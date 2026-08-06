const { roundMoney } = require('./bookingHelpers');

const UI_POLICY_MAP = {
  fully_refundable: 'full',
  partially_refundable: 'partial',
  non_refundable: 'none',
  full: 'full',
  partial: 'partial',
  none: 'none',
};

const getDaysUntilDeparture = (startDate, fromDate = new Date()) => {
  if (!startDate) return 0;
  const departure = new Date(startDate);
  departure.setHours(0, 0, 0, 0);
  const today = new Date(fromDate);
  today.setHours(0, 0, 0, 0);
  return Math.ceil((departure.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

/**
 * Estimate refund for a booking against the trip's cancellation policy.
 */
const estimateRefund = (trip, booking, { now = new Date() } = {}) => {
  const amountPaid = roundMoney(booking.amountPaid || 0);
  const daysUntilDeparture = getDaysUntilDeparture(trip.startDate, now);
  const policy = UI_POLICY_MAP[trip.refundPolicy] || trip.refundPolicy || 'none';
  const deadlineDays =
    trip.cancellationDeadlineDays != null
      ? Number(trip.cancellationDeadlineDays)
      : policy === 'full'
        ? 14
        : 0;
  const refundPercentage =
    trip.refundPercentage != null ? Number(trip.refundPercentage) : undefined;

  const base = {
    amountPaid,
    daysUntilDeparture,
    policy,
    deadlineDays,
    refundPercentage,
    refundPolicySummary:
      typeof trip.getRefundPolicySummary === 'function'
        ? trip.getRefundPolicySummary()
        : '',
  };

  if (amountPaid <= 0) {
    return {
      ...base,
      eligible: false,
      refundAmount: 0,
      message: 'No payment has been made yet. You can cancel without a refund.',
    };
  }

  if (policy === 'none') {
    return {
      ...base,
      eligible: false,
      refundAmount: 0,
      message: 'This trip is non-refundable. Your booking can still be cancelled.',
    };
  }

  if (daysUntilDeparture < deadlineDays) {
    return {
      ...base,
      eligible: false,
      refundAmount: 0,
      message: `Cancellation deadline passed. Refunds require at least ${deadlineDays} days before departure.`,
    };
  }

  if (policy === 'full') {
    return {
      ...base,
      eligible: true,
      refundAmount: amountPaid,
      message: `Full refund of ${deadlineDays}+ days before departure.`,
    };
  }

  const pct = refundPercentage ?? 50;
  const refundAmount = roundMoney(amountPaid * (pct / 100));
  return {
    ...base,
    eligible: true,
    refundAmount,
    refundPercentage: pct,
    message: `${pct}% refund when cancelled ${deadlineDays}+ days before departure.`,
  };
};

module.exports = {
  estimateRefund,
  getDaysUntilDeparture,
  UI_POLICY_MAP,
};
