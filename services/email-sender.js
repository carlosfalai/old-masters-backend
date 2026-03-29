const nodemailer = require('nodemailer');
const { SESClient, SendRawEmailCommand } = require('@aws-sdk/client-ses');
const fs = require('fs');

// Try SES first, fall back to Gmail SMTP if SES isn't configured
function createTransporter() {
  const awsKey = process.env.AWS_ACCESS_KEY_ID;
  const awsSecret = process.env.AWS_SECRET_ACCESS_KEY;

  if (awsKey && awsSecret) {
    const ses = new SESClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: awsKey,
        secretAccessKey: awsSecret
      }
    });

    return nodemailer.createTransport({
      SES: { ses, aws: { SendRawEmailCommand } }
    });
  }

  // Fallback: Gmail SMTP (for dev/testing)
  console.warn('[EMAIL] AWS SES not configured, falling back to Gmail SMTP');
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
}

async function sendPortraitEmail({ to, orderId, masters, style, portraitBase64, portraitMimeType }) {
  const transporter = createTransporter();
  const fromAddress = process.env.EMAIL_FROM || 'noreply@oldmasters.art';
  // Accept either "masters" (new) or legacy "style" field
  const selectedMasters = masters || style || 'leighton';
  const masterNames = selectedMasters.split(',').map(m => m.trim().charAt(0).toUpperCase() + m.trim().slice(1)).join(' + ');

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Georgia, serif; background: #0a0a08; color: #f5f0e8; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .header { text-align: center; border-bottom: 1px solid #8b7355; padding-bottom: 30px; margin-bottom: 30px; }
    .title { font-size: 28px; color: #c8a96e; letter-spacing: 3px; text-transform: uppercase; margin: 0; }
    .subtitle { font-size: 14px; color: #8b7355; letter-spacing: 2px; margin-top: 8px; }
    .body-text { font-size: 16px; line-height: 1.8; color: #d4c9b0; }
    .cta-box { background: #1a1a14; border: 1px solid #8b7355; border-radius: 4px; padding: 24px; margin: 30px 0; text-align: center; }
    .cta-title { font-size: 18px; color: #c8a96e; margin: 0 0 10px; }
    .cta-text { font-size: 14px; color: #8b7355; margin: 0 0 20px; }
    .cta-button { display: inline-block; background: #c8a96e; color: #0a0a08; padding: 12px 32px; text-decoration: none; font-size: 14px; letter-spacing: 2px; text-transform: uppercase; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #2a2a22; text-align: center; font-size: 12px; color: #5a5040; }
    .order-id { font-size: 11px; color: #5a5040; font-family: monospace; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <p class="title">Old Masters</p>
      <p class="subtitle">AI Portrait Studio</p>
    </div>

    <p class="body-text">Your portrait has been painted.</p>

    <p class="body-text">
      Our AI has transformed your photograph into a classical oil painting in the style of
      <strong>${masterNames}</strong>. The portrait is attached to this email as a high-resolution PNG.
    </p>

    <p class="body-text">
      Your digital portrait arrives as a 2000×2000px PNG, suitable for display at home,
      sharing with family, or as a reference for a custom oil painting on canvas.
    </p>

    <div class="cta-box">
      <p class="cta-title">Want this painted on real canvas?</p>
      <p class="cta-text">
        Our master artists will paint your portrait on real oil canvas —
        exactly as it appears here. Sizes from 16×20" to 40×60". Ships worldwide in 3–6 weeks.
      </p>
      <a href="https://oldmasters.art/painting.html?order=${orderId}" class="cta-button">
        Order a Real Painting — from $750
      </a>
    </div>

    <p class="body-text">
      Thank you for trusting Old Masters with your likeness.
    </p>

    <div class="footer">
      <p>Old Masters · oldmasters.art</p>
      <p class="order-id">Order: ${orderId}</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const attachments = [];
  if (portraitBase64) {
    attachments.push({
      filename: `old-masters-portrait-${orderId}.png`,
      content: Buffer.from(portraitBase64, 'base64'),
      contentType: portraitMimeType || 'image/png'
    });
  }

  await transporter.sendMail({
    from: `"Old Masters" <${fromAddress}>`,
    to,
    subject: 'Your Old Masters Portrait is Ready',
    html: htmlBody,
    attachments
  });

  console.log(`[EMAIL] Portrait sent to ${to} for order ${orderId}`);
}

async function sendAssessmentEmail({ to, orderId, preferredSizes }) {
  const transporter = createTransporter();
  const fromAddress = process.env.EMAIL_FROM || 'noreply@oldmasters.art';
  const sizesText = preferredSizes?.join(', ') || 'not specified';

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Georgia, serif; background: #0a0a08; color: #f5f0e8; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .header { text-align: center; border-bottom: 1px solid #8b7355; padding-bottom: 30px; margin-bottom: 30px; }
    .title { font-size: 28px; color: #c8a96e; letter-spacing: 3px; text-transform: uppercase; margin: 0; }
    .subtitle { font-size: 14px; color: #8b7355; letter-spacing: 2px; margin-top: 8px; }
    .body-text { font-size: 16px; line-height: 1.8; color: #d4c9b0; }
    .info-box { background: #1a1a14; border-left: 3px solid #c8a96e; padding: 16px 20px; margin: 24px 0; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #2a2a22; text-align: center; font-size: 12px; color: #5a5040; }
    .order-id { font-size: 11px; color: #5a5040; font-family: monospace; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <p class="title">Old Masters</p>
      <p class="subtitle">AI Portrait Studio</p>
    </div>

    <p class="body-text">We have received your oil painting assessment request.</p>

    <div class="info-box">
      <p style="margin: 0; color: #c8a96e; font-size: 14px;">Your preferred sizes: ${sizesText}</p>
    </div>

    <p class="body-text">
      One of our studio advisors will review your portrait and send you a detailed
      quote within 24 hours. This will include canvas size options, framing choices,
      and the estimated production and shipping timeline.
    </p>

    <p class="body-text">
      The $12 assessment fee will be deducted from the final price of your painting.
    </p>

    <div class="footer">
      <p>Old Masters · oldmasters.art</p>
      <p class="order-id">Assessment Request: ${orderId}</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  await transporter.sendMail({
    from: `"Old Masters" <${fromAddress}>`,
    to,
    subject: 'Your Oil Painting Assessment Request — We\'ll be in touch within 24 hours',
    html: htmlBody
  });

  console.log(`[EMAIL] Assessment confirmation sent to ${to} for order ${orderId}`);
}

// Internal notification to studio when an assessment comes in
async function sendAssessmentNotificationToStudio({ customerEmail, orderId, preferredSizes, originalOrderId }) {
  const studioEmail = process.env.STUDIO_EMAIL || 'studio@oldmasters.art';
  const transporter = createTransporter();
  const fromAddress = process.env.EMAIL_FROM || 'noreply@oldmasters.art';

  await transporter.sendMail({
    from: `"Old Masters System" <${fromAddress}>`,
    to: studioEmail,
    subject: `New Assessment Request — ${customerEmail}`,
    text: `
New oil painting assessment request:

Customer: ${customerEmail}
Assessment Order ID: ${orderId}
Original Portrait Order: ${originalOrderId || 'N/A'}
Preferred Sizes: ${preferredSizes?.join(', ') || 'not specified'}

Action required: Send quote within 24 hours.
    `.trim()
  });
}

module.exports = { sendPortraitEmail, sendAssessmentEmail, sendAssessmentNotificationToStudio };
