const jwt = require('jsonwebtoken');
const RevokedToken = require('../models/RevokedToken');

const optionalAuthenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.split(' ')[1];
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, secret);

    if (decoded.jti) {
      const revoked = await RevokedToken.findOne({ jti: decoded.jti }).select('_id');
      if (revoked) {
        next();
        return;
      }
    }

    req.user = decoded;
    req.token = token;
    next();
  } catch {
    next();
  }
};

module.exports = optionalAuthenticate;
