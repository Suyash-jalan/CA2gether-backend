const winston = require('winston');
const path = require('path');

// Custom format that redacts sensitive fields
const redactSensitive = winston.format((info) => {
  if (info.message && typeof info.message === 'string') {
    info.message = info.message
      .replace(/password["']?\s*[:=]\s*["'][^"']*["']/gi, 'password=***REDACTED***')
      .replace(/token["']?\s*[:=]\s*["'][^"']*["']/gi, 'token=***REDACTED***')
      .replace(/secret["']?\s*[:=]\s*["'][^"']*["']/gi, 'secret=***REDACTED***');
  }
  return info;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    redactSensitive(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'ca-connect' },
  transports: [
    new winston.transports.File({
      filename: path.join(__dirname, '..', 'logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '..', 'logs', 'combined.log'),
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

// Also log to console in non-production
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    })
  );
}

module.exports = logger;
