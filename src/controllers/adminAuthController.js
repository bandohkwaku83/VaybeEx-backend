const User = require('../models/User');
const { isValidEmail } = require('../utils/userLookup');
const { comparePassword } = require('../utils/password');
const { signToken } = require('../utils/jwt');

/**
 * Admin sign-in (email + password). User must have role `admin`.
 * Create admins in the DB (no public register endpoint).
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (!email?.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      role: 'admin',
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const passwordMatch = await comparePassword(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const token = signToken(user);

    res.json({
      success: true,
      message: 'Signed in successfully',
      data: {
        user: user.toPublicJSON(),
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

const me = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || user.role !== 'admin') {
      return res.status(404).json({
        success: false,
        message: 'Admin not found',
      });
    }

    res.json({
      success: true,
      message: 'Admin profile retrieved',
      data: { user: user.toPublicJSON() },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  login,
  me,
};
