/**
 * Map booking paymentStatus → organizer dashboard payment labels.
 * paid | partial | pending | cancelled | refunded
 */
const toMemberPaymentStatus = (booking) => {
  if (booking.status === 'refunded') return 'refunded';
  if (booking.status === 'cancelled') return 'cancelled';
  if (booking.paymentStatus === 'fully_paid') return 'paid';
  if (booking.paymentStatus === 'deposit_paid') return 'partial';
  return 'pending';
};

/** Bookings still on the trip (attendance / outstanding). */
const ACTIVE_BOOKING_STATUSES = ['pending_payment', 'confirmed'];

/** Bookings that can still hold organizer money for payout math. */
const PAYOUT_BOOKING_STATUSES = [
  'pending_payment',
  'confirmed',
  'cancelled',
  'refunded',
];

const PENDING_REFUND_STATUSES = ['pending', 'processing'];

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** Money the organizer still holds from a booking after approved refunds. */
const getRetainedAmount = (booking) =>
  roundMoney(Math.max(0, (booking.amountPaid || 0) - (booking.refundedAmount || 0)));

const getLeadGuest = (booking) => {
  const lead = (booking.guests || []).find((g) => g.isLead) || booking.guests?.[0];
  const traveler =
    booking.travelerId && typeof booking.travelerId === 'object' ? booking.travelerId : null;

  return {
    fullName: lead?.fullName || traveler?.fullName || '',
    email: lead?.email || traveler?.email || '',
    phone: lead?.phone || traveler?.phone || booking.whatsapp || '',
  };
};

/**
 * Shape a booking row for the Member Payments table.
 */
const toMemberPaymentRow = (booking) => {
  const attendee = getLeadGuest(booking);
  const totalDue = booking.pricing?.totalAmount ?? 0;
  const amountPaid = booking.amountPaid ?? 0;
  const refundedAmount = booking.refundedAmount ?? 0;
  const retainedAmount = getRetainedAmount(booking);
  const status = toMemberPaymentStatus(booking);

  return {
    id: booking._id,
    attendee: {
      fullName: attendee.fullName,
      email: attendee.email,
    },
    contact: attendee.phone,
    method: booking.paymentMethod || null,
    paidOn: booking.paidAt || null,
    status,
    paymentStatus: booking.paymentStatus,
    bookingStatus: booking.status,
    amountPaid: roundMoney(amountPaid),
    refundedAmount: roundMoney(refundedAmount),
    retainedAmount,
    totalDue: roundMoney(totalDue),
    outstanding: roundMoney(
      ACTIVE_BOOKING_STATUSES.includes(booking.status)
        ? Math.max(0, totalDue - amountPaid)
        : 0
    ),
    currency: booking.pricing?.currency || 'GHS',
    partySize: booking.partySize,
    createdAt: booking.createdAt,
  };
};

/**
 * Aggregate payout summary + payment-method breakdown.
 * - Member / outstanding stats: active bookings only
 * - collected: retained money still held (active + cancelled + partial refunds)
 */
