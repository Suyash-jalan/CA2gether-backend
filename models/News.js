const mongoose = require('mongoose');

const newsSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    summary: { type: String, required: true, trim: true, maxlength: 500 },
    content: { type: String, required: true, trim: true, maxlength: 20000 },
    category: {
      type: String,
      enum: ['ICAI', 'Exams', 'Tax & Compliance', 'Career', 'Community', 'General'],
      default: 'General',
    },
    coverImageUrl: { type: String, trim: true, maxlength: 2000 },
    sourceUrl: { type: String, trim: true, maxlength: 2000 },
    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    publishedAt: { type: Date },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

newsSchema.index({ status: 1, publishedAt: -1 });
newsSchema.index({ category: 1, status: 1 });

module.exports = mongoose.model('News', newsSchema);
