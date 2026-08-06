const Trip = require('../models/Trip');
const Booking = require('../models/Booking');
const Broadcast = require('../models/Broadcast');
const BroadcastDelivery = require('../models/BroadcastDelivery');
const { sendSms } = require('./arkeselService');
const { normalizeGhanaPhone } = require('../utils/phone');
const { getLeadGuest, toMemberPaymentStatus } = require('../utils/payoutHelpers');

const SMS_COST_PER_SEGMENT_GHS = Number(process.env.SMS_COST_PER_SEGMENT_GHS) || 0.05;
const MAX_RECIPIENTS_PER_BROADCAST =
  Number(process.env.SMS_BROADCAST_MAX_RECIPIENTS) || 200;

/** Active trip attendees eligible for SMS broadcasts. */
const AUDIENCE_BOOKING_STATUSES = ['confirmed'];

/** GSM-7 basic character set (3GPP TS 23.038). Extended chars count as 2. */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€';

const audienceLabel = (audience) => {
  if (audience.mode === 'everyone') return 'All participants';
  if (audience.mode === 'filter' && audience.filter === 'paid') return 'Paid only';
  if (audience.mode === 'filter' && audience.filter === 'unpaid') return 'Not paid';
  if (audience.mode === 'specific') return 'Custom selection';
  return 'All participants';
};

const firstNameFrom = (fullName) => {
  const token = String(fullName || '')
    .trim()
    .split(/\s+/)
    .find(Boolean);
  return token || 'there';
};

const personalizeMessage = (template, fullName) => {
  const firstName = firstNameFrom(fullName);
  return String(template || '').replace(/\{FirstName\}/gi, firstName);
};

const isGsm7 = (text) => {
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch) || GSM7_EXTENDED.includes(ch)) continue;
    return false;
  }
  return true;
};

/** Count characters with GSM-7 extended chars counting as 2. */
const gsm7Length = (text) => {
  let len = 0;
  for (const ch of text) {
    len += GSM7_EXTENDED.includes(ch) ? 2 : 1;
  }
  return len;
};

/**
 * Segment math matching the UI:
 * GSM-7: 160 single / 153 concatenated
 * Unicode: 70 single / 67 concatenated
 */
const analyzeSms = (message) => {
  const text = String(message || '');
  const encoding = isGsm7(text) ? 'GSM-7' : 'Unicode';
  const length = encoding === 'GSM-7' ? gsm7Length(text) : [...text].length;

  let segments = 1;
  if (encoding === 'GSM-7') {
    if (length === 0) segments = 1;
    else if (length <= 160) segments = 1;
    else segments = Math.ceil(length / 153);
  } else if (length === 0) {
    segments = 1;
  } else if (length <= 70) {
    segments = 1;
  } else {
    segments = Math.ceil(length / 67);
  }

  const charsPerSms = encoding === 'GSM-7' ? (segments > 1 ? 153 : 160) : segments > 1 ? 67 : 70;

  return {
    encoding,
    length,
    segments,
    charsPerSms,
  };
};

const tryNormalizePhone = (raw) => {
  if (!raw) return null;
  try {
    return normalizeGhanaPhone(String(raw));
  } catch {
    return null;
  }
};

const resolveRecipientPhone = (booking) => {
  const lead = getLeadGuest(booking);
  return tryNormalizePhone(lead.phone) || tryNormalizePhone(booking.whatsapp);
};

const mapUiPaymentStatus = (booking) => toMemberPaymentStatus(booking);

const loadOwnedTrip = async (tripId, organizerId) => {
  const trip = await Trip.findOne({ _id: tripId, organizerId });
  if (!trip) {
    const err = new Error('Trip not found');
    err.statusCode = 404;
    throw err;
  }
  return trip;
};

const loadTripBookings = async (tripId) => {
  return Booking.find({
    tripId,
    status: { $in: AUDIENCE_BOOKING_STATUSES },
  }).populate('travelerId', 'fullName email phone location whatsapp');
};

/**
 * Resolve audience for a trip into recipient candidates.
 * Each confirmed booking = one SMS recipient (lead traveler).
 */
