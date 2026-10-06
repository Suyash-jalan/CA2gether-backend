const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema(
  {
    // ── Authentication ───────────────────────────────────────────
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 8,
      select: false, // never returned in queries by default
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },

    // ── Email verification ───────────────────────────────────────
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },

    // ── Password reset ───────────────────────────────────────────
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },

    // ── Account lockout ──────────────────────────────────────────
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },

    // ── Basic profile ────────────────────────────────────────────
    name: { type: String, trim: true, maxlength: 100 },
    dateOfBirth: { type: Date },
    age: { type: Number, min: 18, max: 99 },
    gender: { type: String, enum: ['Male', 'Female', 'Non-binary', 'Prefer not to say'] },
    city: { type: String, trim: true, maxlength: 100 },
    bio: { type: String, trim: true, maxlength: 500 },
    photos: [{ type: String }], // array of URLs

    // ── CA-specific fields ───────────────────────────────────────
    caStatus: {
      type: String,
      enum: ['CA Foundation', 'CA Inter', 'CA Final', 'Articleship', 'Qualified CA'],
    },
    icaiRegNumber: { type: String, select: false }, // encrypted at rest
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
    },
    verificationDocument: { type: String }, // private upload path/URL
    verificationRejectionReason: { type: String },

    specialization: {
      type: String,
      enum: ['Audit', 'Tax', 'GST', 'Valuation', 'CFO Track', 'Other'],
    },
    firmName: { type: String, trim: true, maxlength: 200 },
    firmType: {
      type: String,
      enum: ['Big 4', 'Mid-size', 'Independent', 'Industry'],
    },
    workLifeTag: {
      type: String,
      enum: ['Big 4 Hustler', 'Practice Life', 'Industry 9-to-5', 'Prepping for Finals'],
    },

    // ── Exam history ─────────────────────────────────────────────
    examHistory: [
      {
        examStage: String,
        attemptNumber: Number,
        result: String,
      },
    ],
    airRank: { type: Number }, // All India Rank (optional)

    // ── Privacy / Mode toggles ───────────────────────────────────
    anonymousMode: { type: Boolean, default: false },
    hideFromFirm: { type: Boolean, default: false },
    examBuddyMode: { type: Boolean, default: false },
    discoveryVisibility: {
      type: String,
      enum: ['both', 'dating', 'exam_buddy'],
      default: 'both',
    },
    notificationPreferences: {
      matches: { type: Boolean, default: true },
      messages: { type: Boolean, default: true },
      lounge: { type: Boolean, default: true },
    },

    // ── Account status ───────────────────────────────────────────
    accountStatus: {
      type: String,
      enum: ['active', 'deactivated', 'banned'],
      default: 'active',
    },

    // ── Flagging ─────────────────────────────────────────────────
    reportCount: { type: Number, default: 0 },
    isFlagged: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

// ── Indexes ────────────────────────────────────────────────────────
userSchema.index({ city: 1 });
userSchema.index({ caStatus: 1 });
userSchema.index({ specialization: 1 });
userSchema.index({ firmType: 1 });
userSchema.index({ accountStatus: 1 });
userSchema.index({ verificationStatus: 1 });
userSchema.index({ accountStatus: 1, isEmailVerified: 1, gender: 1 });

// ── Pre-save: hash password ────────────────────────────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ── Instance method: compare password ──────────────────────────────
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ── Instance method: check if account is locked ────────────────────
userSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};

// ── Instance method: generate email verification token ─────────────
userSchema.methods.createEmailVerificationToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken = crypto.createHash('sha256').update(token).digest('hex');
  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  return token;
};

// ── Instance method: generate password reset token ─────────────────
userSchema.methods.createPasswordResetToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto.createHash('sha256').update(token).digest('hex');
  this.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1 hour
  return token;
};

module.exports = mongoose.model('User', userSchema);
