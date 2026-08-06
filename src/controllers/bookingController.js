const Booking = require('../models/Booking');
const Trip = require('../models/Trip');
const User = require('../models/User');
const {
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
  assertPaymentMatchesBooking,
  getPublicKey,
} = require('../services/paystackService');
const { applyBookingPayment } = require('../services/bookingService');
const { normalizeGhanaPhone } = require('../utils/phone');
const {
  BOOKING_TYPES,
  resolvePartySize,
  inferBookingType,
  normalizeGuestList,
  buildTravelerDefaults,
  normalizeBookingContact,
  validateGuestAges,
  normalizeAddOnSelections,
  calculateBookingPricing,
  resolvePaymentAmount,
  validateTripBookable,
  generatePaystackReference,
} = require('../utils/bookingHelpers');

const resolvePaystackCallbackUrl = (callbackUrl) =>
  callbackUrl ||
  process.env.PAYSTACK_CALLBACK_URL ||
  `${process.env.APP_BASE_URL || 'http://localhost:3000'}/booking/callback`;

const findBookingByPaymentReference = async (reference) =>
  Booking.findOne({
    $or: [{ paystackReference: reference }, { 'payments.reference': reference }],
  });

const startPaystackCheckout = async (booking, traveler, trip, callbackUrl) => {
  const reference = generatePaystackReference(booking._id);
  const paystackData = await initializeTransaction({
    email: traveler.email,
    amountGhs: booking.pricing.amountDueNow,
    reference,
    callbackUrl: resolvePaystackCallbackUrl(callbackUrl),
    metadata: {
      bookingId: String(booking._id),
      tripId: String(trip._id || booking.tripId),
      travelerId: String(traveler._id || booking.travelerId),
      partySize: booking.partySize,
      bookingType: booking.bookingType,
      paymentAmount: booking.pricing.amountDueNow,
      amountPaidSoFar: booking.amountPaid || 0,
    },
  });

  booking.paystackReference = reference;
  booking.paystackAccessCode = paystackData.access_code;
  booking.paystackAuthorizationUrl = paystackData.authorization_url;
  await booking.save();

  return paystackData;
};

const parseGuestsArray = (guests) => {
  if (Array.isArray(guests)) return guests;
  if (typeof guests === 'string') {
    try {
      return JSON.parse(guests);
    } catch {
      return [];
    }
  }
  return [];
};

const loadTravelerBooking = async (req, res) => {
  const booking = await Booking.findOne({
    _id: req.params.id,
    travelerId: req.user.userId,
  }).populate('tripId', 'title destination startDate endDate coverImage slug status');

  if (!booking) {
    res.status(404).json({ success: false, message: 'Booking not found' });
    return null;
  }

  return booking;
};

