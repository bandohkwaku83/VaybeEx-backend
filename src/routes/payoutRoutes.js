const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const {
  listTrips,
  getTripPayoutDashboard,
  getMemberPayments,
  exportMemberPayments,
  createWithdrawal,
} = require('../controllers/payoutController');

const router = express.Router();

router.use(authenticate, requireRole('organizer'));

/** Trip selector for the Payouts page */
router.get('/trips', listTrips);

/** Full dashboard: summary, methods, withdrawal, recent member payments */
router.get('/trips/:tripId', getTripPayoutDashboard);

/** Member payments table with filters / search / sort / pagination */
router.get('/trips/:tripId/members', getMemberPayments);

/** CSV export of member payments (same filters as members list) */
router.get('/trips/:tripId/members/export', exportMemberPayments);

/** Withdraw all or part of available funds to Mobile Money */
router.post('/trips/:tripId/withdrawals', createWithdrawal);

module.exports = router;
