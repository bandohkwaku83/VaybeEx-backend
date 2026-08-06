const User = require('../models/User');
const RevokedToken = require('../models/RevokedToken');
const { isValidEmail } = require('../utils/userLookup');
const { hashPassword, comparePassword, validatePassword } = require('../utils/password');
const { issueOrganizerOtp, verifyOrganizerOtp } = require('../services/organizerOtpService');
const { signToken } = require('../utils/jwt');

const register = async (req, res, next) => {
  try {
    const { email, password, confirmPassword } = req.body;

    if (!email?.trim() || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and confirm password are required',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({
        success: false,
        message: passwordError,
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });

    if (existing?.isVerified && existing.role === 'organizer') {
      return res.status(409).json({
        success: false,
        message: 'An organizer account with this email already exists. Please sign in instead',
      });
    }

    if (existing?.isVerified) {
      return res.status(409).json({
        success: false,
        message: `This email is already registered as a ${existing.role} account. Use a different email or sign in to that account`,
      });
    }

    const passwordHash = await hashPassword(password);

    let user = existing;

    if (user) {
      if (user.role !== 'organizer') {
        return res.status(409).json({
          success: false,
          message: `This email is already registered as a ${user.role} account. Use a different email`,
        });
      }
      user.passwordHash = passwordHash;
    } else {
      user = await User.create({
        email: normalizedEmail,
        passwordHash,
        role: 'organizer',
        authProvider: 'email',
      });
    }

    const otpMeta = await issueOrganizerOtp(user);

    res.status(201).json({
      success: true,
      message: 'Verification code sent to your email',
      data: {
        email: user.email,
        ...otpMeta,
      },
    });
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail, role: 'organizer' });

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

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before signing in',
        data: { email: user.email, requiresVerification: true },
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

const verifyOtp = async (req, res, next) => {
  try {
    const { email, code } = req.body;

    if (!email?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    if (!code?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Verification code is required',
      });
    }

    const user = await verifyOrganizerOtp({ email, code: code.trim() });
    const token = signToken(user);

    res.json({
      success: true,
      message: 'Email verified successfully',
      data: {
        user: user.toPublicJSON(),
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

const resendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail, role: 'organizer' });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No organizer account found',
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified',
      });
    }

    const otpMeta = await issueOrganizerOtp(user);

    res.json({
      success: true,
      message: 'Verification code resent to your email',
      data: {
        email: user.email,
        ...otpMeta,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user || user.role !== 'organizer') {
      return res.status(404).json({
        success: false,
        message: 'Organizer account not found',
      });
    }

    res.json({
      success: true,
      data: user.toPublicJSON(),
    });
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    const { jti, userId, exp } = req.user;

    if (jti && exp) {
      await RevokedToken.findOneAndUpdate(
        { jti },
        {
          jti,
          userId,
          expiresAt: new Date(exp * 1000),
        },
        { upsert: true, new: true }
      );
    }

    res.json({
      success: true,
      message: 'Signed out successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /organizer/auth/password
 * Body: { currentPassword, newPassword, confirmNewPassword }
 */
const updatePassword = async (req, res, next) => {
  try {
    const {
      currentPassword,
      newPassword,
      confirmNewPassword,
      confirmPassword,
    } = req.body || {};

    const confirm = confirmNewPassword ?? confirmPassword;

    if (!currentPassword || !newPassword || !confirm) {
      return res.status(400).json({
        success: false,
        message: 'Current password, new password, and confirm new password are required',
      });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({
        success: false,
        message: passwordError,
      });
    }

    if (newPassword !== confirm) {
      return res.status(400).json({
        success: false,
        message: 'New passwords do not match',
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from your current password',
      });
    }

    const user = await User.findById(req.user.userId);

    if (!user || user.role !== 'organizer') {
      return res.status(404).json({
        success: false,
        message: 'Organizer account not found',
      });
    }

    if (!user.passwordHash) {
      return res.status(400).json({
        success: false,
        message: 'This account does not use a password. Sign in with your original method',
      });
    }

    const currentMatch = await comparePassword(currentPassword, user.passwordHash);
    if (!currentMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    user.passwordHash = await hashPassword(newPassword);
    await user.save();

    res.json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  verifyOtp,
  resendOtp,
  updatePassword,
  getMe,
  logout,
};
