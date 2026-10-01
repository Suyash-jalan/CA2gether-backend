const express = require('express');
const { body } = require('express-validator');
const adminController = require('../controllers/adminController');
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { validate } = require('../middleware/validate');
const newsController = require('../controllers/newsController');

const router = express.Router();

// All admin routes require auth + admin role
router.use(protect, requireAdmin);

// ── Verifications ───────────────────────────────────────────────────
router.get('/verifications', adminController.getPendingVerifications);
router.get('/verifications/:userId', adminController.getVerificationDetail);
router.get('/verifications/:userId/document', adminController.getVerificationDocument);
router.post(
  '/verifications/:userId/review',
  [
    body('status').isIn(['verified', 'rejected']).withMessage('Status must be "verified" or "rejected"'),
    body('reason').optional().trim().isLength({ max: 500 }),
  ],
  validate,
  adminController.reviewVerification
);

// ── Reports ─────────────────────────────────────────────────────────
router.get('/reports', adminController.getReports);
router.post(
  '/reports/:reportId/review',
  [
    body('action')
      .isIn(['warned', 'suspended', 'banned', 'dismissed'])
      .withMessage('Invalid action'),
    body('adminNote').optional().trim().isLength({ max: 1000 }),
  ],
  validate,
  adminController.reviewReport
);

// ── Flagged users ───────────────────────────────────────────────────
router.get('/flagged-users', adminController.getFlaggedUsers);

// ── User management ─────────────────────────────────────────────────
router.put(
  '/users/:userId/status',
  [body('accountStatus').isIn(['active', 'deactivated', 'banned'])],
  validate,
  adminController.updateUserStatus
);

// ── Audit logs ──────────────────────────────────────────────────────
router.get('/logs', adminController.getAdminLogs);

// ── News management ────────────────────────────────────────────────
const newsValidation = [
  body('title').trim().notEmpty().isLength({ max: 200 }),
  body('summary').trim().notEmpty().isLength({ max: 500 }),
  body('content').trim().notEmpty().isLength({ max: 20000 }),
  body('category').optional().isIn(['ICAI', 'Exams', 'Tax & Compliance', 'Career', 'Community', 'General']),
  body('status').optional().isIn(['draft', 'published']),
  body('coverImageUrl').optional({ checkFalsy: true }).isURL({ protocols: ['http', 'https'], require_protocol: true }),
  body('sourceUrl').optional({ checkFalsy: true }).isURL({ protocols: ['http', 'https'], require_protocol: true }),
];
router.get('/news', newsController.listAdmin);
router.post('/news', newsValidation, validate, newsController.create);
router.put('/news/:id', newsValidation, validate, newsController.update);
router.delete('/news/:id', newsController.remove);

module.exports = router;
