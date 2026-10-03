const express = require('express');
const chatController = require('../controllers/chatController');
const { protect, requireVerifiedEmail } = require('../middleware/auth');
const { photoUpload } = require('../middleware/upload');

const router = express.Router();

router.use(protect, requireVerifiedEmail);

// ── Chat history (paginated) ────────────────────────────────────────
router.get('/:matchId/messages', chatController.getChatHistory);

// ── Image message ──────────────────────────────────────────────────
router.post('/:matchId/images', photoUpload.single('image'), chatController.sendImageMessage);

// ── Icebreaker prompts ──────────────────────────────────────────────
router.get('/icebreakers', chatController.getIcebreakers);

module.exports = router;
