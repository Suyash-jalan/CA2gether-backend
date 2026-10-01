const express = require('express');
const { body } = require('express-validator');
const safetyController = require('../controllers/safetyController');
const { protect, requireVerifiedEmail } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

router.use(protect, requireVerifiedEmail);

// ── Block / Unblock ─────────────────────────────────────────────────
router.post('/block/:userId', safetyController.blockUser);
router.delete('/block/:userId', safetyController.unblockUser);
router.get('/blocked', safetyController.getBlockedUsers);

// ── Report ──────────────────────────────────────────────────────────
router.post(
  '/report/:userId',
  [body('reason').trim().notEmpty().withMessage('Reason is required').isLength({ max: 1000 })],
  validate,
  safetyController.reportUser
);

module.exports = router;
