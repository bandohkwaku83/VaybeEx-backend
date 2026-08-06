const express = require('express');
const {
  register,
  login,
  verifyOtp,
  resendOtp,
  getMe,
  logout,
  updatePassword,
} = require('../controllers/organizerAuthController');
const { completeSetup, updateProfile, getProfileOptions } = require('../controllers/organizerProfileController');
const {
  listOrganizerCancellations,
  updateOrganizerCancellation,
} = require('../controllers/cancellationController');
const {
  listOrganizerBroadcasts,
  getOrganizerBroadcast,
  estimateOrganizerBroadcast,
  createOrganizerBroadcast,
} = require('../controllers/broadcastController');
const { getDashboard } = require('../controllers/organizerDashboardController');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const { uploadSetupImages, uploadProfileImages } = require('../middleware/upload');

const router = express.Router();

router.get('/dashboard', authenticate, requireRole('organizer'), getDashboard);

router.post('/auth/register', register);
router.post('/auth/login', login);
router.post('/auth/verify-otp', verifyOtp);
router.post('/auth/resend-otp', resendOtp);
router.get('/auth/me', authenticate, requireRole('organizer'), getMe);
router.patch('/auth/password', authenticate, requireRole('organizer'), updatePassword);
router.post('/auth/logout', authenticate, requireRole('organizer'), logout);

router.get(
  '/profile/options',
  authenticate,
  requireRole('organizer'),
  getProfileOptions
);
router.post(
  '/profile/setup',
  authenticate,
  requireRole('organizer'),
  uploadSetupImages,
  completeSetup
);
router.patch(
  '/profile',
  authenticate,
  requireRole('organizer'),
  uploadProfileImages,
  updateProfile
);

router.get(
  '/cancellations',
  authenticate,
  requireRole('organizer'),
  listOrganizerCancellations
);
router.patch(
  '/cancellations/:id',
  authenticate,
  requireRole('organizer'),
  updateOrganizerCancellation
);

router.get('/broadcasts', authenticate, requireRole('organizer'), listOrganizerBroadcasts);
router.post(
  '/broadcasts/estimate',
  authenticate,
  requireRole('organizer'),
  estimateOrganizerBroadcast
);
router.post('/broadcasts', authenticate, requireRole('organizer'), createOrganizerBroadcast);
router.get('/broadcasts/:id', authenticate, requireRole('organizer'), getOrganizerBroadcast);

module.exports = router;