const getBookingPreview = async (req, res, next) => {
  try {
    const { tripId } = req.params;
    const {
      bookingType,
      partySize,
      guests,
      selectedAddOns,
      location,
      whatsapp,
      paymentAmount,
      amount,
    } = req.body;

    const trip = await Trip.findById(tripId);
    const resolvedPartySize = resolvePartySize(bookingType, partySize, parseGuestsArray(guests));
    validateTripBookable(trip, resolvedPartySize);

    const leadTraveler = req.user
      ? await User.findById(req.user.userId).select('fullName email phone location whatsapp')
      : null;
    const travelerDefaults = buildTravelerDefaults(leadTraveler);

    let normalizedGuests;
    try {
      normalizedGuests = normalizeGuestList(guests, resolvedPartySize, leadTraveler);
      validateGuestAges(trip, normalizedGuests);
    } catch {
      // Soft preview: still return defaults so the form can prepopulate even if guests are incomplete.
      if (leadTraveler && resolvedPartySize >= 1) {
        normalizedGuests = Array.from({ length: resolvedPartySize }, (_, index) => ({
          fullName: index === 0 ? leadTraveler.fullName || `Traveler ${index + 1}` : `Traveler ${index + 1}`,
          email: index === 0 ? leadTraveler.email : undefined,
          phone: index === 0 ? leadTraveler.phone : undefined,
          isLead: index === 0,
        }));
      } else {
        normalizedGuests = Array.from({ length: resolvedPartySize }, (_, index) => ({
          fullName: `Traveler ${index + 1}`,
          isLead: index === 0,
        }));
      }
    }

    const resolvedBookingType = bookingType || inferBookingType(resolvedPartySize);
    const addOns = normalizeAddOnSelections(trip, selectedAddOns, resolvedPartySize);
    const pricing = calculateBookingPricing(trip, {
      partySize: resolvedPartySize,
      selectedAddOns: addOns,
      bookingType: resolvedBookingType,
      paymentAmount: paymentAmount ?? amount,
    });

    // Preview may include draft contact fields; they are not required until create.
    const contactPreview = {
      location: location?.trim() || travelerDefaults?.location || '',
      whatsapp: whatsapp?.trim() || travelerDefaults?.whatsapp || '',
    };

    res.json({
      success: true,
      message: 'Booking preview calculated',
      data: {
        trip: {
          id: trip._id,
          title: trip.title,
          destination: trip.destination,
          startDate: trip.startDate,
          endDate: trip.endDate,
          seatsAvailable: trip.getSeatsAvailable(),
          pricePerPerson: trip.pricePerPerson,
          couplePrice: trip.couplePrice,
          groupPrice: trip.groupPrice,
          groupSize: trip.groupSize,
          depositAmount: trip.depositAmount,
          depositDue: trip.depositDue,
          addOns: trip.addOns,
        },
        /** Use these to prepopulate the booking form from the logged-in traveler profile. */
        travelerDefaults,
        bookingType: resolvedBookingType,
        partySize: resolvedPartySize,
        guests: normalizedGuests,
        location: contactPreview.location,
        whatsapp: contactPreview.whatsapp,
        selectedAddOns: addOns,
        pricing,
        /**
         * Amount input helpers for the checkout UI.
         * Traveler can send `paymentAmount` between minPayment and maxPayment.
         * Default / suggested is the deposit (when set) or the full total.
         */
        paymentInput: {
          field: 'paymentAmount',
          currency: 'GHS',
          min: pricing.minPayment,
          max: pricing.maxPayment,
          suggested: pricing.suggestedPayment,
          depositTotal: pricing.depositTotal,
          totalAmount: pricing.totalAmount,
          note: pricing.paymentNote,
        },
      },
    });
  } catch (error) {
    if (!error.statusCode) error.statusCode = 400;
    next(error);
  }
};

