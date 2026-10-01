const express = require('express');
const chatController = require('../controllers/chatController');
const { protect, requireVerifiedEmail } = require('../middleware/auth');

const router = express.Router();

router.use(protect, requireVerifiedEmail);

// ── Chat history (paginated) ────────────────────────────────────────
router.get('/:matchId/messages', chatController.getChatHistory);

// ── Icebreaker prompts ──────────────────────────────────────────────
router.get('/icebreakers', chatController.getIcebreakers);

module.exports = router;
