const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema(
  {
    users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
    ],
    mode: {
      type: String,
      enum: ['dating', 'exam_buddy'],
      default: 'dating',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for fast look-ups by user
matchSchema.index({ users: 1 });
matchSchema.index({ users: 1, mode: 1 });

module.exports = mongoose.model('Match', matchSchema);
