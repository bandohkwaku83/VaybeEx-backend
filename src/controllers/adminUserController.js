const {
  getDashboardStats,
  listUsers,
  getUserById,
  approveOrganizer,
  rejectOrganizer,
  listAdminTrips,
} = require('../services/adminService');

const getDashboard = async (req, res, next) => {
  try {
    const data = await getDashboardStats();
    res.json({
      success: true,
      message: 'Admin dashboard retrieved successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

const list = async (req, res, next) => {
  try {
    const data = await listUsers(req.query);
    res.json({
      success: true,
      message: 'Users retrieved successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

const getOne = async (req, res, next) => {
  try {
    const user = await getUserById(req.params.id);
    res.json({
      success: true,
      message: 'User retrieved successfully',
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

const approve = async (req, res, next) => {
  try {
    const user = await approveOrganizer(req.params.id, req.user.userId);
    res.json({
      success: true,
      message: 'Organizer approved. A confirmation email has been sent.',
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

const reject = async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    const user = await rejectOrganizer(req.params.id, req.user.userId, { reason });
    res.json({
      success: true,
      message: 'Organizer application rejected',
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

const listTrips = async (req, res, next) => {
  try {
    const data = await listAdminTrips(req.query);
    res.json({
      success: true,
      message: 'Trips retrieved successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboard,
  list,
  getOne,
  approve,
  reject,
  listTrips,
};
