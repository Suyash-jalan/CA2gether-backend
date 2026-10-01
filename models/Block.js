const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema(
  {
    blocker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    blocked: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Each pair is unique
blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
// Fast reverse look-up (who blocked me)
blockSchema.index({ blocked: 1 });

module.exports = mongoose.model('Block', blockSchema);
