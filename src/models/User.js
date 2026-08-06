const mongoose = require('mongoose');
const { isTravelerProfileComplete } = require('../utils/travelerProfile');

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    passwordHash: String,
    role: {
      type: String,
      enum: ['traveler', 'organizer', 'admin'],
      default: 'traveler',
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    authProvider: {
      type: String,
      enum: ['email', 'google'],
      default: 'email',
    },
    googleId: {
      type: String,
      sparse: true,
      unique: true,
    },
    otpHash: String,
    otpExpiresAt: Date,
    lastOtpSentAt: Date,
    profilePhoto: String,
    brandLogo: String,
    location: String,
    whatsapp: String,
    businessName: String,
    /** Public page subdomain slug, e.g. "your-brand" → your-brand.localhost:3000 */
    brandSlug: {
      type: String,
      trim: true,
      lowercase: true,
    },
    aboutYou: String,
    tripSpecialties: {
      type: [String],
      default: [],
    },
    nationalIdPhoto: String,
    onboardingCompleted: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
    },
    /** Set when an admin rejects an organizer application. */
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    reviewedAt: Date,
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ phone: 1 }, { unique: true, sparse: true });
userSchema.index({ brandSlug: 1 }, { unique: true, sparse: true });

userSchema.methods.toPublicJSON = function toPublicJSON() {
  const base = {
    id: this._id,
    fullName: this.fullName,
    email: this.email,
    phone: this.phone,
    location: this.location || '',
    whatsapp: this.whatsapp || '',
    role: this.role,
    isVerified: this.isVerified,
    authProvider: this.authProvider,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };

  if (this.role === 'organizer') {
    return {
      ...base,
      profilePhoto: this.profilePhoto,
      brandLogo: this.brandLogo,
      businessName: this.businessName,
      brandSlug: this.brandSlug,
      aboutYou: this.aboutYou,
      tripSpecialties: this.tripSpecialties || [],
      nationalIdPhoto: this.nationalIdPhoto,
      onboardingCompleted: this.onboardingCompleted,
      /** KYC review: pending | approved | rejected. null until profile setup is submitted. */
      status: this.status || null,
      rejectionReason: this.rejectionReason || undefined,
      reviewedAt: this.reviewedAt || undefined,
    };
  }

  return {
    ...base,
    needsProfile: !isTravelerProfileComplete(this),
  };
};

module.exports = mongoose.model('User', userSchema);