const buildPayoutSummary = (trip, bookings) => {
  const active = bookings.filter((b) => ACTIVE_BOOKING_STATUSES.includes(b.status));

  let collected = 0;
  let outstanding = 0;
  let paidMembers = 0;
  let partialMembers = 0;
  let pendingMembers = 0;
  let potentialFromBookings = 0;

  const methodMap = new Map();

  // Retained funds across all money-holding bookings (including cancelled / partial refunds).
  bookings.forEach((booking) => {
    const retained = getRetainedAmount(booking);
    if (retained <= 0) return;

    collected += retained;

    if (booking.paymentMethod) {
      const key = booking.paymentMethod;
      const entry = methodMap.get(key) || {
        method: key,
        collected: 0,
        paidCount: 0,
        partialCount: 0,
      };
      entry.collected += retained;
      methodMap.set(key, entry);
    }
  });

  active.forEach((booking) => {
    const amountPaid = booking.amountPaid || 0;
    const totalDue = booking.pricing?.totalAmount || 0;
    outstanding += Math.max(0, totalDue - amountPaid);
    potentialFromBookings += totalDue;

    const memberStatus = toMemberPaymentStatus(booking);
    if (memberStatus === 'paid') paidMembers += 1;
    else if (memberStatus === 'partial') partialMembers += 1;
    else pendingMembers += 1;

    if (amountPaid > 0 && booking.paymentMethod) {
      const entry = methodMap.get(booking.paymentMethod);
      if (entry) {
        if (memberStatus === 'paid') entry.paidCount += 1;
        else if (memberStatus === 'partial') entry.partialCount += 1;
      }
    }
  });

  // Include retained funds from cancelled/refunded bookings in potential so
  // collectionPercent stays coherent after cancellations.
  bookings.forEach((booking) => {
    if (ACTIVE_BOOKING_STATUSES.includes(booking.status)) return;
    const retained = getRetainedAmount(booking);
    if (retained > 0) potentialFromBookings += retained;
  });

  collected = roundMoney(collected);
  outstanding = roundMoney(outstanding);

  // Prefer sum of booking totals (includes add-ons / package rates).
  // Fall back to seats booked × ticket price when there are no priced bookings yet.
  const bookedSeats = trip.bookingsCount ?? 0;
  const pricePerPerson = trip.pricePerPerson ?? 0;
  const potential =
    potentialFromBookings > 0
      ? roundMoney(potentialFromBookings)
      : roundMoney(bookedSeats * pricePerPerson);

  const collectionPercent =
    potential > 0 ? Math.round((collected / potential) * 1000) / 10 : 0;

  const totalMembers = paidMembers + partialMembers + pendingMembers;
  const awaitingPayment = partialMembers + pendingMembers;
  const membersWhoPaid = paidMembers + partialMembers;
  const avgPerPaidMember =
    membersWhoPaid > 0 ? roundMoney(collected / membersWhoPaid) : 0;

  const methods = [...methodMap.values()]
    .map((entry) => ({
      method: entry.method,
      collected: roundMoney(entry.collected),
      percentOfCollected:
        collected > 0 ? Math.round((entry.collected / collected) * 1000) / 10 : 0,
      paidCount: entry.paidCount,
      partialCount: entry.partialCount,
      countLabel:
        entry.partialCount > 0 && entry.paidCount === 0
          ? `${entry.partialCount} partial`
          : entry.partialCount > 0
            ? `${entry.paidCount} paid · ${entry.partialCount} partial`
            : `${entry.paidCount} paid`,
    }))
    .sort((a, b) => b.collected - a.collected);

  return {
    currency: 'GHS',
    collected,
    outstanding,
    potential,
    collectionPercent,
    paidMembers,
    partialMembers,
    pendingMembers,
    totalMembers,
    awaitingPayment,
    booked: bookedSeats,
    capacity: trip.maxCapacity ?? null,
    pricePerPerson,
    methodsUsed: methods.length,
    avgPerPaidMember,
    methods,
    statusCounts: {
      all: totalMembers,
      paid: paidMembers,
      partial: partialMembers,
      pending: pendingMembers,
    },
  };
};

const resolveTimeRange = (period) => {
  const raw = String(period || 'all').toLowerCase().trim();
  if (!raw || raw === 'all' || raw === 'all_time') return null;

  const now = new Date();
  const start = new Date(now);

  if (raw === 'today') {
    start.setHours(0, 0, 0, 0);
    return { from: start, to: now };
  }
  if (raw === '7d' || raw === 'last_7_days') {
    start.setDate(start.getDate() - 7);
    return { from: start, to: now };
  }
  if (raw === '30d' || raw === 'last_30_days') {
    start.setDate(start.getDate() - 30);
    return { from: start, to: now };
  }
  if (raw === '90d' || raw === 'last_90_days') {
    start.setDate(start.getDate() - 90);
    return { from: start, to: now };
  }

  return null;
};

