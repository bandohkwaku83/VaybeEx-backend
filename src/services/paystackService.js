const crypto = require('crypto');

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

const getSecretKey = () => {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    const error = new Error('Paystack is not configured on the server');
    error.statusCode = 500;
    throw error;
  }
  return key;
};

const getPublicKey = () => {
  const key = process.env.PAYSTACK_PUBLIC_KEY;
  if (!key) {
    const error = new Error('Paystack public key is not configured on the server');
    error.statusCode = 500;
    throw error;
  }
  return key;
};

const paystackRequest = async (path, options = {}) => {
  let response;
  try {
    response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch (networkError) {
    const error = new Error('Unable to reach Paystack. Please try again.');
    error.statusCode = 502;
    error.cause = networkError;
    throw error;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    const error = new Error('Invalid response from Paystack');
    error.statusCode = 502;
    throw error;
  }

  if (!response.ok || !data.status) {
    const error = new Error(data.message || 'Paystack request failed');
    error.statusCode = response.status >= 400 && response.status < 500 ? 400 : 502;
    error.paystackCode = data.code;
    throw error;
  }

  return data.data;
};

/** Convert GHS major units to pesewas (Paystack minor units). */
const toMinorUnit = (amountGhs) => Math.round(Number(amountGhs) * 100);

/** Convert Paystack pesewas back to GHS. */
const fromMinorUnit = (amountPesewas) => Number(amountPesewas) / 100;

const initializeTransaction = async ({
  email,
  amountGhs,
  reference,
  callbackUrl,
  metadata = {},
  currency = 'GHS',
}) => {
  if (!email) {
    const error = new Error('Customer email is required for payment');
    error.statusCode = 400;
    throw error;
  }

  const amount = toMinorUnit(amountGhs);
  if (!Number.isFinite(amount) || amount < 100) {
    const error = new Error('Payment amount must be at least GHS 1.00');
    error.statusCode = 400;
    throw error;
  }

  return paystackRequest('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email,
      amount,
      reference,
      currency,
      callback_url: callbackUrl,
      metadata: {
        ...metadata,
        custom_fields: [
          ...(metadata.bookingId
            ? [
                {
                  display_name: 'Booking ID',
                  variable_name: 'booking_id',
                  value: String(metadata.bookingId),
                },
              ]
            : []),
        ],
      },
    }),
  });
};

const verifyTransaction = async (reference) => {
  if (!reference?.trim()) {
    const error = new Error('Payment reference is required');
    error.statusCode = 400;
    throw error;
  }

  return paystackRequest(`/transaction/verify/${encodeURIComponent(reference.trim())}`, {
    method: 'GET',
  });
};

/**
 * Validate Paystack webhook HMAC signature (sha512).
 * @param {Buffer|string} rawBody
 * @param {string} signatureHeader x-paystack-signature
 */
const verifyWebhookSignature = (rawBody, signatureHeader) => {
  const secret = getSecretKey();
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    return false;
  }

  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  const hash = crypto.createHmac('sha512', secret).update(payload).digest('hex');

  try {
    const expected = Buffer.from(hash, 'utf8');
    const received = Buffer.from(signatureHeader, 'utf8');
    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(expected, received);
  } catch {
    return false;
  }
};

/**
 * Map Paystack channel (+ auth metadata) to organizer-facing payment method labels.
 */
