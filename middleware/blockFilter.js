const Block = require('../models/Block');

/**
 * Populate `req.blockedUserIds` with the set of user IDs that the
 * current user has blocked OR that have blocked the current user.
 *
 * This middleware must be placed AFTER `protect`.
 * Downstream handlers should use `req.blockedUserIds` to exclude
 * those users from discovery, chat, and profile look-ups.
 */
const loadBlockList = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const blocks = await Block.find({
      $or: [{ blocker: userId }, { blocked: userId }],
    }).lean();

    const ids = new Set();
    blocks.forEach((b) => {
      ids.add(b.blocker.toString());
      ids.add(b.blocked.toString());
    });

    // Remove self
    ids.delete(userId.toString());

    req.blockedUserIds = [...ids];
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { loadBlockList };
