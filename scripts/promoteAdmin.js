require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');

async function promoteAdmin() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) throw new Error('Usage: npm run admin:promote -- user@example.com');
  await connectDB();
  const user = await User.findOneAndUpdate(
    { email },
    { $set: { role: 'admin' } },
    { new: true }
  ).select('email name role');
  if (!user) throw new Error(`No user found for ${email}`);
  console.log(JSON.stringify({ success: true, email: user.email, name: user.name, role: user.role }));
}

promoteAdmin()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(async () => mongoose.disconnect());
