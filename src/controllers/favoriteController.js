const FavoriteTrip = require('../models/FavoriteTrip');
const Trip = require('../models/Trip');
const User = require('../models/User');

const findPublicTrip = async (idOrSlug) => {
  const isObjectId = /^[a-f\d]{24}$/i.test(idOrSlug);
  const trip = await Trip.findOne(
    isObjectId ? { _id: idOrSlug } : { slug: String(idOrSlug).toLowerCase() }
  );

  if (!trip || trip.status !== 'live' || trip.visibility === 'private') {
    return null;
  }

  return trip;
};

const addFavorite = async (req, res, next) => {
  try {
    const trip = await findPublicTrip(req.params.idOrSlug);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found' });
    }

    const favorite = await FavoriteTrip.findOneAndUpdate(
      { travelerId: req.user.userId, tripId: trip._id },
      { travelerId: req.user.userId, tripId: trip._id },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({
      success: true,
      message: 'Trip added to favorites',
      data: {
        id: favorite._id,
        tripId: trip._id,
        favoritedAt: favorite.createdAt,
        isFavorited: true,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(201).json({
        success: true,
        message: 'Trip already in favorites',
        data: { tripId: req.params.idOrSlug, isFavorited: true },
      });
    }
    next(error);
  }
};

const removeFavorite = async (req, res, next) => {
  try {
    const trip = await findPublicTrip(req.params.idOrSlug);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found' });
    }

    await FavoriteTrip.deleteOne({ travelerId: req.user.userId, tripId: trip._id });

    res.json({
      success: true,
      message: 'Trip removed from favorites',
      data: {
        tripId: trip._id,
        isFavorited: false,
      },
    });
  } catch (error) {
    next(error);
  }
};

const listFavorites = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const filter = { travelerId: req.user.userId };

    const [favorites, total] = await Promise.all([
      FavoriteTrip.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      FavoriteTrip.countDocuments(filter),
    ]);

    const tripIds = favorites.map((f) => f.tripId);
    const trips = await Trip.find({
      _id: { $in: tripIds },
      status: 'live',
      visibility: { $ne: 'private' },
    });
    const tripMap = Object.fromEntries(trips.map((t) => [String(t._id), t]));

    const organizerIds = [...new Set(trips.map((t) => String(t.organizerId)))];
    const organizers = await User.find({ _id: { $in: organizerIds } }).select(
      'fullName businessName brandSlug brandLogo profilePhoto location aboutYou tripSpecialties whatsapp status isVerified'
    );
    const organizerMap = Object.fromEntries(organizers.map((o) => [String(o._id), o]));

    const items = favorites
      .map((favorite) => {
        const trip = tripMap[String(favorite.tripId)];
        if (!trip) return null;
        return {
          favoritedAt: favorite.createdAt,
          trip: {
            ...trip.toPublicJSON(organizerMap[String(trip.organizerId)]),
            isFavorited: true,
          },
        };
      })
      .filter(Boolean);

    res.json({
      success: true,
      message: 'Favorite trips retrieved successfully',
      data: {
        favorites: items,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addFavorite,
  removeFavorite,
  listFavorites,
};
