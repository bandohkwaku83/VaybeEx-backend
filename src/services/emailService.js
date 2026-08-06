const { Resend } = require('resend');

let resendClient;

const getResendClient = () => {
  const apiKey = process.env.RESEND_API_KEY || process.env.SMTP_PASS;

  if (!apiKey) {
    return null;
  }

  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }

  return resendClient;
};

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatMoney = (amount, currency = 'GHS') =>
  `${currency} ${Number(amount || 0).toFixed(2)}`;

const formatCurrency = (amount, currency = 'GHS') => {
  try {
    return new Intl.NumberFormat('en-GH', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Number(amount) || 0);
  } catch {
    return `GH₵${Math.round(Number(amount) || 0).toLocaleString('en-GH')}`;
  }
};

const formatDate = (date) => {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
};

const formatTripDates = (startDate, endDate) => {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  if (!start && !end) return 'TBD';
  if (!start) return end;
  if (!end || start === end) return start;
  return `${start} – ${end}`;
};

const resolveDurationDays = (startDate, endDate) => {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
};

const paymentStatusLabel = (paymentStatus) => {
  if (paymentStatus === 'fully_paid') return 'Paid in full';
  if (paymentStatus === 'deposit_paid') return 'Deposit paid';
  return 'Payment received';
};

const pricingBadgeLabel = (paymentStatus, balanceDue) => {
  if (paymentStatus === 'fully_paid' || !(balanceDue > 0)) return 'Paid';
  return 'Deposit paid';
};

const BOOKING_TYPE_LABEL = {
  solo: 'Solo',
  couple: 'Couple',
  group: 'Group',
};

const detailRow = (label, valueHtml) => {
  if (!valueHtml) return '';
  return `
    <tr>
      <td style="padding:10px 0;border-top:1px solid rgba(107,63,29,0.08);font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#9c8773;vertical-align:top;width:38%;">
        ${escapeHtml(label)}
      </td>
      <td style="padding:10px 0;border-top:1px solid rgba(107,63,29,0.08);font-size:14px;font-weight:500;color:#2a1b0f;text-align:right;vertical-align:top;">
        ${valueHtml}
      </td>
    </tr>
  `;
};

const moneyRow = (label, amount, currency, { emphasize = false, muted = false } = {}) => {
  if (amount == null || Number(amount) <= 0) return '';
  return `
    <tr>
      <td style="padding:4px 0;font-size:14px;color:${muted ? '#9c8773' : '#6b5544'};">
        ${escapeHtml(label)}
      </td>
      <td style="padding:4px 0;font-size:${emphasize ? '16px' : '14px'};font-weight:${emphasize ? '600' : '500'};color:#2a1b0f;text-align:right;font-variant-numeric:tabular-nums;">
        ${escapeHtml(formatCurrency(amount, currency))}
      </td>
    </tr>
  `;
};

const buildOtpEmailHtml = ({ fullName, code, expiryMinutes }) => {
  const safeName = escapeHtml(fullName || 'there');
  const safeCode = escapeHtml(code);
  const safeExpiry = escapeHtml(expiryMinutes);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your VaybeEx verification code</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#0f766e 0%,#0d9488 55%,#14b8a6 100%);padding:28px 32px;">
              <p style="margin:0;font-size:22px;font-weight:700;letter-spacing:0.3px;color:#ffffff;">VaybeEx</p>
              <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">Verify your account</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827;">Hi ${safeName},</p>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#4b5563;">
                Use the code below to finish signing in. For your security, don’t share it with anyone.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="background-color:#f0fdfa;border:1px solid #99f6e4;border-radius:12px;padding:24px 16px;">
                    <p style="margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:#0f766e;">
                      Verification code
                    </p>
                    <p style="margin:0;font-size:36px;font-weight:700;letter-spacing:10px;color:#134e4a;font-family:'Courier New',Courier,monospace;">
                      ${safeCode}
                    </p>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#6b7280;">
                This code expires in <strong style="color:#111827;">${safeExpiry} minutes</strong>.
              </p>
              <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#9ca3af;">
                If you didn’t request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 24px;border-top:1px solid #f3f4f6;background-color:#fafafa;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;text-align:center;">
                © ${new Date().getFullYear()} VaybeEx · Experiences made simple
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
};

