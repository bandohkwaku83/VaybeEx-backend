const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

const hashPassword = async (password) => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

const comparePassword = async (password, hash) => {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
};

const validatePassword = (password) => {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
};

module.exports = {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  comparePassword,
  validatePassword,
};
