const Notification = require('../models/Notification');

// ── GET MY NOTIFICATIONS (unread first) ─────────────────────────────
exports.getNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 30, unreadOnly } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter = { user: req.user._id };
    if (unreadOnly === 'true') filter.isRead = false;

    const total = await Notification.countDocuments(filter);
    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const unreadCount = await Notification.countDocuments({ user: req.user._id, isRead: false });

    res.json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
};

// ── MARK NOTIFICATION(S) AS READ ────────────────────────────────────
exports.markAsRead = async (req, res, next) => {
  try {
    const { notificationId } = req.params;

    if (notificationId) {
      await Notification.findOneAndUpdate(
        { _id: notificationId, user: req.user._id },
        { isRead: true }
      );
    }

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    next(error);
  }
};

// ── MARK ALL NOTIFICATIONS AS READ ──────────────────────────────────
exports.markAllAsRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { isRead: true }
    );

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    next(error);
  }
};
