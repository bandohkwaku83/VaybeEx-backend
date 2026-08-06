/**
 * Create (or update) an admin user.
 *
 * Usage:
 *   node scripts/createAdmin.js admin@example.com 'StrongPass123!'
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const { hashPassword, validatePassword } = require('../src/utils/password');

const run = async () => {
  const [, , email, password] = process.argv;

  if (!email || !password) {
    console.error('Usage: node scripts/createAdmin.js <email> <password>');
    process.exit(1);
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    console.error(passwordError);
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const normalizedEmail = email.toLowerCase().trim();
  const passwordHash = await hashPassword(password);

  let user = await User.findOne({ email: normalizedEmail });
  if (user) {
    user.role = 'admin';
    user.passwordHash = passwordHash;
    user.isVerified = true;
    await user.save();
    console.log(`Updated existing user to admin: ${normalizedEmail}`);
  } else {
    user = await User.create({
      email: normalizedEmail,
      passwordHash,
      role: 'admin',
      isVerified: true,
      authProvider: 'email',
      fullName: 'Admin',
    });
    console.log(`Created admin: ${normalizedEmail}`);
  }

  console.log(`id=${user._id}`);
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
