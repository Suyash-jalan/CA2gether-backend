const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Event = require('../models/Event');
const { sanitizeText } = require('../utils/sanitize');
const Notification = require('../models/Notification');
const { cloudinary, configureCloudinary } = require('../config/cloudinary');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════
//  POSTS
// ═══════════════════════════════════════════════════════════════════

exports.createPost = async (req, res, next) => {
  try {
    const { title, body, tags } = req.body;

    const post = await Post.create({
      author: req.user._id,
      title: sanitizeText(title),
      body: sanitizeText(body),
      tags: Array.isArray(tags) ? tags.map(sanitizeText) : [],
    });

    await post.populate('author', 'name photos');

    res.status(201).json({ success: true, data: post });
  } catch (error) {
    next(error);
  }
};

exports.createProfilePost = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please choose an image to post' });
    }
    if ((req.body.caption || '').length > 2000) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: 'Caption must be 2000 characters or fewer' });
    }

    let imageUrl;
    let imagePublicId;
    if (configureCloudinary()) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: 'ca-connect/profile-posts',
        resource_type: 'image',
        allowed_formats: ['jpg', 'png', 'webp'],
        transformation: [{ width: 1920, height: 1920, crop: 'limit', quality: 'auto:good' }],
      });
      imageUrl = result.secure_url;
      imagePublicId = result.public_id;
      fs.unlink(req.file.path, () => {});
    } else {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    const post = await Post.create({
      author: req.user._id,
      kind: 'profile',
      body: sanitizeText(req.body.caption || ''),
      imageUrl,
      imagePublicId,
    });
    await post.populate('author', 'name photos verificationStatus');
    const data = post.toObject();
    data.likeCount = 0;
    data.commentCount = 0;
    data.isLiked = false;
    delete data.likes;
    delete data.imagePublicId;
    res.status(201).json({ success: true, data });
  } catch (error) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    next(error);
  }
};

exports.getProfilePosts = async (req, res, next) => {
  try {
    const { page = 1, limit = 12, userId } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 30);
    const filter = { kind: 'profile' };
    if (userId) {
      filter.author = userId;
      if (userId !== req.user._id.toString()) {
        const User = require('../models/User');
        const owner = await User.findById(userId).select('anonymousMode accountStatus').lean();
        if (!owner || owner.accountStatus !== 'active') {
          return res.status(404).json({ success: false, message: 'User not found' });
        }
        if (owner.anonymousMode) {
          const Match = require('../models/Match');
          const isMatched = await Match.exists({ users: { $all: [req.user._id, userId] }, isActive: true });
          if (!isMatched) {
            return res.json({ success: true, data: [], pagination: { page: 1, limit: limitNum, total: 0, pages: 0 } });
          }
        }
      }
    }
    if (req.blockedUserIds?.length) {
      if (userId && req.blockedUserIds.includes(userId)) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      if (!userId) filter.author = { $nin: req.blockedUserIds };
    }

    const [total, posts] = await Promise.all([
      Post.countDocuments(filter),
      Post.find(filter)
        .populate('author', 'name photos verificationStatus')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
    ]);

    const data = await Promise.all(posts.map(async (post) => ({
      ...post,
      likeCount: post.likes?.length || 0,
      isLiked: post.likes?.some((id) => id.toString() === req.user._id.toString()) || false,
      commentCount: await Comment.countDocuments({ post: post._id }),
      likes: undefined,
    })));

    res.json({
      success: true,
      data,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
};

exports.togglePostLike = async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id).select('author kind likes');
    if (!post || post.kind !== 'profile') {
      return res.status(404).json({ success: false, message: 'Photo post not found' });
    }
    const userId = req.user._id.toString();
    const isLiked = post.likes.some((id) => id.toString() === userId);
    if (isLiked) post.likes.pull(req.user._id);
    else post.likes.addToSet(req.user._id);
    await post.save();
    res.json({ success: true, isLiked: !isLiked, likeCount: post.likes.length });
  } catch (error) {
    next(error);
  }
};

exports.getPosts = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, tag } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const skip = (pageNum - 1) * limitNum;

    // Profile photo posts belong only on member profiles. The lounge contains
    // discussion posts created through the lounge composer.
    const filter = { kind: 'discussion' };
    if (tag) filter.tags = tag;

    // Exclude posts from blocked users
    if (req.blockedUserIds && req.blockedUserIds.length) {
      filter.author = { $nin: req.blockedUserIds };
    }

    const total = await Post.countDocuments(filter);
    const posts = await Post.find(filter)
      .populate('author', 'name photos')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    res.json({
      success: true,
      data: posts,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
};

exports.getPost = async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id).populate('author', 'name photos');
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    // Block check
    if (req.blockedUserIds && req.blockedUserIds.includes(post.author._id.toString())) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    res.json({ success: true, data: post });
  } catch (error) {
    next(error);
  }
};

