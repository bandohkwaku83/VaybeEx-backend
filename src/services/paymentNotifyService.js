const User = require('../models/User');
const Trip = require('../models/Trip');
const {
  sendPaymentConfirmationEmail,
  sendOrganizerBookingAlertEmail,
  sendOrganizerRefundRequestEmail,
  buildPaymentConfirmationSms,
  resolveDurationDays,
} = require('./emailService');
const { sendPaymentConfirmationSms } = require('./arkeselService');
const { roundMoney } = require('../utils/bookingHelpers');

const resolveAbsoluteMediaUrl = (path) => {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = (process.env.API_PUBLIC_URL || process.env.BACKEND_PUBLIC_URL || '').replace(
    /\/$/,
    ''
  );
  if (!base) return null;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};

const resolveTravelerContact = async (booking) => {
  const lead =
    (booking.guests || []).find((guest) => guest.isLead) || (booking.guests || [])[0] || {};

  let traveler = null;
  if (booking.travelerId) {
    traveler = await User.findById(booking.travelerId).select('fullName email phone');
  }

  return {
    fullName: lead.fullName || traveler?.fullName || 'there',
    email: lead.email || traveler?.email,
    phone: lead.phone || traveler?.phone,
  };
};

const loadTripForNotify = async (booking) => {
  const tripId = booking.tripId?._id || booking.tripId;
  if (booking.tripId?.title != null && booking.tripId?.organizerId != null) {
    return booking.tripId;
  }

  return Trip.findById(tripId).select(
    'title destination startDate endDate coverImage organizerId departurePoint meetingPointDetails'
  );
};

const resolveOrganizer = async (trip) => {
  const organizerId = trip?.organizerId?._id || trip?.organizerId;
  if (!organizerId) return null;
  return User.findById(organizerId).select('businessName fullName email');
};

const buildPaymentPayload = async (booking, chargeAmount, reference) => {
  const trip = await loadTripForNotify(booking);
  const organizer = await resolveOrganizer(trip);
  const contact = await resolveTravelerContact(booking);
  const currency = booking.pricing?.currency || 'GHS';
  const totalAmount = roundMoney(booking.pricing?.totalAmount || 0);
  const amountPaidTotal = roundMoney(booking.amountPaid || 0);
  const balanceDue = roundMoney(
    booking.pricing?.balanceDue != null
      ? booking.pricing.balanceDue
      : Math.max(0, totalAmount - amountPaidTotal)
  );

  return {
    ...contact,
    tripTitle: trip?.title,
    destination: trip?.destination,
    coverImageUrl: resolveAbsoluteMediaUrl(trip?.coverImage),
    organizerName: organizer?.businessName || organizer?.fullName || null,
    organizerEmail: organizer?.email || null,
    startDate: trip?.startDate,
    endDate: trip?.endDate,
    durationDays: resolveDurationDays(trip?.startDate, trip?.endDate),
    meetingPoint: trip?.meetingPointDetails || trip?.departurePoint || null,
    bookingType: booking.bookingType,
    partySize: booking.partySize,
    guests: booking.guests || [],
    addOns: (booking.selectedAddOns || []).map((a) => ({
      name: a.name,
      perPerson: a.perPerson,
      quantity: a.quantity,
      lineTotal: a.lineTotal,
    })),
    location: booking.location,
    whatsapp: booking.whatsapp,
    amountPaid: roundMoney(chargeAmount),
    amountPaidTotal,
    tripSubtotal: roundMoney(booking.pricing?.tripSubtotal || 0),
    addOnsTotal: roundMoney(booking.pricing?.addOnsTotal || 0),
    totalAmount,
    balanceDue,
    balanceDueDate: booking.pricing?.balanceDueDate || null,
    paymentNote: booking.pricing?.paymentNote || null,
    paymentStatus: booking.paymentStatus,
    paymentMethod: booking.paymentMethod || booking.paymentChannel || null,
    paidAt: booking.paidAt || new Date(),
    reference: reference || booking.paystackReference,
    currency,
  };
};

