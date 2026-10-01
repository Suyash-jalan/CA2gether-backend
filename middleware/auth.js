const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Protect routes — verifies JWT access token from the Authorization header.
 * Attaches `req.user` (full user doc minus password).
 */
const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorised — no token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists' });
    }

    if (user.accountStatus !== 'active') {
      return res.status(403).json({
        success: false,
        message: user.accountStatus === 'banned' ? 'Account has been banned' : 'Account is deactivated',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Not authorised — invalid token' });
  }
};

/**
 * Require the user's email to be verified before continuing.
 * Must be placed AFTER `protect`.
 */
const requireVerifiedEmail = (req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }
  if (!req.user.isEmailVerified) {
    return res
      .status(403)
      .json({ success: false, message: 'Please verify your email before accessing this resource' });
  }
  next();
};

module.exports = { protect, requireVerifiedEmail };
