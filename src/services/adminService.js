const mongoose = require('mongoose');
const User = require('../models/User');
const Trip = require('../models/Trip');
const Booking = require('../models/Booking');
const Withdrawal = require('../models/Withdrawal');
const CancellationRequest = require('../models/CancellationRequest');
const { roundMoney } = require('../utils/payoutHelpers');

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toAdminUserJson = (user, extras = {}) => {
  const json = typeof user.toPublicJSON === 'function' ? user.toPublicJSON() : { ...user };
  return {
    ...json,
    reviewedBy: user.reviewedBy || undefined,
    ...extras,
  };
};

/**
 * Admin dashboard counters for the home screen.
 */
const getDashboardStats = async () => {
  const [
    travelersTotal,
    travelersVerified,
    organizersTotal,
    organizersPending,
    organizersApproved,
    organizersRejected,
    organizersIncomplete,
    tripsByStatus,
    bookingsByStatus,
    withdrawalsByStatus,
    cancellationsPending,
  ] = await Promise.all([
    User.countDocuments({ role: 'traveler' }),
    User.countDocuments({ role: 'traveler', isVerified: true }),
    User.countDocuments({ role: 'organizer' }),
    User.countDocuments({
      role: 'organizer',
      onboardingCompleted: true,
      status: 'pending',
    }),
    User.countDocuments({ role: 'organizer', status: 'approved' }),
    User.countDocuments({ role: 'organizer', status: 'rejected' }),
    User.countDocuments({
      role: 'organizer',
      $or: [{ onboardingCompleted: false }, { onboardingCompleted: { $exists: false } }],
    }),
    Trip.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Booking.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Withdrawal.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]),
    CancellationRequest.countDocuments({ status: { $in: ['pending', 'processing'] } }),
  ]);

  const tripCounts = { draft: 0, scheduled: 0, live: 0, completed: 0, cancelled: 0 };
  tripsByStatus.forEach((row) => {
    if (row._id in tripCounts) tripCounts[row._id] = row.count;
  });

  const bookingCounts = {
    pending_payment: 0,
    confirmed: 0,
    cancelled: 0,
    refunded: 0,
  };
  bookingsByStatus.forEach((row) => {
    if (row._id in bookingCounts) bookingCounts[row._id] = row.count;
  });

  const withdrawalCounts = { pending: 0, processing: 0, success: 0, failed: 0 };
  const withdrawalAmounts = { pending: 0, processing: 0, success: 0, failed: 0 };
  withdrawalsByStatus.forEach((row) => {
    if (row._id in withdrawalCounts) {
      withdrawalCounts[row._id] = row.count;
      withdrawalAmounts[row._id] = roundMoney(row.amount || 0);
    }
  });

  return {
    travelers: {
      total: travelersTotal,
      verified: travelersVerified,
    },
    organizers: {
      total: organizersTotal,
      pendingApproval: organizersPending,
      approved: organizersApproved,
      rejected: organizersRejected,
      incompleteSetup: organizersIncomplete,
    },
    trips: tripCounts,
    bookings: bookingCounts,
    withdrawals: {
      counts: withdrawalCounts,
      amounts: withdrawalAmounts,
    },
    cancellations: {
      awaitingReview: cancellationsPending,
    },
  };
};

/**
 * List registered users (travelers + organizers). Admins excluded by default.
 */
