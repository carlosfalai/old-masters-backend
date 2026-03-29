const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');

// Input validation
const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

const validateMasters = (masters) => {
  const validMasters = ['leighton', 'bouguereau', 'rembrandt', 'vermeer', 'sargent', 'caravaggio', 'gainsborough', 'reynolds', 'ingres', 'vigee_le_brun', 'van_dyck', 'velazquez'];
  const masterList = Array.isArray(masters) ? masters : (masters || '').split(',').map(m => m.trim());
  return masterList.every(m => validMasters.includes(m));
};

// Multer: store uploaded photos in ./uploads/
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPEG, PNG, and WebP images are accepted'));
  }
});

// Save order to JSON file
function saveOrder(orderId, data) {
  const orderPath = path.join(__dirname, '..', 'orders', `${orderId}.json`);
  fs.writeFileSync(orderPath, JSON.stringify({ 
    ...data, 
    orderId, 
    createdAt: new Date().toISOString() 
  }, null, 2));
}

// Compress image
async function compressImage(inputPath, outputPath) {
  try {
    await sharp(inputPath)
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(outputPath);
    return outputPath;
  } catch (err) {
    console.error('Image compression failed:', err.message);
    return inputPath; // Return original if compression fails
  }
}

// POST /api/checkout
// Creates a checkout session for AI portrait ($35) or assessment ($12)
router.post('/checkout', upload.single('photo'), async (req, res) => {
  try {
    const { email, masters, activity, sizes, tier = 'digital' } = req.body;
    
    // Input validation
    if (!email || !validateEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    
    if (tier === 'digital' && (!masters || !validateMasters(masters))) {
      return res.status(400).json({ error: 'Valid master selection is required' });
    }
    
    if (tier === 'digital' && (!req.file && !req.body.imageBase64)) {
      return res.status(400).json({ error: 'Photo is required for digital portrait' });
    }
    
    const orderId = uuidv4();
    let photoPath = null;
    
    // Handle photo upload
    if (req.file) {
      // Compress image
      const compressedPath = path.join(__dirname, '..', 'uploads', `${orderId}_compressed.jpg`);
      photoPath = await compressImage(req.file.path, compressedPath);
      
      // Delete original if compression succeeded
      if (photoPath !== req.file.path) {
        fs.unlink(req.file.path, (err) => {
          if (err) console.error('Failed to delete original image:', err);
        });
      }
    } else if (req.body.imageBase64 && tier === 'digital') {
      // Handle base64 image
      const match = req.body.imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: 'Invalid base64 image format' });
      }
      const buffer = Buffer.from(match[2], 'base64');
      photoPath = path.join(__dirname, '..', 'uploads', `${orderId}.jpg`);
      fs.writeFileSync(photoPath, buffer);
    }
    
    // Save order data
    saveOrder(orderId, {
      type: tier,
      status: 'pending_payment',
      email,
      masters: tier === 'digital' ? masters : null,
      activity: activity || null,
      preferredSizes: tier === 'assessment' ? (sizes || null) : null,
      photoPath,
      createdAt: new Date().toISOString()
    });
    
    // Create Stripe checkout session
    let session;
    if (tier === 'digital') {
      const masterNames = Array.isArray(masters) ? masters.join(' + ') : masters;
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: email,
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: 3500, // $35.00
            product_data: {
              name: 'AI Portrait — Old Masters',
              description: `Classical oil painting portrait in the style of ${masterNames}. Delivered as high-resolution PNG.`,
              images: ['https://oldmasters.art/assets/og-image.jpg']
            }
          },
          quantity: 1
        }],
        metadata: {
          orderId,
          type: 'digital',
          masters: Array.isArray(masters) ? masters.join(',') : masters,
          email
        },
        success_url: `https://oldmasters.art/success.html?session_id={CHECKOUT_SESSION_ID}&order_id=${orderId}`,
        cancel_url: 'https://oldmasters.art/order.html?canceled=true'
      });
    } else if (tier === 'assessment') {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: email,
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: 1200, // $12.00
            product_data: {
              name: 'Oil Painting Assessment — Old Masters',
              description: 'Custom oil painting quote. Assessment fee credited toward final price.',
              images: ['https://oldmasters.art/assets/og-image.jpg']
            }
          },
          quantity: 1
        }],
        metadata: {
          orderId,
          type: 'assessment',
          email
        },
        success_url: `https://oldmasters.art/assessment-success.html?session_id={CHECKOUT_SESSION_ID}&order_id=${orderId}`,
        cancel_url: 'https://oldmasters.art/painting.html?canceled=true'
      });
    } else {
      return res.status(400).json({ error: 'Invalid tier' });
    }
    
    res.json({ 
      sessionId: session.id, 
      url: session.url,
      orderId 
    });
    
  } catch (err) {
    console.error('[CHECKOUT] Error:', err.message);
    res.status(500).json({ error: 'Checkout failed. Please try again.' });
  }
});

// File cleanup job (run daily via cron in production)
function cleanupOldFiles() {
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  const generatedDir = path.join(__dirname, '..', 'generated');
  const ordersDir = path.join(__dirname, '..', 'orders');
  
  const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days ago
  
  [uploadsDir, generatedDir].forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(file => {
        const filePath = path.join(dir, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            console.log(`Cleaned up old file: ${filePath}`);
          }
        } catch (err) {
          console.error(`Failed to clean up ${filePath}:`, err.message);
        }
      });
    }
  });
}

// Run cleanup on startup and schedule daily
cleanupOldFiles();
setInterval(cleanupOldFiles, 24 * 60 * 60 * 1000); // Daily

module.exports = router;
