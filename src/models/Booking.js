const mongoose = require('mongoose');

const guestSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    age: { type: Number, min: 0 },
    isLead: { type: Boolean, default: false },
  },
  { _id: false }
);

const selectedAddOnSchema = new mongoose.Schema(
  {
    addOnId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    unitPrice: { type: Number, required: true, min: 0 },
    perPerson: { type: Boolean, default: true },
    quantity: { type: Number, default: 1, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const pricingSchema = new mongoose.Schema(
  {
    currency: { type: String, default: 'GHS' },
    pricePerPerson: { type: Number, required: true, min: 0 },
    isEarlyBird: { type: Boolean, default: false },
    partySize: { type: Number, required: true, min: 1 },
    tripSubtotal: { type: Number, required: true, min: 0 },
    addOnsTotal: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    depositPerPerson: { type: Number, default: 0, min: 0 },
    depositTotal: { type: Number, default: 0, min: 0 },
    /** Amount charged on the current / latest Paystack checkout */
    amountDueNow: { type: Number, required: true, min: 0 },
    balanceDue: { type: Number, default: 0, min: 0 },
    balanceDueDate: Date,
    depositDuePolicy: String,
    paymentNote: String,
    minPayment: { type: Number, min: 0 },
    maxPayment: { type: Number, min: 0 },
    suggestedPayment: { type: Number, min: 0 },
    remainingBalance: { type: Number, min: 0 },
    allowsCustomAmount: { type: Boolean, default: true },
  },
  { _id: false }
);

const paymentRecordSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    paidAt: { type: Date, required: true },
    channel: String,
    paymentMethod: String,
    status: { type: String, enum: ['success'], default: 'success' },
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
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
    bookingType: {
      type: String,
      enum: ['solo', 'couple', 'group'],
      required: true,
    },
    partySize: { type: Number, required: true, min: 1 },
    guests: [guestSchema],
    /** Traveler contact location for this booking (e.g. Accra, Ghana). Required on create. */
    location: { type: String, trim: true },
    /** Optional WhatsApp number for trip coordination. */
    whatsapp: { type: String, trim: true },
    selectedAddOns: [selectedAddOnSchema],
    pricing: { type: pricingSchema, required: true },
    status: {
      type: String,
      enum: ['pending_payment', 'confirmed', 'cancelled', 'refunded'],
      default: 'pending_payment',
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'deposit_paid', 'fully_paid'],
      default: 'unpaid',
    },
    /** Latest Paystack checkout reference (pending or last initiated) */
    paystackReference: { type: String, unique: true, sparse: true, index: true },
    paystackAccessCode: String,
    paystackAuthorizationUrl: String,
    /** Paystack channel raw value, e.g. card, mobile_money, bank_transfer */
    paymentChannel: { type: String, trim: true },
    /** Display label for organizers, e.g. Card, MTN MoMo, Bank Transfer */
    paymentMethod: { type: String, trim: true },
    /** Successful installment history */
    payments: [paymentRecordSchema],
    amountPaid: { type: Number, default: 0, min: 0 },
    /** Amount returned to traveler after an approved refund (amountPaid is kept as history). */
    refundedAmount: { type: Number, default: 0, min: 0 },
    paidAt: Date,
    expiresAt: Date,
  },
  {
    timestamps: true,
  }
);

bookingSchema.index({ travelerId: 1, createdAt: -1 });
bookingSchema.index({ tripId: 1, status: 1 });
bookingSchema.index({ 'payments.reference': 1 }, { sparse: true });

bookingSchema.methods.toJSON = function toJSON() {
  const totalAmount = this.pricing?.totalAmount ?? 0;
  const amountPaid = this.amountPaid ?? 0;
  const refundedAmount = this.refundedAmount ?? 0;
  const remainingBalance = Math.max(0, Math.round((totalAmount - amountPaid) * 100) / 100);
  const retainedAmount = Math.max(0, Math.round((amountPaid - refundedAmount) * 100) / 100);

  return {
    id: this._id,
    tripId: this.tripId,
    travelerId: this.travelerId,
    bookingType: this.bookingType,
    partySize: this.partySize,
    guests: this.guests,
    location: this.location,
    whatsapp: this.whatsapp,
    selectedAddOns: this.selectedAddOns,
    pricing: this.pricing,
    status: this.status,
    paymentStatus: this.paymentStatus,
    paystackReference: this.paystackReference,
    paystackAuthorizationUrl: this.paystackAuthorizationUrl,
    paymentChannel: this.paymentChannel,
    paymentMethod: this.paymentMethod,
    payments: this.payments || [],
    amountPaid,
    refundedAmount,
    retainedAmount,
    remainingBalance,
    paidAt: this.paidAt,
    expiresAt: this.expiresAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

bookingSchema.methods.toOrganizerJSON = function toOrganizerJSON() {
  const traveler =
    this.travelerId && typeof this.travelerId === 'object'
      ? {
          id: this.travelerId._id,
          fullName: this.travelerId.fullName,
          email: this.travelerId.email,
          phone: this.travelerId.phone,
          location: this.travelerId.location,
          whatsapp: this.travelerId.whatsapp,
        }
      : { id: this.travelerId };

  const totalAmount = this.pricing?.totalAmount ?? 0;
  const amountPaid = this.amountPaid ?? 0;
  const refundedAmount = this.refundedAmount ?? 0;

  return {
    id: this._id,
    bookingType: this.bookingType,
    partySize: this.partySize,
    status: this.status,
    paymentStatus: this.paymentStatus,
    paymentChannel: this.paymentChannel,
    paymentMethod: this.paymentMethod,
    amountPaid,
    refundedAmount,
    retainedAmount: Math.max(0, Math.round((amountPaid - refundedAmount) * 100) / 100),
    remainingBalance: Math.max(0, Math.round((totalAmount - amountPaid) * 100) / 100),
    payments: this.payments || [],
    paidAt: this.paidAt,
    guests: this.guests,
    location: this.location,
    whatsapp: this.whatsapp,
    selectedAddOns: this.selectedAddOns,
    pricing: {
      currency: this.pricing?.currency,
      totalAmount: this.pricing?.totalAmount,
      depositTotal: this.pricing?.depositTotal,
      amountDueNow: this.pricing?.amountDueNow,
      balanceDue: this.pricing?.balanceDue,
      balanceDueDate: this.pricing?.balanceDueDate,
      minPayment: this.pricing?.minPayment,
      maxPayment: this.pricing?.maxPayment,
      suggestedPayment: this.pricing?.suggestedPayment,
    },
    traveler,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Booking', bookingSchema);
