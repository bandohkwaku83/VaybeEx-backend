const Booking = require('../models/Booking');
const CancellationRequest = require('../models/CancellationRequest');
const { markBookingRefunded } = require('./bookingService');
const { createRefund, fromMinorUnit, toMinorUnit } = require('./paystackService');
const { roundMoney } = require('../utils/payoutHelpers');

/**
 * Split a refund across successful Paystack payment installments (newest first).
 */
const allocateRefundAcrossPayments = (payments, refundAmountGhs) => {
  const amountNeeded = roundMoney(refundAmountGhs);
  if (amountNeeded <= 0) return [];

  const sorted = [...(payments || [])]
    .filter((p) => p && p.reference && (p.status === 'success' || !p.status) && Number(p.amount) > 0)
    .sort((a, b) => new Date(b.paidAt || 0) - new Date(a.paidAt || 0));

  if (!sorted.length) {
    const error = new Error(
      'No successful Paystack payments found on this booking to refund'
    );
    error.statusCode = 400;
    throw error;
  }

  let remaining = amountNeeded;
  const allocations = [];

  for (const payment of sorted) {
    if (remaining <= 0) break;
    const available = roundMoney(payment.amount || 0);
    const take = roundMoney(Math.min(available, remaining));
    if (take <= 0) continue;
    allocations.push({
      transactionReference: payment.reference,
      amountGhs: take,
    });
    remaining = roundMoney(remaining - take);
  }

  if (remaining > 0) {
    const error = new Error(
      `Cannot refund GHS ${amountNeeded.toFixed(2)} — payment history only covers part of this amount`
    );
    error.statusCode = 400;
    throw error;
  }

  return allocations;
};

const mapPaystackRefundStatus = (status) => {
  const raw = String(status || '')
    .toLowerCase()
    .trim();
  if (raw === 'processed' || raw === 'success') return 'processed';
  if (raw === 'failed') return 'failed';
  if (raw === 'pending' || raw === 'processing' || raw === 'needs-attention') return raw;
  return raw || 'pending';
};

/**
 * Organizer approved a refundable cancellation → send money back via Paystack.
 * Sets request to `processing` (or `refunded` if Paystack already processed).
 */
const initiatePaystackRefundForCancellation = async (request, { organizerNote } = {}) => {
  if (!request.refundEligible || roundMoney(request.refundAmount) <= 0) {
    const error = new Error('This cancellation is not eligible for an automatic refund');
    error.statusCode = 400;
    throw error;
  }

  const booking = await Booking.findById(request.bookingId);
  if (!booking) {
    const error = new Error('Booking for this cancellation request was not found');
    error.statusCode = 404;
    throw error;
  }

  if (booking.status === 'refunded' && roundMoney(booking.refundedAmount) > 0) {
    request.status = 'refunded';
    request.processedAt = request.processedAt || new Date();
    await request.save();
    return { request, booking, alreadyRefunded: true };
  }

  const existing = request.paystackRefunds || [];
  if (existing.length) {
    const allProcessed = existing.every(
      (e) => mapPaystackRefundStatus(e.status) === 'processed'
    );
    if (allProcessed) {
      request.status = 'refunded';
      request.processedAt = request.processedAt || new Date();
      await request.save();
      if (booking.status !== 'refunded') {
        await markBookingRefunded(booking, request.refundAmount);
      }
      return { request, booking, alreadyRefunded: true };
    }

    const allFailed = existing.every((e) => mapPaystackRefundStatus(e.status) === 'failed');
    if (!allFailed) {
      // Refund(s) already submitted to Paystack — wait for webhook.
      request.status = 'processing';
      await request.save();
      return { request, booking, alreadyRefunded: false };
    }

    // Previous attempt failed — clear and retry.
    request.paystackRefunds = [];
  }

  const allocations = allocateRefundAcrossPayments(booking.payments, request.refundAmount);
  const currency = booking.pricing?.currency || 'GHS';
  const paystackRefunds = [];

  try {
    for (const allocation of allocations) {
      const refund = await createRefund({
        transaction: allocation.transactionReference,
        amountGhs: allocation.amountGhs,
        currency,
        customerNote: 'Trip cancellation refund',
        merchantNote:
          organizerNote ||
          `Cancellation ${request._id} — booking ${booking._id}`,
      });

      const amountFromPaystack =
        refund.amount != null ? fromMinorUnit(refund.amount) : allocation.amountGhs;

      paystackRefunds.push({
        transactionReference: allocation.transactionReference,
        refundId: refund.id != null ? String(refund.id) : undefined,
        amount: roundMoney(amountFromPaystack),
        status: mapPaystackRefundStatus(refund.status),
        currency: refund.currency || currency,
      });
    }
  } catch (err) {
    request.status = 'pending';
    request.refundFailureReason = err.message || 'Paystack refund failed';
    request.paystackRefunds = paystackRefunds.length ? paystackRefunds : undefined;
    await request.save();

    const error = new Error(
      err.message || 'Unable to send refund via Paystack. Please try again.'
    );
    error.statusCode = err.statusCode || 502;
    throw error;
  }

  request.paystackRefunds = paystackRefunds;
  request.refundFailureReason = undefined;
  request.refundDestination = 'Original payment method (Paystack automatic refund)';

  const allProcessed = paystackRefunds.every((r) => r.status === 'processed');
  if (allProcessed) {
    request.status = 'refunded';
    request.processedAt = new Date();
    if (booking.status !== 'refunded') {
      await markBookingRefunded(booking, request.refundAmount);
    }
  } else {
    request.status = 'processing';
    request.processedAt = undefined;
  }

  await request.save();
  return { request, booking, alreadyRefunded: false };
};

