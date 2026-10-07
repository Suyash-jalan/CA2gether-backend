const User = require('../models/User');
const Report = require('../models/Report');
const AdminLog = require('../models/AdminLog');
const Notification = require('../models/Notification');
const { decrypt } = require('../utils/encryption');
const { cloudinary, configureCloudinary } = require('../config/cloudinary');
const path = require('path');

// ── Helper: log admin action ────────────────────────────────────────
const logAction = async (adminId, action, target, details) => {
  await AdminLog.create({ admin: adminId, action, target, details });
};

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD SUMMARY
// ═══════════════════════════════════════════════════════════════════

exports.getDashboardStats = async (_req, res, next) => {
  try {
    const totalAccounts = await User.countDocuments();
    res.json({ success: true, data: { totalAccounts } });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════
//  VERIFICATION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

exports.getPendingVerifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const skip = (pageNum - 1) * limitNum;

    const filter = { verificationStatus: 'pending', verificationDocument: { $exists: true, $ne: null } };

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select('name email caStatus verificationDocument verificationStatus createdAt')
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    res.json({
      success: true,
      data: users,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
};

exports.getVerificationDetail = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('+icaiRegNumber name email caStatus verificationDocument verificationStatus')
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Decrypt ICAI number for admin viewing
    let icaiNumber = null;
    if (user.icaiRegNumber) {
      try {
        icaiNumber = decrypt(user.icaiRegNumber);
      } catch {
        icaiNumber = '[decryption error]';
      }
    }

    res.json({
      success: true,
      data: { ...user, icaiRegNumber: icaiNumber },
    });
  } catch (error) {
    next(error);
  }
};

exports.getVerificationDocument = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId).select('verificationDocument');
    if (!user?.verificationDocument) {
      return res.status(404).json({ success: false, message: 'Verification document not found' });
    }

    const reference = user.verificationDocument;
    if (reference.startsWith('private:')) {
      const filename = path.basename(reference.slice('private:'.length));
      return res.sendFile(path.join(__dirname, '..', 'private_uploads', filename));
    }
    if (reference.startsWith('cloudinary:') && configureCloudinary()) {
      const signedUrl = cloudinary.url(reference.slice('cloudinary:'.length), {
        type: 'authenticated', resource_type: 'auto', secure: true, sign_url: true,
      });
      return res.redirect(signedUrl);
    }
    if (reference.startsWith('/uploads/')) {
      return res.sendFile(path.join(__dirname, '..', 'uploads', path.basename(reference)));
    }
    return res.status(404).json({ success: false, message: 'Verification document unavailable' });
  } catch (error) {
    return next(error);
  }
};

exports.reviewVerification = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { status, reason } = req.body; // status: 'verified' | 'rejected'

    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be "verified" or "rejected"' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.verificationStatus = status;
    if (status === 'rejected') {
      user.verificationRejectionReason = reason || 'No reason provided';
    }
    await user.save({ validateBeforeSave: false });

    // Notify the user
    await Notification.create({
      user: userId,
      type: 'verification_update',
      data: { status, reason: status === 'rejected' ? user.verificationRejectionReason : undefined },
    });

    // Log admin action
    await logAction(req.user._id, `verification_${status}`, `User:${userId}`, { reason });

    res.json({ success: true, message: `Verification ${status}` });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════
//  REPORT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

exports.getReports = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (status) filter.status = status;

    const total = await Report.countDocuments(filter);
    const reports = await Report.find(filter)
      .populate('reporter', 'name email')
      .populate('reportedUser', 'name email accountStatus isFlagged reportCount')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    res.json({
      success: true,
      data: reports,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
};

exports.reviewReport = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const { action, adminNote } = req.body; // action: 'warned' | 'suspended' | 'banned' | 'dismissed'

    const validActions = ['warned', 'suspended', 'banned', 'dismissed'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: `Action must be one of: ${validActions.join(', ')}`,
      });
    }

    const report = await Report.findById(reportId);
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    report.status = action === 'dismissed' ? 'dismissed' : 'action_taken';
    report.adminAction = action === 'dismissed' ? 'none' : action;
    report.adminNote = adminNote;
    report.reviewedBy = req.user._id;
    report.reviewedAt = new Date();
    await report.save();

    // Apply action to reported user
    if (action !== 'dismissed') {
      const reportedUser = await User.findById(report.reportedUser);
      if (reportedUser) {
        if (action === 'banned') {
          reportedUser.accountStatus = 'banned';
        } else if (action === 'suspended') {
          reportedUser.accountStatus = 'deactivated';
        }
        await reportedUser.save({ validateBeforeSave: false });

        // Notify the user
        await Notification.create({
          user: report.reportedUser,
          type: 'report_action',
          data: { action, note: adminNote },
        });
      }
    }

    // Log admin action
    await logAction(req.user._id, `report_${action}`, `Report:${reportId}`, {
      reportedUser: report.reportedUser,
      adminNote,
    });

    res.json({ success: true, message: `Report action "${action}" applied` });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════
//  FLAGGED USERS
// ═══════════════════════════════════════════════════════════════════

exports.getFlaggedUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const skip = (pageNum - 1) * limitNum;

    const filter = { isFlagged: true };
    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select('name email accountStatus reportCount isFlagged createdAt')
      .sort({ reportCount: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    res.json({
      success: true,
      data: users,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════
//  ADMIN AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════

exports.getAdminLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const total = await AdminLog.countDocuments();
    const logs = await AdminLog.find()
      .populate('admin', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    res.json({
      success: true,
      data: logs,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════
//  USER MANAGEMENT (quick admin endpoints)
// ═══════════════════════════════════════════════════════════════════

exports.updateUserStatus = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { accountStatus } = req.body;

    if (!['active', 'deactivated', 'banned'].includes(accountStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid account status' });
    }

    const user = await User.findByIdAndUpdate(userId, { accountStatus }, { new: true });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await logAction(req.user._id, `set_account_status_${accountStatus}`, `User:${userId}`, {});

    res.json({ success: true, message: `Account status set to ${accountStatus}` });
  } catch (error) {
    next(error);
  }
};
