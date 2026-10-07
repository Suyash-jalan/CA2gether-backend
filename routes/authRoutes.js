const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Password policy: min 8 chars, at least 1 number + 1 special character
const passwordValidator = body('password')
  .isLength({ min: 8 })
  .withMessage('Password must be at least 8 characters')
  .matches(/\d/)
  .withMessage('Password must contain at least one number')
  .matches(/[!@#$%^&*(),.?":{}|<>]/)
  .withMessage('Password must contain at least one special character');

// ── Public routes ───────────────────────────────────────────────────
router.post(
  '/signup',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('gender')
      .isIn(['Male', 'Female', 'Non-binary', 'Prefer not to say'])
      .withMessage('Please select a valid gender'),
    body('caStatus')
      .isIn(['CA Foundation', 'CA Inter', 'CA Final', 'Articleship', 'Qualified CA'])
      .withMessage('Please select your current CA status'),
    body('icaiRegNumber')
      .trim()
      .isLength({ min: 4, max: 30 })
      .withMessage('CA registration number must be between 4 and 30 characters')
      .matches(/^[A-Za-z0-9/ -]+$/)
      .withMessage('CA registration number contains invalid characters'),
    body('dateOfBirth')
      .isISO8601({ strict: true })
      .withMessage('Valid date of birth is required')
      .custom((value) => {
        const birthDate = new Date(`${value}T00:00:00.000Z`);
        const today = new Date();
        let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
        const month = today.getUTCMonth() - birthDate.getUTCMonth();
        if (month < 0 || (month === 0 && today.getUTCDate() < birthDate.getUTCDate())) age -= 1;
        if (age < 18) throw new Error('You must be at least 18 years old to join');
        if (age > 99) throw new Error('Please enter a valid date of birth');
        return true;
      }),
    passwordValidator,
  ],
  validate,
  authController.signup
);

router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  authController.login
);

router.post(
  '/google',
  authLimiter,
  [body('credential').isString().notEmpty().withMessage('Google credential is required')],
  validate,
  authController.googleLogin
);

router.post(
  '/google/signup',
  authLimiter,
  [
    body('credential').isString().notEmpty().withMessage('Google credential is required'),
    body('name').trim().notEmpty().isLength({ max: 100 }).withMessage('Name is required'),
    body('gender').isIn(['Male', 'Female', 'Non-binary', 'Prefer not to say']),
    body('caStatus').isIn(['CA Foundation', 'CA Inter', 'CA Final', 'Articleship', 'Qualified CA']),
    body('icaiRegNumber').trim().isLength({ min: 4, max: 30 }).matches(/^[A-Za-z0-9/ -]+$/),
    body('dateOfBirth')
      .isISO8601({ strict: true })
      .custom((value) => {
        const birthDate = new Date(`${value}T00:00:00.000Z`);
        const today = new Date();
        let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
        const month = today.getUTCMonth() - birthDate.getUTCMonth();
        if (month < 0 || (month === 0 && today.getUTCDate() < birthDate.getUTCDate())) age -= 1;
        if (age < 18) throw new Error('You must be at least 18 years old to join');
        if (age > 99) throw new Error('Please enter a valid date of birth');
        return true;
      }),
  ],
  validate,
  authController.googleSignup
);

router.post('/refresh-token', authController.refreshToken);

router.get('/verify-email/:token', authController.verifyEmail);

router.post(
  '/forgot-password',
  authLimiter,
  [body('email').isEmail().withMessage('Valid email is required').normalizeEmail()],
  validate,
  authController.forgotPassword
);

router.post(
  '/reset-password/:token',
  authLimiter,
  [passwordValidator],
  validate,
  authController.resetPassword
);

// ── Protected routes ────────────────────────────────────────────────
router.post('/logout', protect, authController.logout);
router.get('/me', protect, authController.getMe);
router.post('/resend-verification', protect, authController.resendVerification);

module.exports = router;
