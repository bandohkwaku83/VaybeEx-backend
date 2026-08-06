const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const { login, me } = require('../controllers/adminAuthController');
const {
  listWithdrawals,
  getWithdrawal,
  retry,
  sync,
} = require('../controllers/adminWithdrawalController');
const {
  getDashboard,
  list,
  getOne,
  approve,
  reject,
  listTrips,
} = require('../controllers/adminUserController');

const router = express.Router();

/** Public admin login */
router.post('/auth/login', login);

router.use(authenticate, requireRole('admin'));

router.get('/auth/me', me);

/** Home dashboard counters */
router.get('/dashboard', getDashboard);

/** Registered users (travelers + organizers) */
router.get('/users', list);
router.get('/users/:id', getOne);

/** Organizer KYC decisions */
router.post('/organizers/:id/approve', approve);
router.post('/organizers/:id/reject', reject);

/** Platform trips */
router.get('/trips', listTrips);

/** Withdrawals queue */
router.get('/withdrawals', listWithdrawals);
router.get('/withdrawals/:id', getWithdrawal);
router.post('/withdrawals/:id/retry', retry);
router.post('/withdrawals/:id/sync', sync);

module.exports = router;