const MEMBER_SORT_FIELDS = {
  attendee: 'attendee',
  contact: 'contact',
  method: 'method',
  paidOn: 'paidOn',
  status: 'status',
  amount: 'amountPaid',
  createdAt: 'createdAt',
};

const STATUS_ORDER = { paid: 0, partial: 1, pending: 2, cancelled: 3, refunded: 4 };

const sortMemberRows = (rows, sortBy, sortOrder) => {
  const field = MEMBER_SORT_FIELDS[sortBy] || 'createdAt';
  const dir = String(sortOrder || 'desc').toLowerCase() === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    let av;
    let bv;

    if (field === 'attendee') {
      av = (a.attendee?.fullName || '').toLowerCase();
      bv = (b.attendee?.fullName || '').toLowerCase();
    } else if (field === 'contact') {
      av = (a.contact || '').toLowerCase();
      bv = (b.contact || '').toLowerCase();
    } else if (field === 'method') {
      av = (a.method || '').toLowerCase();
      bv = (b.method || '').toLowerCase();
    } else if (field === 'status') {
      av = STATUS_ORDER[a.status] ?? 99;
      bv = STATUS_ORDER[b.status] ?? 99;
    } else if (field === 'paidOn' || field === 'createdAt') {
      av = a[field] ? new Date(a[field]).getTime() : 0;
      bv = b[field] ? new Date(b[field]).getTime() : 0;
    } else {
      av = a[field] ?? 0;
      bv = b[field] ?? 0;
    }

    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
};

const filterMemberRows = (rows, { paymentStatus, q, period, from, to }) => {
  let result = rows;

  if (paymentStatus && paymentStatus !== 'all') {
    const normalized = String(paymentStatus).toLowerCase();
    result = result.filter((row) => row.status === normalized);
  }

  if (q && String(q).trim()) {
    const needle = String(q).trim().toLowerCase();
    result = result.filter((row) => {
      const hay = [
        row.attendee?.fullName,
        row.attendee?.email,
        row.contact,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  const range = from || to ? { from, to } : resolveTimeRange(period);
  if (range) {
    result = result.filter((row) => {
      const ts = row.paidOn || row.createdAt;
      if (!ts) return false;
      const time = new Date(ts).getTime();
      if (range.from && time < new Date(range.from).getTime()) return false;
      if (range.to && time > new Date(range.to).getTime()) return false;
      return true;
    });
  }

  return result;
};

const escapeCsv = (value) => {
  const str = value == null ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
};

const memberRowsToCsv = (rows) => {
  const header = [
    'Attendee',
    'Email',
    'Contact',
    'Method',
    'Paid On',
    'Status',
    'Amount Paid',
    'Total Due',
    'Currency',
  ];
  const lines = [header.join(',')];

  rows.forEach((row) => {
    lines.push(
      [
        escapeCsv(row.attendee?.fullName),
        escapeCsv(row.attendee?.email),
        escapeCsv(row.contact),
        escapeCsv(row.method || ''),
        escapeCsv(row.paidOn ? new Date(row.paidOn).toISOString() : ''),
        escapeCsv(row.status),
        escapeCsv(row.amountPaid),
        escapeCsv(row.totalDue),
        escapeCsv(row.currency),
      ].join(',')
    );
  });

  return lines.join('\n');
};

module.exports = {
  toMemberPaymentStatus,
  toMemberPaymentRow,
  getLeadGuest,
  buildPayoutSummary,
  getRetainedAmount,
  ACTIVE_BOOKING_STATUSES,
  PAYOUT_BOOKING_STATUSES,
  PENDING_REFUND_STATUSES,
  resolveTimeRange,
  sortMemberRows,
  filterMemberRows,
  memberRowsToCsv,
  roundMoney,
};
