const REQUIRED_FIELDS = [
  'overall_summary', 'personality', 'palm_shape', 'life_line', 'head_line',
  'heart_line', 'fate_line', 'sun_line', 'mercury_line', 'relationship_lines',
  'career', 'business', 'money', 'love', 'marriage', 'family', 'strengths',
  'weaknesses', 'opportunities', 'next_12_months', 'next_5_years', 'next_10_years',
  'spiritual_growth', 'personalized_advice', 'lucky_color', 'lucky_number',
  'lucky_day', 'detected_features', 'confidence', 'image_quality', 'disclaimer'
];

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

function extractJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return a !== -1 && b > a ? s.slice(a, b + 1) : null;
}

async function callGemini(apiKey, preferredModel, payload) {
  const candidates = Array.from(new Set([
    preferredModel,
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3.0-flash',
    'gemini-2.5-flash'
  ].filter(Boolean)));

  let lastStatus = 502;
  let lastErr = '';
  for (const m of candidates) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, data, usedModel: m };
    }
    lastStatus = res.status;
    lastErr = await res.text().catch(() => '');
    if (res.status !== 404) {
      break;
    }
  }
  return { ok: false, status: lastStatus, errTxt: lastErr };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/worker.js' || path === '/wrangler.jsonc' || path === '/.assetsignore') return new Response('Not Found', { status: 404 });

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    const apiKey = String((env && (env.MY_GEMINI_KEY || env.GEMINI_API_KEY || env.GOOGLE_AI_KEY || env.GEMINI_KEY || env.API_KEY)) || '').trim();
    const model = String((env && env.GEMINI_MODEL) || 'gemini-3.8-flash').trim();

    // 1. Health Check
    if (path === '/api/health' && request.method === 'GET') {
      return jsonRes({
        status: 'ok',
        platform: 'cloudflare-worker',
        aiConfigured: Boolean(apiKey),
        envKeys: env ? Object.keys(env) : [],
        model,
        timestamp: new Date().toISOString()
      });
    }

    // 2. Palm Analysis
    if (path === '/api/analyze-palm' && request.method === 'POST') {
      try {
        if (!apiKey) {
          return jsonRes({ error: 'AI_NOT_CONFIGURED', message: 'Set MY_GEMINI_KEY in Cloudflare Worker Variables and Secrets.' }, 503);
        }
        const body = await request.json().catch(() => ({}));
        const { imageBase64, mimeType = 'image/jpeg', handSide = 'right', language = 'hi' } = body;
        if (!imageBase64 || typeof imageBase64 !== 'string') {
          return jsonRes({ error: 'MISSING_IMAGE', message: 'Base64 palm image required.' }, 400);
        }

        const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
        const targetLang = language === 'en' ? 'English' : 'Hindi (सरल, सहज, प्रीमियम पारंपरिक हस्तरेखा हिंदी)';
        const handLabel = handSide === 'left' ? 'Left Hand' : 'Right Hand';

        const promptText = `You are an Expert Gemini AI Vision Engineer and Traditional Palmistry Expert.
Analyze the ACTUAL uploaded palm image (${handLabel}). Write all narrative text in ${targetLang}.
STRICT RULES:
- Describe ONLY clearly visible features. Mark unclear lines as "not_visible" and return [] for their coordinates.
- Provide normalized [0,1000] polyline coordinates in line_coordinates (life_line, head_line, heart_line, fate_line, sun_line) ONLY where visually verifiable.
- Never predict death, serious illness, or exact marriage dates.
Return ONLY valid JSON with all keys: ${REQUIRED_FIELDS.join(', ')}, line_coordinates, and life_pillar_scores.`;

        const result = await callGemini(apiKey, model, {
          contents: [{
            role: 'user',
            parts: [
              { text: promptText },
              { inlineData: { mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType, data: cleanBase64 } }
            ]
          }],
          generationConfig: { temperature: 0.45, topP: 0.9, maxOutputTokens: 8192, responseMimeType: 'application/json' }
        });

        if (!result.ok) {
          return jsonRes({ error: 'GEMINI_ERROR', message: `HTTP ${result.status}: ${result.errTxt.slice(0, 220)}` }, 502);
        }

        const rawText = result.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonStr = extractJson(rawText);
        if (!jsonStr) {
          return jsonRes({ error: 'INVALID_AI_RESPONSE', message: 'Gemini returned non-JSON output.' }, 502);
        }
        const parsed = JSON.parse(jsonStr);
        for (const f of REQUIRED_FIELDS) {
          if (parsed[f] === undefined || parsed[f] === null || parsed[f] === '') parsed[f] = 'not_visible';
        }
        parsed._meta = { mode: 'real_ai', model: result.usedModel, platform: 'cloudflare-worker', language, generated_at: new Date().toISOString() };
        return jsonRes(parsed);
      } catch (err) {
        return jsonRes({ error: 'ANALYSIS_FAILED', message: err?.message || 'Palm analysis failed.' }, 500);
      }
    }

    // 3. Face Reading Analysis
    if (path === '/api/analyze-face' && request.method === 'POST') {
      try {
        if (!apiKey) {
          return jsonRes({ error: 'AI_NOT_CONFIGURED', message: 'Set MY_GEMINI_KEY in Cloudflare Worker Variables and Secrets.' }, 503);
        }
        const { imageBase64, mimeType = 'image/jpeg', language = 'hi' } = await request.json().catch(() => ({}));
        if (!imageBase64) return jsonRes({ error: 'MISSING_IMAGE', message: 'Face image required.' }, 400);

        const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
        const targetLang = language === 'en' ? 'English' : 'Hindi (सरल, सम्मानजनक पारंपरिक सामुद्रिक शास्त्र हिंदी)';
        const prompt = `You are a Traditional Samudrika Shastra (Face Reading) Expert. Analyze ONLY clearly visible facial features in ${targetLang}. Return ONLY valid JSON with keys: overall_nature, face_shape, forehead, eyebrows, eyes, nose, lips_mouth, chin_jaw, ears (each having trait, strength, weakness, confidence), career_and_social_nature, improvement_advice, disclaimer.`;

        const result = await callGemini(apiKey, model, {
          contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType, data: cleanBase64 } }] }],
          generationConfig: { temperature: 0.45, maxOutputTokens: 4096, responseMimeType: 'application/json' }
        });
        if (!result.ok) {
          return jsonRes({ error: 'GEMINI_ERROR', message: `HTTP ${result.status}: ${result.errTxt.slice(0, 220)}` }, 502);
        }
        const jsonStr = extractJson(result.data?.candidates?.[0]?.content?.parts?.[0]?.text || '');
        if (!jsonStr) return jsonRes({ error: 'INVALID_AI_RESPONSE', message: 'Empty response from Gemini.' }, 502);
        const parsed = JSON.parse(jsonStr);
        parsed._meta = { mode: 'real_ai', model: result.usedModel, platform: 'cloudflare-worker', generated_at: new Date().toISOString() };
        return jsonRes(parsed);
      } catch (err) {
        return jsonRes({ error: 'FACE_ANALYSIS_FAILED', message: err?.message || 'Face analysis failed.' }, 500);
      }
    }

    // 4. Voice Q&A
    if (path === '/api/ask-palm' && request.method === 'POST') {
      try {
        if (!apiKey) {
          return jsonRes({ error: 'AI_NOT_CONFIGURED', message: 'Set MY_GEMINI_KEY in Cloudflare Worker Variables and Secrets.' }, 503);
        }
        const { question, report, language = 'hi' } = await request.json().catch(() => ({}));
        if (!question) return jsonRes({ error: 'MISSING_QUESTION', message: 'Question is required.' }, 400);

        const targetLang = language === 'en' ? 'English' : 'Hindi (सरल बोलचाल की हिंदी)';
        const prompt = `Answer concisely (3-5 sentences for voice playback) in ${targetLang} based ONLY on this palm report JSON: ${JSON.stringify(report || {}).slice(0, 12000)}\nQuestion: ${question}`;

        const result = await callGemini(apiKey, model, {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 512 }
        });
        if (!result.ok) {
          return jsonRes({ error: 'GEMINI_ERROR', message: `HTTP ${result.status}: ${result.errTxt.slice(0, 220)}` }, 502);
        }
        const answer = result.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        return jsonRes({ answer });
      } catch (err) {
        return jsonRes({ error: 'QA_FAILED', message: err?.message || 'Voice Q&A failed.' }, 500);
      }
    }

    // 5. Serve all static frontend files (index.html, manifest.json, sw.js, icons)
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('MAHAJYOTISH Worker Active — Static ASSETS binding missing.', { status: 200 });
  }
};
