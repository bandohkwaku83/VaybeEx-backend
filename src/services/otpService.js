const { generateOtpCode, hashOtp, getOtpExpiryDate, OTP_EXPIRY_MINUTES } = require('../utils/otp');
const { findUserByEmailOrPhone } = require('../utils/userLookup');
const { sendOtpEmail } = require('./emailService');
const { sendOtpSms } = require('./arkeselService');

const RESEND_COOLDOWN_MS = 60 * 1000;

const assertOtpCooldown = (user) => {
  if (user.lastOtpSentAt && Date.now() - user.lastOtpSentAt.getTime() < RESEND_COOLDOWN_MS) {
    const waitSeconds = Math.ceil(
      (RESEND_COOLDOWN_MS - (Date.now() - user.lastOtpSentAt.getTime())) / 1000
    );
    const error = new Error(`Please wait ${waitSeconds} seconds before requesting a new code`);
    error.statusCode = 429;
    throw error;
  }
};

const persistOtp = async (user, code) => {
  user.otpHash = hashOtp(code);
  user.otpExpiresAt = getOtpExpiryDate();
  user.lastOtpSentAt = new Date();
  await user.save();
};

const issueOtpToUser = async (user) => {
  assertOtpCooldown(user);

  const code = generateOtpCode();
  await persistOtp(user, code);

  const [emailResult, smsResult] = await Promise.allSettled([
    sendOtpEmail(user.email, user.fullName, code),
    sendOtpSms(user.phone, code),
  ]);

  const failures = [];

  if (emailResult.status === 'rejected') {
    console.error(`[OTP EMAIL FAILED] ${emailResult.reason.message}`);
    failures.push(`email: ${emailResult.reason.message}`);
  }

  if (smsResult.status === 'rejected') {
    console.error(`[OTP SMS FAILED] ${smsResult.reason.message}`);
    failures.push(`sms: ${smsResult.reason.message}`);
  }

  if (failures.length === 2) {
    const error = new Error(`Failed to deliver verification code (${failures.join('; ')})`);
    error.statusCode = 502;
    throw error;
  }

  return {
    expiresInMinutes: OTP_EXPIRY_MINUTES,
    delivery: {
      email: emailResult.status === 'fulfilled' ? 'sent' : 'failed',
      sms: smsResult.status === 'fulfilled' ? 'sent' : 'failed',
    },
    ...(failures.length
      ? { deliveryErrors: failures }
      : {}),
  };
};

/** SMS-only OTP — used after Google sign-in when confirming phone ownership. */
const issuePhoneOtpToUser = async (user) => {
  if (!user.phone) {
    const error = new Error('Phone number is required before sending a verification code');
    error.statusCode = 400;
    throw error;
  }

  assertOtpCooldown(user);

  const code = generateOtpCode();
  await persistOtp(user, code);

  try {
    await sendOtpSms(user.phone, code);
  } catch (err) {
    console.error(`[OTP SMS FAILED] ${err.message}`);
    const error = new Error(`Failed to deliver verification code to phone: ${err.message}`);
    error.statusCode = 502;
    throw error;
  }

  return {
    expiresInMinutes: OTP_EXPIRY_MINUTES,
    delivery: {
      email: 'skipped',
      sms: 'sent',
    },
  };
};

const verifyUserOtp = async ({ email, phone, code }) => {
  const user = await findUserByEmailOrPhone({ email, phone });

  if (!user) {
    const error = new Error('Account not found');
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
  issueOtpToUser,
  issuePhoneOtpToUser,
  verifyUserOtp,
};
