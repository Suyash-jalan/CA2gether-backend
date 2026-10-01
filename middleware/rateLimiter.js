const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';

/**
 * General API rate limiter — relaxed in dev mode.
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev,
  message: { success: false, message: 'Too many requests — please try again later' },
});

/**
 * Strict auth-route rate limiter — relaxed in dev mode.
 */
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) || (isDev ? 1000 : 5),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev,
  message: {
    success: false,
    message: 'Too many authentication attempts — please try again later',
  },
});

module.exports = { generalLimiter, authLimiter };

