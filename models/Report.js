const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reportedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: {
      type: String,
      required: true,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: ['pending', 'reviewed', 'action_taken', 'dismissed'],
      default: 'pending',
    },
    adminAction: {
      type: String,
      enum: ['none', 'warned', 'suspended', 'banned'],
      default: 'none',
    },
    adminNote: { type: String },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

reportSchema.index({ reportedUser: 1 });
reportSchema.index({ status: 1 });

module.exports = mongoose.model('Report', reportSchema);
