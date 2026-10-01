require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Event = require('../models/Event');
const Match = require('../models/Match');
const Message = require('../models/Message');
const Swipe = require('../models/Swipe');
const Block = require('../models/Block');
const Notification = require('../models/Notification');
const Report = require('../models/Report');
const RefreshToken = require('../models/RefreshToken');

async function removeOrphanData() {
  await connectDB();

  const userIds = await User.distinct('_id');
  const orphanPosts = await Post.find({ author: { $nin: userIds } }).select('_id').lean();
  const orphanPostIds = orphanPosts.map(({ _id }) => _id);
  const orphanMatches = await Match.find({ users: { $elemMatch: { $nin: userIds } } })
    .select('_id')
    .lean();
  const orphanMatchIds = orphanMatches.map(({ _id }) => _id);

  const results = await Promise.all([
    Comment.deleteMany({
      $or: [{ author: { $nin: userIds } }, { post: { $in: orphanPostIds } }],
    }),
    Message.deleteMany({
      $or: [{ sender: { $nin: userIds } }, { match: { $in: orphanMatchIds } }],
    }),
    Post.deleteMany({ _id: { $in: orphanPostIds } }),
    Event.deleteMany({ creator: { $nin: userIds } }),
    Match.deleteMany({ _id: { $in: orphanMatchIds } }),
    Swipe.deleteMany({
      $or: [{ swiper: { $nin: userIds } }, { swiped: { $nin: userIds } }],
    }),
    Block.deleteMany({
      $or: [{ blocker: { $nin: userIds } }, { blocked: { $nin: userIds } }],
    }),
    Notification.deleteMany({ user: { $nin: userIds } }),
    Report.deleteMany({
      $or: [{ reporter: { $nin: userIds } }, { reportedUser: { $nin: userIds } }],
    }),
    RefreshToken.deleteMany({ user: { $nin: userIds } }),
  ]);

  console.log(JSON.stringify({
    removedOrphanRecords: results.reduce((sum, result) => sum + result.deletedCount, 0),
  }));
}

removeOrphanData()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