/**
 * Apply Paystack refund.* webhook events.
 */
const applyRefundWebhookEvent = async (eventName, data = {}) => {
  const transactionReference =
    data.transaction_reference ||
    data.transaction?.reference ||
    data.reference ||
    null;
  const refundId = data.id != null ? String(data.id) : null;

  if (!transactionReference && !refundId) {
    return { handled: false, reason: 'missing_reference' };
  }

  const or = [];
  if (transactionReference) {
    or.push({ 'paystackRefunds.transactionReference': transactionReference });
  }
  if (refundId) {
    or.push({ 'paystackRefunds.refundId': refundId });
  }

  const request = await CancellationRequest.findOne({ $or: or });
  if (!request) {
    return { handled: false, reason: 'cancellation_not_found' };
  }

  if (request.status === 'refunded') {
    return { handled: true, reason: 'already_refunded', request };
  }

  const mapped = mapPaystackRefundStatus(
    eventName === 'refund.processed'
      ? 'processed'
      : eventName === 'refund.failed'
        ? 'failed'
        : data.status
  );

  let touched = false;
  request.paystackRefunds = (request.paystackRefunds || []).map((entry) => {
    const plain = typeof entry.toObject === 'function' ? entry.toObject() : { ...entry };
    const matchRef =
      transactionReference && plain.transactionReference === transactionReference;
    const matchId = refundId && plain.refundId === refundId;
    if (!matchRef && !matchId) return plain;
    touched = true;
    return {
      ...plain,
      status: mapped,
      refundId: plain.refundId || refundId || undefined,
    };
  });

  if (!touched && transactionReference) {
    // Refund created outside our allocation list — still record it.
    request.paystackRefunds = [
      ...(request.paystackRefunds || []),
      {
        transactionReference,
        refundId: refundId || undefined,
        amount:
          data.amount != null
            ? fromMinorUnit(data.amount)
            : roundMoney(request.refundAmount),
        status: mapped,
        currency: data.currency || 'GHS',
      },
    ];
  }

  if (mapped === 'failed') {
    request.status = 'pending';
    request.refundFailureReason =
      data.customer_note ||
      data.merchant_note ||
      data.gateway_response ||
      'Paystack refund failed';
    await request.save();
    return { handled: true, request };
  }

  const entries = request.paystackRefunds || [];
  const allProcessed =
    entries.length > 0 && entries.every((e) => mapPaystackRefundStatus(e.status) === 'processed');

  if (allProcessed) {
    request.status = 'refunded';
    request.processedAt = new Date();
    request.refundFailureReason = undefined;
    await request.save();

    const booking = await Booking.findById(request.bookingId);
    if (booking && booking.status !== 'refunded') {
      await markBookingRefunded(booking, request.refundAmount);
    }
    return { handled: true, request };
  }

  request.status = 'processing';
  await request.save();
  return { handled: true, request };
};

module.exports = {
  allocateRefundAcrossPayments,
  initiatePaystackRefundForCancellation,
  applyRefundWebhookEvent,
};
