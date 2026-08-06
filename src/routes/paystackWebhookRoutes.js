const express = require('express');
const { handlePaystackWebhook } = require('../controllers/bookingController');

const router = express.Router();

router.post('/', handlePaystackWebhook);

module.exports = router;
