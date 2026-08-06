const RESERVED_BRAND_SLUGS = new Set([
  'www',
  'api',
  'admin',
  'app',
  'mail',
  'ftp',
  'cdn',
  'static',
  'assets',
  'localhost',
  'organizer',
  'organizers',
  'trip',
  'trips',
  'booking',
  'bookings',
  'auth',
  'dashboard',
  'support',
  'help',
  'status',
]);

/**
 * Normalize and validate a public-page brand slug (subdomain).
 * Accepts values like "your-brand" → used as your-brand.localhost:3000
 */
const normalizeBrandSlug = (value) => {
  if (value === undefined || value === null || !String(value).trim()) {
    const error = new Error('Public page slug is required');
    error.statusCode = 400;
    throw error;
  }

  const slug = String(value).trim().toLowerCase();

  if (slug.length < 2 || slug.length > 63) {
    const error = new Error('Public page slug must be between 2 and 63 characters');
    error.statusCode = 400;
    throw error;
  }

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    const error = new Error(
      'Public page slug can only use lowercase letters, numbers, and hyphens (no leading/trailing hyphen)'
    );
    error.statusCode = 400;
    throw error;
  }

  if (RESERVED_BRAND_SLUGS.has(slug)) {
    const error = new Error('This public page slug is reserved. Please choose another.');
    error.statusCode = 400;
    throw error;
  }

  return slug;
};

module.exports = {
  normalizeBrandSlug,
  RESERVED_BRAND_SLUGS,
};