const resolveAudience = async ({ tripId, organizerId, audience }) => {
  if (!audience || !audience.mode) {
    const err = new Error('audience.mode is required');
    err.statusCode = 400;
    throw err;
  }

  const mode = audience.mode;
  if (!['everyone', 'filter', 'specific'].includes(mode)) {
    const err = new Error('audience.mode must be everyone, filter, or specific');
    err.statusCode = 400;
    throw err;
  }

  let filter = audience.filter;
  // UI id "not-checked-in" maps to unpaid
  if (filter === 'not-checked-in' || filter === 'not_paid' || filter === 'not-paid') {
    filter = 'unpaid';
  }

  if (mode === 'filter') {
    if (!['paid', 'unpaid'].includes(filter)) {
      const err = new Error('audience.filter must be paid or unpaid when mode is filter');
      err.statusCode = 400;
      throw err;
    }
  }

  await loadOwnedTrip(tripId, organizerId);
  const bookings = await loadTripBookings(tripId);

  const allRecipients = bookings.map((booking) => {
    const lead = getLeadGuest(booking);
    const phone = resolveRecipientPhone(booking);
    const paymentStatus = mapUiPaymentStatus(booking);

    return {
      id: String(booking._id),
      bookingId: booking._id,
      travelerId: booking.travelerId?._id || booking.travelerId,
      name: lead.fullName || '',
      phone: phone || null,
      rawPhone: lead.phone || booking.whatsapp || null,
      paymentStatus,
      hasValidPhone: Boolean(phone),
    };
  });

  const counts = {
    total: allRecipients.length,
    paid: allRecipients.filter((r) => r.paymentStatus === 'paid').length,
    unpaid: allRecipients.filter(
      (r) => r.paymentStatus === 'partial' || r.paymentStatus === 'pending'
    ).length,
    withPhone: allRecipients.filter((r) => r.hasValidPhone).length,
  };

  let selected = allRecipients;

  if (mode === 'filter') {
    selected = allRecipients.filter((r) => {
      if (filter === 'paid') return r.paymentStatus === 'paid';
      return r.paymentStatus === 'partial' || r.paymentStatus === 'pending';
    });
  } else if (mode === 'specific') {
    const ids = (audience.attendeeIds || []).map(String);
    if (ids.length) {
      const idSet = new Set(ids);
      selected = allRecipients.filter((r) => idSet.has(r.id));
      const missing = ids.filter((id) => !selected.some((r) => r.id === id));
      if (missing.length) {
        const err = new Error(
          `Some attendeeIds are not active bookings on this trip: ${missing.slice(0, 5).join(', ')}`
        );
        err.statusCode = 400;
        throw err;
      }
    }
    // No attendeeIds → return full list (audience preview / compose picker)
  }

  const withPhone = selected.filter((r) => r.hasValidPhone);
  const withoutPhone = selected.filter((r) => !r.hasValidPhone);

  return {
    recipients: selected,
    sendable: withPhone,
    skipped: withoutPhone,
    counts,
    audience: {
      mode,
      filter: mode === 'filter' ? filter : undefined,
      attendeeIds: mode === 'specific' ? (audience.attendeeIds || []).map(String) : undefined,
    },
    audienceLabel: audienceLabel({
      mode,
      filter: mode === 'filter' ? filter : undefined,
    }),
  };
};

const estimateBroadcast = async ({ tripId, organizerId, message, audience }) => {
  const body = String(message || '').trim();
  if (!body) {
    const err = new Error('message is required');
    err.statusCode = 400;
    throw err;
  }

  const resolved = await resolveAudience({ tripId, organizerId, audience });
  const recipientCount = resolved.sendable.length;

  // Estimate segments using personalized sample (longest first-name impact ≈ base template analysis)
  const sampleName = resolved.sendable[0]?.name || 'Sample';
  const sampleMessage = personalizeMessage(body, sampleName);
  const sms = analyzeSms(sampleMessage);
  const estimatedCostGhs =
    Math.round(recipientCount * sms.segments * SMS_COST_PER_SEGMENT_GHS * 100) / 100;

  return {
    recipientCount,
    skippedCount: resolved.skipped.length,
    totalSelected: resolved.recipients.length,
    segments: sms.segments,
    encoding: sms.encoding,
    charsPerSms: sms.charsPerSms,
    messageLength: sms.length,
    costPerSegmentGhs: SMS_COST_PER_SEGMENT_GHS,
    estimatedCostGhs,
    counts: resolved.counts,
    audienceLabel: resolved.audienceLabel,
  };
};

const getBroadcastAudiencePreview = async ({ tripId, organizerId, mode, filter }) => {
  const resolved = await resolveAudience({
    tripId,
    organizerId,
    audience: { mode: mode || 'everyone', filter, attendeeIds: undefined },
  });

  return {
    recipients: resolved.recipients.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      paymentStatus: r.paymentStatus,
      hasValidPhone: r.hasValidPhone,
    })),
    counts: {
      ...resolved.counts,
      selected: resolved.recipients.length,
      sendable: resolved.sendable.length,
      skipped: resolved.skipped.length,
    },
    audienceLabel: resolved.audienceLabel,
  };
};

