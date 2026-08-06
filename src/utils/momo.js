const { normalizeGhanaPhone, maskPhone } = require('./phone');

/** Supported Ghana mobile-money networks for organizer withdrawals. */
const MOMO_PROVIDERS = {
  mtn: { code: 'mtn', label: 'MTN MoMo', paystackBankCode: 'MTN' },
  vodafone: { code: 'vodafone', label: 'Vodafone Cash', paystackBankCode: 'VOD' },
  airteltigo: { code: 'airteltigo', label: 'AirtelTigo Money', paystackBankCode: 'ATL' },
};

/** Statuses that lock funds against further withdrawals. */
const FUNDS_LOCKED_STATUSES = ['pending', 'processing', 'success'];

const normalizeMomoProvider = (provider) => {
  const raw = String(provider || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');

  if (!raw) {
    const error = new Error('Mobile money provider is required (mtn, vodafone, or airteltigo)');
    error.statusCode = 400;
    throw error;
  }

  if (raw === 'mtn' || raw === 'mtnmomo') return MOMO_PROVIDERS.mtn;
  if (raw === 'vodafone' || raw === 'vod' || raw === 'telecel' || raw === 'vodafonecash') {
    return MOMO_PROVIDERS.vodafone;
  }
  if (
    raw === 'airteltigo' ||
    raw === 'airtel' ||
    raw === 'tigo' ||
    raw === 'atl' ||
    raw === 'airteltigomoney'
  ) {
    return MOMO_PROVIDERS.airteltigo;
  }

  const error = new Error('Mobile money provider must be mtn, vodafone, or airteltigo');
  error.statusCode = 400;
  throw error;
};

/** Paystack Ghana MoMo expects a local 0-prefixed number, e.g. 0244123456. */
const toPaystackAccountNumber = (normalized233) => {
  const digits = String(normalized233 || '').replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) {
    return `0${digits.slice(3)}`;
  }
  if (digits.startsWith('0') && digits.length === 10) return digits;
  if (digits.length === 9) return `0${digits}`;
  return digits;
};

/**
 * Validate + normalize MoMo payout destination for a withdrawal.
 */
const parseMomoDestination = ({ momoProvider, momoNumber, accountName } = {}) => {
  const provider = normalizeMomoProvider(momoProvider);

  let number;
  try {
    number = normalizeGhanaPhone(momoNumber);
  } catch (err) {
    const error = new Error(err.message || 'A valid Ghana mobile money number is required');
    error.statusCode = 400;
    throw error;
  }

  const name =
    accountName != null && String(accountName).trim()
      ? String(accountName).trim().slice(0, 120)
      : undefined;

  const masked = maskPhone(number);
  const destinationLabel = name
    ? `${provider.label} ${masked} (${name})`
    : `${provider.label} ${masked}`;

  return {
    provider: provider.code,
    providerLabel: provider.label,
    paystackBankCode: provider.paystackBankCode,
    number,
    paystackAccountNumber: toPaystackAccountNumber(number),
    accountName: name,
    destinationLabel,
  };
};

module.exports = {
  MOMO_PROVIDERS,
  FUNDS_LOCKED_STATUSES,
  normalizeMomoProvider,
  toPaystackAccountNumber,
  parseMomoDestination,
};
