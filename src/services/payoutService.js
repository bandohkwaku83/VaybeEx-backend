const mongoose = require('mongoose');
const Trip = require('../models/Trip');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const CancellationRequest = require('../models/CancellationRequest');
const {
  ACTIVE_BOOKING_STATUSES,
  PAYOUT_BOOKING_STATUSES,
  PENDING_REFUND_STATUSES,
  toMemberPaymentRow,
  buildPayoutSummary,
  filterMemberRows,
  sortMemberRows,
  memberRowsToCsv,
  roundMoney,
} = require('../utils/payoutHelpers');
const { parseMomoDestination, FUNDS_LOCKED_STATUSES } = require('../utils/momo');
const {
  createTransferRecipient,
  initiateTransfer,
  fetchTransfer,
} = require('./paystackService');

const STATUS_LABELS = {
  pending: 'Pending',
  processing: 'Processing',
  success: 'Success',
  failed: 'Failed',
};

const loadOrganizerTripById = async (tripId, organizerId) => {
  const trip = await Trip.findOne({ _id: tripId, organizerId });
  if (!trip) {
    const error = new Error('Trip not found');
    error.statusCode = 404;
    throw error;
  }
  return trip;
};

const toTripSelectorItem = (trip) => ({
  id: trip._id,
  title: trip.title,
  destination: trip.destination,
  startDate: trip.startDate,
  endDate: trip.endDate,
  pricePerPerson: trip.pricePerPerson,
  price: trip.pricePerPerson,
  booked: trip.bookingsCount ?? 0,
  capacity: trip.maxCapacity ?? null,
  status: trip.status,
  currency: 'GHS',
});

const toWithdrawalJson = (withdrawal) => {
  const json = typeof withdrawal.toJSON === 'function' ? withdrawal.toJSON() : { ...withdrawal };
  return {
    ...json,
    label: STATUS_LABELS[json.status] || json.status,
  };
};

/**
 * Trips the organizer can pick on the Payouts page.
 */
const listPayoutTrips = async (organizerId, { page = 1, limit = 50, status } = {}) => {
  const filter = {
    organizerId,
    status: { $nin: ['draft'] },
  };
  if (status) filter.status = status;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const [trips, total] = await Promise.all([
    Trip.find(filter).sort({ startDate: -1, updatedAt: -1 }).skip(skip).limit(limitNum),
    Trip.countDocuments(filter),
  ]);

  return {
    trips: trips.map(toTripSelectorItem),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  };
};

/** Active attendees only (member payments table / outstanding). */
const loadActiveBookings = async (tripId) =>
  Booking.find({
    tripId,
    status: { $in: ACTIVE_BOOKING_STATUSES },
  }).populate('travelerId', 'fullName email phone location whatsapp');

/** All bookings that affect payout collected (includes cancelled + refunded retainers). */
const loadPayoutBookings = async (tripId) =>
  Booking.find({
    tripId,
    status: { $in: PAYOUT_BOOKING_STATUSES },
  }).populate('travelerId', 'fullName email phone location whatsapp');

const sumReservedRefunds = async (tripId) => {
  const pending = await CancellationRequest.find({
    tripId,
    status: { $in: PENDING_REFUND_STATUSES },
    refundEligible: true,
  }).select('refundAmount');

  return roundMoney(pending.reduce((sum, r) => sum + (r.refundAmount || 0), 0));
};

/**
 * Funds locked by withdrawals (pending + processing + success).
 * Failed withdrawals do not lock funds.
 */
