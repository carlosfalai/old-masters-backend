const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fs = require('fs');
const path = require('path');
const { generatePortrait } = require('../services/portrait-generator');
const { sendPortraitEmail, sendAssessmentEmail, sendAssessmentNotificationToStudio } = require('../services/email-sender');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Read order file
function loadOrder(orderId) {
  const orderPath = path.join(__dirname, '..', 'orders', `${orderId}.json`);
  if (!fs.existsSync(orderPath)) return null;
  return JSON.parse(fs.readFileSync(orderPath, 'utf8'));
}

// Update order status
function updateOrder(orderId, updates) {
  const orderPath = path.join(__dirname, '..', 'orders', `${orderId}.json`);
  if (!fs.existsSync(orderPath)) return;
  const order = JSON.parse(fs.readFileSync(orderPath, 'utf8'));
  fs.writeFileSync(orderPath, JSON.stringify({ 
    ...order, 
    ...updates, 
    updatedAt: new Date().toISOString() 
  }, null, 2));
}

// POST /api/webhook
router.post('/', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    if (WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
    } else {
      // Dev mode: parse raw body without signature verification
      console.warn('[WEBHOOK] No STRIPE_WEBHOOK_SECRET set — skipping signature verification');
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('[WEBHOOK] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // Acknowledge receipt immediately — process async
  res.json({ received: true });

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { orderId, type, masters, email } = session.metadata || {};

    if (!orderId) {
      console.error('[WEBHOOK] No orderId in session metadata');
      return;
    }

    console.log(`[WEBHOOK] Payment confirmed — orderId=${orderId} type=${type}`);
    updateOrder(orderId, { 
      status: 'paid', 
      stripeSessionId: session.id,
      paidAt: new Date().toISOString()
    });

    if (type === 'digital') {
      // Generate portrait and email it
      handlePortraitOrder({ orderId, email, masters }).catch(err => {
        console.error(`[WEBHOOK] Portrait generation failed for ${orderId}:`, err.message);
        updateOrder(orderId, { 
          status: 'generation_failed', 
          error: err.message,
          failedAt: new Date().toISOString()
        });
      });
    } else if (type === 'assessment') {
      // Send confirmation emails
      const order = loadOrder(orderId);
      const preferredSizes = order ? order.preferredSizes : null;
      handleAssessmentOrder({
        orderId,
        email,
        preferredSizes
      }).catch(err => {
        console.error(`[WEBHOOK] Assessment email failed for ${orderId}:`, err.message);
        updateOrder(orderId, { 
          status: 'email_failed', 
          error: err.message,
          failedAt: new Date().toISOString()
        });
      });
    }
  }
});

async function handlePortraitOrder({ orderId, email, masters }) {
  const order = loadOrder(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  updateOrder(orderId, { status: 'generating' });

  // Read the uploaded photo
  const photoPath = order.photoPath;
  if (!photoPath || !fs.existsSync(photoPath)) {
    throw new Error(`Photo file not found: ${photoPath}`);
  }

  const photoBase64 = fs.readFileSync(photoPath).toString('base64');
  const activity = order.activity || null;
  
  console.log(`[PORTRAIT] Generating portrait for order ${orderId}, masters=${masters}${activity ? `, activity="${activity}"` : ''}`);
  
  // Retry logic for Gemini API
  let result;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      result = await generatePortrait(photoBase64, 'image/jpeg', masters, orderId, activity);
      break;
    } catch (err) {
      lastError = err;
      console.error(`[PORTRAIT] Generation attempt ${attempt} failed:`, err.message);
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
      }
    }
  }
  
  if (!result) {
    throw new Error(`Portrait generation failed after 3 attempts: ${lastError?.message}`);
  }

  updateOrder(orderId, { 
    status: 'generated', 
    portraitPath: result.filePath,
    generatedAt: new Date().toISOString()
  });

  console.log(`[PORTRAIT] Sending portrait email to ${email}`);
  await sendPortraitEmail({
    to: email,
    orderId,
    masters,
    portraitBase64: result.base64,
    portraitMimeType: result.mimeType
  });

  updateOrder(orderId, { 
    status: 'delivered',
    deliveredAt: new Date().toISOString()
  });
  console.log(`[PORTRAIT] Order ${orderId} complete — portrait delivered`);
}

async function handleAssessmentOrder({ orderId, email, preferredSizes }) {
  updateOrder(orderId, { status: 'processing' });

  // Send confirmation to customer
  await sendAssessmentEmail({ to: email, orderId, preferredSizes });

  // Notify studio
  await sendAssessmentNotificationToStudio({
    customerEmail: email,
    orderId,
    preferredSizes
  });

  updateOrder(orderId, { 
    status: 'notified',
    notifiedAt: new Date().toISOString()
  });
  console.log(`[ASSESSMENT] Order ${orderId} — customer notified, studio alerted`);
}

module.exports = router;
