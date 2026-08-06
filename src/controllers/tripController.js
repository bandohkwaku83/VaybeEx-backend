const mongoose = require('mongoose');
const Trip = require('../models/Trip');
const Booking = require('../models/Booking');
const FavoriteTrip = require('../models/FavoriteTrip');
const User = require('../models/User');
const { normalizeGhanaPhone } = require('../utils/phone');
const { applyTripMediaUploads } = require('../middleware/upload');
const {
  TRIP_CATEGORIES,
  DEPOSIT_DUE_OPTIONS,
  REFUND_POLICIES,
  TRIP_STATUSES,
  VISIBILITY_OPTIONS,
  buildTripPayload,
  applyPayloadToTrip,
  validateCoverImage,
  validateTripForPublish,
  generateUniqueSlug,
  parseStringArray,
  parseDate,
  slugify,
} = require('../utils/tripHelpers');

const loadOrganizerTrip = async (req, res) => {
  const trip = await Trip.findOne({
    _id: req.params.id,
    organizerId: req.user.userId,
  });

  if (!trip) {
    res.status(404).json({
      success: false,
      message: 'Trip not found',
    });
    return null;
  }

  return trip;
};

const normalizeContactPhone = (phone) => {
  if (!phone?.trim()) return phone;
  return normalizeGhanaPhone(phone);
};

const ensureTripSlug = async (trip, preferredSlug) => {
  const source = preferredSlug || trip.slug || trip.title;
  if (!source?.trim()) return;
  trip.slug = await generateUniqueSlug(Trip, source, trip.organizerId, trip._id);
};

const createTrip = async (req, res, next) => {
  try {
    const payload = buildTripPayload(req.body);
    const action = req.body.action || 'draft';

    if (payload.category && !TRIP_CATEGORIES.includes(payload.category)) {
      return res.status(400).json({
        success: false,
        message: `Category must be one of: ${TRIP_CATEGORIES.join(', ')}`,
      });
    }

    if (payload.organizerContactPhone) {
      try {
        payload.organizerContactPhone = normalizeContactPhone(payload.organizerContactPhone);
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
      }
    }

    const organizer = req.organizer || (await User.findById(req.user.userId));
    if (!payload.organizerContactPhone && organizer?.phone) {
      payload.organizerContactPhone = organizer.phone;
    }
    if (!payload.organizerContactEmail && organizer?.email) {
      payload.organizerContactEmail = organizer.email;
    }

    const trip = new Trip({
      _id: req.draftTripId,
      organizerId: req.user.userId,
      status: 'draft',
      visibility: payload.visibility || 'private',
    });

    applyPayloadToTrip(trip, payload);
    applyTripMediaUploads(trip, req.files);

    // `live` is accepted as an alias of `publish` (frontend historically sent live).
    const publishNow = action === 'publish' || action === 'live';
    if (publishNow || action === 'schedule') {
      const coverError = validateCoverImage(trip);
      if (coverError) {
        return res.status(400).json({ success: false, message: coverError });
      }

      const errors = validateTripForPublish(trip);
      if (errors.length) {
        return res.status(400).json({ success: false, message: errors[0], errors });
      }

      await ensureTripSlug(trip, payload.slug);

      if (publishNow) {
        trip.status = 'live';
        if (!trip.visibility || trip.visibility === 'private') {
          trip.visibility = 'public';
        }
      } else {
        if (!trip.scheduledPublishAt) {
          return res.status(400).json({
            success: false,
            message: 'Scheduled publish date is required',
          });
        }
        trip.status = 'scheduled';
      }
    } else if (payload.slug || trip.title) {
      await ensureTripSlug(trip, payload.slug);
    }

    await trip.save();

    res.status(201).json({
      success: true,
      message:
        publishNow
          ? 'Trip published successfully'
          : action === 'schedule'
            ? 'Trip scheduled successfully'
            : 'Trip saved as draft',
      data: trip.toOrganizerJSON(),
    });
  } catch (error) {
    if (error?.code === 11000 && String(error.message).includes('slug')) {
      return res.status(400).json({
        success: false,
        message: 'This public link is already in use for another of your trips',
      });
    }
    next(error);
  }
};