const recountDeliveryStats = async (broadcastId) => {
  const rows = await BroadcastDelivery.aggregate([
    { $match: { broadcastId } },
    { $group: { _id: '$status', count: { $sum: 1 }, cost: { $sum: '$costGhs' } } },
  ]);

  const stats = { total: 0, queued: 0, sent: 0, failed: 0, skipped: 0 };
  let actualCostGhs = 0;

  rows.forEach((row) => {
    stats.total += row.count;
    if (row._id in stats) stats[row._id] = row.count;
    if (row._id === 'sent') actualCostGhs += row.cost || 0;
  });

  return {
    deliveryStats: stats,
    actualCostGhs: Math.round(actualCostGhs * 100) / 100,
  };
};

const finalizeBroadcastStatus = (stats) => {
  // Partial success: sent if any delivered; failed only when nothing sent and work finished.
  if (stats.queued > 0) return 'pending';
  if (stats.sent > 0) return 'sent';
  return 'failed';
};

const processBroadcastDeliveries = async (broadcastId) => {
  const broadcast = await Broadcast.findById(broadcastId);
  if (!broadcast) return;

  const deliveries = await BroadcastDelivery.find({
    broadcastId,
    status: 'queued',
  });

  let sentCount = 0;

  for (const delivery of deliveries) {
    try {
      const result = await sendSms(delivery.phone, delivery.personalizedMessage);
      delivery.status = 'sent';
      delivery.sentAt = new Date();
      delivery.providerResponse = result;
      await delivery.save();
      sentCount += 1;
    } catch (error) {
      delivery.status = 'failed';
      delivery.errorMessage = error.message || 'Failed to send SMS';
      await delivery.save();
    }
  }

  const { deliveryStats, actualCostGhs } = await recountDeliveryStats(broadcast._id);
  broadcast.deliveryStats = deliveryStats;
  broadcast.actualCostGhs = actualCostGhs;
  broadcast.status = finalizeBroadcastStatus(deliveryStats);
  broadcast.completedAt = new Date();
  if (sentCount > 0 && !broadcast.sentAt) {
    broadcast.sentAt = new Date();
  }
  if (broadcast.status === 'failed' && deliveryStats.sent === 0) {
    broadcast.errorMessage =
      deliveryStats.skipped === deliveryStats.total
        ? 'No recipients with valid phone numbers'
        : 'All SMS deliveries failed';
  }
  await broadcast.save();
};

