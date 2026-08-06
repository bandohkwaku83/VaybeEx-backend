const CancellationRequest = require('../models/CancellationRequest');
const Booking = require('../models/Booking');
const Trip = require('../models/Trip');
const { estimateRefund } = require('../utils/refundHelpers');
const { cancelBookingAndReleaseSeats } = require('../services/bookingService');
const { notifyOrganizerRefundRequest } = require('../services/paymentNotifyService');

const { CANCELLATION_STATUSES } = CancellationRequest;

const normalizeStatusFilter = (status) => {
  if (!status) return null;
  const value = String(status).toLowerCase().trim();
  return CANCELLATION_STATUSES.includes(value) ? value : null;
};

const loadTravelerBookingWithTrip = async (req, res) => {
  const booking = await Booking.findOne({
    _id: req.params.id,
    travelerId: req.user.userId,
  }).populate(
    'tripId',
    'title destination startDate endDate coverImage slug status refundPolicy refundPercentage cancellationDeadlineDays organizerId'
  );

  if (!booking) {
    res.status(404).json({ success: false, message: 'Booking not found' });
    return null;
  }

  return booking;
};

/**
 * GET /bookings/:id/cancellation-preview
 * Preview refund eligibility before submitting a cancellation.
 */
const getCancellationPreview = async (req, res, next) => {
  try {
    const booking = await loadTravelerBookingWithTrip(req, res);
    if (!booking) return;

    const trip = booking.tripId;
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found for this booking' });
    }

    if (booking.status === 'cancelled' || booking.status === 'refunded') {
      return res.status(400).json({
        success: false,
        message: `This booking is already ${booking.status}`,
      });
    }

    const estimate = estimateRefund(trip, booking);

    res.json({
      success: true,
      message: 'Cancellation preview',
      data: {
        bookingId: booking._id,
        tripId: trip._id,
        tripTitle: trip.title,
        destination: trip.destination,
        startDate: trip.startDate,
        paymentMethod: booking.paymentMethod || undefined,
        ...estimate,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /bookings/:id/cancel
 * Traveler requests cancellation (and refund when eligible).
 */
const requestCancellation = async (req, res, next) => {
  try {
    const booking = await loadTravelerBookingWithTrip(req, res);
    if (!booking) return;

    const trip = booking.tripId;
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found for this booking' });
    }

    if (booking.status === 'cancelled' || booking.status === 'refunded') {
      return res.status(400).json({
        success: false,
        message: `This booking is already ${booking.status}`,
      });
    }

    const existing = await CancellationRequest.findOne({ bookingId: booking._id });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'A cancellation request already exists for this booking',
        data: existing.toTravelerJSON(),
      });
    }

    const estimate = estimateRefund(trip, booking);
    const reason =
      typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 2000) : '';

    const refundDestination = booking.paymentMethod
      ? `Original payment method (${booking.paymentMethod}) via Paystack`
      : 'Original payment method via Paystack';

    const request = new CancellationRequest({
      bookingId: booking._id,
      tripId: trip._id,
      travelerId: booking.travelerId,
      organizerId: trip.organizerId,
      tripTitle: trip.title,
      destination: trip.destination || '',
      startDate: trip.startDate,
      amountPaid: estimate.amountPaid,
      refundAmount: estimate.refundAmount,
      refundEligible: estimate.eligible,
      reason: reason || undefined,
      status: estimate.eligible ? 'pending' : 'denied',
      refundDestination,
      paymentMethod: booking.paymentMethod || undefined,
      requestedAt: new Date(),
      processedAt: estimate.eligible ? undefined : new Date(),
    });

    // Persist the request first so a failed cancel never leaves a cancelled booking
    // without a CancellationRequest (which would block retries).
    try {
      await request.save();
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          success: false,
          message: 'A cancellation request already exists for this booking',
        });
      }
      throw error;
    }

    try {
      await cancelBookingAndReleaseSeats(booking);
    } catch (error) {
      await CancellationRequest.deleteOne({ _id: request._id }).catch(() => {});
      throw error;
    }

    notifyOrganizerRefundRequest({ booking, trip, request, estimate }).catch((error) => {
      console.error(`[ORGANIZER REFUND EMAIL FAILED] ${error.message}`);
    });

    res.status(201).json({
      success: true,
      message: estimate.eligible
        ? 'Cancellation requested. Refund is pending organizer review.'
        : 'Booking cancelled. No refund applies under this trip\'s policy.',
      data: {
        request: request.toTravelerJSON(),
        booking: booking.toJSON(),
        estimate,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /bookings/me/cancellations
 * List the traveler's cancellation requests.
 */
const listMyCancellations = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = { travelerId: req.user.userId };
    const statusFilter = normalizeStatusFilter(status);
    if (statusFilter) filter.status = statusFilter;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [requests, total] = await Promise.all([
      CancellationRequest.find(filter).sort({ requestedAt: -1 }).skip(skip).limit(limitNum),
      CancellationRequest.countDocuments(filter),
    ]);

    res.json({
      success: true,
      message: 'Cancellation requests retrieved',
      data: {
        requests: requests.map((r) => r.toTravelerJSON()),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum) || 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /organizer/cancellations
 * List cancellation / refund requests for the organizer.
 */
const listOrganizerCancellations = async (req, res, next) => {
  try {
    const { status, tripId, page = 1, limit = 50 } = req.query;
    const filter = { organizerId: req.user.userId };
    const statusFilter = normalizeStatusFilter(status);
    if (statusFilter) filter.status = statusFilter;
    if (tripId) filter.tripId = tripId;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [requests, total] = await Promise.all([
      CancellationRequest.find(filter)
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('travelerId', 'fullName email phone'),
      CancellationRequest.countDocuments(filter),
    ]);

    res.json({
      success: true,
      message: 'Organizer cancellation requests retrieved',
      data: {
        requests: requests.map((r) => r.toOrganizerJSON()),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum) || 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /organizer/trips/:id/cancellations
 */
const listTripCancellations = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({
      _id: req.params.id,
      organizerId: req.user.userId,
    }).select('_id title');

    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found' });
    }

    const requests = await CancellationRequest.find({
      tripId: trip._id,
      organizerId: req.user.userId,
    })
      .sort({ requestedAt: -1 })
      .populate('travelerId', 'fullName email phone');

    res.json({
      success: true,
      message: 'Trip cancellation requests retrieved',
      data: {
        trip: { id: trip._id, title: trip.title },
        requests: requests.map((r) => r.toOrganizerJSON()),
      },
    });
  } catch (error) {
    next(error);
  }
};

const ALLOWED_STATUS_TRANSITIONS = {
  // Client may only approve (`refunded`) or deny. `processing` is set by Paystack flow.
  pending: ['refunded', 'denied'],
  processing: ['refunded', 'denied'],
  denied: [],
  refunded: [],
};

/**
 * PATCH /organizer/cancellations/:id
 * Organizer approves or denies a refund.
 * - denied: no money movement
 * - refunded (eligible): Paystack refunds traveler from platform balance automatically
 * - processing: set by the server/Paystack only — clients must not send this status
 */
const updateOrganizerCancellation = async (req, res, next) => {
  try {
    const request = await CancellationRequest.findOne({
      _id: req.params.id,
      organizerId: req.user.userId,
    }).populate('travelerId', 'fullName email phone');

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Cancellation request not found',
      });
    }

    const nextStatus = String(req.body?.status || '')
      .toLowerCase()
      .trim();

    if (nextStatus === 'processing') {
      return res.status(400).json({
        success: false,
        message:
          'Do not set status to "processing". Send "refunded" to approve (Paystack refund) or "denied" to decline.',
      });
    }

    const allowed = ALLOWED_STATUS_TRANSITIONS[request.status] || [];

    if (!nextStatus || !allowed.includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot move cancellation from "${request.status}" to "${nextStatus || '(empty)'}"`,
      });
    }

    if (typeof req.body?.organizerNote === 'string') {
      request.organizerNote = req.body.organizerNote.trim().slice(0, 2000);
    }

    // Decline — no Paystack refund
    if (nextStatus === 'denied') {
      request.status = 'denied';
      request.processedAt = new Date();
      await request.save();
      return res.json({
        success: true,
        message: 'Cancellation denied',
        data: request.toOrganizerJSON(),
      });
    }

    // Approve refund → automatic Paystack refund to original payment method
    if (nextStatus === 'refunded') {
      if (!request.refundEligible || Number(request.refundAmount) <= 0) {
        // Non-refundable cancel already released seats; just close the request.
        request.status = 'denied';
        request.processedAt = new Date();
        request.organizerNote =
          request.organizerNote || 'No refund due under trip policy';
        await request.save();
        return res.json({
          success: true,
          message: 'No refund due — request closed',
          data: request.toOrganizerJSON(),
        });
      }

      const { initiatePaystackRefundForCancellation } = require('../services/refundService');
      const { request: updated } = await initiatePaystackRefundForCancellation(request, {
        organizerNote: request.organizerNote,
      });

      const fresh = await CancellationRequest.findById(updated._id).populate(
        'travelerId',
        'fullName email phone'
      );

      return res.json({
        success: true,
        message:
          fresh.status === 'refunded'
            ? 'Refund sent to traveler via Paystack'
            : 'Refund submitted to Paystack — traveler will receive it shortly',
        data: fresh.toOrganizerJSON(),
      });
    }

    return res.status(400).json({
      success: false,
      message: 'Unsupported cancellation status update',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCancellationPreview,
  requestCancellation,
  listMyCancellations,
  listOrganizerCancellations,
  listTripCancellations,
  updateOrganizerCancellation,
};
