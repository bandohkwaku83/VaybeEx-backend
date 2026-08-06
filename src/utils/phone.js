const normalizeGhanaPhone = (phone) => {
  if (!phone || typeof phone !== 'string') {
    throw new Error('Phone number is required');
  }

  const digits = phone.replace(/\D/g, '');

  if (digits.startsWith('233') && digits.length === 12) {
    return digits;
  }

  if (digits.startsWith('0') && digits.length === 10) {
    return `233${digits.slice(1)}`;
  }

  if (digits.length === 9) {
    return `233${digits}`;
  }

  throw new Error('Phone number must be a valid Ghana number (e.g. +233 XX XXX XXXX)');
};

const maskPhone = (phone) => {
  if (!phone || phone.length < 6) return phone;
  return `${phone.slice(0, 5)}****${phone.slice(-2)}`;
};

module.exports = {
  normalizeGhanaPhone,
  maskPhone,
};
