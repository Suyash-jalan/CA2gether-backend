require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Swipe = require('../models/Swipe');
const Match = require('../models/Match');

async function auditMatchState() {
  await connectDB();
  const likes = await Swipe.find({ action: 'like' }).select('swiper swiped mode').lean();
  const keys = new Set(likes.map((like) => `${like.mode}:${like.swiper}:${like.swiped}`));
  const oneWayLikes = likes.filter(
    (like) => !keys.has(`${like.mode}:${like.swiped}:${like.swiper}`)
  ).length;
  const activeMatches = await Match.countDocuments({ isActive: true });
  console.log(JSON.stringify({ likes: likes.length, oneWayLikes, activeMatches }));
}

auditMatchState()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
