const crypto = require('crypto');

const OTP_LENGTH = 4;
const OTP_EXPIRY_MINUTES = 10;

const generateOtpCode = () => {
  return crypto.randomInt(1000, 9999).toString();
};

const hashOtp = (code) => {
  const secret = process.env.OTP_SECRET || 'dev-otp-secret';
  return crypto.createHash('sha256').update(`${code}:${secret}`).digest('hex');
};

const verifyOtpHash = (code, hash) => {
  if (!code || !hash) return false;
  const candidate = hashOtp(code);
  if (candidate.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
};

const getOtpExpiryDate = () => {
  return new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
};

module.exports = {
  OTP_LENGTH,
  OTP_EXPIRY_MINUTES,
  generateOtpCode,
  hashOtp,
  verifyOtpHash,
  getOtpExpiryDate,
};
