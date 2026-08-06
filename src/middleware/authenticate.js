const jwt = require('jsonwebtoken');
const RevokedToken = require('../models/RevokedToken');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
    });
  }

  const token = authHeader.split(' ')[1];
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return res.status(500).json({
      success: false,
      message: 'Server authentication is not configured',
    });
  }

  try {
    const decoded = jwt.verify(token, secret);

    if (decoded.jti) {
      const revoked = await RevokedToken.findOne({ jti: decoded.jti }).select('_id');

      if (revoked) {
        return res.status(401).json({
          success: false,
          message: 'Session expired. Please sign in again',
        });
      }
    }

    req.user = decoded;
    req.token = token;
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    });
  }
};

module.exports = authenticate;