const createBooking = async (req, res, next) => {
  try {
    const {
      tripId,
      bookingType,
      partySize,
      guests,
      selectedAddOns,
      callbackUrl,
      location,
      whatsapp,
      paymentAmount,
      amount,
    } = req.body;

    if (!tripId) {
      return res.status(400).json({ success: false, message: 'Trip ID is required' });
    }

    if (bookingType && !BOOKING_TYPES.includes(bookingType)) {
      return res.status(400).json({
        success: false,
        message: `Booking type must be one of: ${BOOKING_TYPES.join(', ')}`,
      });
    }

    const trip = await Trip.findById(tripId);
    const traveler = await User.findById(req.user.userId);

    if (!traveler || traveler.role !== 'traveler') {
      return res.status(403).json({ success: false, message: 'Traveler account required' });
    }

    const contact = normalizeBookingContact(
      { location, whatsapp },
      { normalizeGhanaPhone }
    );

    const resolvedPartySize = resolvePartySize(
      bookingType,
      partySize,
      parseGuestsArray(guests)
    );
    validateTripBookable(trip, resolvedPartySize);

    const normalizedGuests = normalizeGuestList(guests, resolvedPartySize, traveler);
    validateGuestAges(trip, normalizedGuests);

    const resolvedBookingType = bookingType || inferBookingType(resolvedPartySize);
    const addOnSelections = normalizeAddOnSelections(trip, selectedAddOns, resolvedPartySize);
    const pricing = calculateBookingPricing(trip, {
      partySize: resolvedPartySize,
      selectedAddOns: addOnSelections,
      bookingType: resolvedBookingType,
      paymentAmount: paymentAmount ?? amount,
    });

    if (resolvedBookingType === 'couple' && resolvedPartySize !== 2) {
      return res.status(400).json({
        success: false,
        message: 'Couple bookings must include exactly 2 travelers',
      });
    }

    if (resolvedBookingType === 'solo' && resolvedPartySize !== 1) {
      return res.status(400).json({
        success: false,
        message: 'Solo bookings must include exactly 1 traveler',
      });
    }

    if (!traveler.email) {
      return res.status(400).json({
        success: false,
        message: 'Add an email to your profile before booking — Paystack requires it',
      });
    }

    if (!pricing.amountDueNow || pricing.amountDueNow < 1) {
      return res.status(400).json({
        success: false,
        message: 'Booking amount must be at least GHS 1.00',
      });
    }

    const booking = new Booking({
      tripId: trip._id,
      travelerId: traveler._id,
      bookingType: resolvedBookingType,
      partySize: resolvedPartySize,
      guests: normalizedGuests,
      location: contact.location,
      whatsapp: contact.whatsapp,
      selectedAddOns: addOnSelections,
      pricing,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    await booking.save();

    // Persist contact on the traveler profile so future bookings can prepopulate.
    traveler.location = contact.location;
    if (contact.whatsapp) {
      traveler.whatsapp = contact.whatsapp;
    }
    await traveler.save();

    await Trip.updateOne(
      { _id: trip._id },
      { $inc: { checkoutStartsCount: 1 } }
    );

    try {
      await startPaystackCheckout(booking, traveler, trip, callbackUrl);
    } catch (paystackError) {
      booking.status = 'cancelled';
      booking.paystackAuthorizationUrl = undefined;
      booking.paystackAccessCode = undefined;
      await booking.save();
      throw paystackError;
    }

    res.status(201).json({
      success: true,
      message: 'Booking created. Complete payment on Paystack to confirm.',
      data: {
        ...booking.toJSON(),
        paystackPublicKey: getPublicKey(),
        travelerDefaults: buildTravelerDefaults(traveler),
        trip: {
          id: trip._id,
          title: trip.title,
          destination: trip.destination,
          startDate: trip.startDate,
          endDate: trip.endDate,
          coverImage: trip.coverImage,
        },
      },
    });
  } catch (error) {
    if (!error.statusCode) error.statusCode = 400;
    next(error);
  }
};

/**
 * Start or resume Paystack checkout.
 * - pending_payment: first payment (or retry)
 * - confirmed + deposit_paid: pay another installment toward the balance
 */
const resumeBookingPayment = async (req, res, next) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.id,
      travelerId: req.user.userId,
    });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.paymentStatus === 'fully_paid') {
      return res.json({
        success: true,
        message: 'Booking is already fully paid',
        data: {
          ...booking.toJSON(),
          paystackPublicKey: getPublicKey(),
        },
      });
    }

    const isFirstCheckout = booking.status === 'pending_payment';
    const isBalancePayment =
      booking.status === 'confirmed' && booking.paymentStatus === 'deposit_paid';

    if (!isFirstCheckout && !isBalancePayment) {
      return res.status(400).json({
        success: false,
        message: `Cannot pay for a booking with status "${booking.status}"`,
      });
    }

    if (isFirstCheckout && booking.expiresAt && booking.expiresAt < new Date()) {
      booking.status = 'cancelled';
      await booking.save();
      return res.status(400).json({
        success: false,
        message: 'This booking checkout has expired. Please create a new booking.',
      });
    }

    const traveler = await User.findById(req.user.userId);
    const trip = await Trip.findById(booking.tripId);

    if (isFirstCheckout) {
      validateTripBookable(trip, booking.partySize);
    } else if (!trip || trip.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'This trip is no longer available for payment',
      });
    }

    const requestedAmount = req.body?.paymentAmount ?? req.body?.amount;
    const { amount, bounds } = resolvePaymentAmount(
      {
        totalAmount: booking.pricing.totalAmount,
        depositTotal: booking.pricing.depositTotal || 0,
        amountPaid: booking.amountPaid || 0,
      },
      requestedAmount
    );

    booking.pricing.amountDueNow = amount;
    booking.pricing.balanceDue = bounds.remainingBalance;
    booking.pricing.remainingBalance = bounds.remainingBalance;
    booking.pricing.minPayment = bounds.minPayment;
    booking.pricing.maxPayment = bounds.maxPayment;
    booking.pricing.suggestedPayment = bounds.suggestedPayment;
    booking.pricing.allowsCustomAmount = bounds.allowsCustomAmount;
    booking.pricing.paymentNote =
      (booking.amountPaid || 0) > 0
        ? `Paying GHS ${amount.toFixed(2)} toward remaining balance of GHS ${bounds.remainingBalance.toFixed(2)}.`
        : booking.pricing.depositTotal > 0
          ? `Paying GHS ${amount.toFixed(2)} (minimum deposit GHS ${Number(booking.pricing.depositTotal).toFixed(2)}).`
          : `Paying GHS ${amount.toFixed(2)}.`;

    await startPaystackCheckout(booking, traveler, trip, req.body?.callbackUrl);

    if (isFirstCheckout) {
      booking.expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await booking.save();
    }

    res.json({
      success: true,
      message: isBalancePayment
        ? 'Balance payment session ready. Complete payment on Paystack.'
        : 'Payment session ready. Complete payment on Paystack to confirm.',
      data: {
        ...booking.toJSON(),
        paystackPublicKey: getPublicKey(),
      },
    });
  } catch (error) {
    if (!error.statusCode) error.statusCode = 400;
    next(error);
  }
};

