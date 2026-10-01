const Block = require('../models/Block');
const Report = require('../models/Report');
const User = require('../models/User');
const Match = require('../models/Match');
const logger = require('../utils/logger');

const AUTO_FLAG_THRESHOLD = 3; // flag after this many reports

// ── BLOCK USER ──────────────────────────────────────────────────────
exports.blockUser = async (req, res, next) => {
  try {
    const { userId } = req.params;

    if (req.user._id.toString() === userId) {
      return res.status(400).json({ success: false, message: 'Cannot block yourself' });
    }

    const target = await User.findById(userId);
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Create block (idempotent via unique index — catch duplicate)
    try {
      await Block.create({ blocker: req.user._id, blocked: userId });
    } catch (err) {
      if (err.code !== 11000) throw err;
      // Already blocked — that's fine
    }

    // Deactivate any active matches between these users
    await Match.updateMany(
      { users: { $all: [req.user._id, userId] }, isActive: true },
      { isActive: false }
    );

    res.json({ success: true, message: 'User blocked' });
  } catch (error) {
    next(error);
  }
};

// ── UNBLOCK USER ────────────────────────────────────────────────────
exports.unblockUser = async (req, res, next) => {
  try {
    const result = await Block.findOneAndDelete({
      blocker: req.user._id,
      blocked: req.params.userId,
    });

    if (!result) {
      return res.status(404).json({ success: false, message: 'Block not found' });
    }

    res.json({ success: true, message: 'User unblocked' });
  } catch (error) {
    next(error);
  }
};

// ── GET MY BLOCKED USERS ────────────────────────────────────────────
exports.getBlockedUsers = async (req, res, next) => {
  try {
    const blocks = await Block.find({ blocker: req.user._id })
      .populate('blocked', 'name photos')
      .lean();

    res.json({ success: true, data: blocks.map((b) => b.blocked) });
  } catch (error) {
    next(error);
  }
};

// ── REPORT USER ─────────────────────────────────────────────────────
exports.reportUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    if (req.user._id.toString() === userId) {
      return res.status(400).json({ success: false, message: 'Cannot report yourself' });
    }

    const target = await User.findById(userId);
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await Report.create({
      reporter: req.user._id,
      reportedUser: userId,
      reason,
    });

    // Increment report count and auto-flag if threshold reached
    target.reportCount = (target.reportCount || 0) + 1;
    if (target.reportCount >= AUTO_FLAG_THRESHOLD && !target.isFlagged) {
      target.isFlagged = true;
      logger.warn(`User ${userId} auto-flagged after ${target.reportCount} reports`);
    }
    await target.save({ validateBeforeSave: false });

    res.json({ success: true, message: 'Report submitted' });
  } catch (error) {
    next(error);
  }
};
