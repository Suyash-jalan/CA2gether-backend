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
    content: {
      type: String,
      required: true,
      maxlength: 2000,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for paginated chat history retrieval
messageSchema.index({ match: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
