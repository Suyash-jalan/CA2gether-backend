const User = require('../models/User');
const { cloudinary, configureCloudinary } = require('../config/cloudinary');
const { encrypt } = require('../utils/encryption');
const { sanitizeText } = require('../utils/sanitize');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

// ── GET MY FULL PROFILE ─────────────────────────────────────────────
exports.getMyProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
};

// ── UPDATE MY PROFILE ───────────────────────────────────────────────
exports.updateMyProfile = async (req, res, next) => {
  try {
    const allowedFields = [
      'name', 'age', 'gender', 'city', 'bio',
      'caStatus', 'specialization', 'firmName', 'firmType',
      'workLifeTag', 'examHistory', 'airRank',
      'anonymousMode', 'hideFromFirm', 'examBuddyMode',
      'notificationPreferences',
    ];

    const updates = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        // Sanitise text fields
        if (typeof req.body[field] === 'string') {
          updates[field] = sanitizeText(req.body[field]);
        } else {
          updates[field] = req.body[field];
        }
      }
    });

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });

    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
};

// ── UPLOAD PROFILE PHOTOS ───────────────────────────────────────────
exports.uploadPhotos = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    const urls = [];
    const useCloudinary = configureCloudinary();
    const user = await User.findById(req.user._id);
    const remainingSlots = Math.max(0, 6 - (user.photos || []).length);

    if (req.files.length > remainingSlots) {
      req.files.forEach((file) => fs.unlink(file.path, () => {}));
      return res.status(400).json({
        success: false,
        message: remainingSlots ? `You can upload only ${remainingSlots} more photo(s)` : 'You already have 6 profile photos',
      });
    }

    for (const file of req.files) {
      if (useCloudinary) {
        const result = await cloudinary.uploader.upload(file.path, {
          folder: 'ca-connect/photos',
          allowed_formats: ['jpg', 'png'],
        });
        urls.push(result.secure_url);
        // Remove temp local file
        fs.unlink(file.path, () => {});
      } else {
        // Local storage — serve via /uploads static route
        urls.push(`/uploads/${file.filename}`);
      }
    }

    // Append to existing photos (max 6)
    const combined = [...(user.photos || []), ...urls];

    user.photos = combined;
    await user.save({ validateBeforeSave: false });

    res.json({ success: true, photos: user.photos });
  } catch (error) {
    next(error);
  }
};

// ── DELETE A PHOTO ──────────────────────────────────────────────────
exports.deletePhoto = async (req, res, next) => {
  try {
    const { photoUrl } = req.body;
    if (!photoUrl) {
      return res.status(400).json({ success: false, message: 'photoUrl is required' });
    }

    const user = await User.findById(req.user._id);
    user.photos = (user.photos || []).filter((p) => p !== photoUrl);
    await user.save({ validateBeforeSave: false });

    // If Cloudinary URL, attempt to delete from Cloudinary
    if (photoUrl.includes('cloudinary') && configureCloudinary()) {
      const publicId = photoUrl.split('/').slice(-1)[0].split('.')[0];
      cloudinary.uploader.destroy(`ca-connect/photos/${publicId}`).catch(() => {});
    }

    // If local file
    if (photoUrl.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '..', photoUrl);
      fs.unlink(filePath, () => {});
    }

    res.json({ success: true, photos: user.photos });
  } catch (error) {
    next(error);
  }
};

// ── UPLOAD VERIFICATION DOCUMENT ────────────────────────────────────
exports.uploadVerificationDoc = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const { icaiRegNumber } = req.body;
    if (!icaiRegNumber) {
      return res.status(400).json({ success: false, message: 'ICAI registration number is required' });
    }

    let docPath;
    const useCloudinary = configureCloudinary();

    if (useCloudinary) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: 'ca-connect/verification',
        resource_type: 'auto',
        access_mode: 'authenticated', // private
      });
      docPath = `cloudinary:${result.public_id}`;
      fs.unlink(req.file.path, () => {});
    } else {
      docPath = `private:${req.file.filename}`;
    }

    const user = await User.findById(req.user._id).select('+icaiRegNumber');
    user.icaiRegNumber = encrypt(icaiRegNumber);
    user.verificationDocument = docPath;
    user.verificationStatus = 'pending';
    user.verificationRejectionReason = undefined;
    await user.save({ validateBeforeSave: false });

    res.json({
      success: true,
      message: 'Verification document uploaded — under review',
      verificationStatus: 'pending',
    });
  } catch (error) {
    next(error);
  }
};

// ── GET ANOTHER USER'S PROFILE ──────────────────────────────────────
exports.getUserProfile = async (req, res, next) => {
  try {
    const targetUser = await User.findById(req.params.id).select(
      'name age gender city bio photos caStatus verificationStatus specialization firmName firmType workLifeTag examHistory airRank anonymousMode accountStatus'
    );

    if (!targetUser || targetUser.accountStatus !== 'active') {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if target is in block list
    if (req.blockedUserIds && req.blockedUserIds.includes(targetUser._id.toString())) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Apply anonymous mode
    let profileData = targetUser.toObject();
    if (targetUser.anonymousMode) {
      // Check if they are matched
      const Match = require('../models/Match');
      const isMatched = await Match.findOne({
        users: { $all: [req.user._id, targetUser._id] },
        isActive: true,
      });

      if (!isMatched) {
        profileData.name = 'Anonymous CA';
        profileData.photos = [];
      }
    }

    res.json({ success: true, user: profileData });
  } catch (error) {
    next(error);
  }
};

// ── DEACTIVATE / REACTIVATE ACCOUNT ─────────────────────────────────
exports.deactivateAccount = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { accountStatus: 'deactivated' });
    res.json({ success: true, message: 'Account deactivated' });
  } catch (error) {
    next(error);
  }
};

exports.reactivateAccount = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { accountStatus: 'active' });
    res.json({ success: true, message: 'Account reactivated' });
  } catch (error) {
    next(error);
  }
};
