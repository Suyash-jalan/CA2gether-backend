require('dotenv').config();

const mongoose = require('mongoose');
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
const connectDB = require('../config/db');

const demoEmails = [
  'priya.sharma@example.com',
  'rohan.mehta@example.com',
  'ananya.deshmukh@example.com',
  'karan.singhania@example.com',
  'sneha.patel@example.com',
  'aditya.verma@example.com',
  'kavita.joshi@example.com',
  'arjun.nair@example.com',
  'meera.kapoor@example.com',
  'vikram.choudhury@example.com',
  'tanvi.saxena@example.com',
  'gaurav.bansal@example.com',
];

async function removeDemoData() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await connectDB();

  // The seeded records use example.com addresses. Keep the explicit list for
  // older seeds, while also catching demo accounts added by later seed runs.
  const demoUsers = await User.find({
    $or: [
      { email: { $in: demoEmails } },
      { email: /@example\.com$/i },
    ],
  }).select('_id email').lean();
  const userIds = demoUsers.map((user) => user._id);
  if (!userIds.length) {
    console.log(JSON.stringify({ removedUsers: 0, message: 'No known demo accounts found' }));
    return;
  }

  const matches = await Match.find({ users: { $in: userIds } }).select('_id').lean();
  const matchIds = matches.map((match) => match._id);
  const posts = await Post.find({ author: { $in: userIds } }).select('_id').lean();
  const postIds = posts.map((post) => post._id);

  const results = await Promise.all([
    Message.deleteMany({ $or: [{ sender: { $in: userIds } }, { match: { $in: matchIds } }] }),
    Comment.deleteMany({ $or: [{ author: { $in: userIds } }, { post: { $in: postIds } }] }),
    Post.deleteMany({ author: { $in: userIds } }),
    Event.deleteMany({ creator: { $in: userIds } }),
    Match.deleteMany({ _id: { $in: matchIds } }),
    Swipe.deleteMany({ $or: [{ swiper: { $in: userIds } }, { swiped: { $in: userIds } }] }),
    Block.deleteMany({ $or: [{ blocker: { $in: userIds } }, { blocked: { $in: userIds } }] }),
    Notification.deleteMany({ user: { $in: userIds } }),
    Report.deleteMany({ $or: [{ reporter: { $in: userIds } }, { reportedUser: { $in: userIds } }] }),
    RefreshToken.deleteMany({ user: { $in: userIds } }),
    Post.updateMany(
      { author: { $nin: userIds }, likes: { $in: userIds } },
      { $pull: { likes: { $in: userIds } } }
    ),
    Event.updateMany(
      { creator: { $nin: userIds }, attendees: { $in: userIds } },
      { $pull: { attendees: { $in: userIds } } }
    ),
  ]);
  const userResult = await User.deleteMany({ _id: { $in: userIds } });

  console.log(JSON.stringify({
    removedUsers: userResult.deletedCount,
    removedLinkedRecords: results.reduce((sum, result) => sum + result.deletedCount, 0),
    emails: demoUsers.map((user) => user.email),
  }));
}

removeDemoData()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
