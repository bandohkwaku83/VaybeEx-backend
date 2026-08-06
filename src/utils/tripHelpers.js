const crypto = require('crypto');
const { TRIP_SPECIALTIES } = require('../constants/tripSpecialties');

/** Trip category uses the same selectable list as organizer profile trip specialties. */
const TRIP_CATEGORIES = [...TRIP_SPECIALTIES];
const DIFFICULTY_LEVELS = ['easy', 'moderate', 'challenging'];
const DEPOSIT_DUE_OPTIONS = ['at_booking', '7_days_before', '14_days_before', '30_days_before'];
const REFUND_POLICIES = ['fully_refundable', 'partially_refundable', 'non_refundable'];
const TRIP_STATUSES = ['draft', 'scheduled', 'live', 'completed', 'cancelled'];
const VISIBILITY_OPTIONS = ['public', 'private'];

const REFUND_POLICY_ALIASES = {
  fully_refundable: 'fully_refundable',
  partially_refundable: 'partially_refundable',
  non_refundable: 'non_refundable',
  full: 'fully_refundable',
  free_cancellation: 'fully_refundable',
  free: 'fully_refundable',
  partial: 'partially_refundable',
  partial_refund: 'partially_refundable',
  none: 'non_refundable',
  no_refund: 'non_refundable',
};

const parseStringArray = (value) => {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).trim()).filter(Boolean);
        }
      } catch {
        // fall through to delimiter parsing
      }
    }

    return trimmed
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const parseJsonArray = (value) => {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value;

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
};

