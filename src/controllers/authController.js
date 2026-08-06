const User = require('../models/User');
const RevokedToken = require('../models/RevokedToken');
const { normalizeGhanaPhone, maskPhone } = require('../utils/phone');
const { isValidEmail, findUserByEmailOrPhone } = require('../utils/userLookup');
const { issueOtpToUser, issuePhoneOtpToUser, verifyUserOtp } = require('../services/otpService');
const { verifyGoogleIdToken } = require('../services/googleAuthService');
const { isTravelerProfileComplete } = require('../utils/travelerProfile');
const { signToken } = require('../utils/jwt');

const otpResponseData = (user, otpMeta) => ({
  email: user.email,
  phone: maskPhone(user.phone),
  ...otpMeta,
});

const authSuccessPayload = (user, token) => {
  const needsProfile = !isTravelerProfileComplete(user);

  return {
    user: user.toPublicJSON(),
    token,
    needsProfile,
  };
};

const register = async (req, res, next) => {
  try {
    const { fullName, email, phone } = req.body;

    if (!fullName?.trim() || !email?.trim() || !phone?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Full name, email, and phone number are required',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    let normalizedPhone;

    try {
      normalizedPhone = normalizeGhanaPhone(phone);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingByEmail = await User.findOne({ email: normalizedEmail });
    const existingByPhone = await User.findOne({ phone: normalizedPhone });

    if (existingByEmail?.isVerified || (existingByPhone && existingByPhone.email !== normalizedEmail)) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email or phone number already exists',
      });
    }

    let user = existingByEmail;

    if (user) {
      user.fullName = fullName.trim();
      user.phone = normalizedPhone;
    } else {
      user = await User.create({
        fullName: fullName.trim(),
        email: normalizedEmail,
        phone: normalizedPhone,
        role: 'traveler',
        authProvider: 'email',
      });
    }

    const otpMeta = await issueOtpToUser(user);

    res.status(201).json({
      success: true,
      message: 'Verification code sent to your email and phone',
      data: otpResponseData(user, otpMeta),
    });
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, phone } = req.body;

    let user;

    try {
      user = await findUserByEmailOrPhone({ email, phone });
    } catch (error) {
      return res.status(error.statusCode || 400).json({
        success: false,
        message: error.message,
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found. Please create an account first',
      });
    }

    const otpMeta = await issueOtpToUser(user);

    res.json({
      success: true,
      message: 'Verification code sent to your email and phone',
      data: otpResponseData(user, otpMeta),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Sign in / create traveler account with Google.
 * Client sends the Google ID token from Sign in with Google.
 * If phone/full name are missing, returns needsProfile: true — call POST /auth/complete-profile next.
 */
const googleAuth = async (req, res, next) => {
  try {
    const { idToken } = req.body;
    const googleProfile = await verifyGoogleIdToken(idToken);

    let user =
      (await User.findOne({ googleId: googleProfile.googleId })) ||
      (await User.findOne({ email: googleProfile.email }));

    if (user && user.role !== 'traveler') {
      return res.status(409).json({
        success: false,
        message: 'This email is already registered as an organizer or admin account',
      });
    }

    if (!user) {
      user = await User.create({
        fullName: googleProfile.fullName || '',
        email: googleProfile.email,
        googleId: googleProfile.googleId,
        authProvider: 'google',
        role: 'traveler',
        isVerified: true,
        ...(googleProfile.picture ? { profilePhoto: googleProfile.picture } : {}),
      });
    } else {
      let dirty = false;

      if (!user.googleId) {
        user.googleId = googleProfile.googleId;
        dirty = true;
      }

      if (user.authProvider !== 'google') {
        user.authProvider = 'google';
        dirty = true;
      }

      if (!user.fullName?.trim() && googleProfile.fullName) {
        user.fullName = googleProfile.fullName;
        dirty = true;
      }

      if (!user.profilePhoto && googleProfile.picture) {
        user.profilePhoto = googleProfile.picture;
        dirty = true;
      }

      // Email from Google is trusted. Phone ownership is confirmed in complete-profile via SMS OTP.
      if (!user.isVerified) {
        user.isVerified = true;
        dirty = true;
      }

      if (dirty) {
        await user.save();
      }
    }

    const token = signToken(user);
    const needsProfile = !isTravelerProfileComplete(user);

    res.json({
      success: true,
      message: needsProfile
        ? 'Signed in with Google. Please complete your profile'
        : 'Signed in with Google successfully',
      data: authSuccessPayload(user, token),
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * After Google sign-in: save full name + Ghana phone, then SMS OTP to confirm the number.
 * Client should then call POST /auth/verify-otp with { phone, code }.
 */
const completeProfile = async (req, res, next) => {
  try {
    if (req.user.role !== 'traveler') {
      return res.status(403).json({
        success: false,
        message: 'Profile completion is for traveler accounts only',
      });
    }

    const { fullName, phone } = req.body;
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const nextFullName = (fullName?.trim() || user.fullName || '').trim();

    if (!nextFullName) {
      return res.status(400).json({
        success: false,
        message: 'Full name is required',
      });
    }

    if (!phone?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
      });
    }

    let normalizedPhone;

    try {
      normalizedPhone = normalizeGhanaPhone(phone);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    const phoneOwner = await User.findOne({ phone: normalizedPhone });

    if (phoneOwner && phoneOwner._id.toString() !== user._id.toString()) {
      return res.status(409).json({
        success: false,
        message: 'An account with this phone number already exists',
      });
    }

    user.fullName = nextFullName;
    user.phone = normalizedPhone;

    // Phone ownership must be confirmed via SMS OTP before the session is fully trusted.
    user.isVerified = false;
    await user.save();

    const otpMeta = await issuePhoneOtpToUser(user);

    res.json({
      success: true,
      message: 'Profile saved. Verification code sent to your phone',
      data: {
        ...otpResponseData(user, otpMeta),
        user: user.toPublicJSON(),
        needsProfile: false,
        needsPhoneVerification: true,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

const verifyOtp = async (req, res, next) => {
  try {
    const { email, phone, code } = req.body;

    if (!code?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Verification code is required',
      });
    }

    if (!email?.trim() && !phone?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Email or phone number is required',
      });
    }

    const user = await verifyUserOtp({ email, phone, code: code.trim() });
    const token = signToken(user);

    res.json({
      success: true,
      message: 'Verification successful',
      data: authSuccessPayload(user, token),
    });
  } catch (error) {
    next(error);
  }
};

const resendOtp = async (req, res, next) => {
  try {
    const { email, phone } = req.body;

    let user;

    try {
      user = await findUserByEmailOrPhone({ email, phone });
    } catch (error) {
      return res.status(error.statusCode || 400).json({
        success: false,
        message: error.message,
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found',
      });
    }

    // Google profile completion only needs SMS; email/OTP path keeps both channels.
    const otpMeta =
      user.authProvider === 'google' && phone?.trim()
        ? await issuePhoneOtpToUser(user)
        : await issueOtpToUser(user);

    res.json({
      success: true,
      message:
        user.authProvider === 'google' && phone?.trim()
          ? 'Verification code resent to your phone'
          : 'Verification code resent to your email and phone',
      data: otpResponseData(user, otpMeta),
    });
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
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
    if (req.user.role !== 'traveler') {
      return res.status(403).json({
        success: false,
        message: 'This sign out endpoint is for traveler accounts only',
      });
    }

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

module.exports = {
  register,
  login,
  googleAuth,
  completeProfile,
  verifyOtp,
  resendOtp,
  getMe,
  logout,
};
