const express = require('express');
const { body } = require('express-validator');
const userController = require('../controllers/userController');
const { protect, requireVerifiedEmail } = require('../middleware/auth');
const { loadBlockList } = require('../middleware/blockFilter');
const { validate } = require('../middleware/validate');
const { photoUpload, verificationUpload } = require('../middleware/upload');

const router = express.Router();

// All routes require authentication
router.use(protect);

// ── Own profile ─────────────────────────────────────────────────────
router.get('/me', userController.getMyProfile);

router.put(
  '/me',
  [
    body('name').optional().trim().isLength({ max: 100 }),
    body('age').optional().isInt({ min: 18, max: 99 }),
    body('gender').optional().isIn(['Male', 'Female', 'Non-binary', 'Prefer not to say']),
    body('city').optional().trim().isLength({ max: 100 }),
    body('bio').optional().trim().isLength({ max: 500 }),
    body('caStatus')
      .optional()
      .isIn(['CA Foundation', 'CA Inter', 'CA Final', 'Articleship', 'Qualified CA']),
    body('specialization')
      .optional()
      .isIn(['Audit', 'Tax', 'GST', 'Valuation', 'CFO Track', 'Other']),
    body('firmType').optional().isIn(['Big 4', 'Mid-size', 'Independent', 'Industry']),
    body('workLifeTag')
      .optional()
      .isIn(['Big 4 Hustler', 'Practice Life', 'Industry 9-to-5', 'Prepping for Finals']),
    body('anonymousMode').optional().isBoolean(),
    body('hideFromFirm').optional().isBoolean(),
    body('examBuddyMode').optional().isBoolean(),
    body('notificationPreferences').optional().isObject(),
    body('notificationPreferences.matches').optional().isBoolean(),
    body('notificationPreferences.messages').optional().isBoolean(),
    body('notificationPreferences.lounge').optional().isBoolean(),
  ],
  validate,
  userController.updateMyProfile
);

// ── Photos ──────────────────────────────────────────────────────────
router.post('/me/photos', photoUpload.array('photos', 6), userController.uploadPhotos);
router.delete('/me/photos', userController.deletePhoto);

// ── Verification ────────────────────────────────────────────────────
router.post(
  '/me/verification',
  verificationUpload.single('document'),
  [body('icaiRegNumber').trim().notEmpty().withMessage('ICAI registration number is required')],
  validate,
  userController.uploadVerificationDoc
);

// ── Account lifecycle ───────────────────────────────────────────────
router.post('/me/deactivate', userController.deactivateAccount);
router.post('/me/reactivate', userController.reactivateAccount);

// ── View other user's profile ───────────────────────────────────────
router.get('/:id', requireVerifiedEmail, loadBlockList, userController.getUserProfile);

module.exports = router;