const buildPaymentConfirmationEmailHtml = (payload) => {
  const {
    tripTitle,
    destination,
    coverImageUrl,
    organizerName,
    startDate,
    endDate,
    durationDays,
    meetingPoint,
    bookingType,
    partySize,
    guests = [],
    addOns = [],
    location,
    whatsapp,
    paymentStatus,
    paymentMethod,
    paidAt,
    tripSubtotal,
    addOnsTotal,
    totalAmount,
    amountPaidTotal,
    balanceDue,
    balanceDueDate,
    paymentNote,
    reference,
    currency = 'GHS',
  } = payload;

  const isDeposit = paymentStatus === 'deposit_paid' || (balanceDue != null && balanceDue > 0);
  const badge = pricingBadgeLabel(paymentStatus, balanceDue);
  const statusLabel = paymentStatusLabel(paymentStatus);
  const startLabel = formatDate(startDate) || '—';
  const endLabel = formatDate(endDate) || '—';
  const paidAtLabel = formatDate(paidAt);
  const balanceDueLabel = formatDate(balanceDueDate);

  const partyLabel = bookingType
    ? `${BOOKING_TYPE_LABEL[bookingType] || bookingType}${partySize ? ` · ${partySize}` : ''}`
    : partySize
      ? `${partySize} ${partySize === 1 ? 'traveler' : 'travelers'}`
      : null;

  const namedGuests = (guests || []).filter((g) => g?.fullName?.trim());
  const travelersHtml =
    namedGuests.length > 0
      ? namedGuests
          .map((g) => {
            const name = escapeHtml(g.fullName);
            return g.isLead
              ? `${name} <span style="font-size:11px;font-weight:400;color:#9c8773;">(lead)</span>`
              : name;
          })
          .join('<br />')
      : partySize
        ? escapeHtml(`${partySize} ${partySize === 1 ? 'traveler' : 'travelers'}`)
        : null;

  const addOnsHtml =
    (addOns || []).length > 0
      ? addOns
          .map((a) => {
            const bits = [escapeHtml(a.name)];
            if (a.perPerson) bits.push('(pp)');
            if (a.quantity > 1) bits.push(`×${a.quantity}`);
            if (typeof a.lineTotal === 'number') {
              bits.push(`· ${escapeHtml(formatCurrency(a.lineTotal, currency))}`);
            }
            return bits.join(' ');
          })
          .join('<br />')
      : null;

  const paymentValueHtml = [
    `<span>${escapeHtml(statusLabel)}</span>`,
    paymentMethod
      ? `<br /><span style="font-size:11px;font-weight:400;color:#9c8773;">via ${escapeHtml(paymentMethod)}</span>`
      : '',
    paidAtLabel
      ? `<br /><span style="font-size:11px;font-weight:400;color:#9c8773;">${escapeHtml(paidAtLabel)}</span>`
      : '',
  ].join('');

  const durationLabel =
    durationDays != null
      ? `${durationDays} ${durationDays === 1 ? 'day' : 'days'}`
      : null;

  const coverBlock = coverImageUrl
    ? `
      <tr>
        <td style="padding:0;position:relative;">
          <img src="${escapeHtml(coverImageUrl)}" alt="${escapeHtml(tripTitle || 'Trip')}" width="520" style="display:block;width:100%;max-height:220px;object-fit:cover;border:0;" />
          <div style="padding:14px 20px 0;">
            <span style="display:inline-block;background:rgba(251,247,241,0.95);color:#c4864c;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:600;">
              ${escapeHtml(isDeposit ? 'Deposit paid' : 'Booking confirmed')}
            </span>
          </div>
          ${
            destination
              ? `<p style="margin:10px 20px 0;font-size:13px;font-weight:500;color:#6b5544;">📍 ${escapeHtml(destination)}</p>`
              : ''
          }
        </td>
      </tr>
    `
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VaybeEx booking receipt</title>
</head>
<body style="margin:0;padding:0;background-color:#f7f1e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f7f1e8;padding:28px 14px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:20px;overflow:hidden;border:1px solid rgba(107,63,29,0.12);">
          ${coverBlock}
          <tr>
            <td style="padding:24px 20px 8px;">
              <h1 style="margin:0;font-size:22px;font-weight:700;line-height:1.3;color:#2a1b0f;">${escapeHtml(tripTitle || 'Trip')}</h1>
              ${
                organizerName
                  ? `<p style="margin:8px 0 0;font-size:14px;color:#6b5544;">Hosted by ${escapeHtml(organizerName)}</p>`
                  : ''
              }

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;background-color:#f2eada;border-radius:12px;">
                <tr>
                  <td style="padding:14px 16px;width:50%;vertical-align:top;">
                    <p style="margin:0;font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#9c8773;"> Starts</p>
                    <p style="margin:6px 0 0;font-size:14px;font-weight:600;color:#2a1b0f;">${escapeHtml(startLabel)}</p>
                  </td>
                  <td style="padding:14px 16px;width:50%;vertical-align:top;border-left:1px solid rgba(107,63,29,0.14);">
                    <p style="margin:0;font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#9c8773;"> Ends</p>
                    <p style="margin:6px 0 0;font-size:14px;font-weight:600;color:#2a1b0f;">${escapeHtml(endLabel)}</p>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
                ${detailRow('Duration', durationLabel ? escapeHtml(durationLabel) : null)}
                ${detailRow('Meeting point', meetingPoint ? escapeHtml(meetingPoint) : null)}
                ${detailRow('Party', partyLabel ? escapeHtml(partyLabel) : null)}
                ${detailRow('Travelers', travelersHtml)}
                ${detailRow('Add-ons', addOnsHtml)}
                ${detailRow('Location', location ? escapeHtml(location) : null)}
                ${detailRow('WhatsApp', whatsapp ? escapeHtml(whatsapp) : null)}
                ${detailRow('Payment', paymentValueHtml)}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 20px;">
              <div style="border-top:1px dashed rgba(107,63,29,0.28);"></div>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 20px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 0 10px;font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#9c8773;">
                    Pricing
                  </td>
                  <td style="padding:0 0 10px;text-align:right;">
                    <span style="display:inline-block;background:rgba(196,134,76,0.14);color:#c4864c;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:600;">
                      ${escapeHtml(badge)}
                    </span>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${moneyRow('Trip', tripSubtotal, currency, { muted: true })}
                ${moneyRow('Add-ons', addOnsTotal, currency, { muted: true })}
                ${moneyRow('Total', totalAmount, currency, { emphasize: true })}
                <tr><td colspan="2" style="padding:8px 0;"><div style="border-top:1px dashed rgba(107,63,29,0.18);"></div></td></tr>
                ${moneyRow(isDeposit ? 'Deposit paid' : 'Amount paid', amountPaidTotal, currency)}
                ${moneyRow(
                  balanceDueLabel ? `Balance due · ${balanceDueLabel}` : 'Balance due',
                  balanceDue,
                  currency,
                  { emphasize: true }
                )}
              </table>

              ${
                paymentNote
                  ? `<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#9c8773;">${escapeHtml(paymentNote)}</p>`
                  : ''
              }

              ${
                reference
                  ? `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;background-color:#f2eada;border-radius:12px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <p style="margin:0;font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#9c8773;">Booking reference</p>
                      <p style="margin:6px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;font-weight:500;color:#2a1b0f;word-break:break-all;">
                        ${escapeHtml(reference)}
                      </p>
                    </td>
                  </tr>
                </table>
              `
                  : ''
              }

              <p style="margin:18px 0 0;text-align:center;font-size:10px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:#9c8773;">
                VaybeEx booking receipt
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
};

