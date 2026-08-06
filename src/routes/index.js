const express = require('express');
const authRoutes = require('./authRoutes');
const organizerRoutes = require('./organizerRoutes');
const tripRoutes = require('./tripRoutes');
const publicTripRoutes = require('./publicTripRoutes');
const bookingRoutes = require('./bookingRoutes');
const payoutRoutes = require('./payoutRoutes');
const adminRoutes = require('./adminRoutes');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString(),
  });
});

router.use('/auth', authRoutes);
router.use('/bookings', bookingRoutes);
router.use('/organizer/payouts', payoutRoutes);
router.use('/organizer/trips', tripRoutes);
router.use('/organizer', organizerRoutes);
router.use('/admin', adminRoutes);
router.use('/trips', publicTripRoutes);

module.exports = router;
