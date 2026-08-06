const mongoose = require('mongoose');

const AUDIENCE_MODES = ['everyone', 'filter', 'specific'];
const AUDIENCE_FILTERS = ['paid', 'unpaid'];
const BROADCAST_STATUSES = ['pending', 'sent', 'failed'];
const CHANNELS = ['sms'];

const audienceSchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      enum: AUDIENCE_MODES,
      required: true,
    },
    filter: {
      type: String,
      enum: AUDIENCE_FILTERS,
    },
    attendeeIds: [{ type: mongoose.Schema.Types.ObjectId }],
  },
  { _id: false }
);

const deliveryStatsSchema = new mongoose.Schema(
  {
    total: { type: Number, default: 0, min: 0 },
    queued: { type: Number, default: 0, min: 0 },
    sent: { type: Number, default: 0, min: 0 },
    failed: { type: Number, default: 0, min: 0 },
    skipped: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const broadcastSchema = new mongoose.Schema(
  {
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
      index: true,
    },
    tripTitle: { type: String, required: true, trim: true },
    channel: {
      type: String,
      enum: CHANNELS,
      default: 'sms',
    },
    messageBody: { type: String, required: true, trim: true, maxlength: 1600 },
    audience: { type: audienceSchema, required: true },
    audienceLabel: { type: String, required: true, trim: true },
    recipients: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: BROADCAST_STATUSES,
      default: 'pending',
      index: true,
    },
    encoding: { type: String, enum: ['GSM-7', 'Unicode'], default: 'GSM-7' },
    segmentsPerMessage: { type: Number, default: 1, min: 1 },
    estimatedCostGhs: { type: Number, default: 0, min: 0 },
    actualCostGhs: { type: Number, default: 0, min: 0 },
    deliveryStats: {
      type: deliveryStatsSchema,
      default: () => ({ total: 0, queued: 0, sent: 0, failed: 0, skipped: 0 }),
    },
    /** Client-supplied key to avoid double-send on confirm retry. */
    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 128,
    },
    sentAt: Date,
    completedAt: Date,
    errorMessage: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

broadcastSchema.index({ organizerId: 1, createdAt: -1 });
broadcastSchema.index({ organizerId: 1, status: 1, createdAt: -1 });
broadcastSchema.index({ tripId: 1, createdAt: -1 });
broadcastSchema.index(
  { organizerId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true }
);

const previewFromBody = (body, max = 48) => {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
};

const snippetFromBody = (body, max = 60) => {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
};

broadcastSchema.methods.toListJSON = function toListJSON() {
  return {
    id: this._id,
    date: (this.sentAt || this.createdAt)?.toISOString?.() || this.createdAt,
    tripId: this.tripId,
    tripTitle: this.tripTitle,
    preview: previewFromBody(this.messageBody, 48),
    snippet: snippetFromBody(this.messageBody, 60),
    messageBody: this.messageBody,
    recipients: this.recipients,
    status: this.status,
    audience: this.audienceLabel,
    channel: this.channel,
    estimatedCostGhs: this.estimatedCostGhs,
    createdAt: this.createdAt,
  };
};

broadcastSchema.methods.toDetailJSON = function toDetailJSON() {
  return {
    ...this.toListJSON(),
    audienceMode: this.audience?.mode,
    audienceFilter: this.audience?.filter || null,
    encoding: this.encoding,
    segmentsPerMessage: this.segmentsPerMessage,
    actualCostGhs: this.actualCostGhs,
    deliveryStats: this.deliveryStats,
    sentAt: this.sentAt || null,
    completedAt: this.completedAt || null,
    errorMessage: this.errorMessage || undefined,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Broadcast', broadcastSchema);
module.exports.AUDIENCE_MODES = AUDIENCE_MODES;
module.exports.AUDIENCE_FILTERS = AUDIENCE_FILTERS;
module.exports.BROADCAST_STATUSES = BROADCAST_STATUSES;
module.exports.previewFromBody = previewFromBody;
module.exports.snippetFromBody = snippetFromBody;
