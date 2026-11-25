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

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function callGemini(apiKey, preferredModel, payload) {
  const candidates = Array.from(new Set([
    preferredModel,
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash'
  ].filter(Boolean)));

  const retryStatuses = new Set([404, 429, 500, 502, 503, 504]);
  let lastStatus = 502;
  let lastErr = '';

  const attempts = [
    ...candidates.map((m) => ({ model: m, delay: 0 })),
    { model: candidates[0], delay: 1200 }
  ];

  for (const step of attempts) {
    if (step.delay > 0) {
      await new Promise((r) => setTimeout(r, step.delay));
    }
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(step.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000)
      });
      if (res.ok) {
        const data = await res.json();
        return { ok: true, data, usedModel: step.model };
      }
      lastStatus = res.status;
      lastErr = await res.text().catch(() => '');
      if (!retryStatuses.has(res.status)) {
        return { ok: false, status: lastStatus, errTxt: lastErr };
      }
    } catch (e) {
      lastStatus = 504;
      lastErr = e?.message || 'Request timeout';
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
    const model = String((env && env.GEMINI_MODEL) || 'gemini-3.5-flash-lite').trim();

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

    // 1b. Universal Village / Town / City Search Proxy (India + Global)
    if (path === '/api/search-place' && request.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) return jsonRes({ results: [] });
      const results = [];
      const seen = new Set();
      const pushUnique = (display, lat, lon, tz = 5.5) => {
        const key = `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
        if (!display || Number.isNaN(Number(lat)) || Number.isNaN(Number(lon)) || seen.has(key)) return;
        seen.add(key);
        results.push({ display: display.slice(0, 88), lat: Number(lat).toFixed(4), lon: Number(lon).toFixed(4), tz });
      };

      try {
        const omRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=12&language=en&format=json`, {
          signal: AbortSignal.timeout(7000)
        });
        if (omRes.ok) {
          const omJson = await omRes.json();
          const list = Array.isArray(omJson?.results) ? omJson.results : [];
          list.sort((a, b) => (b.country_code === 'IN' ? 1 : 0) - (a.country_code === 'IN' ? 1 : 0));
          for (const r of list) {
            const parts = [r.name, r.admin2, r.admin1, r.country].filter(Boolean);
            const tz = r.country_code === 'IN' ? 5.5 : Math.round((Number(r.longitude || 0) / 15) * 2) / 2;
            pushUnique(parts.join(', '), r.latitude, r.longitude, tz);
          }
        }
      } catch (_) {}

      if (results.length < 6) {
        try {
          const nomRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=10&q=${encodeURIComponent(q + ', India')}`, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'MAHAJYOTISH-App/1.0' },
            signal: AbortSignal.timeout(7000)
          });
          if (nomRes.ok) {
            const rows = await nomRes.json();
            if (Array.isArray(rows)) {
              for (const r of rows) {
                pushUnique(r.display_name, r.lat, r.lon, 5.5);
              }
            }
          }
        } catch (_) {}
      }

      if (results.length < 4) {
        try {
          const phRes = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8`, {
            signal: AbortSignal.timeout(6000)
          });
          if (phRes.ok) {
            const phJson = await phRes.json();
            const feats = Array.isArray(phJson?.features) ? phJson.features : [];
            for (const f of feats) {
              const p = f.properties || {};
              const coords = f.geometry?.coordinates || [];
              const parts = [p.name, p.county || p.city, p.state, p.country].filter(Boolean);
              const tz = p.countrycode === 'IN' ? 5.5 : Math.round((Number(coords[0] || 0) / 15) * 2) / 2;
              pushUnique(parts.join(', '), coords[1], coords[0], tz);
            }
          }
        } catch (_) {}
      }

      return jsonRes({ results: results.slice(0, 15) });
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
- Carefully inspect the full palm at high detail and analyze ALL 7 lines (life_line, head_line, heart_line, fate_line, sun_line, mercury_line, relationship_lines). Even if secondary lines are faint or thin, describe what is observable and mark visibility as "low" or "medium" rather than "not_visible" unless completely cropped or blurred out.
- Provide normalized [0,1000] polyline coordinates in line_coordinates (life_line, head_line, heart_line, fate_line, sun_line, mercury_line, relationship_lines) wherever visually traceable.
- Never predict death, serious illness, or exact marriage dates.
Return ONLY valid JSON with all keys: ${REQUIRED_FIELDS.join(', ')}, line_coordinates, and life_pillar_scores.
Ensure "detected_features" is an object containing: hand_analyzed, palm_type, finger_proportions, thumb_characteristics, and "line_visibility" (an object with keys life_line, head_line, heart_line, fate_line, sun_line, mercury_line, relationship_lines, each set to "high", "medium", "low", or "not_visible").`;

        const result = await callGemini(apiKey, model, {
          contents: [{
            role: 'user',
            parts: [
              { text: promptText },
              { inlineData: { mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType, data: cleanBase64 } }
            ]
          }],
          generationConfig: { temperature: 0.45, topP: 0.9, maxOutputTokens: 4096, responseMimeType: 'application/json' }
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
        if (!parsed.detected_features || typeof parsed.detected_features !== 'object' || Array.isArray(parsed.detected_features)) {
          parsed.detected_features = {};
        }
        if (!parsed.detected_features.line_visibility || typeof parsed.detected_features.line_visibility !== 'object') {
          parsed.detected_features.line_visibility = {};
        }
        for (const lk of ['life_line', 'head_line', 'heart_line', 'fate_line', 'sun_line', 'mercury_line', 'relationship_lines']) {
          const cur = parsed.detected_features.line_visibility[lk] || parsed.detected_features[lk];
          if (cur && cur !== 'not_visible') {
            parsed.detected_features.line_visibility[lk] = cur === 'clear' || cur === 'visible' ? 'high' : cur === 'moderate' ? 'medium' : cur === 'faint' ? 'low' : cur;
          } else if (Array.isArray(parsed.line_coordinates?.[lk]) && parsed.line_coordinates[lk].length > 0) {
            parsed.detected_features.line_visibility[lk] = 'medium';
          } else if (typeof parsed[lk] === 'string' && parsed[lk].trim() && parsed[lk] !== 'not_visible') {
            parsed.detected_features.line_visibility[lk] = 'medium';
          } else {
            parsed.detected_features.line_visibility[lk] = 'not_visible';
          }
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
        const prompt = `Answer concisely (3-5 sentences for voice playback) in ${targetLang} based ONLY on this report JSON: ${JSON.stringify(report || {}).slice(0, 12000)}\nQuestion: ${question}`;

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

    // 5. Personalized AI Jyotish (Kundli, Name Correction, Marriage Prediction)
    if (path === '/api/ai-jyotish' && request.method === 'POST') {
      try {
        if (!apiKey) {
          return jsonRes({ error: 'AI_NOT_CONFIGURED', message: 'Set MY_GEMINI_KEY in Cloudflare Worker Variables and Secrets.' }, 503);
        }
        const { mode = 'kundli', data = {}, language = 'hi' } = await request.json().catch(() => ({}));
        const targetLang = language === 'en' ? 'English' : 'Hindi (स्पष्ट, व्यक्तिगत और पारंपरिक वैदिक ज्योतिष हिंदी)';
        let prompt = '';

        if (mode === 'kundli') {
          prompt = `You are a senior Vedic Astrologer. Generate a UNIQUE, deeply personalized Janam Kundli reading in ${targetLang} strictly for this person's exact chart data (NEVER give generic boilerplate):
