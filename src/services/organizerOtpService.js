const User = require('../models/User');
const { generateOtpCode, hashOtp, getOtpExpiryDate, OTP_EXPIRY_MINUTES } = require('../utils/otp');
const { sendOtpEmail } = require('./emailService');

const RESEND_COOLDOWN_MS = 60 * 1000;

const issueOrganizerOtp = async (user) => {
  if (user.lastOtpSentAt && Date.now() - user.lastOtpSentAt.getTime() < RESEND_COOLDOWN_MS) {
    const waitSeconds = Math.ceil(
      (RESEND_COOLDOWN_MS - (Date.now() - user.lastOtpSentAt.getTime())) / 1000
    );
    const error = new Error(`Please wait ${waitSeconds} seconds before requesting a new code`);
    error.statusCode = 429;
    throw error;
  }

  const code = generateOtpCode();

  user.otpHash = hashOtp(code);
  user.otpExpiresAt = getOtpExpiryDate();
  user.lastOtpSentAt = new Date();
  await user.save();

  try {
    await sendOtpEmail(user.email, user.fullName || 'Organizer', code);
  } catch (error) {
    error.statusCode = error.statusCode || 502;
    throw error;
  }

  return {
    expiresInMinutes: OTP_EXPIRY_MINUTES,
    delivery: { email: 'sent' },
  };
};

const verifyOrganizerOtp = async ({ email, code }) => {
  const normalizedEmail = email?.toLowerCase().trim();

  if (!normalizedEmail) {
    const error = new Error('Email is required');
    error.statusCode = 400;
    throw error;
  }

  const user = await User.findOne({ email: normalizedEmail, role: 'organizer' });

  if (!user) {
    const error = new Error('Organizer account not found');
    error.statusCode = 404;
    throw error;
  }

  if (!user.otpHash || !user.otpExpiresAt) {
    const error = new Error('No verification code found. Please request a new one');
    error.statusCode = 400;
    throw error;
  }

  if (user.otpExpiresAt.getTime() < Date.now()) {
    const error = new Error('Verification code has expired. Please request a new one');
    error.statusCode = 400;
    throw error;
  }

  const { verifyOtpHash } = require('../utils/otp');

  if (!verifyOtpHash(code, user.otpHash)) {
    const error = new Error('Invalid verification code');
    error.statusCode = 400;
    throw error;
  }

  user.isVerified = true;
  user.otpHash = undefined;
  user.otpExpiresAt = undefined;
  await user.save();

  return user;
};

module.exports = {
  issueOrganizerOtp,
  verifyOrganizerOtp,
};
