require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Swipe = require('../models/Swipe');
const Match = require('../models/Match');

async function reconcileMatches() {
  await connectDB();
  const likes = await Swipe.find({ action: 'like' }).select('swiper swiped mode').lean();
  const keys = new Set(likes.map((like) => `${like.mode}:${like.swiper}:${like.swiped}`));
  const processed = new Set();
  let created = 0;

  for (const like of likes) {
    const reciprocalKey = `${like.mode}:${like.swiped}:${like.swiper}`;
    if (!keys.has(reciprocalKey)) continue;

    const users = [like.swiper.toString(), like.swiped.toString()].sort();
    const pairKey = `${like.mode}:${users.join(':')}`;
    if (processed.has(pairKey)) continue;
    processed.add(pairKey);

    const existing = await Match.findOne({ users: { $all: users }, mode: like.mode });
    if (existing) {
      if (!existing.isActive) {
        existing.isActive = true;
        await existing.save();
      }
      continue;
    }

    await Match.create({ users, mode: like.mode });
    created += 1;
  }

  console.log(JSON.stringify({ mutualPairs: processed.size, matchesCreated: created }));
}

reconcileMatches()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
