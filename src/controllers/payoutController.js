const {
  listPayoutTrips,
  getTripPayouts,
  listMemberPayments,
  exportMemberPaymentsCsv,
  requestWithdrawal,
} = require('../services/payoutService');

const listTrips = async (req, res, next) => {
  try {
    const data = await listPayoutTrips(req.user.userId, req.query);
    res.json({
      success: true,
      message: 'Payout trips retrieved successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

const getTripPayoutDashboard = async (req, res, next) => {
  try {
    const data = await getTripPayouts(req.params.tripId, req.user.userId);
    res.json({
      success: true,
      message: 'Trip payouts retrieved successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

const getMemberPayments = async (req, res, next) => {
  try {
    const data = await listMemberPayments(req.params.tripId, req.user.userId, req.query);
    res.json({
      success: true,
      message: 'Member payments retrieved successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

const exportMemberPayments = async (req, res, next) => {
  try {
    const { csv, filename } = await exportMemberPaymentsCsv(
      req.params.tripId,
      req.user.userId,
      req.query
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
};

const createWithdrawal = async (req, res, next) => {
  try {
    const { amount, note, momoProvider, momoNumber, accountName } = req.body || {};
    const data = await requestWithdrawal(req.params.tripId, req.user.userId, {
      amount,
      note,
      momoProvider,
      momoNumber,
      accountName,
    });

    res.status(201).json({
      success: true,
      message:
        data.withdrawal.status === 'success'
          ? 'Mobile money payout sent successfully'
          : 'Mobile money payout initiated — funds are on the way',
      data,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listTrips,
  getTripPayoutDashboard,
  getMemberPayments,
  exportMemberPayments,
  createWithdrawal,
};