const verifyBookingPayment = async (req, res, next) => {
  try {
    const reference = (req.body?.reference || req.query?.reference || '').trim();
    if (!reference) {
      return res.status(400).json({ success: false, message: 'Payment reference is required' });
    }

    const booking = await findBookingByPaymentReference(reference);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (String(booking.travelerId) !== String(req.user.userId)) {
      return res.status(403).json({ success: false, message: 'You do not own this booking' });
    }

    if (
      Array.isArray(booking.payments) &&
      booking.payments.some((p) => p.reference === reference && p.status === 'success')
    ) {
      return res.json({
        success: true,
        message: 'Payment already recorded',
        data: booking.toJSON(),
      });
    }

    if (booking.status === 'cancelled' || booking.status === 'refunded') {
      return res.status(400).json({
        success: false,
        message: `Cannot verify payment for a ${booking.status} booking`,
      });
    }

    if (booking.paystackReference !== reference) {
      return res.status(400).json({
        success: false,
        message: 'This payment reference does not match the current checkout session',
      });
    }

    const paystackData = await verifyTransaction(reference);
    const { amountPaid, paidAt, channel, paymentMethod } = assertPaymentMatchesBooking(
      paystackData,
      booking,
      { expectedAmountGhs: booking.pricing.amountDueNow }
    );

    const wasPending = booking.status === 'pending_payment';

    await applyBookingPayment(booking, {
      amountPaid,
      paidAt,
      paymentChannel: channel,
      paymentMethod,
      reference,
    });

    res.json({
      success: true,
      message:
        booking.paymentStatus === 'fully_paid'
          ? 'Payment verified. Booking is fully paid.'
          : wasPending
            ? 'Payment verified and booking confirmed'
            : 'Installment payment verified',
      data: booking.toJSON(),
    });
  } catch (error) {
    if (!error.statusCode) error.statusCode = 400;
    next(error);
  }
};