const buildPaymentConfirmationText = (payload) => {
  const {
    tripTitle,
    organizerName,
    startDate,
    endDate,
    durationDays,
    bookingType,
    partySize,
    guests = [],
    location,
    whatsapp,
    paymentStatus,
    paymentMethod,
    paidAt,
    totalAmount,
    amountPaidTotal,
    balanceDue,
    balanceDueDate,
    paymentNote,
    reference,
    currency = 'GHS',
  } = payload;

  const lines = [
    tripTitle || 'Trip',
    organizerName ? `Hosted by ${organizerName}` : null,
    '',
    `Starts: ${formatDate(startDate) || '—'}`,
    `Ends: ${formatDate(endDate) || '—'}`,
    durationDays != null ? `Duration: ${durationDays} ${durationDays === 1 ? 'day' : 'days'}` : null,
    bookingType
      ? `Party: ${BOOKING_TYPE_LABEL[bookingType] || bookingType}${partySize ? ` · ${partySize}` : ''}`
      : null,
    ...(guests || [])
      .filter((g) => g?.fullName)
      .map((g) => `Traveler: ${g.fullName}${g.isLead ? ' (lead)' : ''}`),
    location ? `Location: ${location}` : null,
    whatsapp ? `WhatsApp: ${whatsapp}` : null,
    `Payment: ${paymentStatusLabel(paymentStatus)}`,
    paymentMethod ? `via ${paymentMethod}` : null,
    paidAt ? formatDate(paidAt) : null,
    '',
    'PRICING',
    `Total: ${formatCurrency(totalAmount, currency)}`,
    `Amount paid: ${formatCurrency(amountPaidTotal, currency)}`,
    balanceDue > 0
      ? `Balance due${balanceDueDate ? ` · ${formatDate(balanceDueDate)}` : ''}: ${formatCurrency(balanceDue, currency)}`
      : null,
    paymentNote || null,
    '',
    reference ? `Booking reference: ${reference}` : null,
    '',
    'VAYBEEX BOOKING RECEIPT',
  ];

  return lines.filter((line) => line != null).join('\n');
};

