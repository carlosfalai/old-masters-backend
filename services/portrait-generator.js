const https = require('https');
const fs = require('fs');
const path = require('path');

const GEMINI_MODEL = 'gemini-3-pro-image-preview';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Full registry of old masters — consistent IDs with frontend
const MASTERS = {
  leighton: {
    name: 'Frederic Leighton',
    prompt: "Frederic Leighton's Victorian neoclassical style — dramatic chiaroscuro lighting, rich warm tones, the texture of oil on canvas visible in every detail. Dignified, classical composition."
  },
  bouguereau: {
    name: 'William-Adolphe Bouguereau',
    prompt: "William-Adolphe Bouguereau's French academic style — luminous skin, impossibly soft brushwork, romantic atmosphere. Photorealistic softness with no visible brushstrokes, flesh that glows from within."
  },
  rembrandt: {
    name: 'Rembrandt van Rijn',
    prompt: "Rembrandt's Dutch Golden Age mastery — deep, dramatic chiaroscuro with rich umber shadows. Thick impasto highlights on the face, the subject emerging from near-total darkness. Warm ochre and brown palette, visible brushwork that gives the surface life."
  },
  vermeer: {
    name: 'Johannes Vermeer',
    prompt: "Vermeer's intimate Dutch interiors — soft, diffused light from a window on the left. Pearl-like luminosity on skin, quiet domestic elegance. Cool blues, warm yellows, the impossible stillness of a perfect moment captured."
  },
  sargent: {
    name: 'John Singer Sargent',
    prompt: "John Singer Sargent's bold portraiture — confident, fluid brushstrokes with a modern edge. Dramatic contrasts, silk and satin rendered with bravura technique. The subject radiates personality and social presence."
  },
  caravaggio: {
    name: 'Caravaggio',
    prompt: "Caravaggio's intense Italian Baroque — extreme tenebrism, figures carved from darkness by a single dramatic light source. Raw, unflinching realism. Deep blacks, warm flesh tones, theatrical intensity."
  },
  gainsborough: {
    name: 'Thomas Gainsborough',
    prompt: "Thomas Gainsborough's English elegance — feathery, delicate brushwork. Pastoral landscape backgrounds, soft greens and blues. Subjects dressed in flowing silks with natural, relaxed poses. Aristocratic refinement without stiffness."
  },
  reynolds: {
    name: 'Joshua Reynolds',
    prompt: "Joshua Reynolds' grand manner portraiture — classical poses borrowed from Renaissance masters. Rich, warm palette with deep reds and golds. Allegorical settings, the subject elevated to heroic status through composition and lighting."
  },
  ingres: {
    name: 'Jean-Auguste-Dominique Ingres',
    prompt: "Ingres' French neoclassical precision — impossibly smooth surfaces, meticulous draftsmanship. Cool, controlled palette. Every fabric fold and skin tone rendered with photographic precision, yet idealized. The line is everything."
  },
  vigee_le_brun: {
    name: 'Élisabeth Vigée Le Brun',
    prompt: "Vigée Le Brun's luminous royal portraiture — flattering, warm, glowing skin tones. Soft, romantic poses with natural hair and flowing garments. Pastel-tinged backgrounds, the subject bathed in gentle admiration. Feminine grace elevated to art."
  },
  van_dyck: {
    name: 'Anthony van Dyck',
    prompt: "Van Dyck's Flemish aristocratic sophistication — elongated, elegant figures in rich fabrics. Silver-grey palette with warm accents. The subject exudes effortless nobility, hands posed with courtly grace. Loose, flowing brushwork in the clothing."
  },
  velazquez: {
    name: 'Diego Velázquez',
    prompt: "Velázquez's Spanish realism — painterly mastery that dissolves into impressionistic strokes at close range but snaps into photographic clarity from a distance. Natural, unflattering honesty mixed with regal dignity. Muted greys, warm flesh, atmospheric depth."
  }
};

// Aliases for frontend compatibility
const MASTER_ALIASES = {
  vigee: 'vigee_le_brun',
  vandyck: 'van_dyck',
  van_dyke: 'van_dyck'
};

function resolveMasterKey(key) {
  const k = key.trim().toLowerCase();
  return MASTER_ALIASES[k] || k;
}

function buildPrompt(masters, activity) {
  // masters can be a single string "leighton" or comma-separated "leighton,rembrandt"
  const masterKeys = (masters || 'leighton').split(',').map(m => resolveMasterKey(m)).filter(m => MASTERS[m]);

  if (masterKeys.length === 0) masterKeys.push('leighton'); // fallback

  // Build the artist style description
  let styleDescription;
  if (masterKeys.length === 1) {
    const m = MASTERS[masterKeys[0]];
    styleDescription = `Transform this photograph into a classical oil painting in the style of ${m.name}.\n${m.prompt}`;
  } else {
    const names = masterKeys.map(k => MASTERS[k].name).join(' and ');
    const prompts = masterKeys.map(k => `- ${MASTERS[k].name}: ${MASTERS[k].prompt}`).join('\n');
    styleDescription = `Transform this photograph into a classical oil painting that blends the styles of ${names}.\nCombine these artistic influences into a harmonious whole:\n${prompts}\nThe blend should feel natural — as if these masters collaborated on a single canvas.`;
  }

  // If the customer told us what the person loves doing, weave it into the scene
  const activityScene = activity
    ? `Place this person in a scene that reflects their passion: ${activity}. The setting should feel natural and dignified — as if the artist chose this moment to capture who they truly are. Integrate this activity meaningfully into the composition.`
    : 'Maintain the composition of the original photo.';

  return `${styleDescription}
${activityScene}
Maintain the exact likeness and features of the person in the original photo.
The result should look like a genuine oil painting that could hang in a museum.
NO artist signature, watermark, or any text on the painting.
Output only the generated image, no text.`;
}

async function generatePortrait(imageBase64, mimeType, masters, orderId, activity) {
  const apiKey = process.env.GEMINI_API_KEY_IMAGES;
  if (!apiKey) throw new Error('GEMINI_API_KEY_IMAGES not set');

  const prompt = buildPrompt(masters, activity);

  const requestBody = JSON.stringify({
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: mimeType || 'image/jpeg',
              data: imageBase64
            }
          },
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 1024,
      responseModalities: ['IMAGE']
    }
  });

  return new Promise((resolve, reject) => {
    const url = new URL(`${GEMINI_ENDPOINT}?key=${apiKey}`);

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: 90000 // 90 second timeout — Gemini image gen can take 45-90s
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);

          if (parsed.error) {
            return reject(new Error(`Gemini API error: ${parsed.error.message}`));
          }

          // Extract image from response
          const parts = parsed?.candidates?.[0]?.content?.parts || [];
          const imagePart = parts.find(p => p.inline_data?.mime_type?.startsWith('image/'));

          if (!imagePart) {
            console.error('Gemini response:', JSON.stringify(parsed, null, 2));
            return reject(new Error('No image returned from Gemini'));
          }

          // Save generated portrait to disk
          const outputPath = path.join(__dirname, '..', 'generated', `${orderId}.png`);
          const imageBuffer = Buffer.from(imagePart.inline_data.data, 'base64');
          fs.writeFileSync(outputPath, imageBuffer);

          resolve({
            base64: imagePart.inline_data.data,
            mimeType: imagePart.inline_data.mime_type,
            filePath: outputPath
          });
        } catch (err) {
          reject(new Error(`Failed to parse Gemini response: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Gemini API request timeout'));
    });
    
    req.write(requestBody);
    req.end();
  });
}

module.exports = { generatePortrait };
