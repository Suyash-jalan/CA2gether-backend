const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Message = require('../models/Message');
const Match = require('../models/Match');
const Block = require('../models/Block');
const User = require('../models/User');
const logger = require('../utils/logger');
const { sanitizeText } = require('../utils/sanitize');

/**
 * Initialise Socket.io on the given HTTP server.
 * Returns the `io` instance so other modules can reference it.
 */
const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: (process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map((origin) => origin.trim()),
      credentials: true,
    },
  });

  // ── JWT auth middleware on handshake ────────────────────────────
  io.use(async (socket, next) => {
    const token =
      socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      const user = await User.findById(decoded.id).select('accountStatus isEmailVerified');
      if (!user || user.accountStatus !== 'active' || (process.env.NODE_ENV === 'production' && !user.isEmailVerified)) return next(new Error('Account cannot access chat'));
      socket.userId = decoded.id;
      next();
    } catch (err) {
      return next(new Error('Invalid or expired token'));
    }
  });

  // ── Connection handler ─────────────────────────────────────────
  io.on('connection', (socket) => {
    logger.info(`Socket connected: userId=${socket.userId}`);

    // Join a personal room so we can push notifications
    socket.join(`user:${socket.userId}`);

    // ── Join a chat room (match-based) ─────────────────────────
    socket.on('join_chat', async ({ matchId } = {}) => {
      try {
        // Verify the match exists and includes this user
        const match = await Match.findOne({
          _id: matchId,
          users: socket.userId,
          isActive: true,
        });

        if (!match) {
          return socket.emit('error_msg', { message: 'Match not found or access denied' });
        }

        // Check block status between the two users
        const otherUserId = match.users.find((u) => u.toString() !== socket.userId);
        const blocked = await Block.findOne({
          $or: [
            { blocker: socket.userId, blocked: otherUserId },
            { blocker: otherUserId, blocked: socket.userId },
          ],
        });

        if (blocked) {
          return socket.emit('error_msg', { message: 'Cannot chat — user blocked' });
        }

        socket.join(`match:${matchId}`);
        socket.emit('joined_chat', { matchId });
      } catch (err) {
        logger.error(`join_chat error: ${err.message}`);
        socket.emit('error_msg', { message: 'Server error joining chat' });
      }
    });

    // ── Send a message ─────────────────────────────────────────
    socket.on('send_message', async ({ matchId, content } = {}) => {
      try {
        if (!content || typeof content !== 'string' || content.trim().length === 0) {
          return socket.emit('error_msg', { message: 'Message content is required' });
        }

        // Verify match + membership
        const match = await Match.findOne({
          _id: matchId,
          users: socket.userId,
          isActive: true,
        });

        if (!match) {
          return socket.emit('error_msg', { message: 'Match not found or access denied' });
        }

        // Block check
        const otherUserId = match.users.find((u) => u.toString() !== socket.userId);
        const blocked = await Block.findOne({
          $or: [
            { blocker: socket.userId, blocked: otherUserId },
            { blocker: otherUserId, blocked: socket.userId },
          ],
        });

        if (blocked) {
          return socket.emit('error_msg', { message: 'Cannot chat — user blocked' });
        }

        const sanitizedContent = sanitizeText(content.trim());

        const message = await Message.create({
          match: matchId,
          sender: socket.userId,
          content: sanitizedContent,
        });

        const populated = await message.populate('sender', 'name photos');

        // Broadcast to the match room
        io.to(`match:${matchId}`).emit('new_message', populated);
        io.to(`user:${otherUserId}`).emit('chat_unread_changed');

      } catch (err) {
        logger.error(`send_message error: ${err.message}`);
        socket.emit('error_msg', { message: 'Server error sending message' });
      }
    });

    // Mark messages from the other user as read while this chat is open.
    socket.on('mark_read', async ({ matchId } = {}) => {
      try {
        if (!socket.rooms.has(`match:${matchId}`)) return;

        const match = await Match.findOne({
          _id: matchId,
          users: socket.userId,
          isActive: true,
        }).select('_id');
        if (!match) return;

        const unreadMessages = await Message.find({
          match: matchId,
          sender: { $ne: socket.userId },
          readAt: null,
        }).select('_id sender').lean();
        if (!unreadMessages.length) return;

        const readAt = new Date();
        const messageIds = unreadMessages.map((message) => message._id);
        await Message.updateMany({ _id: { $in: messageIds } }, { $set: { readAt } });
        const receipt = {
          matchId,
          readerId: socket.userId,
          messageIds: messageIds.map((id) => id.toString()),
          readAt,
        };
        io.to(`match:${matchId}`).emit('messages_read', receipt);
        const senderIds = [...new Set(unreadMessages.map((message) => message.sender.toString()))];
        senderIds.forEach((senderId) => io.to(`user:${senderId}`).emit('messages_read', receipt));
        io.to(`user:${socket.userId}`).emit('chat_unread_changed');
      } catch (err) {
        logger.error(`mark_read error: ${err.message}`);
      }
    });

    // ── Typing indicator ───────────────────────────────────────
    socket.on('typing', ({ matchId } = {}) => {
      if (!socket.rooms.has(`match:${matchId}`)) return;
      socket.to(`match:${matchId}`).emit('user_typing', { userId: socket.userId });
    });

    socket.on('stop_typing', ({ matchId } = {}) => {
      if (!socket.rooms.has(`match:${matchId}`)) return;
      socket.to(`match:${matchId}`).emit('user_stop_typing', { userId: socket.userId });
    });

    // ── Leave chat room ────────────────────────────────────────
    socket.on('leave_chat', ({ matchId } = {}) => {
      socket.leave(`match:${matchId}`);
    });

    // ── Disconnect ─────────────────────────────────────────────
    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: userId=${socket.userId}`);
    });
  });

  return io;
};

module.exports = initSocket;
