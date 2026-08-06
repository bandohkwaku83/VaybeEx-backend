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
