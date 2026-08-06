const {
  estimateBroadcast,
  createBroadcast,
  listBroadcasts,
  getBroadcastDetail,
  getBroadcastAudiencePreview,
} = require('../services/broadcastService');

/**
 * GET /organizer/broadcasts
 */
const listOrganizerBroadcasts = async (req, res, next) => {
  try {
    const { status, tripId, page = 1, limit = 20, pageSize } = req.query;
    const data = await listBroadcasts({
      organizerId: req.user.userId,
      status,
      tripId,
      page,
      limit: pageSize || limit,
    });

    res.json({
      success: true,
      message: 'Broadcasts retrieved successfully',
      data,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * GET /organizer/broadcasts/:id
 */
const getOrganizerBroadcast = async (req, res, next) => {
  try {
    const data = await getBroadcastDetail({
      organizerId: req.user.userId,
      broadcastId: req.params.id,
    });

    res.json({
      success: true,
      message: 'Broadcast retrieved successfully',
      data,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * POST /organizer/broadcasts/estimate
 */
const estimateOrganizerBroadcast = async (req, res, next) => {
  try {
    const { tripId, message, audience } = req.body || {};

    if (!tripId) {
      return res.status(400).json({ success: false, message: 'tripId is required' });
    }

    const estimate = await estimateBroadcast({
      tripId,
      organizerId: req.user.userId,
      message,
      audience,
    });

    res.json({
      success: true,
      message: 'Broadcast estimate calculated',
      data: estimate,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * POST /organizer/broadcasts
 */
const createOrganizerBroadcast = async (req, res, next) => {
  try {
    const { tripId, message, channel, audience } = req.body || {};
    const idempotencyKey =
      req.headers['idempotency-key'] || req.body?.idempotencyKey || undefined;

    if (!tripId) {
      return res.status(400).json({ success: false, message: 'tripId is required' });
    }
    if (!audience) {
      return res.status(400).json({ success: false, message: 'audience is required' });
    }

    const { broadcast, reused } = await createBroadcast({
      tripId,
      organizerId: req.user.userId,
      message,
      channel,
      audience,
      idempotencyKey,
    });

    res.status(reused ? 200 : 201).json({
      success: true,
      message: reused
        ? 'Broadcast already created (idempotent replay)'
        : 'Broadcast queued successfully',
      data: {
        broadcast: broadcast.toDetailJSON(),
        reused,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    // Unique idempotency race
    if (error.code === 11000 && error.keyPattern?.idempotencyKey) {
      return res.status(409).json({
        success: false,
        message: 'A broadcast with this idempotency key already exists',
      });
    }
    next(error);
  }
};

/**
 * GET /organizer/trips/:id/broadcast-audience
 */
const getTripBroadcastAudience = async (req, res, next) => {
  try {
    const { mode = 'everyone', filter } = req.query;
    const data = await getBroadcastAudiencePreview({
      tripId: req.params.id,
      organizerId: req.user.userId,
      mode,
      filter,
    });

    res.json({
      success: true,
      message: 'Broadcast audience resolved',
      data,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

module.exports = {
  listOrganizerBroadcasts,
  getOrganizerBroadcast,
  estimateOrganizerBroadcast,
  createOrganizerBroadcast,
  getTripBroadcastAudience,
};
