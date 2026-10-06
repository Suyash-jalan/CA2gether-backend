require('dotenv').config();

const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const xssClean = require('xss-clean');
const morgan = require('morgan');

const connectDB = require('./config/db');
const validateEnvironment = require('./config/env');
const initSocket = require('./config/socket');
const { generalLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const requireDatabase = require('./middleware/requireDatabase');
const logger = require('./utils/logger');
const User = require('./models/User');
const Post = require('./models/Post');
const Message = require('./models/Message');
const { configureCloudinary } = require('./config/cloudinary');

// ── Route imports ───────────────────────────────────────────────────
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const matchRoutes = require('./routes/matchRoutes');
const chatRoutes = require('./routes/chatRoutes');
const communityRoutes = require('./routes/communityRoutes');
const safetyRoutes = require('./routes/safetyRoutes');
const adminRoutes = require('./routes/adminRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const newsRoutes = require('./routes/newsRoutes');

// ── Initialise Express + HTTP server ────────────────────────────────
const app = express();
const server = http.createServer(app);
mongoose.set('bufferCommands', false);

// ── Ensure required directories exist ───────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
const privateUploadsDir = path.join(__dirname, 'private_uploads');
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(privateUploadsDir)) fs.mkdirSync(privateUploadsDir, { recursive: true });
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// ═══════════════════════════════════════════════════════════════════
//  GLOBAL MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════

// Security headers
app.use(helmet());

// CORS — restrict to known frontend origin
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      const error = new Error('Origin is not allowed by CORS');
      error.statusCode = 403;
      return callback(error);
    },
    credentials: true,
  })
);

// Rate limiting (general)
app.use(generalLimiter);

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser (for refresh token cookie)
app.use(cookieParser());

// NoSQL injection prevention
app.use(mongoSanitize());

// XSS prevention
app.use(xssClean());

// HTTP request logging (dev: coloured, prod: combined to file)
if (process.env.NODE_ENV === 'production') {
  app.use(
    morgan('combined', {
      stream: { write: (msg) => logger.info(msg.trim()) },
    })
  );
} else {
  app.use(morgan('dev'));
}

// Serve uploaded files (local storage fallback)
app.get('/uploads/:filename', requireDatabase, async (req, res, next) => {
  try {
    const filename = path.basename(req.params.filename);
    const [isProfilePhoto, isPostImage, isChatImage] = await Promise.all([
      User.exists({ photos: `/uploads/${filename}` }),
      Post.exists({ imageUrl: `/uploads/${filename}` }),
      Message.exists({ imageUrl: `/uploads/${filename}` }),
    ]);
    if (!isProfilePhoto && !isPostImage && !isChatImage) return res.status(404).json({ success: false, message: 'Image not found' });
    // Public profile and post images are intentionally embedded by the
    // frontend, which may run on a different origin in development/deploys.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.sendFile(path.join(uploadsDir, filename));
  } catch (error) {
    return next(error);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════════

app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'CA2gether API is running',
    frontend: process.env.FRONTEND_URL || 'http://localhost:3000',
    health: '/api/health',
    readiness: '/api/ready',
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'CA2gether API is running',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'reconnecting',
    timestamp: new Date(),
  });
});

app.get('/api/ready', (req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  const emailConfigured = Boolean(
    (process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL)
    || process.env.RESEND_API_KEY
    || (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS)
  );
  const persistentUploads = process.env.NODE_ENV !== 'production' || configureCloudinary();
  const ready = dbReady && emailConfigured && persistentUploads;
  res.status(ready ? 200 : 503).json({
    success: ready,
    checks: { database: dbReady, emailConfigured, persistentUploads },
  });
});

app.get('/api/auth/login', (_req, res) => {
  res.redirect(302, `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`);
});

// All feature routes depend on MongoDB. Return a stable, user-safe response
// while the retry loop is restoring the connection.
app.use('/api', requireDatabase);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/match', matchRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/safety', safetyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/news', newsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Centralised error handler
app.use(errorHandler);

// ═══════════════════════════════════════════════════════════════════
//  SOCKET.IO
// ═══════════════════════════════════════════════════════════════════

const io = initSocket(server);
app.set('io', io);

// ═══════════════════════════════════════════════════════════════════
//  START SERVER
// ═══════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 5000;
let reconnectTimer;

const connectWithRetry = async () => {
  try {
    await connectDB();
  } catch {
    const retryMs = parseInt(process.env.MONGO_RETRY_INTERVAL_MS, 10) || 15000;
    logger.warn(`Database unavailable; retrying in ${Math.round(retryMs / 1000)} seconds`);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWithRetry, retryMs);
    reconnectTimer.unref();
  }
};

const startServer = async () => {
  validateEnvironment();
  connectWithRetry();
  return server.listen(PORT, () => {
    logger.info(`CA2gether API server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
};

if (require.main === module) {
  startServer().catch((error) => {
    logger.error(`Server startup failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { app, server, startServer };
