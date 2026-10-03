const mongoose = require('mongoose');
const Swipe = require('../models/Swipe');
const Match = require('../models/Match');
const User = require('../models/User');
const Notification = require('../models/Notification');

const DATING_GENDER_FILTERS = {
  Male: ['Female'],
  Female: ['Male'],
  'Non-binary': ['Non-binary', 'Female'],
};

// ── SWIPE (like / pass) ─────────────────────────────────────────────
exports.swipe = async (req, res, next) => {
  try {
    const { targetUserId, action, mode } = req.body;
    const swiperId = req.user._id;

    if (swiperId.toString() === targetUserId) {
      return res.status(400).json({ success: false, message: 'Cannot swipe on yourself' });
    }

    // Verify target exists
    const target = await User.findById(targetUserId);
    if (!target || target.accountStatus === 'banned') {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if in block list
    if (req.blockedUserIds && req.blockedUserIds.includes(targetUserId)) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const swipeMode = mode || 'dating';

    const allowedDatingGenders = DATING_GENDER_FILTERS[req.user.gender];
    if (swipeMode === 'dating' && allowedDatingGenders && !allowedDatingGenders.includes(target.gender)) {
      return res.status(400).json({ success: false, message: 'This profile is not available in dating mode' });
    }

    // Upsert the swipe (in case they re-swipe)
    await Swipe.findOneAndUpdate(
      { swiper: swiperId, swiped: targetUserId, mode: swipeMode },
      { action, mode: swipeMode },
      { upsert: true, new: true }
    );

    let matched = false;

    // If it's a "like", check for mutual match
    if (action === 'like') {
      const reciprocal = await Swipe.findOne({
        swiper: targetUserId,
        swiped: swiperId,
        action: 'like',
        mode: swipeMode,
      });

      if (reciprocal) {
        // Create match — use a transaction to avoid duplicates
        const session = await mongoose.startSession();
        try {
          session.startTransaction();

          // Check if match already exists
          const existingMatch = await Match.findOne({
            users: { $all: [swiperId, targetUserId] },
            mode: swipeMode,
          }).session(session);

          if (!existingMatch) {
            const [newMatch] = await Match.create(
              [{ users: [swiperId, targetUserId], mode: swipeMode }],
              { session }
            );

            // Create notifications for both users
            const notifications = [];
            if (req.user.notificationPreferences?.matches !== false) {
              notifications.push({ user: swiperId, type: 'new_match', data: { matchId: newMatch._id, matchedUserId: targetUserId } });
            }
            if (target.notificationPreferences?.matches !== false) {
              notifications.push({ user: targetUserId, type: 'new_match', data: { matchId: newMatch._id, matchedUserId: swiperId } });
            }
            if (notifications.length) {
              await Notification.create(notifications, { session, ordered: true });
            }

            matched = true;
          }

          await session.commitTransaction();
        } catch (txErr) {
          await session.abortTransaction();
          throw txErr;
        } finally {
          session.endSession();
        }
      }
    }

    res.json({ success: true, action, matched });
  } catch (error) {
    next(error);
  }
};

// ── INCOMING LIKES ─────────────────────────────────────────────────
exports.getIncomingLikes = async (req, res, next) => {
  try {
    const { mode = 'dating' } = req.query;
    const blockedIds = req.blockedUserIds || [];

    const likes = await Swipe.find({
      swiped: req.user._id,
      action: 'like',
      mode,
      swiper: { $nin: blockedIds },
    })
      .populate('swiper', 'name photos city caStatus verificationStatus bio')
      .sort({ createdAt: -1 })
      .lean();

    const activeMatches = await Match.find({
      users: req.user._id,
      mode,
      isActive: true,
    }).select('users').lean();
    const matchedUserIds = new Set(
      activeMatches.flatMap((match) => match.users.map((id) => id.toString()))
    );

    const declined = await Swipe.find({ swiper: req.user._id, mode, action: 'pass' }).select('swiped').lean();
    const declinedIds = new Set(declined.map((item) => item.swiped.toString()));
    const data = likes
      .filter((like) => like.swiper && !declinedIds.has(like.swiper._id.toString()) && !matchedUserIds.has(like.swiper._id.toString()))
      .map((like) => ({
        _id: like._id,
        mode: like.mode,
        createdAt: like.createdAt,
        user: like.swiper,
      }));

    res.json({ success: true, data, total: data.length });
  } catch (error) {
    next(error);
  }
};

// ── DISCOVERY FEED ──────────────────────────────────────────────────
exports.discover = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const {
      page = 1,
      limit = 20,
      city,
      caStatus,
      firmType,
      specialization,
      examBuddyMode,
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const skip = (pageNum - 1) * limitNum;

    const isExamBuddyMode = examBuddyMode === 'true';

    // Fetch only the IDs needed by the exclusion filter.
    const alreadySwiped = await Swipe.distinct('swiped', {
      swiper: userId,
      mode: isExamBuddyMode ? 'exam_buddy' : 'dating',
    });

    // Build exclusion list
    const excludeIds = [
      userId,
      ...(req.blockedUserIds || []),
      ...alreadySwiped,
    ];

    // Build filter
    const filter = {
      _id: { $nin: excludeIds },
      accountStatus: 'active',
      isEmailVerified: true,
    };

    // Exam Buddy mode filter
    if (isExamBuddyMode) {
      filter.examBuddyMode = true;
    } else {
      const allowedGenders = DATING_GENDER_FILTERS[req.user.gender];
      if (allowedGenders) filter.gender = { $in: allowedGenders };
    }

    if (city) filter.city = { $regex: new RegExp(city, 'i') };
    if (caStatus) filter.caStatus = caStatus;
    if (firmType) filter.firmType = firmType;
    if (specialization) filter.specialization = specialization;

    // "Hide from my firm" logic
    if (req.user.hideFromFirm && req.user.firmName) {
      filter.$or = [
        { firmName: { $ne: req.user.firmName } },
        { firmName: { $exists: false } },
        { firmName: '' },
      ];
    }

    // Also exclude users who have hideFromFirm ON and share the same firm
    if (req.user.firmName) {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { hideFromFirm: false },
          { hideFromFirm: { $exists: false } },
          { firmName: { $ne: req.user.firmName } },
          { firmName: { $exists: false } },
          { firmName: '' },
        ],
      });
    }

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select('name age gender city bio photos caStatus verificationStatus specialization firmName firmType workLifeTag anonymousMode')
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    // Apply anonymous mode — hide name/photos for anonymous users
    const sanitisedUsers = users.map((u) => {
      if (u.anonymousMode) {
        return { ...u, name: 'Anonymous CA', photos: [] };
      }
      return u;
    });

    res.json({
      success: true,
      data: sanitisedUsers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── GET MY MATCHES ──────────────────────────────────────────────────
exports.getMatches = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, mode } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const skip = (pageNum - 1) * limitNum;

    const filter = { users: req.user._id, isActive: true };
    if (mode) filter.mode = mode;

    const total = await Match.countDocuments(filter);
    const matches = await Match.find(filter)
      .populate('users', 'name photos city caStatus anonymousMode')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Strip anonymous data for non-self users
    const sanitised = matches.map((m) => {
      m.users = m.users.map((u) => {
        if (u._id.toString() !== req.user._id.toString() && u.anonymousMode) {
          // Matched users can see each other even in anonymous mode
          // (anonymous mode only affects discovery)
        }
        return u;
      });
      return m;
    });

    res.json({
      success: true,
      data: sanitised,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
};

// ── UNMATCH ─────────────────────────────────────────────────────────
exports.unmatch = async (req, res, next) => {
  try {
    const match = await Match.findOne({
      _id: req.params.matchId,
      users: req.user._id,
    });

    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found' });
    }

    match.isActive = false;
    await match.save();

    res.json({ success: true, message: 'Unmatched successfully' });
  } catch (error) {
    next(error);
  }
};
