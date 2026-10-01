const mongoose = require('mongoose');

/**
 * Fail fast while MongoDB is reconnecting. This prevents individual model
 * queries from throwing Mongoose internals when bufferCommands is disabled.
 */
const requireDatabase = (_req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    res.set('Retry-After', '15');
    return res.status(503).json({
      success: false,
      code: 'DATABASE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Please try again in a moment.',
    });
  }

  return next();
};

module.exports = requireDatabase;
