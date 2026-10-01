const News = require('../models/News');
const AdminLog = require('../models/AdminLog');
const { sanitizeText } = require('../utils/sanitize');

const cleanUrl = (value) => {
  const url = (value || '').trim();
  if (!url) return undefined;
  if (!/^https?:\/\//i.test(url)) {
    const error = new Error('Image and source links must start with http:// or https://');
    error.statusCode = 400;
    throw error;
  }
  return url;
};

exports.listPublished = async (req, res, next) => {
  try {
    const { page = 1, limit = 12, category } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 50);
    const filter = { status: 'published' };
    if (category) filter.category = category;
    const [total, news] = await Promise.all([
      News.countDocuments(filter),
      News.find(filter).populate('author', 'name').sort({ publishedAt: -1, createdAt: -1 })
        .skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
    ]);
    res.json({ success: true, data: news, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (error) { next(error); }
};

exports.getPublished = async (req, res, next) => {
  try {
    const item = await News.findOne({ _id: req.params.id, status: 'published' }).populate('author', 'name').lean();
    if (!item) return res.status(404).json({ success: false, message: 'News article not found' });
    res.json({ success: true, data: item });
  } catch (error) { next(error); }
};

exports.listAdmin = async (_req, res, next) => {
  try {
    const news = await News.find().populate('author', 'name').sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: news });
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    const status = req.body.status || 'draft';
    const item = await News.create({
      title: sanitizeText(req.body.title), summary: sanitizeText(req.body.summary),
      content: sanitizeText(req.body.content), category: req.body.category || 'General',
      coverImageUrl: cleanUrl(req.body.coverImageUrl), sourceUrl: cleanUrl(req.body.sourceUrl),
      status, publishedAt: status === 'published' ? new Date() : undefined, author: req.user._id,
    });
    await AdminLog.create({ admin: req.user._id, action: `news_${status === 'published' ? 'published' : 'created'}`, target: `News:${item._id}`, details: { title: item.title } });
    res.status(201).json({ success: true, data: item });
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try {
    const item = await News.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'News article not found' });
    ['title', 'summary', 'content'].forEach((field) => { if (req.body[field] !== undefined) item[field] = sanitizeText(req.body[field]); });
    if (req.body.category !== undefined) item.category = req.body.category;
    if (req.body.coverImageUrl !== undefined) item.coverImageUrl = cleanUrl(req.body.coverImageUrl);
    if (req.body.sourceUrl !== undefined) item.sourceUrl = cleanUrl(req.body.sourceUrl);
    if (req.body.status !== undefined) {
      item.status = req.body.status;
      if (req.body.status === 'published' && !item.publishedAt) item.publishedAt = new Date();
    }
    await item.save();
    await AdminLog.create({ admin: req.user._id, action: 'news_updated', target: `News:${item._id}`, details: { title: item.title, status: item.status } });
    res.json({ success: true, data: item });
  } catch (error) { next(error); }
};

exports.remove = async (req, res, next) => {
  try {
    const item = await News.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'News article not found' });
    await AdminLog.create({ admin: req.user._id, action: 'news_deleted', target: `News:${item._id}`, details: { title: item.title } });
    res.json({ success: true, message: 'News article deleted' });
  } catch (error) { next(error); }
};
