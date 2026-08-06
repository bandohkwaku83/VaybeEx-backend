const mongoose = require('mongoose');
const { TRIP_SPECIALTIES } = require('../constants/tripSpecialties');

const addOnSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    perPerson: { type: Boolean, default: true },
  },
  { _id: true }
);

const itineraryDaySchema = new mongoose.Schema(
  {
    day: { type: Number, required: true, min: 1 },
    title: { type: String, required: true, trim: true },
    activities: [{ type: String, trim: true }],
  },
  { _id: true }
);

const tripSchema = new mongoose.Schema(
  {
    organizerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    coverImage: String,
    gallery: {
      type: [String],
      validate: {
        validator: (v) => v.length <= 6,
        message: 'Gallery cannot have more than 6 images',
      },
      default: [],
    },
    flyer: String,
    title: { type: String, trim: true, default: '' },
    destination: { type: String, trim: true, default: '' },
    category: {
      type: String,
      enum: [...TRIP_SPECIALTIES, ''],
      default: '',
    },
    startDate: Date,
    endDate: Date,
    tags: [{ type: String, trim: true }],
    organizerContactPhone: String,
    organizerContactEmail: { type: String, trim: true, lowercase: true },
    description: { type: String, trim: true, default: '' },
    highlights: [{ type: String, trim: true }],
    included: [{ type: String, trim: true }],
    excluded: [{ type: String, trim: true }],
    difficulty: {
      type: String,
      enum: ['easy', 'moderate', 'challenging', ''],
      default: '',
    },
    minAge: { type: Number, min: 0 },
    maxAge: { type: Number, min: 0 },
    minCapacity: { type: Number, min: 1 },
    maxCapacity: { type: Number, min: 1 },
    departurePoint: { type: String, trim: true, default: '' },
    meetingPointDetails: { type: String, trim: true, default: '' },
    departureTime: { type: String, trim: true, default: '' },
    expectedReturnTime: { type: String, trim: true, default: '' },
    pricePerPerson: { type: Number, min: 0 },
    /** Package price for 2 travelers when couple rate is offered. */
    couplePrice: { type: Number, min: 0 },
    /** Flat package price for a group booking. */
    groupPrice: { type: Number, min: 0 },
    /** Travelers covered by the flat group package rate (e.g. 5 or 10). */
    groupSize: { type: Number, min: 2 },
    depositAmount: { type: Number, min: 0 },
    depositDue: {
      type: String,
      enum: ['at_booking', '7_days_before', '14_days_before', '30_days_before', ''],
      default: '',
    },
    earlyBirdPrice: { type: Number, min: 0 },
    earlyBirdDeadline: Date,
    addOns: [addOnSchema],
    refundPolicy: {
      type: String,
      enum: ['fully_refundable', 'partially_refundable', 'non_refundable', ''],
      default: '',
    },
    refundPercentage: { type: Number, min: 0, max: 100 },
    cancellationDeadlineDays: { type: Number, min: 0 },
    itinerary: [itineraryDaySchema],
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'live', 'completed', 'cancelled'],
      default: 'draft',
      index: true,
    },
    visibility: {
      type: String,
      enum: ['public', 'private'],
      default: 'private',
    },
    scheduledPublishAt: Date,
    publishConfirmed: { type: Boolean, default: false },
    /** Public path segment under organizer brand, e.g. brand.localhost:3000/{slug} */
    slug: { type: String, trim: true, lowercase: true },
    bookingsCount: { type: Number, default: 0, min: 0 },
    confirmedBookingsCount: { type: Number, default: 0, min: 0 },
    viewsCount: { type: Number, default: 0, min: 0 },
    bookClicksCount: { type: Number, default: 0, min: 0 },
    checkoutStartsCount: { type: Number, default: 0, min: 0 },
    revenue: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
  }
);

tripSchema.index({ organizerId: 1, status: 1 });
tripSchema.index({ status: 1, visibility: 1, startDate: 1 });
tripSchema.index(
  { organizerId: 1, slug: 1 },
  {
    unique: true,
    partialFilterExpression: { slug: { $type: 'string', $gt: '' } },
  }
);

