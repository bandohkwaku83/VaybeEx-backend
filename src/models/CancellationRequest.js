const mongoose = require('mongoose');

const CANCELLATION_STATUSES = ['pending', 'processing', 'refunded', 'denied'];

const paystackRefundSchema = new mongoose.Schema(
  {
    transactionReference: { type: String, trim: true },
    refundId: { type: String, trim: true },
    amount: { type: Number, min: 0 },
    currency: { type: String, default: 'GHS' },
    status: { type: String, trim: true },
  },
  { _id: false }
);

const cancellationRequestSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      unique: true,
      index: true,
    },
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      required: true,
      index: true,
    },
    travelerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    organizerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tripTitle: { type: String, required: true, trim: true },
    destination: { type: String, default: '', trim: true },
    startDate: { type: Date, required: true },
    amountPaid: { type: Number, required: true, min: 0 },
    refundAmount: { type: Number, required: true, min: 0 },
    refundEligible: { type: Boolean, default: false },
    reason: { type: String, trim: true, maxlength: 2000 },
    status: {
      type: String,
      enum: CANCELLATION_STATUSES,
      default: 'pending',
      index: true,
    },
    refundDestination: { type: String, trim: true },
    paymentMethod: { type: String, trim: true },
    requestedAt: { type: Date, default: Date.now },
    processedAt: Date,
    organizerNote: { type: String, trim: true, maxlength: 2000 },
    /** Paystack automatic refund tracking (platform wallet → original payment method). */
    paystackRefunds: [paystackRefundSchema],
    refundFailureReason: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

cancellationRequestSchema.index({ organizerId: 1, status: 1, requestedAt: -1 });
cancellationRequestSchema.index({ travelerId: 1, requestedAt: -1 });
cancellationRequestSchema.index({ 'paystackRefunds.transactionReference': 1 });
cancellationRequestSchema.index({ 'paystackRefunds.refundId': 1 });

cancellationRequestSchema.methods.toTravelerJSON = function toTravelerJSON() {
  return {
    id: this._id,
    bookingId: this.bookingId,
    tripId: this.tripId,
    tripTitle: this.tripTitle,
    destination: this.destination,
    startDate: this.startDate,
    amountPaid: this.amountPaid,
    refundAmount: this.refundAmount,
    refundEligible: this.refundEligible,
    reason: this.reason || undefined,
    status: this.status,
    requestedAt: this.requestedAt,
    processedAt: this.processedAt || undefined,
    refundDestination: this.refundDestination || undefined,
    paymentMethod: this.paymentMethod || undefined,
    organizerNote: this.organizerNote || undefined,
    refundFailureReason: this.refundFailureReason || undefined,
  };
};

cancellationRequestSchema.methods.toOrganizerJSON = function toOrganizerJSON() {
  const traveler =
    this.travelerId && typeof this.travelerId === 'object'
      ? {
          id: this.travelerId._id,
          fullName: this.travelerId.fullName,
          email: this.travelerId.email,
          phone: this.travelerId.phone,
        }
      : { id: this.travelerId };

  return {
    ...this.toTravelerJSON(),
    travelerName: traveler.fullName || '',
    travelerEmail: traveler.email || '',
    phone: traveler.phone || '',
    traveler,
    organizerNote: this.organizerNote || undefined,
    paystackRefunds: this.paystackRefunds || [],
    refundFailureReason: this.refundFailureReason || undefined,
  };
};

module.exports = mongoose.model('CancellationRequest', cancellationRequestSchema);
module.exports.CANCELLATION_STATUSES = CANCELLATION_STATUSES;
