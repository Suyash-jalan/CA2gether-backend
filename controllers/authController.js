const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');
const logger = require('../utils/logger');
const { encrypt } = require('../utils/encryption');

const googleClient = new OAuth2Client();

// ── Helpers ────────────────────────────────────────────────────────
const generateAccessToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  });

const generateRefreshToken = (userId) =>
  jwt.sign({ id: userId, jti: crypto.randomUUID() }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });

const setRefreshCookie = (res, token) => {
  const production = process.env.NODE_ENV === 'production';
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: production,
    sameSite: production ? (process.env.COOKIE_SAME_SITE || 'none') : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/api/auth',
  });
};

const issueSession = async (user, res) => {
  const accessToken = generateAccessToken(user._id);
  const refreshTokenStr = generateRefreshToken(user._id);
  await RefreshToken.create({
    user: user._id,
    token: refreshTokenStr,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  setRefreshCookie(res, refreshTokenStr);
  return { accessToken, refreshTokenStr };
};

const verifyGoogleCredential = async (credential) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    const error = new Error('Google Sign-In is not configured');
    error.statusCode = 503;
    throw error;
  }
  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
  } catch {
    const error = new Error('Google sign-in could not be verified');
    error.statusCode = 401;
    throw error;
  }
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || !payload.email_verified) {
    const error = new Error('Google account email could not be verified');
    error.statusCode = 401;
    throw error;
  }
  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name || payload.given_name || '',
  };
};

const authUserResponse = (user) => ({
  id: user._id,
  email: user.email,
  name: user.name,
  caStatus: user.caStatus,
  gender: user.gender,
  isEmailVerified: user.isEmailVerified,
  role: user.role,
  authProvider: user.authProvider,
});

