const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Trip = require('../models/Trip');
const { syncPricingAfterPayment, roundMoney } = require('../utils/bookingHelpers');
const { notifyPaymentConfirmation } = require('./paymentNotifyService');

const isTransactionsUnsupportedError = (error) =>
  error?.code === 20 ||
  error?.codeName === 'IllegalOperation' ||
  /replica set member or mongos/i.test(error?.message || '');

const resolvePaymentStatus = (amountPaid, totalAmount) => {
  const paid = roundMoney(amountPaid);
  const total = roundMoney(totalAmount);
  if (paid <= 0) return 'unpaid';
  if (paid >= total) return 'fully_paid';
  return 'deposit_paid';
};

const appendPaymentRecord = (booking, payment) => {
  if (!Array.isArray(booking.payments)) booking.payments = [];
  const already = booking.payments.some((p) => p.reference === payment.reference);
  if (!already) {
    booking.payments.push(payment);
  }
};

/**
 * Apply a successful Paystack charge to a booking.
 * - First payment on pending_payment: confirm booking + reserve seats
 * - Later installments on confirmed/deposit_paid: add to amountPaid only
 */
const applyBookingPayment = async (
  booking,
  {
    amountPaid,
    paidAt = new Date(),
    paymentChannel = null,
    paymentMethod = null,
    reference = null,
  }
) => {
  const chargeAmount = roundMoney(amountPaid);
  const paymentRef = reference || booking.paystackReference;

  // Idempotent: same reference already recorded
  if (
    paymentRef &&
    Array.isArray(booking.payments) &&
    booking.payments.some((p) => p.reference === paymentRef && p.status === 'success')
  ) {
    return booking;
  }

  if (booking.status === 'confirmed') {
    return applyInstallmentPayment(booking, {
      chargeAmount,
      paidAt,
      paymentChannel,
      paymentMethod,
      paymentRef,
    });
  }

  if (booking.status !== 'pending_payment') {
    const error = new Error(`Cannot apply payment to a ${booking.status} booking`);
    error.statusCode = 400;
    throw error;
  }

  return confirmFirstPayment(booking, {
    chargeAmount,
    paidAt,
    paymentChannel,
    paymentMethod,
    paymentRef,
  });
};

const confirmFirstPayment = async (
  booking,
  { chargeAmount, paidAt, paymentChannel, paymentMethod, paymentRef }
) => {
  const applyConfirm = async (session = null) => {
    const updateOptions = session ? { new: true, session } : { new: true };

    const updatedTrip = await Trip.findOneAndUpdate(
      {
        _id: booking.tripId,
        status: 'live',
        $expr: {
          $or: [
            { $eq: [{ $ifNull: ['$maxCapacity', null] }, null] },
            {
              $lte: [{ $add: ['$bookingsCount', booking.partySize] }, '$maxCapacity'],
            },
          ],
        },
      },
      {
        $inc: {
          bookingsCount: booking.partySize,
          confirmedBookingsCount: 1,
          revenue: chargeAmount,
        },
      },
      updateOptions
    );

    if (!updatedTrip) {
      const error = new Error('Not enough seats available to confirm this booking');
      error.statusCode = 409;
      throw error;
    }

    booking.status = 'confirmed';
    booking.amountPaid = chargeAmount;
    booking.paidAt = paidAt;
    booking.paymentStatus = resolvePaymentStatus(
      booking.amountPaid,
      booking.pricing.totalAmount
    );
    if (paymentChannel) booking.paymentChannel = paymentChannel;
    if (paymentMethod) booking.paymentMethod = paymentMethod;
    appendPaymentRecord(booking, {
      reference: paymentRef,
      amount: chargeAmount,
      paidAt,
      channel: paymentChannel || undefined,
      paymentMethod: paymentMethod || undefined,
      status: 'success',
    });
    booking.paystackAuthorizationUrl = undefined;
    booking.paystackAccessCode = undefined;
    booking.expiresAt = undefined;
    syncPricingAfterPayment(booking);

    await booking.save(session ? { session } : undefined);
    return booking;
  };

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await applyConfirm(session);
    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    if (isTransactionsUnsupportedError(error)) {
      await applyConfirm(null);
    } else {
      throw error;
    }
  } finally {
    session.endSession();
  }

  notifyPaymentConfirmation(booking, chargeAmount, paymentRef, { kind: 'booking' });
  return booking;
};