const buildPaymentConfirmationSms = ({
  tripTitle,
  amountPaid,
  balanceDue,
  paymentStatus,
  reference,
  currency = 'GHS',
}) => {
  const trip = (tripTitle || 'your trip').slice(0, 40);
  const paid = formatMoney(amountPaid, currency);
  const ref = reference ? ` Ref: ${reference}` : '';

  if (paymentStatus === 'fully_paid') {
    return `VaybeEx: ${paid} received for ${trip}. Fully paid & confirmed.${ref}`;
  }

  const balance = formatMoney(balanceDue, currency);
  return `VaybeEx: ${paid} received for ${trip}. Booking confirmed. Balance due: ${balance}.${ref}`;
};

const sendEmail = async ({ to, subject, text, html }) => {
  const from = process.env.EMAIL_FROM || 'VaybeEx <noreply@vaybeex.com>';
  const client = getResendClient();

  if (!client) {
    console.log(`[DEV EMAIL -> ${to}] ${subject}\n${text}`);
    return { dev: true, message: 'Email logged to console (Resend not configured)' };
  }

  const { data, error } = await client.emails.send({
    from,
    to: [to],
    subject,
    text,
    html,
  });

  if (error) {
    const resendMessage = error.message || error.error || 'Failed to send email';
    const resendError = new Error(resendMessage);
    resendError.statusCode = error.statusCode === 403 ? 403 : 502;
    throw resendError;
  }

  return { sent: true, id: data?.id };
};

const sendOtpEmail = async (email, fullName, code) => {
  const expiryMinutes = process.env.OTP_EXPIRY_MINUTES || 10;

  return sendEmail({
    to: email,
    subject: 'Your VaybeEx verification code',
    text: `Hi ${fullName},\n\nYour VaybeEx verification code is ${code}.\n\nIt expires in ${expiryMinutes} minutes. Do not share this code with anyone.\n\nIf you did not request this, you can ignore this email.\n\n— VaybeEx`,
    html: buildOtpEmailHtml({ fullName, code, expiryMinutes }),
  });
};

const sendPaymentConfirmationEmail = async (payload) => {
  const subjectTrip = payload.tripTitle ? ` — ${payload.tripTitle}` : '';
  return sendEmail({
    to: payload.email,
    subject: `VaybeEx booking receipt${subjectTrip}`,
    text: buildPaymentConfirmationText(payload),
    html: buildPaymentConfirmationEmailHtml(payload),
  });
};

