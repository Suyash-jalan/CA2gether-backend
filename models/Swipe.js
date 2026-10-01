const mongoose = require('mongoose');

const swipeSchema = new mongoose.Schema(
  {
    swiper: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    swiped: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    action: {
      type: String,
      enum: ['like', 'pass'],
      required: true,
    },
    mode: {
      type: String,
      enum: ['dating', 'exam_buddy'],
      default: 'dating',
    },
  },
  {
    timestamps: true,
  }
);

// Each user can only swipe on another user once per mode
swipeSchema.index({ swiper: 1, swiped: 1, mode: 1 }, { unique: true });

module.exports = mongoose.model('Swipe', swipeSchema);
