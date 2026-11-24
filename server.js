/**
 * AI PALM MYSTIC – Secure Gemini Vision Backend Proxy
 * Keeps GEMINI_API_KEY strictly server-side, validates image inputs,
 * enforces structured 31-field palmistry JSON output, and handles
 * timeouts, rate limits, and retries.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 45000);
const RATE_LIMIT_MAX_PER_MIN = Number(process.env.RATE_LIMIT_MAX_PER_MIN || 15);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').trim();

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low', 'not_visible']);

const REQUIRED_FIELDS = [
  'overall_summary',
  'personality',
  'palm_shape',
  'life_line',
  'head_line',
  'heart_line',
  'fate_line',
  'sun_line',
  'mercury_line',
  'relationship_lines',
  'career',
  'business',
  'money',
  'love',
  'marriage',
  'family',
  'strengths',
  'weaknesses',
  'opportunities',
  'next_12_months',
  'next_5_years',
  'next_10_years',
  'spiritual_growth',
  'personalized_advice',
  'lucky_color',
  'lucky_number',
  'lucky_day',
  'detected_features',
  'confidence',
  'image_quality',
  'disclaimer'
];

// Simple in-memory IP rate limiter
const ipBuckets = new Map();
function rateLimitMiddleware(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const entry = ipBuckets.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  ipBuckets.set(ip, entry);

  if (entry.count > RATE_LIMIT_MAX_PER_MIN) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: `Too many analysis requests. Please retry after ${retryAfterSec} seconds.`
    });
  }
  next();
}

// Security headers & CORS
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(
  cors({
    origin: ALLOWED_ORIGINS === '*' ? '*' : ALLOWED_ORIGINS.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'OPTIONS']
  })
);

app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    aiConfigured: Boolean(GEMINI_API_KEY),
    model: GEMINI_MODEL,
    timestamp: new Date().toISOString()
  });
});

function buildPalmistryPrompt({ handSide, language }) {
  const targetLang = language === 'en' ? 'English' : 'Hindi (सरल, सहज, प्रीमियम पारंपरिक हस्तरेखा हिंदी)';
  const handLabel = handSide === 'left' ? 'Left Hand (बायां हाथ)' : 'Right Hand (दायां हाथ)';

  return `You are an Expert Gemini AI Vision Engineer, Hand Landmark Detection Specialist, and Traditional Palmistry Interpretation Expert.

Analyze the ACTUAL uploaded palm image carefully. Hand selected by user: ${handLabel}.
Write all user-facing narrative text in: ${targetLang}.

STRICT HONESTY & EVIDENCE RULES:
1. First evaluate image_quality:
   - Is the full palm visible? Are fingers visible? Is any key palm area obscured?
   - Assess blur, lighting, and palm orientation.
   - If the image is NOT a human palm or is too blurry/dark/cropped for genuine analysis, set image_quality.suitable = false and provide clear corrective instructions in image_quality.improvement_tips. Still return valid JSON.
2. Describe ONLY features that have clear visual evidence in this specific image.
   - If a line (e.g., Fate Line, Sun Line, Mercury Line, Relationship Lines) is not clearly visible, DO NOT invent or hallucinate it. Set its status/visibility to "not_visible" and confidence to "not_visible".
3. Confidence levels must strictly be one of: "high", "medium", "low", "not_visible".
4. Ethical & Traditional Palmistry Guardrails:
   - Present all future readings strictly as traditional symbolic palmistry interpretation, NEVER as guaranteed fate.
   - NEVER predict death, serious illness, accidents, or use fear-inducing language.
   - NEVER claim an exact marriage date, spouse identity, or exact number of marriages.
5. Coordinate Overlay Rule (line_coordinates):
   - Provide normalized polyline coordinates in [0, 1000] scale (where x=0 is left edge, x=1000 is right edge, y=0 is top edge, y=1000 is bottom edge of the image) ONLY for lines that you can visually trace with medium or high confidence on the actual image.
   - Format for each line: array of [x, y] integer pairs (4 to 8 points along the actual crease).
   - If a line is not clearly visible or you cannot reliably localize it, return an empty array [] for that line. NEVER fabricate coordinates.

Return ONLY a single valid JSON object (no markdown fences, no commentary outside JSON) with EXACTLY these keys:
{
  "image_quality": {
    "suitable": true,
    "score": 0,
    "palm_fully_visible": true,
    "fingers_visible": true,
    "obscured_areas": "none",
    "blur_level": "low | medium | high",
    "lighting_level": "good | dim | harsh",
    "orientation": "upright | tilted | sideways | unknown",
    "improvement_tips": ["..."]
  },
  "confidence": {
    "overall": "high | medium | low | not_visible",
    "score_percent": 0,
    "notes": "..."
  },
  "detected_features": {
    "hand_analyzed": "${handSide}",
    "palm_type": "Earth | Air | Fire | Water | Mixed | unknown",
    "finger_proportions": "...",
    "thumb_characteristics": "...",
    "palm_width_length_ratio": "...",
    "visible_mounts": ["..."],
    "line_visibility": {
      "life_line": "high | medium | low | not_visible",
      "head_line": "high | medium | low | not_visible",
      "heart_line": "high | medium | low | not_visible",
      "fate_line": "high | medium | low | not_visible",
      "sun_line": "high | medium | low | not_visible",
      "mercury_line": "high | medium | low | not_visible",
      "relationship_lines": "high | medium | low | not_visible"
    }
  },
  "line_coordinates": {
    "life_line": [[x1, y1], [x2, y2]],
    "head_line": [[x1, y1], [x2, y2]],
    "heart_line": [[x1, y1], [x2, y2]],
    "fate_line": [],
    "sun_line": []
  },
  "overall_summary": "Detailed personalized overview grounded in visible palm features.",
  "personality": "Detailed personality reading based on palm shape, fingers, thumb, and creases.",
  "palm_shape": {
    "classification": "...",
    "visual_evidence": "...",
    "interpretation": "...",
    "confidence": "high | medium | low | not_visible"
  },
  "life_line": {
    "visible_shape": "...",
    "length_curvature_continuity": "...",
    "interpretation": "...",
    "confidence": "high | medium | low | not_visible"
  },
  "head_line": {
    "shape_and_length": "...",
    "starting_point_and_branches": "...",
    "interpretation": "...",
    "confidence": "high | medium | low | not_visible"
  },
  "heart_line": {
    "pattern_and_curvature": "...",
    "start_end_regions": "...",
    "interpretation": "...",
    "confidence": "high | medium | low | not_visible"
  },
  "fate_line": {
    "presence_and_segments": "...",
    "direction_and_continuity": "...",
    "interpretation": "...",
    "confidence": "high | medium | low | not_visible"
  },
  "sun_line": {
    "presence_and_visibility": "...",
    "interpretation": "...",
    "confidence": "high | medium | low | not_visible"
  },
  "mercury_line": {
    "presence_and_visibility": "...",
    "interpretation": "...",
    "confidence": "high | medium | low | not_visible"
  },
  "relationship_lines": {
    "presence_and_visibility": "...",
    "interpretation": "...",
    "confidence": "high | medium | low | not_visible"
  },
  "career": {
    "overview": "...",
    "work_style": "...",
    "opportunities": "...",
    "challenges": "...",
    "symbolic_growth_periods": "..."
  },
  "business": "...",
  "money": {
    "overview": "...",
    "saving_habits": "...",
    "stability_reading": "...",
    "planning_guidance": "..."
  },
  "love": {
    "emotional_nature": "...",
    "relationship_patterns": "...",
    "trust_and_communication": "...",
    "challenges": "...",
    "compatibility_guidance": "..."
  },
  "marriage": {
    "traditional_interpretation": "...",
    "emotional_readiness": "...",
    "stability_themes": "..."
  },
  "family": "...",
  "strengths": ["...", "...", "..."],
  "weaknesses": ["...", "...", "..."],
  "opportunities": ["...", "...", "..."],
  "next_12_months": [
    { "month": 1, "label": "Month 1", "theme": "...", "opportunity": "...", "caution": "...", "guidance": "...", "energy_score": 78 }
  ],
  "next_5_years": [
    { "year": 1, "label": "Year 1", "theme": "...", "focus": "...", "symbolic_reading": "..." }
  ],
  "next_10_years": {
    "long_term_themes": "...",
    "growth_and_transitions": "...",
    "opportunities": "..."
  },
  "spiritual_growth": "...",
  "personalized_advice": "...",
  "lucky_color": "...",
  "lucky_number": "...",
  "lucky_day": "...",
  "life_pillar_scores": {
    "career": 75,
    "wealth": 72,
    "love": 78,
    "vitality": 80,
    "spirituality": 76
  },
  "disclaimer": "Traditional palmistry symbolic reading disclaimer."
}

Ensure next_12_months contains all 12 months (1 to 12) and next_5_years contains all 5 years (1 to 5) whenever image_quality.suitable is true.`;
}

function extractJsonText(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  let cleaned = rawText.trim();
  // Strip markdown code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function sanitizeCoordinates(coordsObj) {
  const lineKeys = ['life_line', 'head_line', 'heart_line', 'fate_line', 'sun_line'];
  const sanitized = {};
  for (const key of lineKeys) {
    const pts = coordsObj && Array.isArray(coordsObj[key]) ? coordsObj[key] : [];
    const validPts = pts
      .filter(
        (p) =>
          Array.isArray(p) &&
          p.length === 2 &&
          Number.isFinite(Number(p[0])) &&
          Number.isFinite(Number(p[1])) &&
          Number(p[0]) >= 0 &&
          Number(p[0]) <= 1000 &&
          Number(p[1]) >= 0 &&
          Number(p[1]) <= 1000
      )
      .map((p) => [Math.round(Number(p[0])), Math.round(Number(p[1]))]);
    sanitized[key] = validPts.length >= 2 ? validPts : [];
  }
  return sanitized;
}

function validateAndNormalizeReport(parsed, language) {
  const report = typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};

  for (const field of REQUIRED_FIELDS) {
    if (report[field] === undefined || report[field] === null || report[field] === '') {
      report[field] = 'not_visible';
    }
  }

  // Normalize confidence
  if (typeof report.confidence !== 'object' || report.confidence === null) {
    report.confidence = { overall: 'low', score_percent: 40, notes: 'unknown' };
  } else if (!VALID_CONFIDENCE.has(String(report.confidence.overall || '').toLowerCase())) {
    report.confidence.overall = 'low';
  }

  // Normalize line_coordinates
  report.line_coordinates = sanitizeCoordinates(report.line_coordinates);

  // Ensure disclaimer exists
  if (!report.disclaimer || report.disclaimer === 'not_visible') {
    report.disclaimer =
      language === 'en'
        ? 'This report is a traditional symbolic palmistry interpretation generated from visible palm features for personal reflection and entertainment. It is not a medical, legal, financial, or guaranteed future prediction.'
        : 'यह रिपोर्ट आपकी हथेली के दृश्यमान लक्षणों पर आधारित एक पारंपरिक एवं प्रतीकात्मक हस्तरेखा व्याख्या है। इसे निश्चित भविष्यवाणी या चिकित्सीय, कानूनी अथवा वित्तीय सलाह के रूप में न लें।';
  }

  report._meta = {
    mode: 'real_ai',
    model: GEMINI_MODEL,
    language,
    generated_at: new Date().toISOString()
  };

  return report;
}

async function callGeminiWithRetry(payload, maxAttempts = 3) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (response.status === 429 || response.status >= 500) {
        const errBody = await response.text().catch(() => '');
        lastError = new Error(`Gemini API HTTP ${response.status}: ${errBody.slice(0, 240)}`);
        if (attempt < maxAttempts) {
          const backoffMs = Math.min(8000, 1000 * Math.pow(2, attempt - 1));
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`Gemini API error (${response.status}): ${errBody.slice(0, 300)}`);
      }

      return await response.json();
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      const isAbort = err && err.name === 'AbortError';
      if (isAbort && attempt >= maxAttempts) {
        throw new Error('GEMINI_TIMEOUT');
      }
      if (attempt < maxAttempts) {
        const backoffMs = 1000 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }
  throw lastError || new Error('GEMINI_REQUEST_FAILED');
}

app.post('/api/analyze-palm', rateLimitMiddleware, async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(503).json({
        error: 'AI_NOT_CONFIGURED',
        message: 'Gemini API key is not configured on the backend server. Set GEMINI_API_KEY in .env.'
      });
    }

    const { imageBase64, mimeType = 'image/jpeg', handSide = 'right', language = 'hi' } = req.body || {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({
        error: 'MISSING_IMAGE',
        message: 'A valid base64 palm image is required.'
      });
    }

    const normalizedMime = String(mimeType).toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
      return res.status(400).json({
        error: 'UNSUPPORTED_FORMAT',
        message: 'Supported formats: JPG, JPEG, PNG, WebP.'
      });
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
    if (cleanBase64.length < 200) {
      return res.status(400).json({
        error: 'INVALID_IMAGE_DATA',
        message: 'Image payload appears empty or corrupted.'
      });
    }

    const promptText = buildPalmistryPrompt({
      handSide: handSide === 'left' ? 'left' : 'right',
      language: language === 'en' ? 'en' : 'hi'
    });

    const geminiPayload = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType: normalizedMime === 'image/jpg' ? 'image/jpeg' : normalizedMime,
                data: cleanBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.45,
        topP: 0.9,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      }
    };

    const apiResponse = await callGeminiWithRetry(geminiPayload, 3);
    const rawText = apiResponse?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonString = extractJsonText(rawText);

    if (!jsonString) {
      return res.status(502).json({
        error: 'INVALID_AI_RESPONSE',
        message: 'Gemini returned an empty or non-JSON response.'
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (parseErr) {
      return res.status(502).json({
        error: 'JSON_PARSE_ERROR',
        message: 'Could not parse structured JSON from Gemini Vision response.'
      });
    }

    const normalizedReport = validateAndNormalizeReport(parsed, language === 'en' ? 'en' : 'hi');
    return res.json(normalizedReport);
  } catch (err) {
    if (err && err.message === 'GEMINI_TIMEOUT') {
      return res.status(504).json({
        error: 'API_TIMEOUT',
        message: 'Gemini Vision analysis timed out. Please try again with a clearer or smaller image.'
      });
    }
    return res.status(500).json({
      error: 'ANALYSIS_FAILED',
      message: err?.message || 'Unexpected error during Gemini Vision palm analysis.'
    });
  }
});

app.post('/api/ask-palm', rateLimitMiddleware, async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(503).json({
        error: 'AI_NOT_CONFIGURED',
        message: 'Gemini API key is not configured on the backend server.'
      });
    }
    const { question, report, language = 'hi' } = req.body || {};
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'MISSING_QUESTION', message: 'Question is required.' });
    }
    const targetLang = language === 'en' ? 'English' : 'Hindi (सरल, सहज बोलचाल की हिंदी)';
    const prompt = `You are AI PALM MYSTIC Voice Assistant. Answer the user's spoken question warmly and concisely (3 to 5 sentences, suitable for voice read-aloud) in ${targetLang}.
STRICT RULES:
- Base your answer ONLY on the provided palm analysis JSON below.
- Never invent lines marked "not_visible".
- Never predict death, illness, accidents, or guaranteed marriage dates.
- Present guidance as traditional symbolic palmistry interpretation.

Palm Report JSON:
${JSON.stringify(report || {}).slice(0, 12000)}

User Question: ${question.trim()}`;

    const apiResponse = await callGeminiWithRetry(
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 512 }
      },
      2
    );
    const answer = apiResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!answer) {
      return res.status(502).json({ error: 'EMPTY_ANSWER', message: 'No answer returned by Gemini.' });
    }
    return res.json({ answer });
  } catch (err) {
    return res.status(500).json({ error: 'QA_FAILED', message: err?.message || 'Voice Q&A failed.' });
  }
});

app.post('/api/analyze-face', rateLimitMiddleware, async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(503).json({
        error: 'AI_NOT_CONFIGURED',
        message: 'Gemini API key is not configured on the backend server.'
      });
    }
    const { imageBase64, mimeType = 'image/jpeg', language = 'hi' } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'MISSING_IMAGE', message: 'A valid base64 face image is required.' });
    }
    const normalizedMime = String(mimeType).toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
      return res.status(400).json({ error: 'UNSUPPORTED_FORMAT', message: 'Supported formats: JPG, JPEG, PNG, WebP.' });
    }
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
    const targetLang = language === 'en' ? 'English' : 'Hindi (सरल, सम्मानजनक पारंपरिक सामुद्रिक शास्त्र हिंदी)';

    const prompt = `You are an Expert Gemini Vision Engineer and Traditional Samudrika Shastra (Face Reading / Physiognomy) Specialist.
Analyze ONLY the visible facial features in this uploaded photo. Write all user-facing text in ${targetLang}.
STRICT HONESTY & RESPECTFUL ETHICS:
- Describe ONLY clearly visible features. If an organ (e.g. ears covered by hair) is not clearly visible, set confidence to "not_visible" and do not fabricate traits.
- Be respectful, balanced, and constructive. Never body-shame or make medical/fatalistic claims.
- Present insights as traditional Samudrika Shastra symbolic character reading.

Return ONLY valid JSON with these exact keys:
{
  "overall_nature": "...",
  "face_shape": { "trait": "...", "strength": "...", "weakness": "...", "confidence": "high | medium | low | not_visible" },
  "forehead": { "trait": "...", "strength": "...", "weakness": "...", "confidence": "high | medium | low | not_visible" },
  "eyebrows": { "trait": "...", "strength": "...", "weakness": "...", "confidence": "high | medium | low | not_visible" },
  "eyes": { "trait": "...", "strength": "...", "weakness": "...", "confidence": "high | medium | low | not_visible" },
  "nose": { "trait": "...", "strength": "...", "weakness": "...", "confidence": "high | medium | low | not_visible" },
  "lips_mouth": { "trait": "...", "strength": "...", "weakness": "...", "confidence": "high | medium | low | not_visible" },
  "chin_jaw": { "trait": "...", "strength": "...", "weakness": "...", "confidence": "high | medium | low | not_visible" },
  "ears": { "trait": "...", "strength": "...", "weakness": "...", "confidence": "high | medium | low | not_visible" },
  "career_and_social_nature": "...",
  "improvement_advice": "...",
  "disclaimer": "Traditional Samudrika Shastra symbolic reading disclaimer."
}`;

    const apiResponse = await callGeminiWithRetry(
      {
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: normalizedMime === 'image/jpg' ? 'image/jpeg' : normalizedMime, data: cleanBase64 } }
            ]
          }
        ],
        generationConfig: { temperature: 0.45, maxOutputTokens: 4096, responseMimeType: 'application/json' }
      },
      3
    );
    const rawText = apiResponse?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonString = extractJsonText(rawText);
    if (!jsonString) {
      return res.status(502).json({ error: 'INVALID_AI_RESPONSE', message: 'Empty response from Gemini Vision.' });
    }
    const parsed = JSON.parse(jsonString);
    parsed._meta = { mode: 'real_ai', model: GEMINI_MODEL, generated_at: new Date().toISOString() };
    return res.json(parsed);
  } catch (err) {
    return res.status(500).json({ error: 'FACE_ANALYSIS_FAILED', message: err?.message || 'Face analysis failed.' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AI PALM MYSTIC backend listening on port ${PORT} (AI configured: ${Boolean(GEMINI_API_KEY)})`);
  });
}

module.exports = { app, buildPalmistryPrompt, validateAndNormalizeReport, sanitizeCoordinates, REQUIRED_FIELDS };
