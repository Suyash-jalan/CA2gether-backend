const multer = require('multer');
const path = require('path');
const { randomUUID } = require('crypto');

// Allowed MIME types
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DOCUMENT_TYPES = [...IMAGE_TYPES, 'application/pdf'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

// ── Local disk storage (fallback when Cloudinary keys are absent) ───
const createStorage = (folderName) => multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', folderName);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Sanitise original filename — remove path traversal characters
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${randomUUID()}${ext}`;
    cb(null, safeName);
  },
});

const createFileFilter = (allowedTypes, message) => (req, file, cb) => {
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const error = new Error(message);
    error.statusCode = 400;
    cb(error, false);
  }
};

/**
 * Multer instance for general uploads (photos, verification docs).
 * – max 5 MB per file
 * – only jpg / png / pdf
 */
const photoUpload = multer({
  storage: createStorage('uploads'),
  fileFilter: createFileFilter(IMAGE_TYPES, 'Only JPG, PNG, and WebP images are allowed'),
  limits: { fileSize: MAX_SIZE },
});

const verificationUpload = multer({
  storage: createStorage('private_uploads'),
  fileFilter: createFileFilter(DOCUMENT_TYPES, 'Only JPG, PNG, WebP, and PDF files are allowed'),
  limits: { fileSize: MAX_SIZE },
});

module.exports = { photoUpload, verificationUpload };
