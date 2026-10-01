const Message = require('../models/Message');
const Match = require('../models/Match');
const { getRandomIcebreakers } = require('../utils/icebreakerPrompts');

// ── GET CHAT HISTORY (paginated) ────────────────────────────────────
exports.getChatHistory = async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    // Verify the user is part of this match
    const match = await Match.findOne({ _id: matchId, users: req.user._id, isActive: true });
    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found' });
    }

    const total = await Message.countDocuments({ match: matchId });
    const messages = await Message.find({ match: matchId })
      .populate('sender', 'name photos')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    res.json({
      success: true,
      data: messages.reverse(), // return in chronological order
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
};

// ── ICEBREAKER PROMPTS ──────────────────────────────────────────────
exports.getIcebreakers = (req, res) => {
  const count = parseInt(req.query.count, 10) || 3;
  res.json({ success: true, prompts: getRandomIcebreakers(count) });
};
