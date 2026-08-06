const { getOrganizerDashboard } = require('../services/organizerDashboardService');

const getDashboard = async (req, res, next) => {
  try {
    const data = await getOrganizerDashboard(req.user.userId, {
      tripsLimit: req.query.tripsLimit,
      withdrawalsLimit: req.query.withdrawalsLimit,
    });

    res.json({
      success: true,
      message: 'Organizer dashboard retrieved successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboard,
};