const applyInstallmentPayment = async (
  booking,
  { chargeAmount, paidAt, paymentChannel, paymentMethod, paymentRef }
) => {
  const remaining = roundMoney(
    Math.max(0, (booking.pricing?.totalAmount || 0) - (booking.amountPaid || 0))
  );

  if (remaining <= 0) {
    return booking;
  }

  if (chargeAmount > remaining + 0.009) {
    const error = new Error(
      `Payment exceeds remaining balance of GHS ${remaining.toFixed(2)}`
    );
    error.statusCode = 400;
    throw error;
  }

  const applyInstallment = async (session = null) => {
    const updateOptions = session ? { new: true, session } : { new: true };

    await Trip.findOneAndUpdate(
      { _id: booking.tripId },
      { $inc: { revenue: chargeAmount } },
      updateOptions
    );

    booking.amountPaid = roundMoney((booking.amountPaid || 0) + chargeAmount);
    booking.paidAt = paidAt;
    booking.paymentStatus = resolvePaymentStatus(
      booking.amountPaid,
      booking.pricing.totalAmount
    );
    if (paymentChannel) booking.paymentChannel = paymentChannel;
    if (paymentMethod) booking.paymentMethod = paymentMethod;
    appendPaymentRecord(booking, {
      reference: paymentRef,
      amount: chargeAmount,
      paidAt,
      channel: paymentChannel || undefined,
      paymentMethod: paymentMethod || undefined,
      status: 'success',
    });
    booking.paystackAuthorizationUrl = undefined;
    booking.paystackAccessCode = undefined;
    syncPricingAfterPayment(booking);

    await booking.save(session ? { session } : undefined);
    return booking;
  };

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await applyInstallment(session);
    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    if (isTransactionsUnsupportedError(error)) {
      await applyInstallment(null);
    } else {
      throw error;
    }
  } finally {
    session.endSession();
  }

  notifyPaymentConfirmation(booking, chargeAmount, paymentRef, { kind: 'installment' });
  return booking;
};

/** @deprecated use applyBookingPayment — kept for older imports */
const confirmBookingPayment = async (booking, opts) => applyBookingPayment(booking, opts);

/**
 * Cancel a booking and release reserved seats when it was confirmed.
 * Does not create a CancellationRequest — callers handle that.
 */
const cancelBookingAndReleaseSeats = async (booking) => {
  if (booking.status === 'cancelled' || booking.status === 'refunded') {
    return booking;
  }

  const wasConfirmed = booking.status === 'confirmed';
  const partySize = booking.partySize || 0;

  const applyCancel = async (session = null) => {
    if (wasConfirmed && partySize > 0) {
      await Trip.findOneAndUpdate(
        { _id: booking.tripId },
        {
          $inc: {
            bookingsCount: -partySize,
            confirmedBookingsCount: -1,
          },
        },
        session ? { session } : undefined
      );
    }

    booking.status = 'cancelled';
    booking.paystackAuthorizationUrl = undefined;
    booking.paystackAccessCode = undefined;
    await booking.save(session ? { session } : undefined);
    return booking;
  };

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await applyCancel(session);
    await session.commitTransaction();
    return booking;
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    if (isTransactionsUnsupportedError(error)) {
      return applyCancel(null);
    }

    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Mark booking refunded and reduce trip revenue by the refund amount.
 * Keeps amountPaid as payment history; stores refundedAmount for retained funds.
 */
const markBookingRefunded = async (booking, refundAmount) => {
  const amount = roundMoney(refundAmount || 0);

  const applyRefund = async (session = null) => {
    if (amount > 0) {
      const tripQuery = Trip.findById(booking.tripId);
      if (session) tripQuery.session(session);
      const trip = await tripQuery;
      if (trip) {
        trip.revenue = Math.max(0, roundMoney((trip.revenue || 0) - amount));
        await trip.save(session ? { session } : undefined);
      }
    }

    booking.status = 'refunded';
    booking.refundedAmount = roundMoney((booking.refundedAmount || 0) + amount);
    await booking.save(session ? { session } : undefined);
    return booking;
  };

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await applyRefund(session);
    await session.commitTransaction();
    return booking;
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    if (isTransactionsUnsupportedError(error)) {
      return applyRefund(null);
    }

    throw error;
  } finally {
    session.endSession();
  }
};

const cancelExpiredPendingBookings = async () => {
  await Booking.updateMany(
    {
      status: 'pending_payment',
      expiresAt: { $lt: new Date() },
    },
    { status: 'cancelled' }
  );
};

module.exports = {
  applyBookingPayment,
  confirmBookingPayment,
  cancelBookingAndReleaseSeats,
  markBookingRefunded,
  cancelExpiredPendingBookings,
  resolvePaymentStatus,
};
