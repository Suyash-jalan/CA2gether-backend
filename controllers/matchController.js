const mongoose = require('mongoose');
const Swipe = require('../models/Swipe');
const Match = require('../models/Match');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Message = require('../models/Message');

const DATING_GENDER_FILTERS = {
  Male: ['Female'],
  Female: ['Male'],
  'Non-binary': ['Non-binary', 'Female'],
};

const PASSED_PROFILE_RETENTION_MS = 48 * 60 * 60 * 1000;
const getPassExpiry = () => new Date(Date.now() + PASSED_PROFILE_RETENTION_MS);
const getLegacyPassCutoff = () => new Date(Date.now() - PASSED_PROFILE_RETENTION_MS);

const removeExpiredPasses = (swiper, mode) => {
  const filter = {
    swiper,
    action: 'pass',
    $or: [
      { expiresAt: { $lte: new Date() } },
      { expiresAt: { $exists: false }, updatedAt: { $lte: getLegacyPassCutoff() } },
    ],
  };
  if (mode) filter.mode = mode;
  return Swipe.deleteMany(filter);
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

    if (
      (swipeMode === 'dating' && target.discoveryVisibility === 'exam_buddy')
      || (swipeMode === 'exam_buddy' && target.discoveryVisibility === 'dating')
    ) {
      return res.status(400).json({ success: false, message: 'This profile is not available in this mode' });
    }

    const allowedDatingGenders = DATING_GENDER_FILTERS[req.user.gender];
    if (swipeMode === 'dating' && allowedDatingGenders && !allowedDatingGenders.includes(target.gender)) {
      return res.status(400).json({ success: false, message: 'This profile is not available in dating mode' });
    }

    // Upsert the swipe (in case they re-swipe)
    const swipeUpdate = {
      $set: {
        action,
        mode: swipeMode,
        ...(action === 'pass' ? { expiresAt: getPassExpiry() } : {}),
      },
    };
    if (action !== 'pass') swipeUpdate.$unset = { expiresAt: 1 };

    await Swipe.findOneAndUpdate(
      { swiper: swiperId, swiped: targetUserId, mode: swipeMode },
      swipeUpdate,
      { upsert: true, new: true }
    );

    if (action === 'like') {
      req.app.get('io')?.to(`user:${targetUserId}`).emit('incoming_like', {
        mode: swipeMode,
        senderId: swiperId.toString(),
      });
    }

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
          } else if (!existingMatch.isActive) {
            existingMatch.isActive = true;
            await existingMatch.save({ session });

            const notifications = [];
            if (req.user.notificationPreferences?.matches !== false) {
              notifications.push({ user: swiperId, type: 'new_match', data: { matchId: existingMatch._id, matchedUserId: targetUserId } });
            }
            if (target.notificationPreferences?.matches !== false) {
              notifications.push({ user: targetUserId, type: 'new_match', data: { matchId: existingMatch._id, matchedUserId: swiperId } });
            }
            if (notifications.length) {
              await Notification.create(notifications, { session, ordered: true });
            }
            matched = true;
          } else {
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

    await removeExpiredPasses(req.user._id, mode);

    const likes = await Swipe.find({
      swiped: req.user._id,
      action: 'like',
      mode,
      swiper: { $nin: blockedIds },
    })
      .populate('swiper', 'name photos city caStatus verificationStatus bio')
      .sort({ updatedAt: -1 })
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
        createdAt: like.updatedAt || like.createdAt,
        user: like.swiper,
      }));

    res.json({ success: true, data, total: data.length });
  } catch (error) {
    next(error);
  }
};

// ── PROFILES I PASSED ──────────────────────────────────────────────
exports.getPassedProfiles = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, mode } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const skip = (pageNum - 1) * limitNum;
    const blockedIds = req.blockedUserIds || [];
    await removeExpiredPasses(req.user._id, mode);
    // Filter invalid/deleted accounts before paginating. Otherwise a page full
    // of orphaned swipe records is populated as null and the UI appears empty.
    const eligibleUserIds = await User.distinct('_id', {
      accountStatus: 'active',
      _id: { $nin: blockedIds },
    });
    const filter = {
      swiper: req.user._id,
      swiped: { $in: eligibleUserIds },
      action: 'pass',
    };
    if (mode) filter.mode = mode;

    const [total, passes] = await Promise.all([
      Swipe.countDocuments(filter),
      Swipe.find(filter)
        .populate('swiped', 'name age gender city bio photos caStatus specialization firmName firmType workLifeTag anonymousMode')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    const data = passes
      .filter((pass) => pass.swiped)
      .map((pass) => ({
        _id: pass._id,
        mode: pass.mode,
        passedAt: pass.updatedAt,
        expiresAt: pass.expiresAt || new Date(new Date(pass.updatedAt).getTime() + PASSED_PROFILE_RETENTION_MS),
        user: pass.swiped.anonymousMode
          ? { ...pass.swiped, name: 'Anonymous CA', photos: [] }
          : pass.swiped,
      }));

    res.json({
      success: true,
      data,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
};

exports.restorePassedProfile = async (req, res, next) => {
  try {
    const filter = {
      swiper: req.user._id,
      swiped: req.params.userId,
      action: 'pass',
    };
    if (req.query.mode) filter.mode = req.query.mode;

    const removed = await Swipe.findOneAndDelete(filter);
    if (!removed) {
      return res.status(404).json({ success: false, message: 'Passed profile not found' });
    }

    res.json({ success: true, message: 'Profile returned to Discover' });
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
    const swipeMode = isExamBuddyMode ? 'exam_buddy' : 'dating';

    await removeExpiredPasses(userId, swipeMode);

    // Fetch only the IDs needed by the exclusion filter.
    const alreadySwiped = await Swipe.distinct('swiped', {
      swiper: userId,
      mode: swipeMode,
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

    // Exam Buddy is open to every eligible profile, regardless of gender or
    // whether that person uses it as their default discovery mode. Dating keeps
    // its own gender rules, and its swipe history is excluded separately above.
    if (!isExamBuddyMode) {
      filter.discoveryVisibility = { $ne: 'exam_buddy' };
      const allowedGenders = DATING_GENDER_FILTERS[req.user.gender];
      if (allowedGenders) filter.gender = { $in: allowedGenders };
    } else {
      filter.discoveryVisibility = { $ne: 'dating' };
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

    const matchIds = matches.map((match) => match._id);
    const unreadByMatch = matchIds.length ? await Message.aggregate([
      {
        $match: {
          match: { $in: matchIds },
          sender: { $ne: req.user._id },
          readAt: null,
        },
      },
      { $group: { _id: '$match', count: { $sum: 1 } } },
    ]) : [];
    const unreadCounts = new Map(unreadByMatch.map((item) => [item._id.toString(), item.count]));

    // Strip anonymous data for non-self users
    const sanitised = matches.map((m) => {
      m.unreadCount = unreadCounts.get(m._id.toString()) || 0;
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
