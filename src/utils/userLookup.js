const User = require('../models/User');
const { normalizeGhanaPhone } = require('./phone');

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const parseEmailOrPhone = (body) => {
  const email = body.email?.trim() || null;
  const phone = body.phone?.trim() || null;

  if (!email && !phone) {
    const error = new Error('Email or phone number is required');
    error.statusCode = 400;
    throw error;
  }

  if (email && phone) {
    const error = new Error('Provide either email or phone number, not both');
    error.statusCode = 400;
    throw error;
  }

  if (email) {
    if (!isValidEmail(email)) {
      const error = new Error('Please provide a valid email address');
      error.statusCode = 400;
      throw error;
    }

    return { type: 'email', value: email.toLowerCase() };
  }

  try {
    return { type: 'phone', value: normalizeGhanaPhone(phone) };
  } catch (error) {
    const validationError = new Error(error.message);
    validationError.statusCode = 400;
    throw validationError;
  }
};

const findUserByEmailOrPhone = async ({ email, phone }) => {
  const rawEmail = email?.trim() || null;
  const rawPhone = phone?.trim() || null;

  // Prefer a single identifier. If both are sent (common after Google complete-profile),
  // resolve when they refer to the same traveler.
  if (rawEmail && rawPhone) {
    if (!isValidEmail(rawEmail)) {
      const error = new Error('Please provide a valid email address');
      error.statusCode = 400;
      throw error;
    }

    let normalizedPhone;
    try {
      normalizedPhone = normalizeGhanaPhone(rawPhone);
    } catch (error) {
      const validationError = new Error(error.message);
      validationError.statusCode = 400;
      throw validationError;
    }

    const normalizedEmail = rawEmail.toLowerCase();
    const [byEmail, byPhone] = await Promise.all([
      User.findOne({ email: normalizedEmail }),
      User.findOne({ phone: normalizedPhone }),
    ]);

    if (byEmail && byPhone && byEmail._id.toString() !== byPhone._id.toString()) {
      const error = new Error('Email and phone number belong to different accounts');
      error.statusCode = 400;
      throw error;
    }

    return byPhone || byEmail;
  }

  const identifier = parseEmailOrPhone({ email, phone });

  if (identifier.type === 'email') {
    return User.findOne({ email: identifier.value });
  }

  return User.findOne({ phone: identifier.value });
};

module.exports = {
  isValidEmail,
  parseEmailOrPhone,
  findUserByEmailOrPhone,
};
