const ARKESEL_SMS_URL = 'https://sms.arkesel.com/api/v2/sms/send';

const sendSms = async (phone, message) => {
  const apiKey = process.env.ARKESEL_API_KEY;
  const senderId = process.env.ARKESEL_SENDER_ID;

  if (!apiKey || !senderId) {
    console.log(`[DEV SMS -> ${phone}] ${message}`);
    return { dev: true, message: 'SMS logged to console (Arkesel not configured)' };
  }

  const response = await fetch(ARKESEL_SMS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: senderId,
      message,
      recipients: [phone],
      sandbox: process.env.ARKESEL_SANDBOX === 'true',
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMessage = data.message || data.error || 'Failed to send SMS';
    throw new Error(errorMessage);
  }

  return data;
};

const sendOtpSms = async (phone, code) => {
  const expiryMinutes = process.env.OTP_EXPIRY_MINUTES || 10;
  const message = `Your VaybeEx verification code is ${code}. It expires in ${expiryMinutes} minutes. Do not share this code.`;
  return sendSms(phone, message);
};

const sendPaymentConfirmationSms = async (phone, message) => sendSms(phone, message);

module.exports = {
  sendSms,
  sendOtpSms,
  sendPaymentConfirmationSms,
};
