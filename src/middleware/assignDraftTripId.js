const mongoose = require('mongoose');

const assignDraftTripId = (req, res, next) => {
  if (!req.params?.id) {
    req.draftTripId = new mongoose.Types.ObjectId();
  }
  next();
};

module.exports = assignDraftTripId;
