const express = require('express');
const {
  getBookingPreview,
  createBooking,
  resumeBookingPayment,
  verifyBookingPayment,
  getPaystackConfig,
  getMyBookings,
  getBookingById,
} = require('../controllers/bookingController');
const {
  getCancellationPreview,
  requestCancellation,
  listMyCancellations,
} = require('../controllers/cancellationController');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const optionalAuthenticate = require('../middleware/optionalAuthenticate');

const router = express.Router();

router.get('/paystack/config', getPaystackConfig);
router.post('/preview/:tripId', optionalAuthenticate, getBookingPreview);
router.post('/', authenticate, requireRole('traveler'), createBooking);
router.post('/verify-payment', authenticate, requireRole('traveler'), verifyBookingPayment);
router.get('/me/cancellations', authenticate, requireRole('traveler'), listMyCancellations);
router.get('/me', authenticate, requireRole('traveler'), getMyBookings);
router.get(
  '/:id/cancellation-preview',
  authenticate,
  requireRole('traveler'),
  getCancellationPreview
);
router.post('/:id/cancel', authenticate, requireRole('traveler'), requestCancellation);
router.post('/:id/pay', authenticate, requireRole('traveler'), resumeBookingPayment);
router.get('/:id', authenticate, requireRole('traveler'), getBookingById);

module.exports = router;
