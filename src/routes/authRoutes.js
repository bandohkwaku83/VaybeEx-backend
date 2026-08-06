const express = require('express');
const {
  register,
  login,
  googleAuth,
  completeProfile,
  verifyOtp,
  resendOtp,
  getMe,
  logout,
} = require('../controllers/authController');
const authenticate = require('../middleware/authenticate');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/google', googleAuth);
router.post('/complete-profile', authenticate, completeProfile);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);
router.get('/me', authenticate, getMe);
router.post('/logout', authenticate, logout);

module.exports = router;
