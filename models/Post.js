const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    kind: {
      type: String,
      enum: ['discussion', 'profile'],
      default: 'discussion',
      index: true,
    },
    title: {
      type: String,
      required() { return this.kind === 'discussion'; },
      trim: true,
      maxlength: 200,
    },
    body: {
      type: String,
      default: '',
      maxlength: 5000,
    },
    tags: [{ type: String, trim: true }], // e.g. city, exam-group
    imageUrl: { type: String },
    imagePublicId: { type: String, select: false },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  {
    timestamps: true,
  }
);

postSchema.index({ author: 1 });
postSchema.index({ author: 1, kind: 1, createdAt: -1 });
postSchema.index({ tags: 1 });
postSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Post', postSchema);