const createBroadcast = async ({
  tripId,
  organizerId,
  message,
  channel = 'sms',
  audience,
  idempotencyKey,
}) => {
  if (channel && channel !== 'sms') {
    const err = new Error('Only SMS channel is supported');
    err.statusCode = 400;
    throw err;
  }

  const body = String(message || '').trim();
  if (!body) {
    const err = new Error('message is required');
    err.statusCode = 400;
    throw err;
  }

  if (idempotencyKey) {
    const existing = await Broadcast.findOne({
      organizerId,
      idempotencyKey: String(idempotencyKey).trim(),
    });
    if (existing) {
      return { broadcast: existing, reused: true };
    }
  }

  const trip = await loadOwnedTrip(tripId, organizerId);
  const resolved = await resolveAudience({ tripId, organizerId, audience });

  if (resolved.sendable.length === 0) {
    const err = new Error(
      resolved.recipients.length === 0
        ? 'No recipients match this audience'
        : 'No recipients have a valid phone number'
    );
    err.statusCode = 400;
    throw err;
  }

  if (resolved.audience.mode === 'specific' && !(audience.attendeeIds || []).length) {
    const err = new Error('audience.attendeeIds is required when mode is specific');
    err.statusCode = 400;
    throw err;
  }

  if (resolved.sendable.length > MAX_RECIPIENTS_PER_BROADCAST) {
    const err = new Error(
      `Broadcast limited to ${MAX_RECIPIENTS_PER_BROADCAST} recipients (got ${resolved.sendable.length})`
    );
    err.statusCode = 400;
    throw err;
  }

  const sampleMessage = personalizeMessage(body, resolved.sendable[0].name);
  const smsMeta = analyzeSms(sampleMessage);
  const estimatedCostGhs =
    Math.round(
      resolved.sendable.length * smsMeta.segments * SMS_COST_PER_SEGMENT_GHS * 100
    ) / 100;

  const broadcast = await Broadcast.create({
    organizerId,
    tripId: trip._id,
    tripTitle: trip.title,
    channel: 'sms',
    messageBody: body,
    audience: {
      mode: resolved.audience.mode,
      filter: resolved.audience.filter,
      attendeeIds: resolved.audience.attendeeIds,
    },
    audienceLabel: resolved.audienceLabel,
    recipients: resolved.sendable.length,
    status: 'pending',
    encoding: smsMeta.encoding,
    segmentsPerMessage: smsMeta.segments,
    estimatedCostGhs,
    deliveryStats: {
      total: resolved.recipients.length,
      queued: resolved.sendable.length,
      sent: 0,
      failed: 0,
      skipped: resolved.skipped.length,
    },
    idempotencyKey: idempotencyKey ? String(idempotencyKey).trim() : undefined,
  });

  const deliveryDocs = [
    ...resolved.sendable.map((r) => {
      const personalized = personalizeMessage(body, r.name);
      const sms = analyzeSms(personalized);
      return {
        broadcastId: broadcast._id,
        organizerId,
        tripId: trip._id,
        bookingId: r.bookingId,
        travelerId: r.travelerId,
        recipientName: r.name,
        phone: r.phone,
        personalizedMessage: personalized,
        segments: sms.segments,
        costGhs: Math.round(sms.segments * SMS_COST_PER_SEGMENT_GHS * 100) / 100,
        status: 'queued',
      };
    }),
    ...resolved.skipped.map((r) => ({
      broadcastId: broadcast._id,
      organizerId,
      tripId: trip._id,
      bookingId: r.bookingId,
      travelerId: r.travelerId,
      recipientName: r.name,
      phone: r.rawPhone || undefined,
      personalizedMessage: personalizeMessage(body, r.name),
      segments: 0,
      costGhs: 0,
      status: 'skipped',
      skipReason: 'Missing or invalid phone number',
    })),
  ];

  await BroadcastDelivery.insertMany(deliveryDocs);

  // Fire-and-forget async delivery (no job queue in v1).
  setImmediate(() => {
    processBroadcastDeliveries(broadcast._id).catch((error) => {
      console.error(`[BROADCAST ${broadcast._id}] delivery failed:`, error.message);
      Broadcast.findByIdAndUpdate(broadcast._id, {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: error.message || 'Broadcast processing failed',
      }).catch(() => {});
    });
  });

  return { broadcast, reused: false };
};

const listBroadcasts = async ({
  organizerId,
  status,
  tripId,
  page = 1,
  limit = 20,
}) => {
  const filter = { organizerId };
  if (status && status !== 'all') {
    if (!['sent', 'pending', 'failed'].includes(status)) {
      const err = new Error('status must be all, sent, pending, or failed');
      err.statusCode = 400;
      throw err;
    }
    filter.status = status;
  }
  if (tripId) filter.tripId = tripId;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [broadcasts, total, sentCount, tripAttendeeCount] = await Promise.all([
    Broadcast.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
    Broadcast.countDocuments(filter),
    Broadcast.countDocuments({ organizerId, status: 'sent', ...(tripId ? { tripId } : {}) }),
    tripId
      ? Booking.countDocuments({
          tripId,
          status: { $in: AUDIENCE_BOOKING_STATUSES },
        })
      : Promise.resolve(null),
  ]);

  return {
    broadcasts: broadcasts.map((b) => b.toListJSON()),
    summary: {
      sentCount,
      ...(tripAttendeeCount != null ? { tripAttendeeCount } : {}),
    },
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 0,
    },
  };
};

const getBroadcastDetail = async ({ organizerId, broadcastId }) => {
  const broadcast = await Broadcast.findOne({ _id: broadcastId, organizerId });
  if (!broadcast) {
    const err = new Error('Broadcast not found');
    err.statusCode = 404;
    throw err;
  }

  const deliveries = await BroadcastDelivery.find({ broadcastId: broadcast._id }).sort({
    createdAt: 1,
  });

  return {
    broadcast: broadcast.toDetailJSON(),
    deliveries: deliveries.map((d) => d.toJSON()),
  };
};

module.exports = {
  SMS_COST_PER_SEGMENT_GHS,
  MAX_RECIPIENTS_PER_BROADCAST,
  analyzeSms,
  personalizeMessage,
  audienceLabel,
  resolveAudience,
  estimateBroadcast,
  getBroadcastAudiencePreview,
  createBroadcast,
  listBroadcasts,
  getBroadcastDetail,
  processBroadcastDeliveries,
};
