const mongoose = require('mongoose');

/**
 * Organizer withdrawal / payout for a trip (platform → organizer via Mobile Money).
 * Amounts are in major units (GHS cedis), matching Booking/Trip money fields.
 */
const withdrawalSchema = new mongoose.Schema(
  {
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      required: true,
      index: true,
    },
    organizerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, default: 'GHS' },
    status: {
      type: String,
      enum: ['pending', 'processing', 'success', 'failed'],
      default: 'pending',
      index: true,
    },
    /** When the withdrawal reached a terminal state (success / failed). */
    processedAt: Date,
    note: { type: String, trim: true, maxlength: 500 },
    failureReason: { type: String, trim: true, maxlength: 500 },

    /** Payout channel — always mobile money for organizer withdrawals. */
    payoutMethod: {
      type: String,
      enum: ['mobile_money'],
      default: 'mobile_money',
    },
    momoProvider: {
      type: String,
      enum: ['mtn', 'vodafone', 'airteltigo'],
      required: true,
    },
    /** Normalized Ghana MoMo number, e.g. 23324XXXXXXX */
    momoNumber: { type: String, required: true, trim: true },
    /** Optional account / wallet name on the MoMo side. */
    accountName: { type: String, trim: true, maxlength: 120 },
    /** Display label shown to organizers (e.g. "MTN MoMo 23324****21"). */
    destinationLabel: { type: String, trim: true },

    /** Paystack Transfer identifiers */
    paystackRecipientCode: { type: String, trim: true, index: true },
    paystackTransferCode: { type: String, trim: true, index: true },
    paystackReference: { type: String, trim: true, unique: true, sparse: true },
    paystackTransferStatus: { type: String, trim: true },
  },
  { timestamps: true }
);

withdrawalSchema.index({ tripId: 1, createdAt: -1 });
withdrawalSchema.index({ organizerId: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1, createdAt: -1 });

withdrawalSchema.methods.toJSON = function toJSON() {
  return {
    id: this._id,
    tripId: this.tripId,
    organizerId: this.organizerId,
    amount: this.amount,
    currency: this.currency,
    status: this.status,
    processedAt: this.processedAt,
    note: this.note,
    failureReason: this.failureReason || undefined,
    payoutMethod: this.payoutMethod || 'mobile_money',
    momoProvider: this.momoProvider,
    momoNumber: this.momoNumber,
    accountName: this.accountName,
    destinationLabel: this.destinationLabel,
    paystackRecipientCode: this.paystackRecipientCode || undefined,
    paystackTransferCode: this.paystackTransferCode || undefined,
    paystackReference: this.paystackReference || undefined,
    paystackTransferStatus: this.paystackTransferStatus || undefined,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
