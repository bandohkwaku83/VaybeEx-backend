const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI is not defined in environment variables');
  }

  await mongoose.connect(uri);
  console.log('MongoDB connected');

  // Keep compound { organizerId, slug } in sync; drops legacy global unique slug index
  try {
    const Trip = require('../models/Trip');
    await Trip.syncIndexes();
  } catch (error) {
    console.warn('Trip index sync skipped:', error.message);
  }
};

module.exports = connectDB;
