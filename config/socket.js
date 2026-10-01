const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Message = require('../models/Message');
const Match = require('../models/Match');
const Block = require('../models/Block');
const Notification = require('../models/Notification');
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

        // Create notification for the other user
        const recipient = await User.findById(otherUserId).select('notificationPreferences').lean();
        if (recipient?.notificationPreferences?.messages !== false) {
          await Notification.create({
            user: otherUserId,
            type: 'new_message',
            data: { matchId, senderId: socket.userId, preview: sanitizedContent.substring(0, 60) },
          });
          io.to(`user:${otherUserId}`).emit('notification', {
            type: 'new_message', matchId, preview: sanitizedContent.substring(0, 60),
          });
        }
      } catch (err) {
        logger.error(`send_message error: ${err.message}`);
        socket.emit('error_msg', { message: 'Server error sending message' });
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