${JSON.stringify(data).slice(0, 6000)}
Return ONLY valid JSON with keys:
- personality_summary (3-4 sentences tailored to exact Lagna, Moon Sign, Nakshatra & 1st/10th house planets)
- career_wealth (3-4 sentences referencing exact 2nd, 10th, 11th house planets & active Mahadasha)
- love_marriage (3-4 sentences referencing 7th house, Venus/Jupiter & Manglik status)
- health_mind (2-3 sentences)
- next_2_years (3 sentences based on current Mahadasha/Antardasha & Saturn/Jupiter transit)
- tailored_remedies (array of 4 specific Vedic & Lal Kitab remedies tailored ONLY to their weak/afflicted planets & current dasha)`;
        } else if (mode === 'name_correction') {
          prompt = `You are an Expert Chaldean & Vedic Numerologist. Give a UNIQUE, personalized Name Correction & Vibration Analysis in ${targetLang} for:
${JSON.stringify(data).slice(0, 4000)}
Return ONLY valid JSON with keys:
- name_diagnosis (3 sentences analyzing exact spelling, compound number, Mulank & Bhagyank interaction)
- lucky_spelling_tip (2-3 sentences on the best single spelling tweak and why)
- career_finance_impact (2-3 sentences)
- signature_and_remedy (2-3 sentences: signature angle, lucky color/day, mobile/business number tip)`;
        } else if (mode === 'marriage') {
          prompt = `You are an Expert Vedic Marriage & Relationship Astrologer. Generate a UNIQUE, detailed Marriage & Future Spouse Prediction in ${targetLang} based strictly on this person's birth details & 7th house / Navamsha / Venus / Jupiter data:
