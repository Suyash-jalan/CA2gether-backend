const express = require('express');
const { body } = require('express-validator');
const communityController = require('../controllers/communityController');
const { protect, requireVerifiedEmail } = require('../middleware/auth');
const { loadBlockList } = require('../middleware/blockFilter');
const { checkOwnership } = require('../middleware/ownership');
const { validate } = require('../middleware/validate');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Event = require('../models/Event');
const { photoUpload } = require('../middleware/upload');

const router = express.Router();

router.use(protect, requireVerifiedEmail, loadBlockList);

// ═══════════════════════════════════════════════════════════════════
//  POSTS
// ═══════════════════════════════════════════════════════════════════

router.post(
  '/posts',
  [
    body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 200 }),
    body('body').trim().notEmpty().withMessage('Body is required').isLength({ max: 5000 }),
    body('tags').optional().isArray(),
  ],
  validate,
  communityController.createPost
);

router.post(
  '/profile-posts',
  photoUpload.single('image'),
  communityController.createProfilePost
);
router.get('/profile-posts', communityController.getProfilePosts);
router.post('/posts/:id/like', communityController.togglePostLike);

router.get('/posts', communityController.getPosts);
router.get('/posts/:id', communityController.getPost);

router.put(
  '/posts/:id',
  checkOwnership(Post, 'author'),
  [
    body('title').optional().trim().isLength({ max: 200 }),
    body('body').optional().trim().isLength({ max: 5000 }),
    body('tags').optional().isArray(),
  ],
  validate,
  communityController.updatePost
);

router.delete('/posts/:id', checkOwnership(Post, 'author'), communityController.deletePost);

// ═══════════════════════════════════════════════════════════════════
//  COMMENTS
// ═══════════════════════════════════════════════════════════════════

router.post(
  '/posts/:postId/comments',
  [body('body').trim().notEmpty().withMessage('Comment body is required').isLength({ max: 2000 })],
  validate,
  communityController.createComment
);

router.get('/posts/:postId/comments', communityController.getComments);

router.put(
  '/comments/:id',
  checkOwnership(Comment, 'author'),
  [body('body').trim().notEmpty().withMessage('Comment body is required').isLength({ max: 2000 })],
  validate,
  communityController.updateComment
);

router.delete('/comments/:id', checkOwnership(Comment, 'author'), communityController.deleteComment);

// ═══════════════════════════════════════════════════════════════════
//  EVENTS
// ═══════════════════════════════════════════════════════════════════

router.post(
  '/events',
  [
    body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 200 }),
    body('date').isISO8601().withMessage('Valid date is required'),
    body('location').optional().trim().isLength({ max: 300 }),
    body('description').optional().trim().isLength({ max: 5000 }),
  ],
  validate,
  communityController.createEvent
);

router.get('/events', communityController.getEvents);
router.get('/events/:id', communityController.getEvent);
router.post('/events/:id/rsvp', communityController.toggleRsvp);

router.put(
  '/events/:id',
  checkOwnership(Event, 'creator'),
  [
    body('title').optional().trim().isLength({ max: 200 }),
    body('date').optional().isISO8601(),
    body('location').optional().trim().isLength({ max: 300 }),
    body('description').optional().trim().isLength({ max: 5000 }),
  ],
  validate,
  communityController.updateEvent
);

router.delete('/events/:id', checkOwnership(Event, 'creator'), communityController.deleteEvent);

module.exports = router;