const listUsers = async (query = {}) => {
  const filter = {};

  const role = String(query.role || '').toLowerCase().trim();
  if (role === 'traveler' || role === 'organizer') {
    filter.role = role;
  } else if (query.includeAdmins === 'true') {
    filter.role = { $in: ['traveler', 'organizer', 'admin'] };
  } else {
    filter.role = { $in: ['traveler', 'organizer'] };
  }

  if (query.status) filter.status = query.status;
  if (query.isVerified === 'true') filter.isVerified = true;
  if (query.isVerified === 'false') filter.isVerified = false;
  if (query.onboardingCompleted === 'true') filter.onboardingCompleted = true;
  if (query.onboardingCompleted === 'false') filter.onboardingCompleted = false;

  // KYC queue shortcut: organizers who finished setup and await admin review
  if (query.queue === 'pending_approval') {
    filter.role = 'organizer';
    filter.onboardingCompleted = true;
    filter.status = 'pending';
  }

  const q = String(query.q || query.search || '').trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [
      { fullName: rx },
      { email: rx },
      { phone: rx },
      { businessName: rx },
      { brandSlug: rx },
    ];
  }

  const pageNum = Math.max(1, parseInt(query.page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [users, total, roleAgg, organizerStatusAgg] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
    User.countDocuments(filter),
    User.aggregate([
      { $match: { role: { $in: ['traveler', 'organizer'] } } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]),
    User.aggregate([
      { $match: { role: 'organizer' } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const roleCounts = { traveler: 0, organizer: 0 };
  roleAgg.forEach((row) => {
    if (row._id in roleCounts) roleCounts[row._id] = row.count;
  });

  const organizerStatusCounts = { pending: 0, approved: 0, rejected: 0, unset: 0 };
  organizerStatusAgg.forEach((row) => {
    if (!row._id) organizerStatusCounts.unset = row.count;
    else if (row._id in organizerStatusCounts) organizerStatusCounts[row._id] = row.count;
  });

  return {
    roleCounts,
    organizerStatusCounts,
    pendingApprovalCount: await User.countDocuments({
      role: 'organizer',
      onboardingCompleted: true,
      status: 'pending',
    }),
    users: users.map((u) => toAdminUserJson(u)),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  };
};

const getUserById = async (userId) => {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error('Invalid user id');
    error.statusCode = 400;
    throw error;
  }

  const user = await User.findById(userId);
  if (!user || user.role === 'admin') {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  const extras = {};

  if (user.role === 'organizer') {
    const [tripCounts, withdrawalCounts] = await Promise.all([
      Trip.aggregate([
        { $match: { organizerId: user._id } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Withdrawal.aggregate([
        { $match: { organizerId: user._id } },
        { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
    ]);

    const trips = { draft: 0, scheduled: 0, live: 0, completed: 0, cancelled: 0, total: 0 };
    tripCounts.forEach((row) => {
      if (row._id in trips) {
        trips[row._id] = row.count;
        trips.total += row.count;
      }
    });

    const withdrawals = { pending: 0, processing: 0, success: 0, failed: 0, totalAmount: 0 };
    withdrawalCounts.forEach((row) => {
      if (row._id in withdrawals) withdrawals[row._id] = row.count;
      if (row._id === 'success') withdrawals.totalAmount = roundMoney(row.amount || 0);
    });

    extras.stats = { trips, withdrawals };
  }

  if (user.role === 'traveler') {
    const bookingCounts = await Booking.aggregate([
      { $match: { travelerId: user._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const bookings = {
      pending_payment: 0,
      confirmed: 0,
      cancelled: 0,
      refunded: 0,
      total: 0,
    };
    bookingCounts.forEach((row) => {
      if (row._id in bookings) {
        bookings[row._id] = row.count;
        bookings.total += row.count;
      }
    });
    extras.stats = { bookings };
  }

  return toAdminUserJson(user, extras);
};

const loadOrganizerForReview = async (organizerId) => {
  if (!mongoose.Types.ObjectId.isValid(organizerId)) {
    const error = new Error('Invalid organizer id');
    error.statusCode = 400;
    throw error;
  }

  const user = await User.findById(organizerId);
  if (!user || user.role !== 'organizer') {
    const error = new Error('Organizer not found');
    error.statusCode = 404;
    throw error;
  }

  if (!user.onboardingCompleted) {
    const error = new Error('Organizer has not completed profile setup yet');
    error.statusCode = 400;
    throw error;
  }

  return user;
};

const approveOrganizer = async (organizerId, adminId) => {
  const user = await loadOrganizerForReview(organizerId);

  if (user.status === 'approved') {
    return toAdminUserJson(user);
  }

  user.status = 'approved';
  user.rejectionReason = undefined;
  user.reviewedAt = new Date();
  user.reviewedBy = adminId;
  await user.save();

  if (user.email) {
    const { sendOrganizerApprovedEmail } = require('./emailService');
    sendOrganizerApprovedEmail({
      email: user.email,
      fullName: user.fullName,
      businessName: user.businessName,
    }).catch((error) => {
      console.error(`[ORGANIZER APPROVED EMAIL FAILED] ${error.message}`);
    });
  }

  return toAdminUserJson(user);
};

const rejectOrganizer = async (organizerId, adminId, { reason } = {}) => {
  const user = await loadOrganizerForReview(organizerId);

  const note =
    reason != null && String(reason).trim() ? String(reason).trim().slice(0, 500) : undefined;

  user.status = 'rejected';
  user.rejectionReason = note;
  user.reviewedAt = new Date();
  user.reviewedBy = adminId;
  await user.save();

  return toAdminUserJson(user);
};

/**
 * Platform-wide trip list for admin moderation / support.
 */
const listAdminTrips = async (query = {}) => {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.visibility) filter.visibility = query.visibility;
  if (query.organizerId) filter.organizerId = query.organizerId;

  const q = String(query.q || query.search || '').trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ title: rx }, { destination: rx }, { slug: rx }];
  }

  const pageNum = Math.max(1, parseInt(query.page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [trips, total] = await Promise.all([
    Trip.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('organizerId', 'fullName email businessName brandSlug status'),
    Trip.countDocuments(filter),
  ]);

  return {
    trips: trips.map((trip) => {
      const organizer =
        trip.organizerId && typeof trip.organizerId === 'object' ? trip.organizerId : null;
      return {
        id: trip._id,
        title: trip.title,
        destination: trip.destination,
        status: trip.status,
        visibility: trip.visibility,
        startDate: trip.startDate,
        endDate: trip.endDate,
        pricePerPerson: trip.pricePerPerson,
        bookingsCount: trip.bookingsCount ?? 0,
        revenue: trip.revenue ?? 0,
        coverImage: trip.coverImage,
        createdAt: trip.createdAt,
        organizer: organizer
          ? {
              id: organizer._id,
              fullName: organizer.fullName,
              email: organizer.email,
              businessName: organizer.businessName,
              brandSlug: organizer.brandSlug,
              status: organizer.status,
            }
          : { id: trip.organizerId },
      };
    }),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  };
};

module.exports = {
  getDashboardStats,
  listUsers,
  getUserById,
  approveOrganizer,
  rejectOrganizer,
  listAdminTrips,
};
