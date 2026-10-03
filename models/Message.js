const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    match: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Match',
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['text', 'image'],
      default: 'text',
    },
    content: {
      type: String,
      required() {
        return this.type === 'text';
      },
      maxlength: 2000,
    },
    imageUrl: { type: String },
    imagePublicId: { type: String, select: false },
  },
  {
    timestamps: true,
  }
);

// Compound index for paginated chat history retrieval
messageSchema.index({ match: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
