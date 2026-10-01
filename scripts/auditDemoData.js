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

async function auditDemoData() {
  await connectDB();

  const userIds = await User.distinct('_id');
  const postIds = await Post.distinct('_id');
  const matchIds = await Match.distinct('_id');

  const checks = {
    exampleAccounts: User.countDocuments({ email: /@example\.com$/i }),
    orphanPosts: Post.countDocuments({ author: { $nin: userIds } }),
    orphanComments: Comment.countDocuments({
      $or: [{ author: { $nin: userIds } }, { post: { $nin: postIds } }],
    }),
    orphanEvents: Event.countDocuments({ creator: { $nin: userIds } }),
    orphanMatches: Match.countDocuments({ users: { $elemMatch: { $nin: userIds } } }),
    orphanMessages: Message.countDocuments({
      $or: [{ sender: { $nin: userIds } }, { match: { $nin: matchIds } }],
    }),
    orphanSwipes: Swipe.countDocuments({
      $or: [{ swiper: { $nin: userIds } }, { swiped: { $nin: userIds } }],
    }),
    orphanBlocks: Block.countDocuments({
      $or: [{ blocker: { $nin: userIds } }, { blocked: { $nin: userIds } }],
    }),
    orphanNotifications: Notification.countDocuments({ user: { $nin: userIds } }),
    orphanReports: Report.countDocuments({
      $or: [{ reporter: { $nin: userIds } }, { reportedUser: { $nin: userIds } }],
    }),
    orphanRefreshTokens: RefreshToken.countDocuments({ user: { $nin: userIds } }),
  };

  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]) => [name, await check])
  );
  const result = Object.fromEntries(entries);
  console.log(JSON.stringify({ clean: Object.values(result).every((count) => count === 0), ...result }));
}

auditDemoData()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