const listOrganizerTrips = async (req, res, next) => {
  try {
    const { status, visibility, page = 1, limit = 20 } = req.query;
    const filter = { organizerId: req.user.userId };

    if (status) filter.status = status;
    if (visibility) filter.visibility = visibility;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [trips, total] = await Promise.all([
      Trip.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limitNum),
      Trip.countDocuments(filter),
    ]);

    res.json({
      success: true,
      message: 'Trips retrieved successfully',
      data: {
        trips: trips.map((trip) => trip.toOrganizerJSON()),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

const getOrganizerTrip = async (req, res, next) => {
  try {
    const trip = await loadOrganizerTrip(req, res);
    if (!trip) return;

    const bookings = await Booking.find({ tripId: trip._id })
      .sort({ createdAt: -1 })
      .populate('travelerId', 'fullName email phone location whatsapp');

    const bookingsSummary = {
      total: bookings.length,
      confirmed: 0,
      pendingPayment: 0,
      cancelled: 0,
      refunded: 0,
      totalTravelers: 0,
      totalPaid: 0,
    };

    bookings.forEach((booking) => {
      if (booking.status === 'confirmed') {
        bookingsSummary.confirmed += 1;
        bookingsSummary.totalTravelers += booking.partySize;
        bookingsSummary.totalPaid += booking.amountPaid || 0;
      } else if (booking.status === 'pending_payment') {
        bookingsSummary.pendingPayment += 1;
      } else if (booking.status === 'cancelled') {
        bookingsSummary.cancelled += 1;
      } else if (booking.status === 'refunded') {
        bookingsSummary.refunded += 1;
      }
    });

    const travelerObjectIds = [
      ...new Set(
        bookings
          .filter((b) => b.status === 'confirmed')
          .map((b) => String(b.travelerId?._id || b.travelerId))
      ),
    ]
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    let repeatBookers = 0;
    if (travelerObjectIds.length) {
      const prior = await Booking.aggregate([
        {
          $match: {
            travelerId: { $in: travelerObjectIds },
            status: 'confirmed',
            tripId: { $ne: trip._id },
          },
        },
        {
          $lookup: {
            from: 'trips',
            localField: 'tripId',
            foreignField: '_id',
            as: 'trip',
          },
        },
        { $unwind: '$trip' },
        { $match: { 'trip.organizerId': trip.organizerId } },
        { $group: { _id: '$travelerId' } },
        { $count: 'count' },
      ]);
      repeatBookers = prior[0]?.count || 0;
    }

    const analytics = {
      ...trip.getAnalytics(),
      repeatBookers,
    };

    res.json({
      success: true,
      message: 'Trip retrieved successfully',
      data: {
        ...trip.toOrganizerJSON(),
        analytics,
        bookings: bookings.map((booking) => booking.toOrganizerJSON()),
        bookingsSummary,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getTripAnalytics = async (req, res, next) => {
  try {
    const trip = await loadOrganizerTrip(req, res);
    if (!trip) return;

    const confirmedBookings = await Booking.find({
      tripId: trip._id,
      status: 'confirmed',
    }).select('travelerId');

    const travelerIds = [...new Set(confirmedBookings.map((b) => String(b.travelerId)))];
    let repeatBookers = 0;

    if (travelerIds.length) {
      const prior = await Booking.aggregate([
        {
          $match: {
            travelerId: { $in: confirmedBookings.map((b) => b.travelerId) },
            status: 'confirmed',
            tripId: { $ne: trip._id },
          },
        },
        {
          $lookup: {
            from: 'trips',
            localField: 'tripId',
            foreignField: '_id',
            as: 'trip',
          },
        },
        { $unwind: '$trip' },
        { $match: { 'trip.organizerId': trip.organizerId } },
        { $group: { _id: '$travelerId' } },
        { $count: 'count' },
      ]);
      repeatBookers = prior[0]?.count || 0;
    }

    res.json({
      success: true,
      message: 'Trip analytics retrieved successfully',
      data: {
        tripId: trip._id,
        ...trip.getAnalytics(),
        repeatBookers,
      },
    });
  } catch (error) {
    next(error);
  }
};

const updateTrip = async (req, res, next) => {
  try {
    const trip = await loadOrganizerTrip(req, res);
    if (!trip) return;

    if (['completed', 'cancelled'].includes(trip.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot edit a ${trip.status} trip`,
      });
    }

    const payload = buildTripPayload(req.body);

    if (payload.category && !TRIP_CATEGORIES.includes(payload.category)) {
      return res.status(400).json({
        success: false,
        message: `Category must be one of: ${TRIP_CATEGORIES.join(', ')}`,
      });
    }

    if (payload.organizerContactPhone) {
      try {
        payload.organizerContactPhone = normalizeContactPhone(payload.organizerContactPhone);
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
      }
    }

    if (req.body.removeGallery !== undefined) {
      const toRemove = new Set(parseStringArray(req.body.removeGallery));
      trip.gallery = (trip.gallery || []).filter((url) => !toRemove.has(url));
    }

    if (req.body.replaceGallery !== undefined) {
      trip.gallery = parseStringArray(req.body.replaceGallery).slice(0, 6);
    }

    const previousSlug = trip.slug;
    applyPayloadToTrip(trip, payload);
    applyTripMediaUploads(trip, req.files);

    if (trip.gallery?.length > 6) {
      trip.gallery = trip.gallery.slice(0, 6);
    }

    if (payload.slug && payload.slug !== previousSlug) {
      trip.slug = await generateUniqueSlug(Trip, payload.slug, trip.organizerId, trip._id);
    } else if (trip.title && !trip.slug) {
      await ensureTripSlug(trip);
    } else if (trip.title && trip.slug && trip.isModified('title') && !payload.slug) {
      // Keep existing custom slug unless the client explicitly sent a new one
    }

    await trip.save();

    res.json({
      success: true,
      message: 'Trip updated successfully',
      data: trip.toOrganizerJSON(),
    });
  } catch (error) {
    if (error?.code === 11000 && String(error.message).includes('slug')) {
      return res.status(400).json({
        success: false,
        message: 'This public link is already in use for another of your trips',
      });
    }
    next(error);
  }
};

const publishTrip = async (req, res, next) => {
  try {
    const trip = await loadOrganizerTrip(req, res);
    if (!trip) return;

    const { action, status, visibility } = req.body;

    if (visibility && VISIBILITY_OPTIONS.includes(visibility)) {
      trip.visibility = visibility;
    }

    if (req.body.publishConfirmed !== undefined) {
      trip.publishConfirmed = ['true', '1', true].includes(req.body.publishConfirmed);
    }

    if (req.body.scheduledPublishAt !== undefined) {
      const parsed = parseDate(req.body.scheduledPublishAt);
      if (parsed) trip.scheduledPublishAt = parsed;
    }

    if (req.body.slug !== undefined) {
      const slug = slugify(req.body.slug);
      if (slug) {
        trip.slug = await generateUniqueSlug(Trip, slug, trip.organizerId, trip._id);
      }
    }

    const resolvedAction = action || status;

    if (resolvedAction === 'draft') {
      trip.status = 'draft';
      await trip.save();
      return res.json({
        success: true,
        message: 'Trip moved to draft',
        data: trip.toOrganizerJSON(),
      });
    }

    if (resolvedAction === 'cancelled') {
      trip.status = 'cancelled';
      await trip.save();
      return res.json({
        success: true,
        message: 'Trip cancelled',
        data: trip.toOrganizerJSON(),
      });
    }

    if (resolvedAction === 'completed') {
      trip.status = 'completed';
      await trip.save();
      return res.json({
        success: true,
        message: 'Trip marked as completed',
        data: trip.toOrganizerJSON(),
      });
    }

    const errors = validateTripForPublish(trip);
    if (errors.length) {
      return res.status(400).json({ success: false, message: errors[0], errors });
    }

    if (resolvedAction === 'schedule' || status === 'scheduled') {
      const fromBody = req.body.scheduledPublishAt;
      if (fromBody !== undefined) {
        const parsed = parseDate(fromBody);
        if (!parsed) {
          return res.status(400).json({
            success: false,
            message: 'Select a valid publish date',
          });
        }
        trip.scheduledPublishAt = parsed;
      }
      if (!trip.scheduledPublishAt) {
        return res.status(400).json({
          success: false,
          message: 'Scheduled publish date is required',
        });
      }
      trip.status = 'scheduled';
    } else if (['live', 'publish'].includes(resolvedAction) || status === 'live') {
      trip.status = 'live';
      if (trip.scheduledPublishAt) {
        trip.scheduledPublishAt = undefined;
      }
      if (!trip.visibility || trip.visibility === 'private') {
        trip.visibility = 'public';
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid publish action. Use draft, live, publish, schedule, completed, or cancelled',
      });
    }

    await ensureTripSlug(trip);

    await trip.save();

    res.json({
      success: true,
      message:
        trip.status === 'scheduled' ? 'Trip scheduled successfully' : 'Trip published successfully',
      data: trip.toOrganizerJSON(),
    });
  } catch (error) {
    next(error);
  }
};

const deleteTrip = async (req, res, next) => {
  try {
    const trip = await loadOrganizerTrip(req, res);
    if (!trip) return;

    if (trip.status === 'live' || trip.bookingsCount > 0) {
      trip.status = 'cancelled';
      await trip.save();
      return res.json({
        success: true,
        message: 'Trip cancelled (existing bookings preserved)',
        data: trip.toOrganizerJSON(),
      });
    }

    await trip.deleteOne();

    res.json({
      success: true,
      message: 'Trip deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

const getTripOptions = async (req, res) => {
  res.json({
    success: true,
    message: 'Trip form options',
    data: {
      depositDueOptions: DEPOSIT_DUE_OPTIONS,
      refundPolicies: REFUND_POLICIES,
      refundPolicyUi: [
        { value: 'full', label: 'Free cancellation', mapsTo: 'fully_refundable' },
        { value: 'partial', label: 'Partial refund', mapsTo: 'partially_refundable' },
        { value: 'none', label: 'Non-refundable', mapsTo: 'non_refundable' },
      ],
      statuses: TRIP_STATUSES,
      visibilityOptions: VISIBILITY_OPTIONS,
      pricingRates: ['per_person', 'couple', 'group'],
      galleryLimit: 6,
      maxImageBytes: 5 * 1024 * 1024,
    },
  });
};

const PUBLIC_ORGANIZER_SELECT =
  'fullName businessName brandSlug brandLogo profilePhoto location aboutYou tripSpecialties whatsapp status isVerified';

const attachFavoriteFlags = async (trips, user) => {
  if (!user?.userId || user.role !== 'traveler' || !trips.length) {
    return trips.map((trip) => ({ ...trip, isFavorited: false }));
  }

  const tripIds = trips.map((t) => t.id || t._id).filter(Boolean);
  const favorites = await FavoriteTrip.find({
    travelerId: user.userId,
    tripId: { $in: tripIds },
  }).select('tripId');
  const favoritedSet = new Set(favorites.map((f) => String(f.tripId)));

  return trips.map((trip) => ({
    ...trip,
    isFavorited: favoritedSet.has(String(trip.id || trip._id)),
  }));
};

const isPubliclyViewableTrip = (trip) => {
  if (trip.visibility === 'private') return false;
  return trip.status === 'live' || trip.status === 'completed';
};

const listPublicTrips = async (req, res, next) => {
  try {
    const { category, destination, page = 1, limit = 20, brandSlug } = req.query;
    const filter = {
      visibility: 'public',
      // Global browse: live only. Brand profile: live + completed.
      status: brandSlug ? { $in: ['live', 'completed'] } : 'live',
    };

    if (category) filter.category = category;
    if (destination) filter.destination = new RegExp(destination, 'i');

    if (brandSlug) {
      const organizer = await User.findOne({
        brandSlug: String(brandSlug).toLowerCase().trim(),
        role: 'organizer',
      }).select('_id');
      if (!organizer) {
        return res.json({
          success: true,
          message: 'Trips retrieved successfully',
          data: {
            trips: [],
            pagination: { page: 1, limit: 20, total: 0, pages: 0 },
          },
        });
      }
      filter.organizerId = organizer._id;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    let trips;
    let total;

    if (brandSlug) {
      // Live first, then completed; within each group, newest start date first.
      const [rows, count] = await Promise.all([
        Trip.aggregate([
          { $match: filter },
          {
            $addFields: {
              _statusOrder: { $cond: [{ $eq: ['$status', 'live'] }, 0, 1] },
            },
          },
          { $sort: { _statusOrder: 1, startDate: -1 } },
          { $skip: skip },
          { $limit: limitNum },
        ]),
        Trip.countDocuments(filter),
      ]);
      trips = rows.map((doc) => Trip.hydrate(doc));
      total = count;
    } else {
      [trips, total] = await Promise.all([
        Trip.find(filter).sort({ startDate: 1 }).skip(skip).limit(limitNum),
        Trip.countDocuments(filter),
      ]);
    }

    const organizerIds = [...new Set(trips.map((t) => String(t.organizerId)))];
    const organizers = await User.find({ _id: { $in: organizerIds } }).select(
      PUBLIC_ORGANIZER_SELECT
    );
    const organizerMap = Object.fromEntries(organizers.map((o) => [String(o._id), o]));

    const publicTrips = trips.map((trip) =>
      trip.toPublicJSON(organizerMap[String(trip.organizerId)])
    );

    res.json({
      success: true,
      message: 'Trips retrieved successfully',
      data: {
        trips: await attachFavoriteFlags(publicTrips, req.user),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

const getPublicTrip = async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const isObjectId = /^[a-f\d]{24}$/i.test(idOrSlug);

    const trip = await Trip.findOne(
      isObjectId ? { _id: idOrSlug } : { slug: idOrSlug.toLowerCase() }
    );

    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found' });
    }

    const isOwner =
      req.user?.role === 'organizer' && String(trip.organizerId) === String(req.user.userId);

    if (!isOwner) {
      if (!isPubliclyViewableTrip(trip)) {
        return res.status(404).json({ success: false, message: 'Trip not found' });
      }

      // Only count views for bookable (live) trips.
      if (trip.status === 'live') {
        trip.viewsCount = (trip.viewsCount || 0) + 1;
        await trip.save();
      }
    }

    const organizer = await User.findById(trip.organizerId).select(PUBLIC_ORGANIZER_SELECT);

    const payload = isOwner ? trip.toOrganizerJSON() : trip.toPublicJSON(organizer);
    const [withFavorite] = isOwner
      ? [payload]
      : await attachFavoriteFlags([payload], req.user);

    res.json({
      success: true,
      message: 'Trip retrieved successfully',
      data: withFavorite,
    });
  } catch (error) {
    next(error);
  }
};

const getPublicTripByBrand = async (req, res, next) => {
  try {
    const brandSlug = String(req.params.brandSlug || '')
      .toLowerCase()
      .trim();
    const tripSlug = String(req.params.tripSlug || '')
      .toLowerCase()
      .trim();

    if (!brandSlug || !tripSlug) {
      return res.status(400).json({
        success: false,
        message: 'Brand slug and trip slug are required',
      });
    }

    const organizer = await User.findOne({ brandSlug, role: 'organizer' }).select(
      PUBLIC_ORGANIZER_SELECT
    );

    if (!organizer) {
      return res.status(404).json({ success: false, message: 'Trip not found' });
    }

    const trip = await Trip.findOne({
      organizerId: organizer._id,
      slug: tripSlug,
    });

    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found' });
    }

    const isOwner =
      req.user?.role === 'organizer' && String(trip.organizerId) === String(req.user.userId);

    if (!isOwner) {
      if (!isPubliclyViewableTrip(trip)) {
        return res.status(404).json({ success: false, message: 'Trip not found' });
      }

      if (trip.status === 'live') {
        trip.viewsCount = (trip.viewsCount || 0) + 1;
        await trip.save();
      }
    }

    const payload = isOwner ? trip.toOrganizerJSON() : trip.toPublicJSON(organizer);
    const [withFavorite] = isOwner
      ? [payload]
      : await attachFavoriteFlags([payload], req.user);

    res.json({
      success: true,
      message: 'Trip retrieved successfully',
      data: withFavorite,
    });
  } catch (error) {
    next(error);
  }
};

const trackTripEvent = async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const event = String(req.body.event || req.body.type || '')
      .toLowerCase()
      .trim();

    const allowed = {
      book_click: 'bookClicksCount',
      clicked_book: 'bookClicksCount',
      checkout_start: 'checkoutStartsCount',
      started_checkout: 'checkoutStartsCount',
    };

    const field = allowed[event];
    if (!field) {
      return res.status(400).json({
        success: false,
        message: 'event must be one of: book_click, checkout_start',
      });
    }

    const isObjectId = /^[a-f\d]{24}$/i.test(idOrSlug);
    const trip = await Trip.findOne(
      isObjectId
        ? { _id: idOrSlug, status: 'live' }
        : { slug: idOrSlug.toLowerCase(), status: 'live' }
    );

    if (!trip || trip.visibility === 'private') {
      return res.status(404).json({ success: false, message: 'Trip not found' });
    }

    trip[field] = (trip[field] || 0) + 1;
    await trip.save();

    res.json({
      success: true,
      message: 'Event tracked',
      data: {
        tripId: trip._id,
        event,
        [field]: trip[field],
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createTrip,
  listOrganizerTrips,
  getOrganizerTrip,
  getTripAnalytics,
  updateTrip,
  publishTrip,
  deleteTrip,
  getTripOptions,
  listPublicTrips,
  getPublicTrip,
  getPublicTripByBrand,
  trackTripEvent,
};