const getPaystackConfig = async (_req, res, next) => {
  try {
    res.json({
      success: true,
      message: 'Paystack config retrieved',
      data: {
        publicKey: getPublicKey(),
        currency: 'GHS',
      },
    });
  } catch (error) {
    next(error);
  }
};

const mapBookingWithTrip = (booking) => ({
  ...booking.toJSON(),
  trip: booking.tripId
    ? {
        id: booking.tripId._id,
        title: booking.tripId.title,
        destination: booking.tripId.destination,
        startDate: booking.tripId.startDate,
        endDate: booking.tripId.endDate,
        coverImage: booking.tripId.coverImage,
        slug: booking.tripId.slug,
        status: booking.tripId.status,
      }
    : undefined,
});

/**
 * Resolve traveler booking list filters.
 * - pending / pending_payment: booking started but payment not completed
 * - cancelled: cancelled bookings
 * - past: confirmed bookings whose trip has ended (or trip marked completed)
 * - upcoming: confirmed bookings whose trip has not ended yet
 * - confirmed | refunded: exact status match
 */
const resolveMyBookingsFilter = async (travelerId, statusQuery) => {
  const filter = { travelerId };
  const raw = String(statusQuery || '')
    .toLowerCase()
    .trim();

  if (!raw || raw === 'all') {
    return { filter, view: 'all' };
  }

  if (raw === 'pending' || raw === 'pending_payment') {
    return { filter: { ...filter, status: 'pending_payment' }, view: 'pending' };
  }

  if (raw === 'cancelled') {
    return { filter: { ...filter, status: 'cancelled' }, view: 'cancelled' };
  }

  if (raw === 'confirmed' || raw === 'refunded') {
    return { filter: { ...filter, status: raw }, view: raw };
  }

  const now = new Date();

  if (raw === 'past') {
    const pastTrips = await Trip.find({
      $or: [{ endDate: { $lt: now } }, { status: 'completed' }],
    }).select('_id');
    return {
      filter: {
        ...filter,
        status: 'confirmed',
        tripId: { $in: pastTrips.map((t) => t._id) },
      },
      view: 'past',
    };
  }

  if (raw === 'upcoming') {
    const upcomingTrips = await Trip.find({
      endDate: { $gte: now },
      status: { $nin: ['completed', 'cancelled'] },
    }).select('_id');
    return {
      filter: {
        ...filter,
        status: 'confirmed',
        tripId: { $in: upcomingTrips.map((t) => t._id) },
      },
      view: 'upcoming',
    };
  }

  return { filter: { ...filter, status: raw }, view: raw };
};