const buildOrganizerStatusEmailHtml = ({
  fullName,
  businessName,
  eyebrow,
  headline,
  bodyHtml,
  ctaLabel,
  ctaUrl,
}) => {
  const safeName = escapeHtml(fullName || 'there');
  const brand = escapeHtml(businessName || 'your brand');
  const cta =
    ctaLabel && ctaUrl
      ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
          <tr>
            <td style="background-color:#0d9488;border-radius:10px;">
              <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
                ${escapeHtml(ctaLabel)}
              </a>
            </td>
          </tr>
        </table>
      `
      : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(headline)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#0f766e 0%,#0d9488 55%,#14b8a6 100%);padding:28px 32px;">
              <p style="margin:0;font-size:22px;font-weight:700;letter-spacing:0.3px;color:#ffffff;">VaybeEx</p>
              <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">${escapeHtml(eyebrow)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827;">Hi ${safeName},</p>
              <p style="margin:0 0 16px;font-size:20px;font-weight:700;line-height:1.35;color:#0f766e;">${escapeHtml(headline)}</p>
              <div style="font-size:15px;line-height:1.65;color:#4b5563;">
                ${bodyHtml}
              </div>
              <p style="margin:20px 0 0;font-size:14px;line-height:1.6;color:#6b7280;">
                Brand on file: <strong style="color:#111827;">${brand}</strong>
              </p>
              ${cta}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 24px;border-top:1px solid #f3f4f6;background-color:#fafafa;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;text-align:center;">
                © ${new Date().getFullYear()} VaybeEx · Experiences made simple
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
};

const sendOrganizerPendingReviewEmail = async ({ email, fullName, businessName }) => {
  const headline = 'Your organizer profile is under review';
  const text = [
    `Hi ${fullName || 'there'},`,
    '',
    'Thanks for completing your VaybeEx organizer setup.',
    '',
    'Our team is reviewing your profile and verification documents. This usually takes a short while.',
    '',
    'You will get another email as soon as a decision is made. Until then, trip publishing stays locked.',
    '',
    `Brand on file: ${businessName || 'your brand'}`,
    '',
    '— VaybeEx',
  ].join('\n');

  return sendEmail({
    to: email,
    subject: 'VaybeEx — organizer verification pending',
    text,
    html: buildOrganizerStatusEmailHtml({
      fullName,
      businessName,
      eyebrow: 'Organizer verification',
      headline,
      bodyHtml: `
        <p style="margin:0 0 14px;">Thanks for completing your organizer setup. We’ve received your profile and documents.</p>
        <p style="margin:0 0 14px;">Our team is reviewing everything now. This usually takes a short while — you don’t need to do anything else.</p>
        <p style="margin:0;">We’ll email you the moment you’re approved. Until then, you can’t publish or manage live trips.</p>
      `,
    }),
  });
};

const sendOrganizerApprovedEmail = async ({ email, fullName, businessName }) => {
  const portalUrl = `${(process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')}/organizer`;
  const headline = 'You’re approved — welcome aboard';
  const text = [
    `Hi ${fullName || 'there'},`,
    '',
    'Great news — your VaybeEx organizer account has been approved.',
    '',
    'You can now create trips, publish them, and start taking bookings.',
    '',
    `Open your organizer portal: ${portalUrl}`,
    '',
    `Brand on file: ${businessName || 'your brand'}`,
    '',
    '— VaybeEx',
  ].join('\n');

  return sendEmail({
    to: email,
    subject: 'VaybeEx — you’re approved as an organizer',
    text,
    html: buildOrganizerStatusEmailHtml({
      fullName,
      businessName,
      eyebrow: 'Organizer approved',
      headline,
      bodyHtml: `
        <p style="margin:0 0 14px;">Great news — your organizer account has been approved.</p>
        <p style="margin:0;">You can now create trips, publish them to travelers, and start receiving bookings on VaybeEx.</p>
      `,
      ctaLabel: 'Open organizer portal',
      ctaUrl: portalUrl,
    }),
  });
};

const organizerPortalUrl = (path = '/organizer') => {
  const base = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};

const buildOrganizerAlertEmailHtml = ({
  fullName,
  eyebrow,
  headline,
  introHtml,
  details = [],
  ctaLabel,
  ctaUrl,
}) => {
  const safeName = escapeHtml(fullName || 'there');
  const detailRows = (details || [])
    .filter((row) => row?.value != null && String(row.value).trim() !== '')
    .map(
      (row) => `
      <tr>
        <td style="padding:10px 0;border-top:1px solid #f3f4f6;font-size:12px;color:#6b7280;width:40%;vertical-align:top;">
          ${escapeHtml(row.label)}
        </td>
        <td style="padding:10px 0;border-top:1px solid #f3f4f6;font-size:14px;font-weight:600;color:#111827;text-align:right;vertical-align:top;">
          ${escapeHtml(String(row.value))}
        </td>
      </tr>
    `
    )
    .join('');

  const cta =
    ctaLabel && ctaUrl
      ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
          <tr>
            <td style="background-color:#0d9488;border-radius:10px;">
              <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
                ${escapeHtml(ctaLabel)}
              </a>
            </td>
          </tr>
        </table>
      `
      : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(headline)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#0f766e 0%,#0d9488 55%,#14b8a6 100%);padding:28px 32px;">
              <p style="margin:0;font-size:22px;font-weight:700;letter-spacing:0.3px;color:#ffffff;">VaybeEx</p>
              <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">${escapeHtml(eyebrow)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827;">Hi ${safeName},</p>
              <p style="margin:0 0 16px;font-size:20px;font-weight:700;line-height:1.35;color:#0f766e;">${escapeHtml(headline)}</p>
              <div style="font-size:15px;line-height:1.65;color:#4b5563;">
                ${introHtml}
              </div>
              ${
                detailRows
                  ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">${detailRows}</table>`
                  : ''
              }
              ${cta}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 24px;border-top:1px solid #f3f4f6;background-color:#fafafa;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;text-align:center;">
                © ${new Date().getFullYear()} VaybeEx · Experiences made simple
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
};

const sendOrganizerBookingAlertEmail = async (payload) => {
  const {
    organizerEmail,
    organizerName,
    travelerName,
    tripTitle,
    destination,
    partySize,
    amountPaid,
    amountPaidTotal,
    balanceDue,
    paymentStatus,
    paymentMethod,
    reference,
    currency = 'GHS',
    kind = 'booking',
  } = payload;

  const isNewBooking = kind === 'booking';
  const headline = isNewBooking
    ? `New booking on ${tripTitle || 'your trip'}`
    : `Payment received for ${tripTitle || 'your trip'}`;
  const subject = isNewBooking
    ? `New booking — ${tripTitle || 'your trip'}`
    : `Payment received — ${tripTitle || 'your trip'}`;
  const status =
    paymentStatus === 'fully_paid'
      ? 'Fully paid'
      : paymentStatus === 'deposit_paid'
        ? 'Deposit paid'
        : 'Payment received';

  const intro = isNewBooking
    ? `<p style="margin:0;">${escapeHtml(travelerName || 'A traveler')} just booked <strong>${escapeHtml(tripTitle || 'your trip')}</strong>${destination ? ` in ${escapeHtml(destination)}` : ''}. A payment has been received and the booking is confirmed.</p>`
    : `<p style="margin:0;">${escapeHtml(travelerName || 'A traveler')} made another payment toward their booking on <strong>${escapeHtml(tripTitle || 'your trip')}</strong>.</p>`;

  const details = [
    { label: 'Traveler', value: travelerName },
    { label: 'Trip', value: tripTitle },
    { label: 'Destination', value: destination },
    { label: 'Party size', value: partySize != null ? String(partySize) : null },
    { label: 'Amount just paid', value: formatMoney(amountPaid, currency) },
    { label: 'Total paid so far', value: formatMoney(amountPaidTotal, currency) },
    { label: 'Balance due', value: formatMoney(balanceDue, currency) },
    { label: 'Payment status', value: status },
    { label: 'Method', value: paymentMethod },
    { label: 'Reference', value: reference },
  ];

  const text = [
    `Hi ${organizerName || 'there'},`,
    '',
    isNewBooking
      ? `${travelerName || 'A traveler'} just booked ${tripTitle || 'your trip'}. Payment received and booking confirmed.`
      : `${travelerName || 'A traveler'} paid toward their booking on ${tripTitle || 'your trip'}.`,
    '',
    ...details.filter((d) => d.value != null && String(d.value).trim() !== '').map((d) => `${d.label}: ${d.value}`),
    '',
    `Review in portal: ${organizerPortalUrl('/organizer')}`,
    '',
    '— VaybeEx',
  ].join('\n');

  return sendEmail({
    to: organizerEmail,
    subject,
    text,
    html: buildOrganizerAlertEmailHtml({
      fullName: organizerName,
      eyebrow: isNewBooking ? 'New booking' : 'Booking payment',
      headline,
      introHtml: intro,
      details,
      ctaLabel: 'Open organizer portal',
      ctaUrl: organizerPortalUrl('/organizer'),
    }),
  });
};

const sendOrganizerRefundRequestEmail = async (payload) => {
  const {
    organizerEmail,
    organizerName,
    travelerName,
    tripTitle,
    destination,
    amountPaid,
    refundAmount,
    refundEligible,
    reason,
    paymentMethod,
    currency = 'GHS',
  } = payload;

  const headline = `Refund request — ${tripTitle || 'your trip'}`;
  const status = refundEligible
    ? 'Pending your review'
    : 'Cancelled · no refund under trip policy';

  const intro = refundEligible
    ? `<p style="margin:0;">${escapeHtml(travelerName || 'A traveler')} cancelled their booking on <strong>${escapeHtml(tripTitle || 'your trip')}</strong> and requested a refund. Please review it in your portal.</p>`
    : `<p style="margin:0;">${escapeHtml(travelerName || 'A traveler')} cancelled their booking on <strong>${escapeHtml(tripTitle || 'your trip')}</strong>. No refund applies under this trip’s policy, but seats have been released.</p>`;

  const details = [
    { label: 'Traveler', value: travelerName },
    { label: 'Trip', value: tripTitle },
    { label: 'Destination', value: destination },
    { label: 'Amount paid', value: formatMoney(amountPaid, currency) },
    { label: 'Refund amount', value: formatMoney(refundAmount, currency) },
    { label: 'Status', value: status },
    { label: 'Payment method', value: paymentMethod },
    { label: 'Reason', value: reason },
  ];

  const text = [
    `Hi ${organizerName || 'there'},`,
    '',
    refundEligible
      ? `${travelerName || 'A traveler'} cancelled ${tripTitle || 'your trip'} and requested a refund. Please review it in your portal.`
      : `${travelerName || 'A traveler'} cancelled ${tripTitle || 'your trip'}. No refund applies under this trip’s policy.`,
    '',
    ...details.filter((d) => d.value != null && String(d.value).trim() !== '').map((d) => `${d.label}: ${d.value}`),
    '',
    `Review in portal: ${organizerPortalUrl('/organizer/refunds')}`,
    '',
    '— VaybeEx',
  ].join('\n');

  return sendEmail({
    to: organizerEmail,
    subject: headline,
    text,
    html: buildOrganizerAlertEmailHtml({
      fullName: organizerName,
      eyebrow: 'Cancellation / refund',
      headline,
      introHtml: intro,
      details,
      ctaLabel: 'Review refund requests',
      ctaUrl: organizerPortalUrl('/organizer/refunds'),
    }),
  });
};

module.exports = {
  sendOtpEmail,
  sendPaymentConfirmationEmail,
  sendOrganizerPendingReviewEmail,
  sendOrganizerApprovedEmail,
  sendOrganizerBookingAlertEmail,
  sendOrganizerRefundRequestEmail,
  buildOtpEmailHtml,
  buildPaymentConfirmationEmailHtml,
  buildPaymentConfirmationText,
  buildPaymentConfirmationSms,
  formatTripDates,
  formatMoney,
  formatCurrency,
  formatDate,
  resolveDurationDays,
};
