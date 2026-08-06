const User = require('../models/User');
const { normalizeGhanaPhone } = require('../utils/phone');
const { normalizeBrandSlug } = require('../utils/brandSlug');
const { toUploadUrl, getUploadedFile } = require('../middleware/upload');
const { sendOrganizerPendingReviewEmail } = require('../services/emailService');
const {
  TRIP_SPECIALTIES,
  TRIP_SPECIALTY_LABELS,
  parseTripSpecialties,
} = require('../constants/tripSpecialties');

const getProfileOptions = async (_req, res) => {
  const options = TRIP_SPECIALTIES.map((value) => ({
    value,
    label: TRIP_SPECIALTY_LABELS[value] || value,
  }));

  res.json({
    success: true,
    data: {
      /** Selectable list for organizer profile specialties and create-trip category. */
      tripSpecialties: options,
      /** Alias for create-trip form category dropdown (same values as tripSpecialties). */
      categories: options,
    },
  });
};

const completeSetup = async (req, res, next) => {
  try {
    const {
      fullName,
      location,
      phone,
      whatsapp,
      businessName,
      brandSlug,
      aboutYou,
      tripSpecialties,
    } = req.body;

    const profileFile = getUploadedFile(req.files, 'profilePhoto');
    const brandLogoFile = getUploadedFile(req.files, 'brandLogo');
    const nationalIdFile = getUploadedFile(req.files, 'nationalIdPhoto');

    if (!fullName?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Full name is required',
      });
    }

    if (!location?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Location is required',
      });
    }

    if (!phone?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
      });
    }

    if (!businessName?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Business or brand name is required',
      });
    }

    if (!aboutYou?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'About you is required',
      });
    }

    if (!profileFile) {
      return res.status(400).json({
        success: false,
        message: 'Profile photo is required (JPG or PNG, max 5 MB)',
      });
    }

    if (!nationalIdFile) {
      return res.status(400).json({
        success: false,
        message: 'National ID photo is required (JPG or PNG, max 5 MB)',
      });
    }

    let normalizedPhone;
    let normalizedWhatsapp;
    let normalizedBrandSlug;
    let specialties;

    try {
      normalizedPhone = normalizeGhanaPhone(phone);
      if (whatsapp?.trim()) {
        normalizedWhatsapp = normalizeGhanaPhone(whatsapp);
      }
      normalizedBrandSlug = normalizeBrandSlug(brandSlug);
      specialties = parseTripSpecialties(tripSpecialties);
    } catch (error) {
      return res.status(error.statusCode || 400).json({
        success: false,
        message: error.message,
      });
    }

    const user = await User.findById(req.user.userId);

    if (!user || user.role !== 'organizer') {
      return res.status(404).json({
        success: false,
        message: 'Organizer account not found',
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before completing setup',
      });
    }

    const phoneConflict = await User.findOne({
      phone: normalizedPhone,
      _id: { $ne: user._id },
    });

    if (phoneConflict) {
      return res.status(409).json({
        success: false,
        message: 'This phone number is already in use',
      });
    }

    const slugConflict = await User.findOne({
      brandSlug: normalizedBrandSlug,
      _id: { $ne: user._id },
    });

    if (slugConflict) {
      return res.status(409).json({
        success: false,
        message: 'This public page slug is already taken',
      });
    }

    user.fullName = fullName.trim();
    user.location = location.trim();
    user.phone = normalizedPhone;
    user.whatsapp = normalizedWhatsapp;
    user.businessName = businessName.trim();
    user.brandSlug = normalizedBrandSlug;
    user.aboutYou = aboutYou.trim();
    user.tripSpecialties = specialties;
    user.profilePhoto = toUploadUrl(profileFile.path);
    if (brandLogoFile) {
      user.brandLogo = toUploadUrl(brandLogoFile.path);
    }
    user.nationalIdPhoto = toUploadUrl(nationalIdFile.path);
    user.onboardingCompleted = true;
    // Admin must approve before the organizer can publish / manage trips.
    user.status = 'pending';
    user.rejectionReason = undefined;
    user.reviewedAt = undefined;
    user.reviewedBy = undefined;

    await user.save();

    if (user.email) {
      sendOrganizerPendingReviewEmail({
        email: user.email,
        fullName: user.fullName,
        businessName: user.businessName,
      }).catch((error) => {
        console.error(`[ORGANIZER PENDING EMAIL FAILED] ${error.message}`);
      });
    }

    res.json({
      success: true,
      message:
        'Setup complete. Your profile is pending verification — we’ll email you when it’s approved.',
      data: user.toPublicJSON(),
    });
  } catch (error) {
    next(error);
  }
};

/** Identity / KYC fields set during setup — not editable after verification. */
const LOCKED_PROFILE_FIELDS = [
  'email',
  'phone',
  'businessName',
  'brandSlug',
  'nationalIdPhoto',
];

const updateProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user || user.role !== 'organizer') {
      return res.status(404).json({
        success: false,
        message: 'Organizer account not found',
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before updating your profile',
      });
    }

    if (!user.onboardingCompleted) {
      return res.status(403).json({
        success: false,
        message: 'Please complete your organizer profile setup first',
      });
    }

    if (user.status !== 'approved') {
      const pendingMessage =
        user.status === 'pending'
          ? 'Your organizer profile is still under review. We’ll email you when it’s approved.'
          : user.status === 'rejected'
            ? 'Your organizer application was not approved. Contact support if you need help.'
            : 'Your organizer account is not approved yet.';

      return res.status(403).json({
        success: false,
        message: pendingMessage,
      });
    }

    const attemptedLocked = LOCKED_PROFILE_FIELDS.filter(
      (field) => req.body[field] !== undefined
    );

    if (attemptedLocked.length > 0) {
      return res.status(400).json({
        success: false,
        message: `These fields cannot be changed on a verified organizer account: ${attemptedLocked.join(', ')}. Contact support if you need to update them.`,
      });
    }

    const { fullName, location, whatsapp, aboutYou, tripSpecialties } = req.body;

    if (fullName !== undefined) {
      if (!fullName?.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Full name cannot be empty',
        });
      }
      user.fullName = fullName.trim();
    }

    if (location !== undefined) {
      if (!location?.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Location cannot be empty',
        });
      }
      user.location = location.trim();
    }

    if (aboutYou !== undefined) {
      if (!aboutYou?.trim()) {
        return res.status(400).json({
          success: false,
          message: 'About you cannot be empty',
        });
      }
      user.aboutYou = aboutYou.trim();
    }

    if (tripSpecialties !== undefined) {
      try {
        user.tripSpecialties = parseTripSpecialties(tripSpecialties);
      } catch (error) {
        return res.status(error.statusCode || 400).json({
          success: false,
          message: error.message,
        });
      }
    }

    const profileFile = getUploadedFile(req.files, 'profilePhoto') || req.file;
    const brandLogoFile = getUploadedFile(req.files, 'brandLogo');

    if (profileFile) {
      user.profilePhoto = toUploadUrl(profileFile.path);
    }

    if (brandLogoFile) {
      user.brandLogo = toUploadUrl(brandLogoFile.path);
    }

    if (whatsapp !== undefined) {
      if (whatsapp?.trim()) {
        try {
          user.whatsapp = normalizeGhanaPhone(whatsapp);
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: error.message,
          });
        }
      } else {
        user.whatsapp = undefined;
      }
    }

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: user.toPublicJSON(),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProfileOptions,
  completeSetup,
  updateProfile,
};
