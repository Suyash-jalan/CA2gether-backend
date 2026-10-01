const express = require('express');
const newsController = require('../controllers/newsController');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);
router.get('/', newsController.listPublished);
router.get('/:id', newsController.getPublished);
module.exports = router;
