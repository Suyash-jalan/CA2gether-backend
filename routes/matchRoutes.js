const express = require('express');
const { body, param, query } = require('express-validator');
const matchController = require('../controllers/matchController');
const { protect, requireVerifiedEmail } = require('../middleware/auth');
const { loadBlockList } = require('../middleware/blockFilter');
const { validate } = require('../middleware/validate');

const router = express.Router();

// All routes require auth + verified email
router.use(protect, requireVerifiedEmail, loadBlockList);

// ── Swipe ───────────────────────────────────────────────────────────
router.post(
  '/swipe',
  [
    body('targetUserId').isMongoId().withMessage('Valid target user ID is required'),
    body('action').isIn(['like', 'pass']).withMessage('Action must be "like" or "pass"'),
    body('mode').optional().isIn(['dating', 'exam_buddy']),
  ],
  validate,
  matchController.swipe
);

// ── Discovery feed ──────────────────────────────────────────────────
router.get(
  '/discover',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('caStatus')
      .optional()
      .isIn(['CA Foundation', 'CA Inter', 'CA Final', 'Articleship', 'Qualified CA']),
    query('firmType').optional().isIn(['Big 4', 'Mid-size', 'Independent', 'Industry']),
    query('specialization')
      .optional()
      .isIn(['Audit', 'Tax', 'GST', 'Valuation', 'CFO Track', 'Other']),
  ],
  validate,
  matchController.discover
);

// ── My matches ──────────────────────────────────────────────────────
router.get('/matches', matchController.getMatches);

// ── People who liked me ────────────────────────────────────────────
router.get(
  '/likes',
  [query('mode').optional().isIn(['dating', 'exam_buddy'])],
  validate,
  matchController.getIncomingLikes
);

router.get(
  '/passed',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('mode').optional().isIn(['dating', 'exam_buddy']),
  ],
  validate,
  matchController.getPassedProfiles
);

router.delete(
  '/passed/:userId',
  [
    param('userId').isMongoId().withMessage('Valid user ID is required'),
    query('mode').optional().isIn(['dating', 'exam_buddy']),
  ],
  validate,
  matchController.restorePassedProfile
);

// ── Unmatch ─────────────────────────────────────────────────────────
router.delete('/matches/:matchId', matchController.unmatch);

module.exports = router;
