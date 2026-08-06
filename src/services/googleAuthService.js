const { OAuth2Client } = require('google-auth-library');

let client;

const getAudience = () => {
  const ids = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    ...(process.env.GOOGLE_CLIENT_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  ].filter(Boolean);

  return [...new Set(ids)];
};

const getClient = () => {
  if (!client) {
    const audience = getAudience();
    if (!audience.length) {
      const error = new Error('Google Sign-In is not configured (missing GOOGLE_CLIENT_ID)');
      error.statusCode = 500;
      throw error;
    }
    client = new OAuth2Client(audience[0]);
  }
  return client;
};

/**
 * Verify a Google ID token from the client and return profile claims.
 * @param {string} idToken
 * @returns {Promise<{ googleId: string, email: string, fullName: string, emailVerified: boolean, picture?: string }>}
 */
const verifyGoogleIdToken = async (idToken) => {
  if (!idToken?.trim()) {
    const error = new Error('Google ID token is required');
    error.statusCode = 400;
    throw error;
  }

  const audience = getAudience();

  if (!audience.length) {
    const error = new Error('Google Sign-In is not configured (missing GOOGLE_CLIENT_ID)');
    error.statusCode = 500;
    throw error;
  }

  let ticket;

  try {
    ticket = await getClient().verifyIdToken({
      idToken: idToken.trim(),
      audience,
    });
  } catch {
    const error = new Error('Invalid or expired Google sign-in token');
    error.statusCode = 401;
    throw error;
  }

  const payload = ticket.getPayload();

  if (!payload?.sub || !payload?.email) {
    const error = new Error('Google account did not return a verified email');
    error.statusCode = 400;
    throw error;
  }

  if (payload.email_verified === false) {
    const error = new Error('Google email is not verified. Use another account or sign up with email');
    error.statusCode = 400;
    throw error;
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase().trim(),
    fullName: (payload.name || '').trim(),
    emailVerified: true,
    picture: payload.picture || undefined,
  };
};

module.exports = {
  verifyGoogleIdToken,
  getAudience,
};
