const mongoose = require('mongoose');

const favoriteTripSchema = new mongoose.Schema(
  {
    travelerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

favoriteTripSchema.index({ travelerId: 1, tripId: 1 }, { unique: true });
favoriteTripSchema.index({ travelerId: 1, createdAt: -1 });

module.exports = mongoose.model('FavoriteTrip', favoriteTripSchema);