const parseNumber = (value) => {
  if (value == null || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const parseBoolean = (value) => {
  if (value == null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
};

const parseDate = (value) => {
  if (value == null || value === '') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const slugify = (text) =>
  String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizeRefundPolicy = (value) => {
  if (value == null || value === '') return undefined;
  const key = String(value).trim().toLowerCase();
  return REFUND_POLICY_ALIASES[key];
};

const generateUniqueSlug = async (Trip, titleOrSlug, organizerId, excludeId = null) => {
  const base = slugify(titleOrSlug) || `trip-${crypto.randomBytes(4).toString('hex')}`;
  let slug = base;
  let suffix = 1;

  while (true) {
    const query = { slug, organizerId };
    if (excludeId) query._id = { $ne: excludeId };
    const existing = await Trip.findOne(query).select('_id');
    if (!existing) return slug;
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
};

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const firstDefined = (body, keys) => {
  for (const key of keys) {
    if (body[key] !== undefined) return body[key];
  }
  return undefined;
};

const buildTripPayload = (body) => {
  const payload = {};

  const stringFields = [
    'title',
    'destination',
    'category',
    'description',
    'depositDue',
    'status',
    'visibility',
  ];

  stringFields.forEach((field) => {
    if (body[field] !== undefined) {
      payload[field] = String(body[field]).trim();
    }
  });

  const departurePoint = firstDefined(body, ['departurePoint', 'pickupPoint']);
  if (departurePoint !== undefined) {
    payload.departurePoint = String(departurePoint).trim();
  }

  const meetingPointDetails = firstDefined(body, [
    'meetingPointDetails',
    'meetingPoint',
    'meetingNotes',
  ]);
  if (meetingPointDetails !== undefined) {
    payload.meetingPointDetails = String(meetingPointDetails).trim();
  }

  const departureTime = firstDefined(body, ['departureTime']);
  if (departureTime !== undefined) {
    payload.departureTime = String(departureTime).trim();
  }

  const expectedReturnTime = firstDefined(body, [
    'expectedReturnTime',
    'returnTime',
    'expectedReturn',
  ]);
  if (expectedReturnTime !== undefined) {
    payload.expectedReturnTime = String(expectedReturnTime).trim();
  }

  if (body.organizerContactEmail !== undefined) {
    payload.organizerContactEmail = String(body.organizerContactEmail).trim().toLowerCase();
  }

  if (body.organizerContactPhone !== undefined) {
    payload.organizerContactPhone = String(body.organizerContactPhone).trim();
  }

  if (body.slug !== undefined) {
    const slug = slugify(body.slug);
    if (slug) payload.slug = slug;
  }

  const refundRaw = firstDefined(body, ['refundPolicy']);
  if (refundRaw !== undefined) {
    const normalized = normalizeRefundPolicy(refundRaw);
    if (normalized) payload.refundPolicy = normalized;
    else if (String(refundRaw).trim() === '') payload.refundPolicy = '';
  }

  const numberFields = [
    ['minAge', ['minAge']],
    ['maxAge', ['maxAge']],
    ['pricePerPerson', ['pricePerPerson', 'price']],
    ['couplePrice', ['couplePrice']],
    ['groupPrice', ['groupPrice']],
    ['groupSize', ['groupSize']],
    ['depositAmount', ['depositAmount', 'initialDeposit']],
    ['earlyBirdPrice', ['earlyBirdPrice']],
    ['refundPercentage', ['refundPercentage']],
    ['cancellationDeadlineDays', ['cancellationDeadlineDays', 'refundDeadlineDays']],
  ];

  numberFields.forEach(([field, aliases]) => {
    const raw = firstDefined(body, aliases);
    if (raw !== undefined) {
      const parsed = parseNumber(raw);
      if (parsed !== undefined) payload[field] = parsed;
    }
  });

  // Empty max travelers = unlimited capacity.
  const maxCapacityRaw = firstDefined(body, ['maxCapacity', 'maxTravelers', 'capacity']);
  if (maxCapacityRaw !== undefined) {
    const parsed = parseNumber(maxCapacityRaw);
    if (parsed !== undefined) {
      payload.maxCapacity = parsed;
    } else {
      payload.$unsetMaxCapacity = true;
    }
  }

  const offerCouplePrice = parseBoolean(body.offerCouplePrice);
  if (offerCouplePrice === false) {
    payload.couplePrice = undefined;
    payload.$unsetCouplePrice = true;
  }

  const offerGroupPrice = parseBoolean(body.offerGroupPrice);
  if (offerGroupPrice === false) {
    payload.groupPrice = undefined;
    payload.groupSize = undefined;
    payload.$unsetGroupPrice = true;
  }

  const dateFields = ['startDate', 'endDate', 'earlyBirdDeadline', 'scheduledPublishAt'];
  dateFields.forEach((field) => {
    if (body[field] !== undefined) {
      const parsed = parseDate(body[field]);
      if (parsed !== undefined) payload[field] = parsed;
    }
  });

  const arrayFields = [
    ['tags', ['tags']],
    ['highlights', ['highlights']],
    ['included', ['included']],
    ['excluded', ['excluded', 'notIncluded']],
  ];

  arrayFields.forEach(([field, aliases]) => {
    const raw = firstDefined(body, aliases);
    if (raw !== undefined) {
      payload[field] = parseStringArray(raw);
    }
  });

  if (body.addOns !== undefined) {
    payload.addOns = parseJsonArray(body.addOns)
      .map((item) => ({
        name: String(item.name || '').trim(),
        price: parseNumber(item.price) ?? 0,
        perPerson: item.perPerson === false || item.perPerson === 'false' ? false : true,
      }))
      .filter((item) => item.name);
  }

  if (body.itinerary !== undefined) {
    payload.itinerary = parseJsonArray(body.itinerary)
      .map((item, index) => ({
        day: parseNumber(item.day) ?? index + 1,
        title: String(item.title || item.dayTitle || '').trim(),
        activities: parseStringArray(item.activities),
      }))
      .filter((item) => item.title);
  }

  if (body.publishConfirmed !== undefined) {
    payload.publishConfirmed = parseBoolean(body.publishConfirmed) ?? false;
  }

  return payload;
};

const clearTripField = (trip, field) => {
  trip[field] = null;
  if (typeof trip.set === 'function') {
    trip.set(field, null);
  }
};

const applyPayloadToTrip = (trip, payload) => {
  const {
    $unsetCouplePrice,
    $unsetGroupPrice,
    $unsetMaxCapacity,
    ...fields
  } = payload;

  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined) return;
    trip[key] = value;
  });

  // Not collected on the create-trip form — always default to 1.
  trip.minCapacity = 1;

  if ($unsetCouplePrice) {
    clearTripField(trip, 'couplePrice');
  }

  if ($unsetGroupPrice) {
    clearTripField(trip, 'groupPrice');
    clearTripField(trip, 'groupSize');
  }

  if ($unsetMaxCapacity) {
    trip.maxCapacity = null;
  }
};

const validateCoverImage = (trip) => {
  if (!trip.coverImage) {
    return 'Cover image is required';
  }
  return null;
};

/**
 * Publish rules aligned with the 4-step create-trip UI:
 * Basics + Experience inclusions + Pricing + Meetup logistics.
 */
const validateTripForPublish = (trip) => {
  const errors = [];

  const coverError = validateCoverImage(trip);
  if (coverError) errors.push(coverError);
  if (!trip.title?.trim()) errors.push('Trip title is required');
  if (!trip.destination?.trim()) errors.push('Destination is required');
  if (!TRIP_CATEGORIES.includes(trip.category)) errors.push('Valid category is required');
  if (!trip.startDate) errors.push('Start date is required');
  if (!trip.endDate) errors.push('End date is required');
  if (trip.startDate && trip.endDate && trip.endDate < trip.startDate) {
    errors.push('End date must be on or after start date');
  }
  if (!trip.description?.trim()) errors.push('Description is required');
  if (!trip.included?.length) errors.push('At least one inclusion is required');

  // minCapacity is not part of the create-trip form; always default to 1.
  trip.minCapacity = 1;
  // Empty / omitted maxCapacity means unlimited travelers.
  if (trip.maxCapacity != null && trip.maxCapacity < 1) {
    errors.push('Max travelers must be at least 1 when set');
  }
  if (trip.minAge != null && trip.maxAge != null && trip.minAge > trip.maxAge) {
    errors.push('Minimum age cannot exceed maximum age');
  }

  if (!trip.departurePoint?.trim()) errors.push('Departure / pickup point is required');
  if (!trip.departureTime?.trim()) errors.push('Departure time is required');
  if (!trip.expectedReturnTime?.trim()) errors.push('Expected return time is required');

  if (trip.pricePerPerson == null) errors.push('Price per person is required');
  if (trip.couplePrice != null && trip.couplePrice <= 0) {
    errors.push('Couple price must be greater than 0 when offered');
  }
  if (trip.groupPrice != null) {
    if (trip.groupPrice <= 0) errors.push('Group price must be greater than 0 when offered');
    if (trip.groupSize == null || trip.groupSize < 2) {
      errors.push('Group size is required when a group rate is offered');
    }
  }

  if (trip.earlyBirdPrice != null && !trip.earlyBirdDeadline) {
    errors.push('Early bird deadline is required when early bird price is set');
  }

  if (!REFUND_POLICIES.includes(trip.refundPolicy)) {
    errors.push('Refund policy is required');
  }
  if (trip.refundPolicy === 'partially_refundable') {
    if (trip.refundPercentage == null) {
      errors.push('Refund percentage is required for partial refunds');
    } else if (trip.refundPercentage <= 0 || trip.refundPercentage > 100) {
      errors.push('Refund percentage must be between 1 and 100');
    }
    if (trip.cancellationDeadlineDays == null) {
      errors.push('Refund deadline (days before departure) is required for partial refunds');
    }
  }
  if (trip.refundPolicy === 'fully_refundable' && trip.cancellationDeadlineDays == null) {
    trip.cancellationDeadlineDays = 14;
  }

  if (trip.depositAmount != null && trip.depositAmount > 0 && !trip.depositDue) {
    trip.depositDue = 'at_booking';
  }

  if (!trip.publishConfirmed) {
    trip.publishConfirmed = true;
  }

  return errors;
};

module.exports = {
  TRIP_CATEGORIES,
  DIFFICULTY_LEVELS,
  DEPOSIT_DUE_OPTIONS,
  REFUND_POLICIES,
  TRIP_STATUSES,
  VISIBILITY_OPTIONS,
  REFUND_POLICY_ALIASES,
  parseStringArray,
  parseJsonArray,
  parseNumber,
  parseBoolean,
  parseDate,
  slugify,
  normalizeRefundPolicy,
  generateUniqueSlug,
  buildTripPayload,
  applyPayloadToTrip,
  validateCoverImage,
  validateTripForPublish,
  validateEmail,
};
