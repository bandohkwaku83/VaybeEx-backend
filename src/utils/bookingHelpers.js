const BOOKING_TYPES = ['solo', 'couple', 'group'];
const BOOKING_STATUSES = ['pending_payment', 'confirmed', 'cancelled', 'refunded'];
const PAYMENT_STATUSES = ['unpaid', 'deposit_paid', 'fully_paid'];

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const parseBoolean = (value) => {
  if (value == null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
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

const resolvePartySize = (bookingType, partySize, guests = []) => {
  if (partySize != null) {
    const size = parseInt(partySize, 10);
    if (!Number.isFinite(size) || size < 1) {
      throw new Error('Party size must be at least 1');
    }
    return size;
  }

  if (guests.length > 0) {
    return guests.length;
  }

  if (bookingType === 'solo') return 1;
  if (bookingType === 'couple') return 2;
  if (bookingType === 'group') {
    throw new Error('Party size is required for group bookings');
  }

  throw new Error('Booking type or party size is required');
};

const inferBookingType = (partySize) => {
  if (partySize === 1) return 'solo';
  if (partySize === 2) return 'couple';
  return 'group';
};

const getEffectivePricePerPerson = (trip) => {
  const now = new Date();
  if (
    trip.earlyBirdPrice != null &&
    trip.earlyBirdDeadline &&
    now <= new Date(trip.earlyBirdDeadline)
  ) {
    return trip.earlyBirdPrice;
  }
  return trip.pricePerPerson ?? 0;
};

/**
 * Resolve trip subtotal using per-person, couple package, or group flat rates.
 * Couple/group package prices apply when the trip offers them and booking type matches.
 */
const calculateTripSubtotal = (trip, { bookingType, partySize }) => {
  const pricePerPerson = getEffectivePricePerPerson(trip);

  if (bookingType === 'couple' && trip.couplePrice != null && trip.couplePrice > 0) {
    return trip.couplePrice;
  }

  if (bookingType === 'group' && trip.groupPrice != null && trip.groupPrice > 0) {
    const covered = trip.groupSize != null && trip.groupSize > 0 ? trip.groupSize : partySize;
    if (partySize <= covered) {
      return trip.groupPrice;
    }
    return trip.groupPrice + pricePerPerson * (partySize - covered);
  }

  return pricePerPerson * partySize;
};

const getBalanceDueDate = (trip) => {
  if (!trip.startDate) return null;

  const dueDaysMap = {
    at_booking: 0,
    '7_days_before': 7,
    '14_days_before': 14,
    '30_days_before': 30,
  };

  const daysBefore = dueDaysMap[trip.depositDue] ?? 7;
  const dueDate = new Date(trip.startDate);
  dueDate.setDate(dueDate.getDate() - daysBefore);
  return dueDate;
};

const normalizeGuestList = (guests, partySize, leadTraveler) => {
  const list = parseJsonArray(guests).map((guest, index) => ({
    fullName: String(guest.fullName || guest.name || '').trim(),
    email: guest.email ? String(guest.email).trim().toLowerCase() : undefined,
    phone: guest.phone ? String(guest.phone).trim() : undefined,
    age: parseNumber(guest.age),
    isLead: index === 0,
  }));

  // Solo with no guests: fill entirely from the logged-in traveler profile.
  if (list.length === 0 && partySize === 1 && leadTraveler) {
    list.push({
      fullName: leadTraveler.fullName || 'Traveler',
      email: leadTraveler.email,
      phone: leadTraveler.phone,
      isLead: true,
    });
  }

  // Prefill missing lead-guest fields from the logged-in traveler (email/phone/name from signup).
  if (list.length > 0 && leadTraveler) {
    const lead = list[0];
    if (!lead.fullName && leadTraveler.fullName) lead.fullName = leadTraveler.fullName;
    if (!lead.email && leadTraveler.email) lead.email = leadTraveler.email;
    if (!lead.phone && leadTraveler.phone) lead.phone = leadTraveler.phone;
  }

  if (list.length !== partySize) {
    throw new Error(`Provide details for all ${partySize} traveler(s)`);
  }

  list.forEach((guest, index) => {
    if (!guest.fullName) {
      throw new Error(`Traveler ${index + 1} name is required`);
    }
  });

  return list;
};

/** Profile fields the frontend should prepopulate on the booking form. */
const buildTravelerDefaults = (traveler) => {
  if (!traveler) return null;
  return {
    fullName: traveler.fullName || '',
    email: traveler.email || '',
    phone: traveler.phone || '',
    location: traveler.location || '',
    whatsapp: traveler.whatsapp || '',
  };
};

/**
 * Resolve booking contact fields.
 * Location is required; WhatsApp is optional (Ghana-normalized when provided).
 */
const normalizeBookingContact = ({ location, whatsapp }, { normalizeGhanaPhone }) => {
  const trimmedLocation = location != null ? String(location).trim() : '';
  if (!trimmedLocation) {
    throw Object.assign(new Error('Location is required'), { statusCode: 400 });
  }

  let normalizedWhatsapp;
  const rawWhatsapp = whatsapp != null ? String(whatsapp).trim() : '';
  if (rawWhatsapp) {
    try {
      normalizedWhatsapp = normalizeGhanaPhone(rawWhatsapp);
    } catch (error) {
      throw Object.assign(new Error(error.message.replace('Phone number', 'WhatsApp number')), {
        statusCode: 400,
      });
    }
  }

  return { location: trimmedLocation, whatsapp: normalizedWhatsapp };
};

const validateGuestAges = (trip, guests) => {
  guests.forEach((guest, index) => {
    if (guest.age == null) return;
    if (trip.minAge != null && guest.age < trip.minAge) {
      throw new Error(`Traveler ${index + 1} does not meet the minimum age of ${trip.minAge}`);
    }
    if (trip.maxAge != null && guest.age > trip.maxAge) {
      throw new Error(`Traveler ${index + 1} exceeds the maximum age of ${trip.maxAge}`);
    }
  });
};

const normalizeAddOnSelections = (trip, rawSelections, partySize) => {
  const tripAddOnMap = new Map(trip.addOns.map((addOn) => [String(addOn._id), addOn]));
  const selections = parseJsonArray(rawSelections);

  if (!selections.length) {
    return [];
  }

  const selected = [];

  selections.forEach((item) => {
    const addOnId = String(item.addOnId || item.id || '').trim();
    if (!addOnId) return;

    const isSelected = item.selected === undefined ? true : parseBoolean(item.selected);
    if (!isSelected) return;

    const tripAddOn = tripAddOnMap.get(addOnId);
    if (!tripAddOn) {
      throw new Error(`Add-on ${addOnId} is not available for this trip`);
    }

    const quantity = Math.max(1, parseNumber(item.quantity) ?? 1);
    const unitPrice = tripAddOn.price;
    const lineTotal = tripAddOn.perPerson
      ? unitPrice * partySize * quantity
      : unitPrice * quantity;

    selected.push({
      addOnId: tripAddOn._id,
      name: tripAddOn.name,
      unitPrice,
      perPerson: tripAddOn.perPerson !== false,
      quantity,
      lineTotal,
    });
  });

  return selected;
};

/**
 * Payment bounds for a booking (or preview).
 * - First payment with a trip deposit: minimum is the deposit (can pay more, up to total)
 * - First payment with no deposit: full amount required
 * - Later installments: GHS 1 up to remaining balance
 */
const getPaymentBounds = ({ totalAmount, depositTotal = 0, amountPaid = 0 } = {}) => {
  const total = roundMoney(totalAmount);
  const paid = roundMoney(amountPaid);
  const remaining = roundMoney(Math.max(0, total - paid));
  const deposit = roundMoney(depositTotal);
  const isFirstPayment = paid <= 0;

  let minPayment = 0;
  let suggestedPayment = 0;

  if (remaining <= 0) {
    minPayment = 0;
    suggestedPayment = 0;
  } else if (isFirstPayment && deposit > 0) {
    minPayment = roundMoney(Math.min(deposit, remaining));
    suggestedPayment = minPayment;
  } else if (isFirstPayment) {
    // No deposit configured — charge the full amount on the first payment
    minPayment = remaining;
    suggestedPayment = remaining;
  } else {
    minPayment = roundMoney(Math.min(1, remaining));
    suggestedPayment = remaining;
  }

  return {
    totalAmount: total,
    amountPaid: paid,
    remainingBalance: remaining,
    depositTotal: deposit,
    hasDeposit: deposit > 0,
    isFirstPayment,
    minPayment,
    maxPayment: remaining,
    suggestedPayment,
    allowsCustomAmount: remaining > 0 && minPayment < remaining,
    currency: 'GHS',
  };
};

/**
 * Validate traveler-entered installment amount.
 * @param {number|string|undefined} requestedAmount - optional; defaults to suggested
 */
const resolvePaymentAmount = (
  { totalAmount, depositTotal = 0, amountPaid = 0 },
  requestedAmount
) => {
  const bounds = getPaymentBounds({ totalAmount, depositTotal, amountPaid });

  if (bounds.remainingBalance <= 0) {
    const error = new Error('This booking is already fully paid');
    error.statusCode = 400;
    throw error;
  }

  const hasRequest = requestedAmount != null && requestedAmount !== '';
  const amount = roundMoney(hasRequest ? Number(requestedAmount) : bounds.suggestedPayment);

  if (!Number.isFinite(amount)) {
    const error = new Error('Payment amount must be a valid number');
    error.statusCode = 400;
    throw error;
  }

  if (amount < bounds.minPayment) {
    const error = new Error(
      bounds.isFirstPayment && bounds.hasDeposit
        ? `Minimum first payment is the deposit of GHS ${bounds.minPayment.toFixed(2)}`
        : `Minimum payment is GHS ${bounds.minPayment.toFixed(2)}`
    );
    error.statusCode = 400;
    throw error;
  }

  if (amount > bounds.maxPayment) {
    const error = new Error(
      `Payment cannot exceed the remaining balance of GHS ${bounds.maxPayment.toFixed(2)}`
    );
    error.statusCode = 400;
    throw error;
  }

  return { amount, bounds };
};

const calculateBookingPricing = (
  trip,
  { partySize, selectedAddOns = [], bookingType, paymentAmount, amountPaid = 0 } = {}
) => {
  const resolvedType = bookingType || inferBookingType(partySize);
  const pricePerPerson = getEffectivePricePerPerson(trip);
  const tripSubtotal = calculateTripSubtotal(trip, {
    bookingType: resolvedType,
    partySize,
  });
  const addOnsTotal = selectedAddOns.reduce((sum, item) => sum + item.lineTotal, 0);
  const totalAmount = roundMoney(tripSubtotal + addOnsTotal);
  const depositPerPerson = trip.depositAmount ?? 0;
  const depositTotal = roundMoney(depositPerPerson * partySize);

  const { amount: amountDueNow, bounds } = resolvePaymentAmount(
    { totalAmount, depositTotal, amountPaid },
    paymentAmount
  );

  const paid = roundMoney(amountPaid);
  const balanceDue = roundMoney(Math.max(0, totalAmount - paid));
  const balanceDueDate = getBalanceDueDate(trip);
  const isEarlyBird =
    trip.earlyBirdPrice != null &&
    trip.earlyBirdDeadline &&
    new Date() <= new Date(trip.earlyBirdDeadline);

  let rateType = 'per_person';
  if (resolvedType === 'couple' && trip.couplePrice != null && trip.couplePrice > 0) {
    rateType = 'couple';
  } else if (resolvedType === 'group' && trip.groupPrice != null && trip.groupPrice > 0) {
    rateType = 'group';
  }

  let paymentNote;
  if (balanceDue <= 0 && paid > 0) {
    paymentNote = 'Fully paid.';
  } else if (depositTotal > 0 && paid <= 0) {
    paymentNote =
      amountDueNow > depositTotal
        ? `Pay at least the deposit of GHS ${depositTotal.toFixed(2)}. You can pay more (up to the full amount) now.`
        : `Pay the deposit of GHS ${depositTotal.toFixed(2)} now to confirm. Pay the balance later.`;
  } else if (paid > 0 && balanceDue > 0) {
    paymentNote = `GHS ${paid.toFixed(2)} paid. Remaining balance: GHS ${balanceDue.toFixed(2)}.`;
  } else {
    paymentNote = 'Full payment collected at booking.';
  }

  return {
    currency: 'GHS',
    pricePerPerson,
    rateType,
    couplePrice: trip.couplePrice,
    groupPrice: trip.groupPrice,
    groupSize: trip.groupSize,
    isEarlyBird,
    partySize,
    tripSubtotal: roundMoney(tripSubtotal),
    addOnsTotal: roundMoney(addOnsTotal),
    totalAmount,
    depositPerPerson: roundMoney(depositPerPerson),
    depositTotal,
    /** Amount that will be charged on the current Paystack checkout */
    amountDueNow,
    /** Remaining after amount already paid (not after the pending charge) */
    balanceDue,
    balanceDueDate,
    depositDuePolicy: trip.depositDue || (depositTotal > 0 ? 'at_booking' : ''),
    paymentNote,
    /** Frontend helpers for the amount input */
    minPayment: bounds.minPayment,
    maxPayment: bounds.maxPayment,
    suggestedPayment: bounds.suggestedPayment,
    remainingBalance: bounds.remainingBalance,
    allowsCustomAmount: bounds.allowsCustomAmount,
  };
};

const syncPricingAfterPayment = (booking) => {
  const totalAmount = roundMoney(booking.pricing?.totalAmount || 0);
  const amountPaid = roundMoney(booking.amountPaid || 0);
  const depositTotal = roundMoney(booking.pricing?.depositTotal || 0);
  const bounds = getPaymentBounds({ totalAmount, depositTotal, amountPaid });

  booking.pricing.balanceDue = bounds.remainingBalance;
  booking.pricing.remainingBalance = bounds.remainingBalance;
  booking.pricing.minPayment = bounds.minPayment;
  booking.pricing.maxPayment = bounds.maxPayment;
  booking.pricing.suggestedPayment = bounds.suggestedPayment;
  booking.pricing.allowsCustomAmount = bounds.allowsCustomAmount;

  if (bounds.remainingBalance <= 0) {
    booking.pricing.amountDueNow = 0;
    booking.pricing.paymentNote = 'Fully paid.';
  } else if (amountPaid > 0) {
    booking.pricing.amountDueNow = bounds.suggestedPayment;
    booking.pricing.paymentNote = `GHS ${amountPaid.toFixed(2)} paid. Remaining balance: GHS ${bounds.remainingBalance.toFixed(2)}.`;
  }

  return booking;
};

const validateTripBookable = (trip, partySize) => {
  if (!trip) {
    throw new Error('Trip not found');
  }

  if (trip.status !== 'live') {
    throw new Error('This trip is not open for booking');
  }

  if (trip.visibility === 'private') {
    throw new Error('This trip is not open for booking');
  }

  const seatsAvailable = trip.getSeatsAvailable();
  if (seatsAvailable != null && partySize > seatsAvailable) {
    throw new Error(
      seatsAvailable === 0
        ? 'This trip is fully booked'
        : `Only ${seatsAvailable} seat(s) remaining`
    );
  }
};

const generatePaystackReference = (bookingId) =>
  `VBE-${String(bookingId)}-${Date.now().toString(36)}`;

module.exports = {
  BOOKING_TYPES,
  BOOKING_STATUSES,
  PAYMENT_STATUSES,
  parseJsonArray,
  parseNumber,
  resolvePartySize,
  inferBookingType,
  normalizeGuestList,
  buildTravelerDefaults,
  normalizeBookingContact,
  validateGuestAges,
  normalizeAddOnSelections,
  calculateBookingPricing,
  getPaymentBounds,
  resolvePaymentAmount,
  syncPricingAfterPayment,
  roundMoney,
  validateTripBookable,
  generatePaystackReference,
  getEffectivePricePerPerson,
  calculateTripSubtotal,
};