const getMyBookings = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const { filter, view } = await resolveMyBookingsFilter(req.user.userId, status);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('tripId', 'title destination startDate endDate coverImage slug status'),
      Booking.countDocuments(filter),
    ]);

    res.json({
      success: true,
      message: 'Bookings retrieved successfully',
      data: {
        view,
        /**
         * pending = traveler started booking but did not complete Paystack payment
         * (stored as status pending_payment).
         */
        statusNote:
          view === 'pending'
            ? 'Pending means the traveler started a booking but has not completed payment.'
            : undefined,
        bookings: bookings.map(mapBookingWithTrip),
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

const getBookingById = async (req, res, next) => {
  try {
    const booking = await loadTravelerBooking(req, res);
    if (!booking) return;

    res.json({
      success: true,
      message: 'Booking retrieved successfully',
      data: {
        ...booking.toJSON(),
        trip: booking.tripId,
      },
    });
  } catch (error) {
    next(error);
  }
};

const listTripBookings = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({
      _id: req.params.id,
      organizerId: req.user.userId,
    });

    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found' });
    }

    const { status, page = 1, limit = 20 } = req.query;
    const filter = { tripId: trip._id };
    if (status) filter.status = status;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('travelerId', 'fullName email phone location whatsapp'),
      Booking.countDocuments(filter),
    ]);

    res.json({
      success: true,
      message: 'Trip bookings retrieved successfully',
      data: {
        trip: { id: trip._id, title: trip.title },
        bookings: bookings.map((booking) => ({
          ...booking.toJSON(),
          traveler: booking.travelerId
            ? {
                id: booking.travelerId._id,
                fullName: booking.travelerId.fullName,
                email: booking.travelerId.email,
                phone: booking.travelerId.phone,
                location: booking.travelerId.location,
                whatsapp: booking.travelerId.whatsapp,
              }
            : undefined,
        })),
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

const handlePaystackWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.body;

    if (!verifyWebhookSignature(rawBody, signature)) {
      return res.status(401).json({ success: false, message: 'Invalid Paystack signature' });
    }

    const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const event = JSON.parse(payload);

    // Organizer MoMo payouts
    if (
      event.event === 'transfer.success' ||
      event.event === 'transfer.failed' ||
      event.event === 'transfer.reversed'
    ) {
      const { applyTransferWebhookEvent } = require('../services/payoutService');
      const result = await applyTransferWebhookEvent(event.event, event.data || {});
      return res.json({
        success: true,
        message: result.handled ? 'Transfer event applied' : `Transfer event ignored (${result.reason})`,
      });
    }

    // Traveler cancellation refunds
    if (
      event.event === 'refund.processed' ||
      event.event === 'refund.failed' ||
      event.event === 'refund.pending' ||
      event.event === 'refund.processing' ||
      event.event === 'refund.needs-attention'
    ) {
      const { applyRefundWebhookEvent } = require('../services/refundService');
      const result = await applyRefundWebhookEvent(event.event, event.data || {});
      return res.json({
        success: true,
        message: result.handled ? 'Refund event applied' : `Refund event ignored (${result.reason})`,
      });
    }

    if (event.event !== 'charge.success') {
      return res.json({ success: true, message: 'Event ignored' });
    }

    const reference = event.data?.reference;
    if (!reference) {
      return res.status(400).json({ success: false, message: 'Missing payment reference' });
    }

    const booking = await findBookingByPaymentReference(reference);
    if (!booking) {
      // Acknowledge so Paystack does not retry forever for unknown refs.
      return res.json({ success: true, message: 'Booking not found' });
    }

    if (
      Array.isArray(booking.payments) &&
      booking.payments.some((p) => p.reference === reference && p.status === 'success')
    ) {
      return res.json({ success: true, message: 'Payment already recorded' });
    }

    if (booking.status === 'cancelled' || booking.status === 'refunded') {
      return res.json({ success: true, message: 'Booking not awaiting payment' });
    }

    if (booking.paymentStatus === 'fully_paid') {
      return res.json({ success: true, message: 'Booking already fully paid' });
    }

    if (booking.paystackReference !== reference) {
      return res.json({ success: true, message: 'Stale payment reference ignored' });
    }

    // Re-verify with Paystack API so we never trust webhook body alone.
    const paystackData = await verifyTransaction(reference);
    const { amountPaid, paidAt, channel, paymentMethod } = assertPaymentMatchesBooking(
      paystackData,
      booking,
      { expectedAmountGhs: booking.pricing.amountDueNow }
    );

    await applyBookingPayment(booking, {
      amountPaid,
      paidAt,
      paymentChannel: channel,
      paymentMethod,
      reference,
    });

    res.json({ success: true, message: 'Payment applied' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getBookingPreview,
  createBooking,
  resumeBookingPayment,
  verifyBookingPayment,
  getPaystackConfig,
  getMyBookings,
  getBookingById,
  listTripBookings,
  handlePaystackWebhook,
};
