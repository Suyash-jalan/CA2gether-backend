const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    action: {
      type: String,
      required: true,
      maxlength: 200,
    },
    target: {
      type: String, // e.g. "User:64abc123", "Report:64def456"
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

adminLogSchema.index({ admin: 1, createdAt: -1 });

module.exports = mongoose.model('AdminLog', adminLogSchema);
