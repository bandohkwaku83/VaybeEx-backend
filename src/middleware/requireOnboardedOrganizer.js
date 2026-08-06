const User = require('../models/User');

const requireOnboardedOrganizer = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId).select('role onboardingCompleted status isVerified');

    if (!user || user.role !== 'organizer') {
      return res.status(404).json({
        success: false,
        message: 'Organizer account not found',
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before managing trips',
      });
    }

    if (!user.onboardingCompleted) {
      return res.status(403).json({
        success: false,
        message: 'Please complete your organizer profile setup before creating trips',
      });
    }

    if (user.status !== 'approved') {
      const pendingMessage =
        user.status === 'pending'
          ? 'Your organizer profile is still under review. We’ll email you when it’s approved.'
          : user.status === 'rejected'
            ? 'Your organizer application was not approved. Contact support if you need help.'
            : 'Your organizer account is not approved yet.';

      return res.status(403).json({
        success: false,
        message: pendingMessage,
      });
    }

    req.organizer = user;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = requireOnboardedOrganizer;
