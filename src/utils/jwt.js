const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/** Default session lengths by role (overridable via env). */
const DEFAULT_EXPIRES = {
  traveler: '7d',
  organizer: '12h',
  admin: '8h',
};

/**
 * Resolve JWT lifetime for a role.
 * Travelers stay longer for booking convenience; organizer/admin are shorter for safety.
 */
const getExpiresInForRole = (role) => {
  const normalized = String(role || '')
    .toLowerCase()
    .trim();

  if (normalized === 'admin') {
    return process.env.JWT_ADMIN_EXPIRES_IN || DEFAULT_EXPIRES.admin;
  }
  if (normalized === 'organizer') {
    return process.env.JWT_ORGANIZER_EXPIRES_IN || DEFAULT_EXPIRES.organizer;
  }
  // traveler + unknown → general traveler lifetime
  return process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES.traveler;
};

const signToken = (user) => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET is not defined in environment variables');
  }

  const role = user.role || 'traveler';
  const expiresIn = getExpiresInForRole(role);

  return jwt.sign(
    {
      userId: user._id.toString(),
      email: user.email,
      role,
    },
    secret,
    {
      expiresIn,
      jwtid: crypto.randomUUID(),
    }
  );
};

const decodeToken = (token) => jwt.decode(token);

module.exports = {
  signToken,
  decodeToken,
  getExpiresInForRole,
  DEFAULT_EXPIRES,
};