tripSchema.methods.getDurationDays = function getDurationDays() {
  if (!this.startDate || !this.endDate) return null;
  const ms = this.endDate.getTime() - this.startDate.getTime();
  if (ms < 0) return null;
  return Math.ceil(ms / (1000 * 60 * 60 * 24)) + 1;
};

tripSchema.methods.getRefundPolicySummary = function getRefundPolicySummary() {
  if (!this.refundPolicy) return '';

  // Keep defaults aligned with estimateRefund (full → 14 days when deadline omitted).
  const deadlineDays =
    this.cancellationDeadlineDays != null
      ? Number(this.cancellationDeadlineDays)
      : this.refundPolicy === 'fully_refundable'
        ? 14
        : null;

  const deadline =
    deadlineDays != null ? `${deadlineDays} day(s) before departure` : 'departure';

  if (this.refundPolicy === 'fully_refundable') {
    return `Fully refundable if cancelled at least ${deadline}.`;
  }

  if (this.refundPolicy === 'partially_refundable') {
    const pct = this.refundPercentage ?? 50;
    return `${pct}% refundable if cancelled at least ${deadline}.`;
  }

  if (this.refundPolicy === 'non_refundable') {
    return 'Non-refundable after booking confirmation.';
  }

  return '';
};

tripSchema.methods.getSeatsAvailable = function getSeatsAvailable() {
  if (this.maxCapacity == null) return null; // unlimited
  return Math.max(0, this.maxCapacity - (this.bookingsCount ?? 0));
};

tripSchema.methods.isUnlimitedCapacity = function isUnlimitedCapacity() {
  return this.maxCapacity == null;
};

tripSchema.methods.getMinReached = function getMinReached() {
  if (this.minCapacity == null) return false;
  return (this.bookingsCount ?? 0) >= this.minCapacity;
};

tripSchema.methods.getAnalytics = function getAnalytics() {
  const views = this.viewsCount ?? 0;
  const bookClicks = this.bookClicksCount ?? 0;
  const checkoutStarts = this.checkoutStartsCount ?? 0;
  const confirmed = this.confirmedBookingsCount ?? 0;
  const conversionRate = views > 0 ? (confirmed / views) * 100 : 0;
  const dropOffRate = views > 0 ? ((views - confirmed) / views) * 100 : 0;

  return {
    views,
    bookClicks,
    checkoutStarts,
    confirmedBookings: confirmed,
    conversions: confirmed,
    conversionRate: Math.round(conversionRate * 10) / 10,
    revenue: this.revenue ?? 0,
    funnel: [
      { step: 'page_views', label: 'Page views', value: views, pct: views > 0 ? 100 : 0 },
      {
        step: 'clicked_book',
        label: 'Clicked Book',
        value: bookClicks,
        pct: views > 0 ? Math.round((bookClicks / views) * 1000) / 10 : 0,
      },
      {
        step: 'started_checkout',
        label: 'Started checkout',
        value: checkoutStarts,
        pct: views > 0 ? Math.round((checkoutStarts / views) * 1000) / 10 : 0,
      },
      {
        step: 'confirmed_booking',
        label: 'Confirmed booking',
        value: confirmed,
        pct: Math.round(conversionRate * 10) / 10,
      },
    ],
    insight:
      views > 0 && dropOffRate >= 90
        ? `${dropOffRate.toFixed(1)}% drop-off from views to bookings. Consider improving your trip description or pricing clarity to convert more browsers.`
        : null,
  };
};

