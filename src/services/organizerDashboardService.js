const mongoose = require('mongoose');
const User = require('../models/User');
const Trip = require('../models/Trip');
const Booking = require('../models/Booking');
const Withdrawal = require('../models/Withdrawal');
const CancellationRequest = require('../models/CancellationRequest');
const { roundMoney } = require('../utils/payoutHelpers');
const { MOMO_PROVIDERS } = require('../utils/momo');
const { maskPhone } = require('../utils/phone');

const ACTIVE_TRIP_STATUSES = ['live', 'scheduled'];
const WITHDRAWAL_STATUS_LABELS = {
  pending: 'Pending',
  processing: 'Processing',
  success: 'Completed',
  failed: 'Failed',
};

const MONTH_LABELS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

const startOfMonthUtc = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));

const addMonthsUtc = (date, months) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 0, 0, 0, 0));

const monthKey = (date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

/**
 * Growth percent vs prior period. Null when prior is 0 and current > 0 (avoid fake 100%).
 */
const calcGrowthPercent = (current, previous) => {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
};

const toSlimTrip = (trip) => {
  const booked = trip.bookingsCount ?? 0;
  const capacity = trip.maxCapacity ?? null;
  const fillRate =
    capacity != null && capacity > 0 ? Math.round((booked / capacity) * 100) : 0;

  return {
    id: trip._id,
    title: trip.title,
    destination: trip.destination,
    coverImage: trip.coverImage,
    image: trip.coverImage,
    startDate: trip.startDate,
    endDate: trip.endDate,
    status: trip.status,
    pricePerPerson: trip.pricePerPerson,
    price: trip.pricePerPerson,
    booked,
    capacity,
    fillRate,
    seatsAvailable: trip.getSeatsAvailable?.() ?? null,
    revenue: trip.revenue ?? 0,
    views: trip.viewsCount ?? 0,
    currency: 'GHS',
  };
};

const toDashboardWithdrawal = (withdrawal) => {
  const trip =
    withdrawal.tripId && typeof withdrawal.tripId === 'object' ? withdrawal.tripId : null;
  const providerMeta = MOMO_PROVIDERS[withdrawal.momoProvider] || null;
  const masked =
    withdrawal.momoNumber && withdrawal.momoNumber.length >= 4
      ? `****${withdrawal.momoNumber.slice(-4)}`
      : maskPhone(withdrawal.momoNumber || '');

  return {
    id: withdrawal._id,
    tripId: trip?._id || withdrawal.tripId,
    tripTitle: trip?.title || '',
    amount: roundMoney(withdrawal.amount),
    currency: withdrawal.currency || 'GHS',
    status: withdrawal.status,
    label: WITHDRAWAL_STATUS_LABELS[withdrawal.status] || withdrawal.status,
    momoProvider: withdrawal.momoProvider,
    momoProviderLabel: providerMeta?.label || withdrawal.momoProvider,
    momoNumber: withdrawal.momoNumber,
    momoNumberMasked: masked,
    accountName: withdrawal.accountName || undefined,
    destinationLabel: withdrawal.destinationLabel || undefined,
    createdAt: withdrawal.createdAt,
    processedAt: withdrawal.processedAt || undefined,
  };
};

const sumPaymentsInRange = async (tripIds, from, to) => {
  if (!tripIds.length) return 0;

  const rows = await Booking.aggregate([
    {
      $match: {
        tripId: { $in: tripIds },
        'payments.0': { $exists: true },
      },
    },
    { $unwind: '$payments' },
    {
      $match: {
        'payments.paidAt': { $gte: from, $lt: to },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$payments.amount' },
      },
    },
  ]);

  return roundMoney(rows[0]?.total || 0);
};

const sumTravelers = async (tripIds, extraMatch = {}) => {
  if (!tripIds.length) return 0;

  const rows = await Booking.aggregate([
    {
      $match: {
        tripId: { $in: tripIds },
        status: 'confirmed',
        ...extraMatch,
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$partySize' },
      },
    },
  ]);

  return rows[0]?.total || 0;
};

/**
 * Last N calendar months of payment totals (UTC), oldest → newest.
 */
const buildRevenuePulse = async (tripIds, months = 7) => {
  const now = new Date();
  const currentMonthStart = startOfMonthUtc(now);
  const rangeStart = addMonthsUtc(currentMonthStart, -(months - 1));
  const rangeEnd = addMonthsUtc(currentMonthStart, 1);

  const totalsByMonth = new Map();
  for (let i = 0; i < months; i += 1) {
    const d = addMonthsUtc(rangeStart, i);
    totalsByMonth.set(monthKey(d), 0);
  }

  if (tripIds.length) {
    const rows = await Booking.aggregate([
      {
        $match: {
          tripId: { $in: tripIds },
          'payments.0': { $exists: true },
        },
      },
      { $unwind: '$payments' },
      {
        $match: {
          'payments.paidAt': { $gte: rangeStart, $lt: rangeEnd },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$payments.paidAt' },
            month: { $month: '$payments.paidAt' },
          },
          revenue: { $sum: '$payments.amount' },
        },
      },
    ]);

    rows.forEach((row) => {
      const key = `${row._id.year}-${String(row._id.month).padStart(2, '0')}`;
      if (totalsByMonth.has(key)) {
        totalsByMonth.set(key, roundMoney(row.revenue || 0));
      }
    });
  }

  const series = [];
  for (let i = 0; i < months; i += 1) {
    const d = addMonthsUtc(rangeStart, i);
    const key = monthKey(d);
    series.push({
      month: key,
      label: MONTH_LABELS[d.getUTCMonth()],
      revenue: totalsByMonth.get(key) || 0,
    });
  }

  const thisMonth = series[series.length - 1] || {
    month: monthKey(currentMonthStart),
    label: MONTH_LABELS[currentMonthStart.getUTCMonth()],
    revenue: 0,
  };

  return {
    currency: 'GHS',
    months: series,
    thisMonth: {
      month: thisMonth.month,
      label: thisMonth.label,
      revenue: thisMonth.revenue,
    },
  };
};