${JSON.stringify(data).slice(0, 5000)}
Return ONLY valid JSON with keys:
- marriage_timing (detailed prediction of when marriage is most likely: exact favorable years, age range & auspicious months)
- marriage_type (Love Marriage vs Arranged Marriage vs Love-cum-Arranged with percentage and astrological reason)
- spouse_nature (4 sentences about future life partner's temperament, values, loyalty & family attitude)
- spouse_appearance (3-4 sentences describing realistic Indian facial features, complexion tone, eyes, smile, hair, build & aura based on 7th sign & Venus/Jupiter)
- spouse_career (2-3 sentences about likely profession/field & financial stability)
- spouse_direction_initials (likely direction from birthplace, zodiac signs, and 3-5 probable first letters of partner's name)
- first_meeting_story (3 sentences on how and where you are likely to meet)
- marriage_remedies (array of 3 practical Vedic remedies for timely & happy marriage)
- sketch_prompt_en (a concise, photorealistic hand-drawn graphite pencil portrait prompt in English describing the future spouse's face based on gender=${data.spouseGender || 'female'}, age=${data.spouseAge || '25'}, Indian ethnicity, eyes, smile, hairstyle, traditional-modern attire, soft shading on cream sketch paper — strictly no text, no watermark)`;
        } else {
          return jsonRes({ error: 'INVALID_MODE', message: 'Unsupported mode.' }, 400);
        }

        const result = await callGemini(apiKey, model, {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.72, maxOutputTokens: 2048, responseMimeType: 'application/json' }
        });
        if (!result.ok) {
          return jsonRes({ error: 'GEMINI_ERROR', message: `HTTP ${result.status}: ${result.errTxt.slice(0, 220)}` }, 502);
        }
        const jsonStr = extractJson(result.data?.candidates?.[0]?.content?.parts?.[0]?.text || '');
        if (!jsonStr) return jsonRes({ error: 'INVALID_AI_RESPONSE', message: 'Non-JSON AI response.' }, 502);
        const parsed = JSON.parse(jsonStr);
        parsed._meta = { mode: 'real_ai', model: result.usedModel };
        return jsonRes(parsed);
      } catch (err) {
        return jsonRes({ error: 'JYOTISH_AI_FAILED', message: err?.message || 'AI Jyotish failed.' }, 500);
      }
    }

    // 6. Real AI Soulmate Pencil Sketch Generator
    if (path === '/api/marriage-sketch' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const promptEn = String(body.promptEn || '').trim() || 'Hand-drawn graphite pencil portrait sketch of a kind, graceful young Indian person smiling warmly, fine charcoal shading, detailed expressive eyes, sketchbook paper background, no text';
        const seed = Number(body.seed) || Math.floor(Math.random() * 999999);
        const fullPrompt = `${promptEn}, realistic hand-drawn graphite & charcoal pencil sketch portrait on warm ivory sketchbook paper, fine cross-hatching shading, artistic soulmate sketch style, centered head-and-shoulders portrait, clean background, no text, no letters, no watermark`;

        // Tier 1: Gemini Native Image Generation (Nano Banana models)
        if (apiKey) {
          const imgModels = ['gemini-3.1-flash-lite-image', 'gemini-nano-banana-2.1', 'gemini-3.1-flash-image'];
          for (const im of imgModels) {
            try {
              const ep = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(im)}:generateContent?key=${encodeURIComponent(apiKey)}`;
              const res = await fetch(ep, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
                  generationConfig: { responseModalities: ['IMAGE'] }
                }),
                signal: AbortSignal.timeout(22000)
              });
              if (res.ok) {
                const j = await res.json();
                const parts = j?.candidates?.[0]?.content?.parts || [];
                const imgPart = parts.find((p) => p?.inlineData?.data);
                if (imgPart) {
                  const mime = imgPart.inlineData.mimeType || 'image/png';
                  return jsonRes({
                    imageDataUrl: `data:${mime};base64,${imgPart.inlineData.data}`,
                    engine: im
                  });
                }
              }
            } catch (_) {}
          }
        }

        // Tier 2: Server-side Real AI Diffusion Sketch (Pollinations Flux)
        try {
          const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=768&height=960&nologo=true&seed=${seed}`;
          const pRes = await fetch(pollUrl, {
            headers: { 'User-Agent': 'MAHAJYOTISH-Worker/1.0' },
            signal: AbortSignal.timeout(22000)
          });
          if (pRes.ok) {
            const ctype = pRes.headers.get('content-type') || 'image/jpeg';
            if (ctype.startsWith('image/')) {
              const buf = await pRes.arrayBuffer();
              if (buf.byteLength > 2000) {
                const b64 = arrayBufferToBase64(buf);
                return jsonRes({
                  imageDataUrl: `data:${ctype.split(';')[0]};base64,${b64}`,
                  engine: 'ai-diffusion-sketch'
                });
              }
            }
          }
        } catch (_) {}

        return jsonRes({ error: 'SKETCH_UNAVAILABLE', message: 'AI image server is busy right now. Please try again in a few seconds.' }, 503);
      } catch (err) {
        return jsonRes({ error: 'SKETCH_FAILED', message: err?.message || 'Sketch generation failed.' }, 500);
      }
    }

    // 7. Serve all static frontend files (index.html, manifest.json, sw.js, icons)
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('MAHAJYOTISH Worker Active — Static ASSETS binding missing.', { status: 200 });
  }
};