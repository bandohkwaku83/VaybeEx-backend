const express = require('express');
const {
  listPublicTrips,
  getPublicTrip,
  getPublicTripByBrand,
  trackTripEvent,
} = require('../controllers/tripController');
const {
  addFavorite,
  removeFavorite,
  listFavorites,
} = require('../controllers/favoriteController');
const optionalAuthenticate = require('../middleware/optionalAuthenticate');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.get('/', optionalAuthenticate, listPublicTrips);
router.get('/favorites', authenticate, requireRole('traveler'), listFavorites);
router.get('/brand/:brandSlug/:tripSlug', optionalAuthenticate, getPublicTripByBrand);
router.post('/:idOrSlug/events', trackTripEvent);
router.post('/:idOrSlug/favorite', authenticate, requireRole('traveler'), addFavorite);
router.delete('/:idOrSlug/favorite', authenticate, requireRole('traveler'), removeFavorite);
router.get('/:idOrSlug', optionalAuthenticate, getPublicTrip);

module.exports = router;
