const Message = require('../models/Message');
const Match = require('../models/Match');
const Block = require('../models/Block');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { getRandomIcebreakers } = require('../utils/icebreakerPrompts');
const { cloudinary, configureCloudinary } = require('../config/cloudinary');
const fs = require('fs');

exports.getUnreadCount = async (req, res, next) => {
  try {
    const matchIds = await Match.distinct('_id', { users: req.user._id, isActive: true });
    const count = matchIds.length ? await Message.countDocuments({
      match: { $in: matchIds },
      sender: { $ne: req.user._id },
      readAt: null,
    }) : 0;
    res.json({ success: true, count });
  } catch (error) {
    next(error);
  }
};

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

    const unreadMessages = await Message.find({
      match: matchId,
      sender: { $ne: req.user._id },
      readAt: null,
    }).select('_id sender').lean();

    if (unreadMessages.length) {
      const readAt = new Date();
      const messageIds = unreadMessages.map((message) => message._id);
      await Message.updateMany({ _id: { $in: messageIds } }, { $set: { readAt } });
      const receipt = {
        matchId,
        readerId: req.user._id.toString(),
        messageIds: messageIds.map((id) => id.toString()),
        readAt,
      };
      const io = req.app.get('io');
      io?.to(`match:${matchId}`).emit('messages_read', receipt);
      const senderIds = [...new Set(unreadMessages.map((message) => message.sender.toString()))];
      senderIds.forEach((senderId) => io?.to(`user:${senderId}`).emit('messages_read', receipt));
      io?.to(`user:${req.user._id}`).emit('chat_unread_changed');
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

// ── SEND IMAGE MESSAGE ─────────────────────────────────────────────
exports.sendImageMessage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please choose an image' });
    }

    const { matchId } = req.params;
    const match = await Match.findOne({ _id: matchId, users: req.user._id, isActive: true });
    if (!match) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ success: false, message: 'Match not found' });
    }

    const otherUserId = match.users.find((id) => id.toString() !== req.user._id.toString());
    const blocked = await Block.exists({
      $or: [
        { blocker: req.user._id, blocked: otherUserId },
        { blocker: otherUserId, blocked: req.user._id },
      ],
    });
    if (blocked) {
      fs.unlink(req.file.path, () => {});
      return res.status(403).json({ success: false, message: 'Cannot chat — user blocked' });
    }

    let imageUrl;
    let imagePublicId;
    if (configureCloudinary()) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: 'ca-connect/chat',
        resource_type: 'image',
        allowed_formats: ['jpg', 'png', 'webp'],
      });
      imageUrl = result.secure_url;
      imagePublicId = result.public_id;
      fs.unlink(req.file.path, () => {});
    } else {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    const message = await Message.create({
      match: matchId,
      sender: req.user._id,
      type: 'image',
      imageUrl,
      imagePublicId,
    });
    const populated = await message.populate('sender', 'name photos');
    const payload = populated.toObject();
    delete payload.imagePublicId;

    const io = req.app.get('io');
    io?.to(`match:${matchId}`).emit('new_message', payload);
    io?.to(`user:${otherUserId}`).emit('chat_unread_changed');

    const recipient = await User.findById(otherUserId).select('notificationPreferences').lean();
    if (recipient?.notificationPreferences?.messages !== false) {
      await Notification.create({
        user: otherUserId,
        type: 'new_message',
        data: { matchId, senderId: req.user._id, preview: 'Photo' },
      });
      io?.to(`user:${otherUserId}`).emit('notification', {
        type: 'new_message', matchId, preview: 'Photo',
      });
    }

    return res.status(201).json({ success: true, data: payload });
  } catch (error) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return next(error);
  }
};

// ── ICEBREAKER PROMPTS ──────────────────────────────────────────────
exports.getIcebreakers = (req, res) => {
  const count = parseInt(req.query.count, 10) || 3;
  res.json({ success: true, prompts: getRandomIcebreakers(count) });
};
