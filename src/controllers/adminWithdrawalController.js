const {
  listAdminWithdrawals,
  getAdminWithdrawalById,
  retryWithdrawal,
  syncWithdrawalFromPaystack,
} = require('../services/payoutService');

const listWithdrawals = async (req, res, next) => {
  try {
    const data = await listAdminWithdrawals(req.query);
    res.json({
      success: true,
      message: 'Withdrawals retrieved successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

const getWithdrawal = async (req, res, next) => {
  try {
    const withdrawal = await getAdminWithdrawalById(req.params.id);
    res.json({
      success: true,
      message: 'Withdrawal retrieved successfully',
      data: { withdrawal },
    });
  } catch (error) {
    next(error);
  }
};

const retry = async (req, res, next) => {
  try {
    const withdrawal = await retryWithdrawal(req.params.id);
    res.json({
      success: true,
      message:
        withdrawal.status === 'success'
          ? 'Withdrawal retry succeeded'
          : 'Withdrawal retry initiated',
      data: { withdrawal },
    });
  } catch (error) {
    next(error);
  }
};

const sync = async (req, res, next) => {
  try {
    const withdrawal = await syncWithdrawalFromPaystack(req.params.id);
    res.json({
      success: true,
      message: 'Withdrawal synced from Paystack',
      data: { withdrawal },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listWithdrawals,
  getWithdrawal,
  retry,
  sync,
};