/**
 * Send payment confirmation to traveler (email + SMS) and alert the organizer.
 * Never throws — payment must not fail because notification delivery failed.
 */
const notifyPaymentConfirmation = async (booking, chargeAmount, reference, options = {}) => {
  try {
    const kind = options.kind === 'installment' ? 'installment' : 'booking';
    const payload = await buildPaymentPayload(booking, chargeAmount, reference);

    const tasks = [];

    if (payload.email) {
      tasks.push(
        sendPaymentConfirmationEmail(payload).catch((error) => {
          console.error(`[PAYMENT EMAIL FAILED] ${error.message}`);
          return { failed: true, channel: 'email', error: error.message };
        })
      );
    } else {
      console.warn('[PAYMENT EMAIL SKIPPED] No traveler email on booking');
    }

    if (payload.phone) {
      const smsMessage = buildPaymentConfirmationSms(payload);
      tasks.push(
        sendPaymentConfirmationSms(payload.phone, smsMessage).catch((error) => {
          console.error(`[PAYMENT SMS FAILED] ${error.message}`);
          return { failed: true, channel: 'sms', error: error.message };
        })
      );
    } else {
      console.warn('[PAYMENT SMS SKIPPED] No traveler phone on booking');
    }

    if (payload.organizerEmail) {
      tasks.push(
        sendOrganizerBookingAlertEmail({
          organizerEmail: payload.organizerEmail,
          organizerName: payload.organizerName,
          travelerName: payload.fullName,
          tripTitle: payload.tripTitle,
          destination: payload.destination,
          partySize: payload.partySize,
          amountPaid: payload.amountPaid,
          amountPaidTotal: payload.amountPaidTotal,
          balanceDue: payload.balanceDue,
          paymentStatus: payload.paymentStatus,
          paymentMethod: payload.paymentMethod,
          reference: payload.reference,
          currency: payload.currency,
          kind,
        }).catch((error) => {
          console.error(`[ORGANIZER BOOKING EMAIL FAILED] ${error.message}`);
          return { failed: true, channel: 'organizer_email', error: error.message };
        })
      );
    } else {
      console.warn('[ORGANIZER BOOKING EMAIL SKIPPED] No organizer email on trip');
    }

    if (tasks.length) {
      await Promise.allSettled(tasks);
    }
  } catch (error) {
    console.error(`[PAYMENT NOTIFY FAILED] ${error.message}`);
  }
};

/**
 * Alert the trip organizer when a traveler requests cancellation / refund.
 */
const notifyOrganizerRefundRequest = async ({ booking, trip, request, estimate }) => {
  try {
    const organizer = await resolveOrganizer(trip);
    if (!organizer?.email) {
      console.warn('[ORGANIZER REFUND EMAIL SKIPPED] No organizer email on trip');
      return;
    }

    const contact = await resolveTravelerContact(booking);

    await sendOrganizerRefundRequestEmail({
      organizerEmail: organizer.email,
      organizerName: organizer.businessName || organizer.fullName,
      travelerName: contact.fullName,
      tripTitle: trip?.title || request?.tripTitle,
      destination: trip?.destination || request?.destination,
      amountPaid: request?.amountPaid ?? estimate?.amountPaid ?? booking.amountPaid,
      refundAmount: request?.refundAmount ?? estimate?.refundAmount ?? 0,
      refundEligible: request?.refundEligible ?? estimate?.eligible ?? false,
      reason: request?.reason,
      paymentMethod: booking.paymentMethod || request?.paymentMethod,
      currency: booking.pricing?.currency || 'GHS',
    });
  } catch (error) {
    console.error(`[ORGANIZER REFUND EMAIL FAILED] ${error.message}`);
  }
};

module.exports = {
  notifyPaymentConfirmation,
  notifyOrganizerRefundRequest,
  buildPaymentPayload,
};
