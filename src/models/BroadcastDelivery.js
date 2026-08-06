const mongoose = require('mongoose');

const DELIVERY_STATUSES = ['queued', 'sent', 'failed', 'skipped'];

const broadcastDeliverySchema = new mongoose.Schema(
  {
    broadcastId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Broadcast',
      required: true,
      index: true,
    },
    organizerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      required: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
    },
    travelerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    recipientName: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true },
    personalizedMessage: { type: String, trim: true },
    segments: { type: Number, default: 1, min: 1 },
    costGhs: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: DELIVERY_STATUSES,
      default: 'queued',
      index: true,
    },
    skipReason: { type: String, trim: true, maxlength: 200 },
    errorMessage: { type: String, trim: true, maxlength: 500 },
    providerResponse: { type: mongoose.Schema.Types.Mixed },
    sentAt: Date,
  },
  { timestamps: true }
);

broadcastDeliverySchema.index({ broadcastId: 1, bookingId: 1 }, { unique: true });
broadcastDeliverySchema.index({ broadcastId: 1, status: 1 });

broadcastDeliverySchema.methods.toJSON = function toJSON() {
  return {
    id: this._id,
    bookingId: this.bookingId,
    travelerId: this.travelerId,
    recipientName: this.recipientName,
    phone: this.phone,
    status: this.status,
    segments: this.segments,
    costGhs: this.costGhs,
    skipReason: this.skipReason || undefined,
    errorMessage: this.errorMessage || undefined,
    sentAt: this.sentAt || null,
  };
};

module.exports = mongoose.model('BroadcastDelivery', broadcastDeliverySchema);
module.exports.DELIVERY_STATUSES = DELIVERY_STATUSES;
