const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema(
  {
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      maxlength: 5000,
    },
    date: {
      type: Date,
      required: true,
    },
    location: {
      type: String,
      trim: true,
      maxlength: 300,
    },
    attendees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  {
    timestamps: true,
  }
);

eventSchema.index({ date: 1 });
eventSchema.index({ creator: 1 });

module.exports = mongoose.model('Event', eventSchema);