// ── SIGNUP ──────────────────────────────────────────────────────────
exports.signup = async (req, res, next) => {
  try {
    const { email, password, name, dateOfBirth, gender, caStatus, icaiRegNumber } = req.body;
    const normalizedRegistrationNumber = icaiRegNumber.trim().toUpperCase();
    const birthDate = new Date(`${dateOfBirth}T00:00:00.000Z`);
    const today = new Date();
    let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
    const month = today.getUTCMonth() - birthDate.getUTCMonth();
    if (month < 0 || (month === 0 && today.getUTCDate() < birthDate.getUTCDate())) age -= 1;

    // Check if email already taken
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const isDev = process.env.NODE_ENV !== 'production';
    const user = await User.create({
      email,
      password,
      name,
      dateOfBirth: birthDate,
      age,
      gender,
      caStatus,
      icaiRegNumber: encrypt(normalizedRegistrationNumber),
      isEmailVerified: isDev,
    });

    // Generate email verification token
    const verifyToken = user.createEmailVerificationToken();
    await user.save({ validateBeforeSave: false });

    // Send verification email (non-blocking — don't let email failure block signup)
    sendVerificationEmail(email, verifyToken).catch((err) =>
      logger.error(`Verification email failed for ${email}: ${err.message}`)
    );

    // Issue tokens
    const accessToken = generateAccessToken(user._id);
    const refreshTokenStr = generateRefreshToken(user._id);

    // Persist refresh token
    await RefreshToken.create({
      user: user._id,
      token: refreshTokenStr,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    setRefreshCookie(res, refreshTokenStr);

    res.status(201).json({
      success: true,
      message: 'Account created — please verify your email',
      accessToken,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        caStatus: user.caStatus,
        gender: user.gender,
        isEmailVerified: user.isEmailVerified,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── LOGIN ───────────────────────────────────────────────────────────
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select(
      '+password +failedLoginAttempts +lockUntil'
    );

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Account lockout check
    if (user.isLocked()) {
      const minutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(423).json({
        success: false,
        message: `Account locked due to too many failed attempts. Try again in ${minutes} minute(s).`,
      });
    }

    // Account banned check
    if (user.accountStatus === 'banned') {
      return res.status(403).json({ success: false, message: 'Account has been banned' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      // Increment failed attempts
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      const maxAttempts = parseInt(process.env.MAX_FAILED_LOGIN_ATTEMPTS, 10) || 5;

      if (user.failedLoginAttempts >= maxAttempts) {
        const lockoutMinutes = parseInt(process.env.LOCKOUT_DURATION_MINUTES, 10) || 30;
        user.lockUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);
        logger.warn(`Account locked: ${email} after ${maxAttempts} failed attempts`);
      }

      await user.save({ validateBeforeSave: false });
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Successful login — reset lockout counters
    if (user.failedLoginAttempts > 0 || user.lockUntil) {
      user.failedLoginAttempts = 0;
      user.lockUntil = undefined;
      await user.save({ validateBeforeSave: false });
    }

    if (user.accountStatus === 'deactivated') {
      user.accountStatus = 'active';
      await user.save({ validateBeforeSave: false });
    }

    // Issue tokens
    const accessToken = generateAccessToken(user._id);
    const refreshTokenStr = generateRefreshToken(user._id);

    await RefreshToken.create({
      user: user._id,
      token: refreshTokenStr,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    setRefreshCookie(res, refreshTokenStr);

    res.json({
      success: true,
      accessToken,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        isEmailVerified: user.isEmailVerified,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── GOOGLE SIGN-IN ─────────────────────────────────────────────────
exports.googleLogin = async (req, res, next) => {
  try {
    const googleProfile = await verifyGoogleCredential(req.body.credential);
    const user = await User.findOne({ email: googleProfile.email }).select('+googleId +password');

    if (!user) {
      return res.status(202).json({
        success: true,
        needsRegistration: true,
        profile: { email: googleProfile.email, name: googleProfile.name },
      });
    }
    if (user.accountStatus === 'banned') {
      return res.status(403).json({ success: false, message: 'Account has been banned' });
    }
    if (user.googleId && user.googleId !== googleProfile.googleId) {
      return res.status(409).json({ success: false, message: 'This email is linked to another Google account' });
    }

    user.googleId = googleProfile.googleId;
    user.authProvider = user.password ? 'both' : 'google';
    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    if (user.accountStatus === 'deactivated') user.accountStatus = 'active';
    await user.save({ validateBeforeSave: false });

    const { accessToken } = await issueSession(user, res);
    return res.json({ success: true, accessToken, user: authUserResponse(user) });
  } catch (error) {
    if (error.statusCode === 401) {
      return res.status(401).json({ success: false, message: error.message });
    }
    return next(error);
  }
};

exports.googleSignup = async (req, res, next) => {
  try {
    const googleProfile = await verifyGoogleCredential(req.body.credential);
    const existing = await User.findOne({ email: googleProfile.email }).select('+googleId');
    if (existing) {
      return res.status(409).json({ success: false, message: 'Account already exists. Use Google Sign-In.' });
    }

    const { name, dateOfBirth, gender, caStatus, icaiRegNumber } = req.body;
    const birthDate = new Date(`${dateOfBirth}T00:00:00.000Z`);
    const today = new Date();
    let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
    const month = today.getUTCMonth() - birthDate.getUTCMonth();
    if (month < 0 || (month === 0 && today.getUTCDate() < birthDate.getUTCDate())) age -= 1;

    const user = await User.create({
      email: googleProfile.email,
      googleId: googleProfile.googleId,
      authProvider: 'google',
      name: name.trim() || googleProfile.name,
      dateOfBirth: birthDate,
      age,
      gender,
      caStatus,
      icaiRegNumber: encrypt(icaiRegNumber.trim().toUpperCase()),
      isEmailVerified: true,
    });

    const { accessToken } = await issueSession(user, res);
    return res.status(201).json({
      success: true,
      message: 'Google account created successfully',
      accessToken,
      user: authUserResponse(user),
    });
  } catch (error) {
    if (error.statusCode === 401) {
      return res.status(401).json({ success: false, message: error.message });
    }
    return next(error);
  }
};

// ── REFRESH TOKEN ───────────────────────────────────────────────────
exports.refreshToken = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) {
      return res.status(401).json({ success: false, message: 'No refresh token provided' });
    }

    // Verify signature
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    // Check in DB (not revoked)
    const storedToken = await RefreshToken.findOne({ token, isRevoked: false });
    if (!storedToken) {
      // Possible token reuse — revoke ALL tokens for this user
      await RefreshToken.updateMany({ user: decoded.id }, { isRevoked: true });
      return res.status(401).json({ success: false, message: 'Refresh token revoked — please login again' });
    }

    // Rotate: revoke old, issue new
    storedToken.isRevoked = true;
    await storedToken.save();

    const newAccessToken = generateAccessToken(decoded.id);
    const newRefreshToken = generateRefreshToken(decoded.id);

    await RefreshToken.create({
      user: decoded.id,
      token: newRefreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    setRefreshCookie(res, newRefreshToken);

    res.json({ success: true, accessToken: newAccessToken });
  } catch (error) {
    next(error);
  }
};

// ── LOGOUT ──────────────────────────────────────────────────────────
exports.logout = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;
    if (token) {
      await RefreshToken.findOneAndUpdate({ token }, { isRevoked: true });
    }

    res.clearCookie('refreshToken', { path: '/api/auth' });
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
};

// ── VERIFY EMAIL ────────────────────────────────────────────────────
exports.verifyEmail = async (req, res, next) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: Date.now() },
    }).select('+emailVerificationToken +emailVerificationExpires');

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification token' });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });

    res.json({ success: true, message: 'Email verified successfully' });
  } catch (error) {
    next(error);
  }
};

// ── RESEND VERIFICATION EMAIL ───────────────────────────────────────
exports.resendVerification = async (req, res, next) => {
  try {
    const user = req.user; // from protect middleware

    if (user.isEmailVerified) {
      return res.status(400).json({ success: false, message: 'Email is already verified' });
    }

    const verifyToken = user.createEmailVerificationToken();
    await user.save({ validateBeforeSave: false });

    await sendVerificationEmail(user.email, verifyToken);

    res.json({ success: true, message: 'Verification email sent' });
  } catch (error) {
    next(error);
  }
};

// ── FORGOT PASSWORD ─────────────────────────────────────────────────
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const message = 'If an account with that email exists, a reset link has been sent';
    const hostname = (req.hostname || '').toLowerCase();
    const isLocalRequest = ['localhost', '127.0.0.1', '::1'].includes(hostname);

    const user = await User.findOne({ email });

    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({
        success: true,
        message,
      });
    }

    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000')
      .split(',')[0]
      .trim()
      .replace(/\/$/, '');
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    try {
      await sendPasswordResetEmail(user.email, resetToken);
    } catch (emailError) {
      if (!isLocalRequest) {
        // Do not leave a usable token behind when its email was not delivered.
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save({ validateBeforeSave: false });
        throw emailError;
      }

      logger.warn(`Password reset email unavailable in development: ${emailError.message}`);
    }

    res.json({
      success: true,
      message,
      // Local development needs a usable path even when SMTP credentials are
      // intentionally absent or invalid. Never expose reset tokens in production.
      ...(isLocalRequest && { resetUrl }),
    });
  } catch (error) {
    next(error);
  }
};

// ── RESET PASSWORD ──────────────────────────────────────────────────
exports.resetPassword = async (req, res, next) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    }).select('+passwordResetToken +passwordResetExpires');

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    user.password = req.body.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    // Revoke all refresh tokens for this user
    await RefreshToken.updateMany({ user: user._id }, { isRevoked: true });

    res.json({ success: true, message: 'Password reset successful — please login with your new password' });
  } catch (error) {
    next(error);
  }
};

// ── GET CURRENT USER ────────────────────────────────────────────────
exports.getMe = async (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      isEmailVerified: req.user.isEmailVerified,
      role: req.user.role,
      accountStatus: req.user.accountStatus,
      authProvider: req.user.authProvider,
    },
  });
};