exports.updatePost = async (req, res, next) => {
  try {
    // req.resource is set by the ownership middleware
    const post = req.resource;
    if (req.body.title) post.title = sanitizeText(req.body.title);
    if (req.body.body) post.body = sanitizeText(req.body.body);
    if (req.body.tags) post.tags = req.body.tags.map(sanitizeText);
    await post.save();

    await post.populate('author', 'name photos');
    res.json({ success: true, data: post });
  } catch (error) {
    next(error);
  }
};

exports.deletePost = async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id).select('+imagePublicId imageUrl');
    if (post?.imagePublicId && configureCloudinary()) {
      cloudinary.uploader.destroy(post.imagePublicId).catch(() => {});
    } else if (post?.imageUrl?.startsWith('/uploads/')) {
      fs.unlink(path.join(__dirname, '..', post.imageUrl), () => {});
    }
    await Post.findByIdAndDelete(req.params.id);
    // Also delete related comments
    await Comment.deleteMany({ post: req.params.id });
    res.json({ success: true, message: 'Post and its comments deleted' });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════
//  COMMENTS
// ═══════════════════════════════════════════════════════════════════

exports.createComment = async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const comment = await Comment.create({
      post: req.params.postId,
      author: req.user._id,
      body: sanitizeText(req.body.body),
    });

    await comment.populate('author', 'name photos');
    if (post.author.toString() !== req.user._id.toString()) {
      const author = await require('../models/User').findById(post.author).select('notificationPreferences').lean();
      if (author?.notificationPreferences?.lounge !== false) {
        await Notification.create({
          user: post.author,
          type: 'lounge_comment',
          data: {
            postId: post._id,
            postKind: post.kind,
            authorId: post.author,
            preview: comment.body.slice(0, 80),
          },
        });
      }
    }
    res.status(201).json({ success: true, data: comment });
  } catch (error) {
    next(error);
  }
};

exports.getComments = async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter = { post: req.params.postId };
    if (req.blockedUserIds && req.blockedUserIds.length) {
      filter.author = { $nin: req.blockedUserIds };
    }

    const total = await Comment.countDocuments(filter);
    const comments = await Comment.find(filter)
      .populate('author', 'name photos')
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    res.json({
      success: true,
      data: comments,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
};

exports.updateComment = async (req, res, next) => {
  try {
    const comment = req.resource;
    comment.body = sanitizeText(req.body.body);
    await comment.save();

    await comment.populate('author', 'name photos');
    res.json({ success: true, data: comment });
  } catch (error) {
    next(error);
  }
};

exports.deleteComment = async (req, res, next) => {
  try {
    await Comment.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Comment deleted' });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════
//  EVENTS
// ═══════════════════════════════════════════════════════════════════

exports.createEvent = async (req, res, next) => {
  try {
    const { title, description, date, location } = req.body;

    const event = await Event.create({
      creator: req.user._id,
      title: sanitizeText(title),
      description: sanitizeText(description || ''),
      date,
      location: sanitizeText(location || ''),
    });

    await event.populate('creator', 'name photos');
    res.status(201).json({ success: true, data: event });
  } catch (error) {
    next(error);
  }
};

exports.getEvents = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (req.blockedUserIds && req.blockedUserIds.length) {
      filter.creator = { $nin: req.blockedUserIds };
    }

    const total = await Event.countDocuments(filter);
    const events = await Event.find(filter)
      .populate('creator', 'name photos')
      .sort({ date: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    events.forEach((event) => {
      event.attendeeCount = event.attendees?.length || 0;
      event.isAttending = Boolean(event.attendees?.some((id) => id.toString() === req.user._id.toString()));
      delete event.attendees;
    });

    res.json({
      success: true,
      data: events,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
};

exports.getEvent = async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id).populate('creator', 'name photos');
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    res.json({ success: true, data: event });
  } catch (error) {
    next(error);
  }
};

exports.toggleRsvp = async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (event.date < new Date()) return res.status(400).json({ success: false, message: 'This event has already ended' });

    const userId = req.user._id.toString();
    const isAttending = event.attendees.some((id) => id.toString() === userId);
    if (isAttending) event.attendees.pull(req.user._id);
    else event.attendees.addToSet(req.user._id);
    await event.save();

    res.json({ success: true, isAttending: !isAttending, attendeeCount: event.attendees.length });
  } catch (error) {
    next(error);
  }
};

exports.updateEvent = async (req, res, next) => {
  try {
    const event = req.resource;
    if (req.body.title) event.title = sanitizeText(req.body.title);
    if (req.body.description) event.description = sanitizeText(req.body.description);
    if (req.body.date) event.date = req.body.date;
    if (req.body.location) event.location = sanitizeText(req.body.location);
    await event.save();

    await event.populate('creator', 'name photos');
    res.json({ success: true, data: event });
  } catch (error) {
    next(error);
  }
};

exports.deleteEvent = async (req, res, next) => {
  try {
    await Event.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Event deleted' });
  } catch (error) {
    next(error);
  }
};
