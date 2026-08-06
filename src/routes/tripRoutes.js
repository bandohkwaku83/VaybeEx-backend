const express = require('express');
const {
  createTrip,
  listOrganizerTrips,
  getOrganizerTrip,
  getTripAnalytics,
  updateTrip,
  publishTrip,
  deleteTrip,
  getTripOptions,
} = require('../controllers/tripController');
const { listTripBookings } = require('../controllers/bookingController');
const { listTripCancellations } = require('../controllers/cancellationController');
const { getTripBroadcastAudience } = require('../controllers/broadcastController');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const requireOnboardedOrganizer = require('../middleware/requireOnboardedOrganizer');
const assignDraftTripId = require('../middleware/assignDraftTripId');
const { uploadTripMedia } = require('../middleware/upload');

const router = express.Router();

router.get('/options', authenticate, requireRole('organizer'), getTripOptions);

router.post(
  '/',
  authenticate,
  requireRole('organizer'),
  requireOnboardedOrganizer,
  assignDraftTripId,
  uploadTripMedia,
  createTrip
);

router.get('/', authenticate, requireRole('organizer'), listOrganizerTrips);
router.get('/:id/bookings', authenticate, requireRole('organizer'), listTripBookings);
router.get('/:id/cancellations', authenticate, requireRole('organizer'), listTripCancellations);
router.get(
  '/:id/broadcast-audience',
  authenticate,
  requireRole('organizer'),
  getTripBroadcastAudience
);
router.get('/:id/analytics', authenticate, requireRole('organizer'), getTripAnalytics);
router.get('/:id', authenticate, requireRole('organizer'), getOrganizerTrip);

router.patch(
  '/:id',
  authenticate,
  requireRole('organizer'),
  requireOnboardedOrganizer,
  uploadTripMedia,
  updateTrip
);

router.patch(
  '/:id/publish',
  authenticate,
  requireRole('organizer'),
  requireOnboardedOrganizer,
  publishTrip
);

router.delete(
  '/:id',
  authenticate,
  requireRole('organizer'),
  requireOnboardedOrganizer,
  deleteTrip
);

module.exports = router;
