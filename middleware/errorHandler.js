const logger = require('../utils/logger');

/**
 * Centralised error-handling middleware.
 * – Logs the error via Winston.
 * – In production, hides stack traces and internal details from the client.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, _next) => {
  logger.error(err.stack || err.message);

  // Database connectivity errors must never expose driver/Mongoose internals.
  const databaseUnavailable =
    err.name === 'MongooseServerSelectionError' ||
    err.name === 'MongoNetworkError' ||
    /before initial connection is complete|bufferCommands/i.test(err.message || '');
  if (databaseUnavailable) {
    res.set('Retry-After', '15');
    return res.status(503).json({
      success: false,
      code: 'DATABASE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Please try again in a moment.',
    });
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ success: false, message: 'Validation error', errors: messages });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue).join(', ');
    return res
      .status(409)
      .json({ success: false, message: `Duplicate value for: ${field}` });
  }

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, message: 'Invalid ID format' });
  }

  // Multer file-size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'File size exceeds 5 MB limit' });
  }

  // Multer general error
  if (err.name === 'MulterError') {
    return res.status(400).json({ success: false, message: err.message });
  }

  // JWT errors (should already be caught in auth middleware, but just in case)
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }

  const statusCode = err.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message || 'Internal server error';

  res.status(statusCode).json({ success: false, message });
};

module.exports = errorHandler;