const mapPaystackChannelToMethod = (channel, authorization = {}) => {
  const raw = String(channel || '').toLowerCase().trim();
  if (!raw) return null;

  if (raw === 'card') return 'Card';
  if (raw === 'bank' || raw === 'bank_transfer') return 'Bank Transfer';
  if (raw === 'ussd') return 'USSD';
  if (raw === 'qr') return 'QR';
  if (raw === 'eft') return 'EFT';

  if (raw === 'mobile_money') {
    const provider = String(
      authorization.bank || authorization.brand || authorization.mobile_money_provider || ''
    )
      .toUpperCase()
      .replace(/[\s_-]+/g, '');

    if (provider.includes('MTN')) return 'MTN MoMo';
    if (provider.includes('VODAFONE') || provider.includes('TELECEL')) return 'Vodafone Cash';
    if (provider.includes('AIRTEL') || provider.includes('TIGO')) return 'AirtelTigo Money';
    return 'Mobile Money';
  }

  return String(channel)
    .split(/[_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

/**
 * Ensure verified Paystack charge matches the expected checkout amount.
 * @param {object} [options]
 * @param {number} [options.expectedAmountGhs] - defaults to booking.pricing.amountDueNow
 */
const assertPaymentMatchesBooking = (paystackData, booking, options = {}) => {
  if (!paystackData || paystackData.status !== 'success') {
    const error = new Error('Payment was not successful');
    error.statusCode = 400;
    throw error;
  }

  const expectedCurrency = (booking.pricing?.currency || 'GHS').toUpperCase();
  const paidCurrency = String(paystackData.currency || '').toUpperCase();
  if (paidCurrency && paidCurrency !== expectedCurrency) {
    const error = new Error(
      `Payment currency mismatch. Expected ${expectedCurrency}, got ${paidCurrency}`
    );
    error.statusCode = 400;
    throw error;
  }

  const expectedGhs =
    options.expectedAmountGhs != null
      ? Number(options.expectedAmountGhs)
      : Number(booking.pricing.amountDueNow);
  const expectedPesewas = toMinorUnit(expectedGhs);
  const paidPesewas = Number(paystackData.amount);
  if (!Number.isFinite(paidPesewas) || paidPesewas < expectedPesewas) {
    const error = new Error(
      `Payment amount mismatch. Expected GHS ${(expectedPesewas / 100).toFixed(2)}, got GHS ${(paidPesewas / 100).toFixed(2)}`
    );
    error.statusCode = 400;
    throw error;
  }

  const channel = paystackData.channel || null;
  const authorization = paystackData.authorization || {};

  return {
    amountPaid: fromMinorUnit(paidPesewas),
    paidAt: new Date(paystackData.paid_at || Date.now()),
    channel,
    paymentMethod: mapPaystackChannelToMethod(channel, authorization),
    reference: paystackData.reference || null,
    gatewayResponse: paystackData.gateway_response,
  };
};

/**
 * Create a Ghana Mobile Money transfer recipient on Paystack.
 * @see https://paystack.com/docs/transfers/creating-transfer-recipients/
 */
const createTransferRecipient = async ({
  name,
  accountNumber,
  bankCode,
  currency = 'GHS',
  metadata = {},
}) => {
  if (!name?.trim()) {
    const error = new Error('Recipient name is required for mobile money transfer');
    error.statusCode = 400;
    throw error;
  }
  if (!accountNumber?.trim()) {
    const error = new Error('Mobile money number is required for transfer');
    error.statusCode = 400;
    throw error;
  }
  if (!bankCode?.trim()) {
    const error = new Error('Mobile money network code is required for transfer');
    error.statusCode = 400;
    throw error;
  }

  return paystackRequest('/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({
      type: 'mobile_money',
      name: name.trim(),
      account_number: accountNumber.trim(),
      bank_code: bankCode.trim().toUpperCase(),
      currency,
      metadata,
    }),
  });
};

/**
 * Initiate a transfer from the Paystack balance to a recipient.
 * @see https://paystack.com/docs/transfers/single-transfers/
 */
const initiateTransfer = async ({
  amountGhs,
  recipientCode,
  reference,
  reason,
  currency = 'GHS',
}) => {
  if (!recipientCode?.trim()) {
    const error = new Error('Paystack recipient code is required');
    error.statusCode = 400;
    throw error;
  }
  if (!reference?.trim()) {
    const error = new Error('Transfer reference is required');
    error.statusCode = 400;
    throw error;
  }

  const amount = toMinorUnit(amountGhs);
  if (!Number.isFinite(amount) || amount < 100) {
    const error = new Error('Transfer amount must be at least GHS 1.00');
    error.statusCode = 400;
    throw error;
  }

  return paystackRequest('/transfer', {
    method: 'POST',
    body: JSON.stringify({
      source: 'balance',
      amount,
      recipient: recipientCode.trim(),
      reference: reference.trim(),
      reason: reason || 'Organizer withdrawal',
      currency,
    }),
  });
};

/**
 * Fetch a transfer by Paystack reference or transfer code.
 */
const fetchTransfer = async (idOrCode) => {
  if (!idOrCode?.trim()) {
    const error = new Error('Transfer reference or code is required');
    error.statusCode = 400;
    throw error;
  }
  return paystackRequest(`/transfer/${encodeURIComponent(idOrCode.trim())}`, {
    method: 'GET',
  });
};

/**
 * Create a Paystack refund back to the original payment method.
 * @see https://paystack.com/docs/payments/refunds/
 * @param {object} opts
 * @param {string|number} opts.transaction - Paystack transaction reference or id
 * @param {number} [opts.amountGhs] - partial refund in GHS; omit for full transaction refund
 * @param {string} [opts.currency]
 * @param {string} [opts.customerNote]
 * @param {string} [opts.merchantNote]
 */
const createRefund = async ({
  transaction,
  amountGhs,
  currency = 'GHS',
  customerNote,
  merchantNote,
}) => {
  if (transaction == null || String(transaction).trim() === '') {
    const error = new Error('Payment reference is required to issue a refund');
    error.statusCode = 400;
    throw error;
  }

  const body = {
    transaction: String(transaction).trim(),
    currency,
  };

  if (amountGhs != null && amountGhs !== '') {
    const amount = toMinorUnit(amountGhs);
    if (!Number.isFinite(amount) || amount < 1) {
      const error = new Error('Refund amount must be greater than 0');
      error.statusCode = 400;
      throw error;
    }
    body.amount = amount;
  }

  if (customerNote) body.customer_note = String(customerNote).slice(0, 500);
  if (merchantNote) body.merchant_note = String(merchantNote).slice(0, 500);

  return paystackRequest('/refund', {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

module.exports = {
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
  assertPaymentMatchesBooking,
  mapPaystackChannelToMethod,
  createTransferRecipient,
  initiateTransfer,
  fetchTransfer,
  createRefund,
  getPublicKey,
  getSecretKey,
  toMinorUnit,
  fromMinorUnit,
};