tripSchema.methods.toOrganizerJSON = function toOrganizerJSON() {
  const durationDays = this.getDurationDays();
  const potentialRevenue =
    this.pricePerPerson != null && this.maxCapacity != null
      ? this.pricePerPerson * this.maxCapacity
      : null;
  const minReached = this.getMinReached();
  const unlimited = this.isUnlimitedCapacity();
  const fillRate =
    !unlimited && this.maxCapacity > 0
      ? Math.round(((this.bookingsCount ?? 0) / this.maxCapacity) * 100)
      : 0;

  return {
    id: this._id,
    organizerId: this.organizerId,
    coverImage: this.coverImage,
    gallery: this.gallery,
    flyer: this.flyer,
    title: this.title,
    destination: this.destination,
    category: this.category,
    startDate: this.startDate,
    endDate: this.endDate,
    tags: this.tags,
    organizerContactPhone: this.organizerContactPhone,
    organizerContactEmail: this.organizerContactEmail,
    description: this.description,
    highlights: this.highlights,
    included: this.included,
    excluded: this.excluded,
    minAge: this.minAge,
    maxAge: this.maxAge,
    maxCapacity: this.maxCapacity ?? null,
    isUnlimitedCapacity: unlimited,
    departurePoint: this.departurePoint,
    meetingPointDetails: this.meetingPointDetails,
    departureTime: this.departureTime,
    expectedReturnTime: this.expectedReturnTime,
    pricePerPerson: this.pricePerPerson,
    couplePrice: this.couplePrice,
    groupPrice: this.groupPrice,
    groupSize: this.groupSize,
    offerCouplePrice: this.couplePrice != null && this.couplePrice > 0,
    offerGroupPrice: this.groupPrice != null && this.groupPrice > 0,
    depositAmount: this.depositAmount,
    depositDue: this.depositDue,
    earlyBirdPrice: this.earlyBirdPrice,
    earlyBirdDeadline: this.earlyBirdDeadline,
    addOns: this.addOns,
    refundPolicy: this.refundPolicy,
    refundPercentage: this.refundPercentage,
    cancellationDeadlineDays: this.cancellationDeadlineDays,
    refundPolicySummary: this.getRefundPolicySummary(),
    itinerary: this.itinerary,
    status: this.status,
    visibility: this.visibility,
    isBookable: this.status === 'live',
    scheduledPublishAt: this.scheduledPublishAt,
    publishConfirmed: this.publishConfirmed,
    slug: this.slug,
    durationDays,
    seatsBooked: this.bookingsCount,
    seatsAvailable: this.getSeatsAvailable(),
    capacityProgress: fillRate,
    fillRate,
    minReached,
    viewsCount: this.viewsCount,
    bookClicksCount: this.bookClicksCount,
    checkoutStartsCount: this.checkoutStartsCount,
    confirmedBookingsCount: this.confirmedBookingsCount,
    conversions: this.confirmedBookingsCount ?? 0,
    revenue: this.revenue,
    potentialRevenue,
    analytics: this.getAnalytics(),
    // Frontend-friendly aliases used by the create-trip / dashboard UI
    image: this.coverImage,
    images: [this.coverImage, ...(this.gallery || [])].filter(Boolean),
    price: this.pricePerPerson,
    capacity: this.maxCapacity ?? null,
    booked: this.bookingsCount,
    meetingPoint: this.meetingPointDetails,
    returnTime: this.expectedReturnTime,
    views: this.viewsCount,
    refundDeadlineDays: this.cancellationDeadlineDays,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

tripSchema.methods.toPublicJSON = function toPublicJSON(organizer = null) {
  const base = this.toOrganizerJSON();
  const {
    organizerContactPhone,
    organizerContactEmail,
    publishConfirmed,
    scheduledPublishAt,
    revenue,
    potentialRevenue,
    ...publicFields
  } = base;

  const organizerId = organizer?._id || this.organizerId;
  const organizerPayload = {
    id: organizerId,
    fullName: organizer?.fullName || '',
    businessName: organizer?.businessName || '',
    displayName: organizer?.businessName || organizer?.fullName || '',
    brandSlug: organizer?.brandSlug || '',
    brandLogo: organizer?.brandLogo || null,
    profilePhoto: organizer?.profilePhoto || null,
    location: organizer?.location || '',
    aboutYou: organizer?.aboutYou || '',
    tripSpecialties: organizer?.tripSpecialties || [],
    whatsapp: organizer?.whatsapp || '',
    isVerified: Boolean(organizer?.isVerified),
    status: organizer?.status || null,
  };

  return {
    ...publicFields,
    refundPolicySummary: this.getRefundPolicySummary(),
    organizer: organizerPayload,
  };
};

module.exports = mongoose.model('Trip', tripSchema);