/**
 * Organizer home dashboard — greeting, KPIs, trips preview, revenue pulse, recent withdrawals.
 */
const getOrganizerDashboard = async (organizerId, { tripsLimit = 5, withdrawalsLimit = 5 } = {}) => {
  const oid = new mongoose.Types.ObjectId(organizerId);
  const tripsLimitNum = Math.min(20, Math.max(1, parseInt(tripsLimit, 10) || 5));
  const withdrawalsLimitNum = Math.min(20, Math.max(1, parseInt(withdrawalsLimit, 10) || 5));

  const now = new Date();
  const thisMonthStart = startOfMonthUtc(now);
  const nextMonthStart = addMonthsUtc(thisMonthStart, 1);
  const lastMonthStart = addMonthsUtc(thisMonthStart, -1);

  const [organizer, tripStatsRows, recentTrips, tripsTotal, recentWithdrawals, pendingRefunds, tripIdDocs] =
    await Promise.all([
      User.findById(organizerId),
      Trip.aggregate([
        { $match: { organizerId: oid } },
        {
          $group: {
            _id: null,
            revenue: { $sum: '$revenue' },
            views: { $sum: '$viewsCount' },
            totalListings: { $sum: 1 },
            activeTrips: {
              $sum: {
                $cond: [{ $in: ['$status', ACTIVE_TRIP_STATUSES] }, 1, 0],
              },
            },
          },
        },
      ]),
      Trip.find({ organizerId: oid }).sort({ updatedAt: -1 }).limit(tripsLimitNum),
      Trip.countDocuments({ organizerId: oid }),
      Withdrawal.find({ organizerId: oid })
        .sort({ createdAt: -1 })
        .limit(withdrawalsLimitNum)
        .populate('tripId', 'title destination status'),
      CancellationRequest.countDocuments({
        organizerId: oid,
        status: { $in: ['pending', 'processing'] },
      }),
      Trip.find({ organizerId: oid }).select('_id').lean(),
    ]);

  if (!organizer) {
    const error = new Error('Organizer not found');
    error.statusCode = 404;
    throw error;
  }

  const tripIds = tripIdDocs.map((t) => t._id);
  const statsRow = tripStatsRows[0] || {
    revenue: 0,
    views: 0,
    totalListings: 0,
    activeTrips: 0,
  };

  const [
    travelersTotal,
    revenueThisMonth,
    revenueLastMonth,
    travelersThisMonth,
    travelersLastMonth,
    revenuePulse,
  ] = await Promise.all([
    sumTravelers(tripIds),
    sumPaymentsInRange(tripIds, thisMonthStart, nextMonthStart),
    sumPaymentsInRange(tripIds, lastMonthStart, thisMonthStart),
    sumTravelers(tripIds, {
      createdAt: { $gte: thisMonthStart, $lt: nextMonthStart },
    }),
    sumTravelers(tripIds, {
      createdAt: { $gte: lastMonthStart, $lt: thisMonthStart },
    }),
    buildRevenuePulse(tripIds, 7),
  ]);

  return {
    organizer: {
      id: organizer._id,
      fullName: organizer.fullName,
      businessName: organizer.businessName || '',
      profilePhoto: organizer.profilePhoto || null,
      brandLogo: organizer.brandLogo || null,
      status: organizer.status || null,
      onboardingCompleted: Boolean(organizer.onboardingCompleted),
    },
    stats: {
      currency: 'GHS',
      revenue: {
        value: roundMoney(statsRow.revenue || 0),
        growthPercent: calcGrowthPercent(revenueThisMonth, revenueLastMonth),
      },
      activeTrips: {
        value: statsRow.activeTrips || 0,
        totalListings: statsRow.totalListings || 0,
      },
      travelers: {
        value: travelersTotal,
        growthPercent: calcGrowthPercent(travelersThisMonth, travelersLastMonth),
      },
      views: {
        value: statsRow.views || 0,
        // No historical view events — growth not available yet
        growthPercent: null,
      },
      avgRating: {
        value: null,
        reviewCount: 0,
      },
    },
    quickActions: {
      pendingRefunds,
      hasTrips: tripsTotal > 0,
    },
    trips: {
      items: recentTrips.map(toSlimTrip),
      pagination: {
        page: 1,
        limit: tripsLimitNum,
        total: tripsTotal,
        pages: Math.ceil(tripsTotal / tripsLimitNum) || 0,
      },
    },
    revenuePulse,
    recentWithdrawals: recentWithdrawals.map(toDashboardWithdrawal),
  };
};

module.exports = {
  getOrganizerDashboard,
};