const sumLockedWithdrawals = async (tripId, organizerId) => {
  const [result] = await Withdrawal.aggregate([
    {
      $match: {
        tripId: new mongoose.Types.ObjectId(String(tripId)),
        organizerId: new mongoose.Types.ObjectId(String(organizerId)),
        status: { $in: FUNDS_LOCKED_STATUSES },
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return roundMoney(result?.total || 0);
};

const sumSuccessfulWithdrawals = async (tripId, organizerId) => {
  const [result] = await Withdrawal.aggregate([
    {
      $match: {
        tripId: new mongoose.Types.ObjectId(String(tripId)),
        organizerId: new mongoose.Types.ObjectId(String(organizerId)),
        status: 'success',
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return roundMoney(result?.total || 0);
};

const computeTripBalance = async (trip, organizerId) => {
  const [bookings, lockedWithdrawals, successfulWithdrawals, reservedForRefunds] =
    await Promise.all([
      loadPayoutBookings(trip._id),
      sumLockedWithdrawals(trip._id, organizerId),
      sumSuccessfulWithdrawals(trip._id, organizerId),
      sumReservedRefunds(trip._id),
    ]);

  const summary = buildPayoutSummary(trip, bookings);
  const rawAvailable = roundMoney(summary.collected - lockedWithdrawals - reservedForRefunds);
  const availableToWithdraw = roundMoney(Math.max(0, rawAvailable));

  return {
    bookings,
    summary,
    lockedWithdrawals,
    withdrawnTotal: successfulWithdrawals,
    reservedForRefunds,
    availableToWithdraw,
    rawAvailable,
  };
};

const mapPaystackTransferToStatus = (paystackStatus) => {
  const raw = String(paystackStatus || '')
    .toLowerCase()
    .trim();
  if (raw === 'success' || raw === 'successful' || raw === 'received') return 'success';
  if (raw === 'failed' || raw === 'reversed' || raw === 'abandoned') return 'failed';
  if (raw === 'otp' || raw === 'pending' || raw === 'processing' || raw === 'queued') {
    return 'processing';
  }
  return 'processing';
};

/**
 * Create Paystack MoMo recipient + initiate transfer for an existing pending withdrawal.
 */
const dispatchPaystackTransfer = async (withdrawal, { accountNameFallback } = {}) => {
  const momo = parseMomoDestination({
    momoProvider: withdrawal.momoProvider,
    momoNumber: withdrawal.momoNumber,
    accountName: withdrawal.accountName || accountNameFallback,
  });

  const recipientName =
    momo.accountName || accountNameFallback || withdrawal.destinationLabel || 'Organizer';

  const recipient = await createTransferRecipient({
    name: recipientName,
    accountNumber: momo.paystackAccountNumber,
    bankCode: momo.paystackBankCode,
    currency: withdrawal.currency || 'GHS',
    metadata: {
      withdrawalId: String(withdrawal._id),
      tripId: String(withdrawal.tripId),
      organizerId: String(withdrawal.organizerId),
    },
  });

  const reference = `wdr_${withdrawal._id}_${Date.now()}`;
  const transfer = await initiateTransfer({
    amountGhs: withdrawal.amount,
    recipientCode: recipient.recipient_code,
    reference,
    reason: withdrawal.note || `Trip withdrawal ${withdrawal.tripId}`,
    currency: withdrawal.currency || 'GHS',
  });

  const mappedStatus = mapPaystackTransferToStatus(transfer.status);
  withdrawal.paystackRecipientCode = recipient.recipient_code;
  withdrawal.paystackTransferCode = transfer.transfer_code || undefined;
  withdrawal.paystackReference = reference;
  withdrawal.paystackTransferStatus = transfer.status || undefined;
  withdrawal.status = mappedStatus === 'success' ? 'success' : 'processing';
  withdrawal.failureReason = undefined;
  if (withdrawal.status === 'success') {
    withdrawal.processedAt = new Date();
  }
  await withdrawal.save();

  return withdrawal;
};

/**
 * Full payouts dashboard payload for one trip.
 */
const getTripPayouts = async (tripId, organizerId) => {
  const trip = await loadOrganizerTripById(tripId, organizerId);
  const [balance, withdrawals] = await Promise.all([
    computeTripBalance(trip, organizerId),
    Withdrawal.find({ tripId: trip._id, organizerId }).sort({ createdAt: -1 }).limit(20),
  ]);

  const { summary, reservedForRefunds, withdrawnTotal, availableToWithdraw, bookings } = balance;
  const activeBookings = bookings.filter((b) => ACTIVE_BOOKING_STATUSES.includes(b.status));
  const memberPayments = activeBookings.map(toMemberPaymentRow);
  const latestWithdrawal = withdrawals[0] || null;

  return {
    trip: toTripSelectorItem(trip),
    summary: {
      collected: summary.collected,
      outstanding: summary.outstanding,
      potential: summary.potential,
      collectionPercent: summary.collectionPercent,
      paidMembers: summary.paidMembers,
      partialMembers: summary.partialMembers,
      pendingMembers: summary.pendingMembers,
      totalMembers: summary.totalMembers,
      awaitingPayment: summary.awaitingPayment,
      currency: summary.currency,
      reservedForRefunds,
      collectionProgress: {
        collected: summary.collected,
        potential: summary.potential,
        percent: summary.collectionPercent,
      },
    },
    paymentMethods: {
      methodsUsed: summary.methodsUsed,
      avgPerPaidMember: summary.avgPerPaidMember,
      methods: summary.methods,
    },
    withdrawal: latestWithdrawal ? toWithdrawalJson(latestWithdrawal) : null,
    withdrawals: withdrawals.map(toWithdrawalJson),
    withdrawnTotal,
    reservedForRefunds,
    availableToWithdraw,
    memberPayments: {
      statusCounts: summary.statusCounts,
      items: sortMemberRows(memberPayments, 'paidOn', 'desc').slice(0, 20),
    },
  };
};

/**
 * Filtered / sorted / paginated member payments for a trip.
 */
const listMemberPayments = async (tripId, organizerId, query = {}) => {
  const trip = await loadOrganizerTripById(tripId, organizerId);
  const bookings = await loadActiveBookings(trip._id);
  let rows = bookings.map(toMemberPaymentRow);

  rows = filterMemberRows(rows, {
    paymentStatus: query.paymentStatus || query.status,
    q: query.q || query.search,
    period: query.period,
    from: query.from,
    to: query.to,
  });

  rows = sortMemberRows(rows, query.sortBy || 'paidOn', query.sortOrder || 'desc');

  const pageNum = Math.max(1, parseInt(query.page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;
  const total = rows.length;
  const pageRows = rows.slice(skip, skip + limitNum);

  const allRows = bookings.map(toMemberPaymentRow);
  const statusCounts = {
    all: allRows.length,
    paid: allRows.filter((r) => r.status === 'paid').length,
    partial: allRows.filter((r) => r.status === 'partial').length,
    pending: allRows.filter((r) => r.status === 'pending').length,
  };

  return {
    trip: { id: trip._id, title: trip.title },
    statusCounts,
    members: pageRows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  };
};

const exportMemberPaymentsCsv = async (tripId, organizerId, query = {}) => {
  const result = await listMemberPayments(tripId, organizerId, {
    ...query,
    page: 1,
    limit: 10000,
  });
  const csv = memberRowsToCsv(result.members);
  const filename = `member-payments-${tripId}-${Date.now()}.csv`;
  return { csv, filename, trip: result.trip };
};

/**
 * Request a Mobile Money withdrawal — creates ledger row then initiates Paystack transfer.
 * Omit `amount` to withdraw the full available balance.
 */
const requestWithdrawal = async (
  tripId,
  organizerId,
  { amount, note, momoProvider, momoNumber, accountName } = {}
) => {
  const trip = await loadOrganizerTripById(tripId, organizerId);
  const momo = parseMomoDestination({ momoProvider, momoNumber, accountName });
  const organizer = await User.findById(organizerId).select('fullName businessName email');

  const balance = await computeTripBalance(trip, organizerId);
  const { availableToWithdraw: available, summary, reservedForRefunds } = balance;

  const requestedAmount =
    amount == null || amount === '' ? available : roundMoney(Number(amount));

  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    const error = new Error('Withdrawal amount must be greater than 0');
    error.statusCode = 400;
    throw error;
  }

  if (requestedAmount > available) {
    const error = new Error(
      `Insufficient balance. Available to withdraw: GHS ${available.toFixed(2)}` +
        (reservedForRefunds > 0
          ? ` (GHS ${reservedForRefunds.toFixed(2)} reserved for pending refunds)`
          : '')
    );
    error.statusCode = 400;
    throw error;
  }

  let withdrawal = await Withdrawal.create({
    tripId: trip._id,
    organizerId,
    amount: requestedAmount,
    currency: 'GHS',
    status: 'pending',
    note: note || undefined,
    payoutMethod: 'mobile_money',
    momoProvider: momo.provider,
    momoNumber: momo.number,
    accountName: momo.accountName,
    destinationLabel: momo.destinationLabel,
  });

  // Guard against concurrent overdraw after insert.
  const after = await computeTripBalance(trip, organizerId);
  if (after.rawAvailable < 0) {
    withdrawal.status = 'failed';
    withdrawal.failureReason = 'Insufficient balance due to a concurrent withdrawal';
    withdrawal.processedAt = new Date();
    await withdrawal.save();
    const error = new Error('Insufficient balance. Please try again.');
    error.statusCode = 400;
    throw error;
  }

  try {
    withdrawal = await dispatchPaystackTransfer(withdrawal, {
      accountNameFallback:
        organizer?.fullName || organizer?.businessName || organizer?.email || 'Organizer',
    });
  } catch (err) {
    withdrawal.status = 'failed';
    withdrawal.failureReason = err.message || 'Paystack transfer failed';
    withdrawal.processedAt = new Date();
    await withdrawal.save();

    const error = new Error(
      err.message || 'Unable to send mobile money payout. Please try again or contact support.'
    );
    error.statusCode = err.statusCode || 502;
    throw error;
  }

  const finalBalance = await computeTripBalance(trip, organizerId);

  return {
    withdrawal: toWithdrawalJson(withdrawal),
    availableToWithdraw: finalBalance.availableToWithdraw,
    collected: summary.collected,
    reservedForRefunds,
  };
};

/**
 * Apply Paystack transfer webhook (success / failed / reversed).
 */
const applyTransferWebhookEvent = async (eventName, data = {}) => {
  const reference = data.reference;
  if (!reference) return { handled: false, reason: 'missing_reference' };

  const withdrawal = await Withdrawal.findOne({ paystackReference: reference });
  if (!withdrawal) return { handled: false, reason: 'withdrawal_not_found' };

  if (withdrawal.status === 'success' || withdrawal.status === 'failed') {
    return { handled: true, reason: 'already_final', withdrawal: toWithdrawalJson(withdrawal) };
  }

  const mapped = mapPaystackTransferToStatus(
    eventName === 'transfer.success'
      ? 'success'
      : eventName === 'transfer.failed' || eventName === 'transfer.reversed'
        ? 'failed'
        : data.status
  );

  withdrawal.paystackTransferStatus = data.status || eventName;
  if (data.transfer_code) withdrawal.paystackTransferCode = data.transfer_code;

  if (mapped === 'success') {
    withdrawal.status = 'success';
    withdrawal.failureReason = undefined;
    withdrawal.processedAt = new Date();
  } else if (mapped === 'failed') {
    withdrawal.status = 'failed';
    withdrawal.failureReason =
      data.gateway_response || data.reason || data.message || 'Transfer failed';
    withdrawal.processedAt = new Date();
  } else {
    withdrawal.status = 'processing';
  }

  await withdrawal.save();
  return { handled: true, withdrawal: toWithdrawalJson(withdrawal) };
};

/**
 * Sync a withdrawal from Paystack (admin / retry helper).
 */
const syncWithdrawalFromPaystack = async (withdrawalId) => {
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (!withdrawal) {
    const error = new Error('Withdrawal not found');
    error.statusCode = 404;
    throw error;
  }

  const key = withdrawal.paystackReference || withdrawal.paystackTransferCode;
  if (!key) {
    const error = new Error('Withdrawal has no Paystack transfer reference to sync');
    error.statusCode = 400;
    throw error;
  }

  const transfer = await fetchTransfer(key);
  withdrawal.paystackTransferStatus = transfer.status;
  if (transfer.transfer_code) withdrawal.paystackTransferCode = transfer.transfer_code;

  const mapped = mapPaystackTransferToStatus(transfer.status);
  if (mapped === 'success') {
    withdrawal.status = 'success';
    withdrawal.failureReason = undefined;
    withdrawal.processedAt = new Date();
  } else if (mapped === 'failed') {
    withdrawal.status = 'failed';
    withdrawal.failureReason =
      transfer.gateway_response || transfer.reason || 'Transfer failed';
    withdrawal.processedAt = new Date();
  } else {
    withdrawal.status = 'processing';
  }

  await withdrawal.save();
  return toWithdrawalJson(withdrawal);
};

/**
 * Retry a failed withdrawal via a new Paystack transfer.
 */
const retryWithdrawal = async (withdrawalId) => {
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (!withdrawal) {
    const error = new Error('Withdrawal not found');
    error.statusCode = 404;
    throw error;
  }

  if (withdrawal.status !== 'failed') {
    const error = new Error('Only failed withdrawals can be retried');
    error.statusCode = 400;
    throw error;
  }

  const trip = await Trip.findById(withdrawal.tripId);
  if (!trip) {
    const error = new Error('Trip not found for this withdrawal');
    error.statusCode = 404;
    throw error;
  }

  // Temporarily release this failed amount, then re-lock as pending for retry.
  const balance = await computeTripBalance(trip, withdrawal.organizerId);
  if (withdrawal.amount > balance.availableToWithdraw) {
    const error = new Error(
      `Insufficient balance to retry. Available: GHS ${balance.availableToWithdraw.toFixed(2)}`
    );
    error.statusCode = 400;
    throw error;
  }

  const organizer = await User.findById(withdrawal.organizerId).select(
    'fullName businessName email'
  );

  withdrawal.status = 'pending';
  withdrawal.failureReason = undefined;
  withdrawal.processedAt = undefined;
  withdrawal.paystackReference = undefined;
  withdrawal.paystackTransferCode = undefined;
  withdrawal.paystackTransferStatus = undefined;
  await withdrawal.save();

  try {
    const updated = await dispatchPaystackTransfer(withdrawal, {
      accountNameFallback:
        organizer?.fullName || organizer?.businessName || organizer?.email || 'Organizer',
    });
    return toWithdrawalJson(updated);
  } catch (err) {
    withdrawal.status = 'failed';
    withdrawal.failureReason = err.message || 'Paystack transfer failed';
    withdrawal.processedAt = new Date();
    await withdrawal.save();
    const error = new Error(err.message || 'Retry failed');
    error.statusCode = err.statusCode || 502;
    throw error;
  }
};

const toAdminWithdrawalRow = (withdrawal) => {
  const json = toWithdrawalJson(withdrawal);
  const trip =
    withdrawal.tripId && typeof withdrawal.tripId === 'object' ? withdrawal.tripId : null;
  const organizer =
    withdrawal.organizerId && typeof withdrawal.organizerId === 'object'
      ? withdrawal.organizerId
      : null;

  return {
    ...json,
    trip: trip
      ? {
          id: trip._id,
          title: trip.title,
          destination: trip.destination,
          status: trip.status,
        }
      : { id: withdrawal.tripId },
    organizer: organizer
      ? {
          id: organizer._id,
          fullName: organizer.fullName,
          email: organizer.email,
          businessName: organizer.businessName,
          phone: organizer.phone,
        }
      : { id: withdrawal.organizerId },
  };
};

/**
 * Admin: list withdrawals across all organizers.
 */
const listAdminWithdrawals = async (query = {}) => {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.tripId) filter.tripId = query.tripId;
  if (query.organizerId) filter.organizerId = query.organizerId;
  if (query.momoProvider) filter.momoProvider = query.momoProvider;

  const pageNum = Math.max(1, parseInt(query.page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [items, total, statusAgg] = await Promise.all([
    Withdrawal.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('tripId', 'title destination status')
      .populate('organizerId', 'fullName email businessName phone'),
    Withdrawal.countDocuments(filter),
    Withdrawal.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
  ]);

  const statusCounts = { pending: 0, processing: 0, success: 0, failed: 0 };
  const statusAmounts = { pending: 0, processing: 0, success: 0, failed: 0 };
  statusAgg.forEach((row) => {
    if (row._id in statusCounts) {
      statusCounts[row._id] = row.count;
      statusAmounts[row._id] = roundMoney(row.amount || 0);
    }
  });

  return {
    statusCounts,
    statusAmounts,
    withdrawals: items.map(toAdminWithdrawalRow),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  };
};

const getAdminWithdrawalById = async (withdrawalId) => {
  const withdrawal = await Withdrawal.findById(withdrawalId)
    .populate('tripId', 'title destination status startDate endDate organizerId')
    .populate('organizerId', 'fullName email businessName phone');

  if (!withdrawal) {
    const error = new Error('Withdrawal not found');
    error.statusCode = 404;
    throw error;
  }

  return toAdminWithdrawalRow(withdrawal);
};

module.exports = {
  listPayoutTrips,
  getTripPayouts,
  listMemberPayments,
  exportMemberPaymentsCsv,
  requestWithdrawal,
  loadOrganizerTripById,
  applyTransferWebhookEvent,
  syncWithdrawalFromPaystack,
  retryWithdrawal,
  listAdminWithdrawals,
  getAdminWithdrawalById,
};
