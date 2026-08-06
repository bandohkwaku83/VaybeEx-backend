/**
 * Traveler profiles need a full name + Ghana phone for bookings/SMS/MoMo.
 * Google supplies email (+ usually name) but not phone — gate on this flag.
 */
const isTravelerProfileComplete = (user) => {
  if (!user) return false;
  return Boolean(user.fullName?.trim() && user.phone);
};

module.exports = {
  isTravelerProfileComplete,
};
