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

    // 1b. Universal Global Village / Town / City Search Proxy (All Countries + Exact IANA Timezone)
    if (path === '/api/search-place' && request.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) return jsonRes({ results: [] });
      const results = [];
      const seen = new Set();
      const pushUnique = (display, lat, lon, tz = 5.5, ianaTz = '') => {
        const key = `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
        if (!display || Number.isNaN(Number(lat)) || Number.isNaN(Number(lon)) || seen.has(key)) return;
        seen.add(key);
        results.push({ display: display.slice(0, 88), lat: Number(lat).toFixed(4), lon: Number(lon).toFixed(4), tz, ianaTz });
      };

      try {
        const omRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=15&language=en&format=json`, {
          signal: AbortSignal.timeout(7000)
        });
        if (omRes.ok) {
          const omJson = await omRes.json();
          const list = Array.isArray(omJson?.results) ? omJson.results : [];
          for (const r of list) {
            const parts = [r.name, r.admin2, r.admin1, r.country].filter(Boolean);
            const tz = r.country_code === 'IN' ? 5.5 : Math.round((Number(r.longitude || 0) / 15) * 2) / 2;
            pushUnique(parts.join(', '), r.latitude, r.longitude, tz, r.timezone || (r.country_code === 'IN' ? 'Asia/Kolkata' : ''));
          }
        }
      } catch (_) {}

      if (results.length < 6) {
        try {
          const nomRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=10&q=${encodeURIComponent(q)}`, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'MAHAJYOTISH-App/1.0' },
            signal: AbortSignal.timeout(7000)
          });
          if (nomRes.ok) {
            const rows = await nomRes.json();
            if (Array.isArray(rows)) {
              for (const r of rows) {
                const cc = String(r.address?.country_code || '').toUpperCase();
                const tz = cc === 'IN' ? 5.5 : Math.round((Number(r.lon || 0) / 15) * 2) / 2;
                pushUnique(r.display_name, r.lat, r.lon, tz, cc === 'IN' ? 'Asia/Kolkata' : '');
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
              pushUnique(parts.join(', '), coords[1], coords[0], tz, p.countrycode === 'IN' ? 'Asia/Kolkata' : '');
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

        const promptText = `You are a Senior Traditional Indian Samudrika Shastra (Hastrekha) Master & Gemini Vision Analyst.
Analyze the ACTUAL uploaded palm image (${handLabel}) in deep, crystal-clear, easy-to-understand ${targetLang} so a layperson understands every detail uniquely for THIS specific palm (NEVER give short 1-line generic boilerplate).
STRICT RULES:
- Inspect the palm shape, fingers, thumb, all major mounts (गुरु, शनि, सूर्य, बुध, शुक्र, चंद्र, मंगल पर्वत) and ALL 7 lines (life_line, head_line, heart_line, fate_line, sun_line, mercury_line, relationship_lines).
- For EVERY major narrative field (overall_summary, personality, life_line, head_line, heart_line, fate_line, sun_line, mercury_line, relationship_lines, career, business, money, love, marriage, family, personalized_advice), write 3 to 5 clear, warm, specific sentences explaining what is visually observed on THIS palm (depth, curve, length, mount prominence) and what it traditionally signifies in easy everyday Hindi/English.
- Under "relationship_lines", "marriage", and "family": examine the Mercury mount (little finger edge) and Venus mount for traditional symbolic signs of relationship harmony, emotional depth, partnership style, and family/parenthood warmth. NEVER claim guaranteed exact numbers of children, child gender, exact number of marriages, death, or serious illness — clearly keep it traditional symbolic guidance.
- Even if secondary lines are faint or thin, describe what is observable and set visibility to "low" or "medium" rather than "not_visible" unless completely cropped or blurred out.
- Provide normalized [0,1000] polyline coordinates in line_coordinates (life_line, head_line, heart_line, fate_line, sun_line, mercury_line, relationship_lines) wherever visually traceable.
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
          generationConfig: { temperature: 0.65, topP: 0.92, maxOutputTokens: 6144, responseMimeType: 'application/json' }
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
          prompt = `You are a Master Indian Vedic Astrologer (Parashari + Bhrigu + Lal Kitab). Generate a 100% UNIQUE, ultra-detailed, crystal-clear Janam Kundli Life Report in ${targetLang} strictly derived from THIS person's exact astronomical chart (NEVER write short generic lines; explain every single point thoroughly in easy Hindi/English citing their exact Lagna, 7th House, 10th House, Moon Sign, Nakshatra+Pada, Retrograde/Combust planets, Yogas, Doshas & exact Mahadasha/Antardasha dates):
${JSON.stringify(data).slice(0, 7500)}
Return ONLY valid JSON with these 10 keys:
- marriage_timing_and_type (4-5 sentences: exact favorable marriage years & age window, Love vs Arranged probability, and 7th lord / Venus / Jupiter role)
- spouse_appearance_and_nature (4-5 sentences: detailed description of future spouse's complexion/face/build/eyes/aura, temperament, profession & likely direction from birthplace)
- career_best_fields (4-5 sentences: exact top 4-5 best career/job/business fields suited to their 10th house, 10th lord, D10 & Sun/Saturn/Mercury/Jupiter — clearly comparing Govt Job vs Private vs Business)
- wealth_property_vehicle (3-4 sentences: money accumulation, property/home/vehicle yoga and peak financial growth years)
- past_timeline (4 sentences: key past life phases & struggles/achievements strictly from their completed Mahadasha years)
- present_situation (4 sentences: what is happening right now from their active Mahadasha, Antardasha, Pratyantardasha & live Saturn/Jupiter Gochar)
- future_roadmap (4-5 sentences: detailed year-by-year outlook for the next 5 to 10 years covering breakthroughs, promotions, wealth & major milestones)
- all_doshas_and_yogas_deep (4-5 sentences: honest, clear check of Manglik, Kaal Sarp, Pitra Dosha, Grahan Dosha, Kemdrum Dosha, Shani Sade Sati/Dhaiya & Rajyogas — explaining clearly which ones exist, which do NOT exist, and their real impact)
- health_and_family_life (3-4 sentences: health tendencies, mental peace, parents & family harmony)
- friends_social_network (3-4 sentences from 3rd & 11th house: friendships, social circle, who genuinely supports them vs who to be cautious with)
- planet_by_planet_impact (5-6 clear bullet-style sentences explaining in simple Hindi what each major planet is actively causing in their life due to its exact house & dignity)
- tailored_remedies (array of 6 specific, practical Vedic & Lal Kitab remedies strictly tailored to THIS chart's weak/afflicted planets & active dasha)`;
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
        } else if (mode === 'tarot') {
          prompt = `You are a Master Vedic & Intuitive Tarot Reader. Provide a UNIQUE, deeply insightful 3-Card Tarot Reading in ${targetLang} for this user's exact question and drawn cards:
${JSON.stringify(data).slice(0, 4000)}
Return ONLY valid JSON with keys:
- past_card_reading (2-3 sentences on how the Past card shaped their situation)
- present_card_reading (2-3 sentences on current energies & hidden factors)
- future_card_reading (3 sentences on upcoming outcome & timeline)
- final_guidance (2-3 sentences of clear, empowering practical advice)
- lucky_affirmation (1 uplifting Hindi/English mantra or affirmation)`;
        } else if (mode === 'love') {
          prompt = `You are a Master Vedic Numerologist & Relationship Compatibility Expert. Analyze this couple's exact name & face compatibility data and explain clearly in ${targetLang} WHY they received this exact percentage (NEVER generic boilerplate; reference their exact names, Chaldean numbers, ruling planets, shared letters, Soul Urge vowels & Name-Rashi elements):
${JSON.stringify(data).slice(0, 4500)}
Return ONLY valid JSON with keys:
- why_this_score (3-4 sentences clearly explaining what specific name/planet/letter factors produced their exact percentage)
- deepest_strength (3 sentences on their strongest emotional & mental bond)
- potential_friction (2-3 sentences on where misunderstandings can happen and how to avoid them)
- marriage_future (3 sentences on long-term stability & marriage potential)
- couple_tips (array of 3 specific practical tips/remedies for this exact pair)`;
        } else {
          return jsonRes({ error: 'INVALID_MODE', message: 'Unsupported mode.' }, 400);
        }

        const result = await callGemini(apiKey, model, {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.72, maxOutputTokens: 4096, responseMimeType: 'application/json' }
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

    // 6. Real AI Soulmate Pencil Sketch Generator (Fast & 100% Guaranteed)
    if (path === '/api/marriage-sketch' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const promptEn = String(body.promptEn || '').trim() || 'Hand-drawn graphite pencil portrait sketch of a graceful young Indian person smiling warmly, fine charcoal shading, detailed eyes, sketchbook paper, no text';
        const seed = Math.abs(Number(body.seed) || Math.floor(Math.random() * 999999));
        const spouseGender = String(body.spouseGender || (promptEn.toLowerCase().includes('man') && !promptEn.toLowerCase().includes('woman') ? 'male' : 'female'));

        // Tier 1: Fast Real AI Diffusion Sketch (Pollinations Flux, 7s timeout)
        try {
          const shortPrompt = promptEn.slice(0, 180) + ', graphite pencil portrait sketch on ivory paper, fine charcoal shading, no text';
          const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(shortPrompt)}?model=flux&width=512&height=640&nologo=true&seed=${seed}`;
          const pRes = await fetch(pollUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(7000)
          });
          if (pRes.ok) {
            const ctype = pRes.headers.get('content-type') || 'image/jpeg';
            if (ctype.startsWith('image/')) {
              const buf = await pRes.arrayBuffer();
              if (buf.byteLength > 2500) {
                return jsonRes({
                  imageDataUrl: `data:${ctype.split(';')[0]};base64,${arrayBufferToBase64(buf)}`,
                  engine: 'Real AI Flux Sketch'
                });
              }
            }
          }
        } catch (_) {}

        // Tier 2: Gemini AI Portrait Illustrator SVG (using working Gemini key, 14s timeout)
        if (apiKey) {
          try {
            const svgPrompt = `Draw a graceful, realistic hand-drawn graphite pencil portrait sketch as a standalone SVG (xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500") of: ${promptEn} (gender=${spouseGender}, variation=${seed % 97}).
Use warm cream sketchbook paper gradient (#f7f1e3 to #e8dcc4), fine graphite/charcoal paths (#1c1917, #292524, #44403c, #57534e) for hair strands, expressive eyes with iris & catchlight, eyebrows, natural nose, warm smiling lips, jawline shading, neck & Indian attire. NO text or letters inside SVG. Output ONLY raw <svg ...>...</svg>.`;
            const ep = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
            const gRes = await fetch(ep, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: svgPrompt }] }],
                generationConfig: { temperature: 0.85, maxOutputTokens: 3500 }
              }),
              signal: AbortSignal.timeout(14000)
            });
            if (gRes.ok) {
              const gj = await gRes.json();
              const rawSvg = gj?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              const a = rawSvg.indexOf('<svg');
              const b = rawSvg.lastIndexOf('</svg>');
              if (a !== -1 && b > a) {
                let cleanSvg = rawSvg.slice(a, b + 6);
                if (!cleanSvg.includes('xmlns=')) cleanSvg = cleanSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
                const svgBytes = new TextEncoder().encode(cleanSvg);
                return jsonRes({
                  imageDataUrl: `data:image/svg+xml;base64,${arrayBufferToBase64(svgBytes.buffer)}`,
                  engine: 'Gemini AI Sketch'
                });
              }
            }
          } catch (_) {}
        }

        // Tier 3: Guaranteed Seed-Unique Graphite Portrait Sketch (Never fails / never busy)
        const isFemale = spouseGender !== 'male';
        const v1 = (seed % 5) - 2; // -2..2 jaw width
        const v2 = ((seed >> 3) % 5) - 2; // eye spacing
        const v3 = ((seed >> 6) % 3); // hair/beard style
        const jawW = 68 + v1 * 3;
        const eyeY = 212 + (v2 % 2) * 2;
        const smileCurve = 294 + (seed % 4);
        const hairFemale = v3 === 0
          ? `<path d="M116 218 C108 135 142 84 200 82 C258 84 292 135 284 218 C294 278 292 355 276 410 C266 356 266 285 262 230 C254 168 232 136 200 132 C168 136 146 168 138 230 C134 285 134 356 124 410 C108 355 106 278 116 218 Z" fill="url(#hairG)" stroke="#1c1917" stroke-width="1.6"/>`
          : v3 === 1
          ? `<path d="M118 224 C112 132 146 80 200 80 C254 80 288 132 282 224 C298 286 306 346 286 392 C272 346 268 278 264 226 C252 158 224 132 200 128 C176 132 148 158 136 226 C132 278 128 346 114 392 C94 346 102 286 118 224 Z" fill="url(#hairG)" stroke="#1c1917" stroke-width="1.6"/>`
          : `<path d="M120 220 C114 134 148 84 200 84 C252 84 286 134 280 220 C276 268 270 305 264 334 C258 272 260 218 256 184 C246 142 224 128 200 126 C176 128 154 142 144 184 C140 218 142 272 136 334 C130 305 124 268 120 220 Z" fill="url(#hairG)" stroke="#1c1917" stroke-width="1.6"/><circle cx="200" cy="76" r="24" fill="url(#hairG)" stroke="#1c1917" stroke-width="1.5"/>`;
        const hairMale = v3 === 0
          ? `<path d="M128 212 C122 142 144 92 200 90 C256 92 278 142 272 212 C266 174 256 146 232 138 C206 132 184 140 162 144 C144 150 134 176 128 212 Z" fill="url(#hairG)" stroke="#1c1917" stroke-width="1.8"/>`
          : `<path d="M128 210 C120 138 148 86 204 86 C256 88 278 136 272 210 C266 166 250 138 220 132 C188 126 154 136 138 164 Z" fill="url(#hairG)" stroke="#1c1917" stroke-width="1.8"/>`;
        const facialExtra = isFemale
          ? `<circle cx="200" cy="${eyeY - 16}" r="3.4" fill="#292524"/><ellipse cx="128" cy="264" rx="4.5" ry="7" fill="none" stroke="#44403c" stroke-width="1.6"/><ellipse cx="272" cy="264" rx="4.5" ry="7" fill="none" stroke="#44403c" stroke-width="1.6"/><path d="M156 358 Q200 398 244 358" fill="none" stroke="#44403c" stroke-width="1.8" stroke-dasharray="3 2"/>`
          : (v3 !== 2 ? `<path d="M142 264 C144 304 168 334 200 336 C232 334 256 304 258 264 C248 292 228 318 200 320 C172 318 152 292 142 264 Z" fill="#292524" opacity="0.22"/><path d="M174 282 Q200 274 226 282" fill="none" stroke="#292524" stroke-width="2.6" opacity="0.65" stroke-linecap="round"/>` : '');

        const procSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500">
          <defs>
            <radialGradient id="paperG" cx="50%" cy="42%" r="65%"><stop offset="0%" stop-color="#faf5e8"/><stop offset="72%" stop-color="#efe5d1"/><stop offset="100%" stop-color="#dfd0b4"/></radialGradient>
            <linearGradient id="hairG" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#292524"/><stop offset="50%" stop-color="#44403c"/><stop offset="100%" stop-color="#1c1917"/></linearGradient>
            <linearGradient id="shadeG" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#292524" stop-opacity="0.16"/><stop offset="55%" stop-color="#292524" stop-opacity="0.02"/><stop offset="100%" stop-color="#292524" stop-opacity="0.2"/></linearGradient>
          </defs>
          <rect width="400" height="500" fill="url(#paperG)"/>
          <g stroke="#78716c" stroke-width="0.6" opacity="0.22">
            <line x1="28" y1="54" x2="96" y2="28"/><line x1="305" y1="42" x2="372" y2="88"/><line x1="34" y1="440" x2="108" y2="478"/><line x1="296" y1="466" x2="368" y2="424"/>
          </g>
          ${isFemale ? hairFemale : ''}
          <!-- Shoulders & Traditional Kurta/Dupatta -->
          <path d="M84 495 C92 418 128 386 168 374 L232 374 C272 386 308 418 316 495 Z" fill="#e7dbc5" stroke="#292524" stroke-width="2.1"/>
          <path d="M168 374 L200 426 L232 374" fill="none" stroke="#292524" stroke-width="2"/>
          <path d="M108 495 Q142 426 172 384 M292 495 Q258 426 228 384" fill="none" stroke="#57534e" stroke-width="1.2" opacity="0.55"/>
          <!-- Neck & Shadow -->
          <path d="M174 322 L172 378 Q200 392 228 378 L226 322 Z" fill="#efe4cf" stroke="#292524" stroke-width="1.8"/>
          <path d="M174 326 Q200 348 226 326 L225 344 Q200 356 175 344 Z" fill="#292524" opacity="0.18"/>
          <!-- Ears -->
          <path d="M${200 - jawW + 2} 226 C${200 - jawW - 14} 226 ${200 - jawW - 12} 260 ${200 - jawW + 4} 262" fill="#f3ead8" stroke="#292524" stroke-width="1.8"/>
          <path d="M${200 + jawW - 2} 226 C${200 + jawW + 14} 226 ${200 + jawW + 12} 260 ${200 + jawW - 4} 262" fill="#f3ead8" stroke="#292524" stroke-width="1.8"/>
          <!-- Face Contour -->
          <path d="M${200 - jawW} 214 C${200 - jawW} 148 164 122 200 122 C236 122 ${200 + jawW} 148 ${200 + jawW} 214 C${200 + jawW} 274 238 332 200 336 C162 332 ${200 - jawW} 274 ${200 - jawW} 214 Z" fill="#f6efe1" stroke="#1c1917" stroke-width="2.1"/>
          <path d="M${200 - jawW} 214 C${200 - jawW} 148 164 122 200 122 C236 122 ${200 + jawW} 148 ${200 + jawW} 214 C${200 + jawW} 274 238 332 200 336 C162 332 ${200 - jawW} 274 ${200 - jawW} 214 Z" fill="url(#shadeG)"/>
          ${!isFemale ? hairMale : ''}
          <!-- Eyebrows -->
          <path d="M150 ${eyeY - 14} Q168 ${eyeY - 24} 186 ${eyeY - 15}" fill="none" stroke="#1c1917" stroke-width="${isFemale ? '2.6' : '3.6'}" stroke-linecap="round"/>
          <path d="M214 ${eyeY - 15} Q232 ${eyeY - 24} 250 ${eyeY - 14}" fill="none" stroke="#1c1917" stroke-width="${isFemale ? '2.6' : '3.6'}" stroke-linecap="round"/>
          <!-- Expressive Almond Eyes -->
          <path d="M153 ${eyeY} Q169 ${eyeY - 10} 185 ${eyeY} Q169 ${eyeY + 8} 153 ${eyeY} Z" fill="#fffdf8" stroke="#1c1917" stroke-width="2"/>
          <circle cx="169" cy="${eyeY}" r="5.4" fill="#1c1917"/><circle cx="171" cy="${eyeY - 2}" r="1.7" fill="#ffffff"/>
          <path d="M215 ${eyeY} Q231 ${eyeY - 10} 247 ${eyeY} Q231 ${eyeY + 8} 215 ${eyeY} Z" fill="#fffdf8" stroke="#1c1917" stroke-width="2"/>
          <circle cx="231" cy="${eyeY}" r="5.4" fill="#1c1917"/><circle cx="233" cy="${eyeY - 2}" r="1.7" fill="#ffffff"/>
          <!-- Nose -->
          <path d="M200 ${eyeY + 4} L196 254 Q200 262 208 256" fill="none" stroke="#292524" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M190 256 Q195 260 198 258 M203 258 Q207 260 211 256" fill="none" stroke="#44403c" stroke-width="1.4" stroke-linecap="round"/>
          <!-- Warm Smiling Lips -->
          <path d="M177 284 Q188 279 200 282 Q212 279 223 284 Q200 ${smileCurve} 177 284 Z" fill="#d6c4ae" stroke="#1c1917" stroke-width="1.7"/>
          <path d="M179 284 Q200 290 221 284" fill="none" stroke="#292524" stroke-width="1.3"/>
          ${facialExtra}
          <!-- Sketch Cross-Hatching Shading -->
          <g stroke="#44403c" stroke-width="0.9" opacity="0.28">
            <line x1="142" y1="240" x2="152" y2="256"/><line x1="146" y1="252" x2="156" y2="268"/><line x1="248" y1="240" x2="258" y2="256"/><line x1="244" y1="252" x2="254" y2="268"/>
            <line x1="186" y1="306" x2="214" y2="306"/>
          </g>
          <rect x="14" y="14" width="372" height="472" rx="12" fill="none" stroke="#78716c" stroke-width="1.2" opacity="0.45"/>
        </svg>`;
        const pBytes = new TextEncoder().encode(procSvg);
        return jsonRes({
          imageDataUrl: `data:image/svg+xml;base64,${arrayBufferToBase64(pBytes.buffer)}`,
          engine: 'Astro-Art Sketch ✓'
        });
      } catch (err) {
        return jsonRes({ error: 'SKETCH_FAILED', message: err?.message || 'Sketch generation failed.' }, 500);
      }
    }

    // 6b. Real-Time Unified AI Jyotish Guru (Kundli + Palm + Numerology + Profile)
    if (path === '/api/ai-guru' && request.method === 'POST') {
      try {
        if (!apiKey) return jsonRes({ error: 'AI_NOT_CONFIGURED', message: 'Set MY_GEMINI_KEY.' }, 503);
        const { question, context = {}, language = 'hi' } = await request.json().catch(() => ({}));
        if (!question) return jsonRes({ error: 'MISSING_QUESTION', message: 'Question required.' }, 400);
        const targetLang = language === 'en' ? 'English' : 'Hindi (सरल, आत्मीय और सटीक वैदिक गुरुजी शैली की हिंदी)';
        const prompt = `You are MAHAJYOTISH Acharya AI Guru — a compassionate, deeply knowledgeable Vedic Astrologer, Palmist, Numerologist & Vastu Expert.
Answer the user's question in ${targetLang} in 4-6 clear, warm sentences suitable for both reading and voice playback. Use their available chart/palm/profile context below if present (never invent chart details not given; give practical Vedic remedies where helpful):
Context: ${JSON.stringify(context).slice(0, 6000)}
User Question: ${question}`;
        const result = await callGemini(apiKey, model, {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.65, maxOutputTokens: 700 }
        });
        if (!result.ok) return jsonRes({ error: 'GEMINI_ERROR', message: `HTTP ${result.status}` }, 502);
        const answer = result.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        return jsonRes({ answer, model: result.usedModel });
      } catch (err) {
        return jsonRes({ error: 'GURU_FAILED', message: err?.message || 'AI Guru failed.' }, 500);
      }
    }

    // 6c. AI Vastu Floorplan / Home Map Vision Scanner
    if (path === '/api/analyze-vastu-map' && request.method === 'POST') {
      try {
        if (!apiKey) return jsonRes({ error: 'AI_NOT_CONFIGURED', message: 'Set MY_GEMINI_KEY.' }, 503);
        const { imageBase64, mimeType = 'image/jpeg', facing = 'East', propertyType = 'Home', language = 'hi' } = await request.json().catch(() => ({}));
        if (!imageBase64) return jsonRes({ error: 'MISSING_IMAGE', message: 'Floorplan image required.' }, 400);
        const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
        const targetLang = language === 'en' ? 'English' : 'Hindi (सरल, व्यावहारिक वास्तु शास्त्र हिंदी)';
        const prompt = `You are a Senior Indian Vastu Shastra & Architectural Floorplan Expert.
Analyze this uploaded ${propertyType} floorplan/map image assuming the main entrance/facing direction is ${facing}. Write all text in ${targetLang}.
Return ONLY valid JSON with keys:
- vastu_score (integer 45 to 96)
- overall_verdict (2-3 sentences summarizing energy flow)
- entrance_analysis (2 sentences)
- kitchen_bedroom_analysis (3 sentences)
- brahmasthan_toilet_analysis (2-3 sentences)
- detected_doshas (array of 3-4 concise observed Vastu issues)
- non_demolition_remedies (array of 4-5 practical बिना तोड़-फोड़ Vastu remedies using colors, mirrors, salt, plants, pyramid, lighting)`;
        const result = await callGemini(apiKey, model, {
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType, data: cleanBase64 } }
            ]
          }],
          generationConfig: { temperature: 0.45, maxOutputTokens: 2048, responseMimeType: 'application/json' }
        });
        if (!result.ok) return jsonRes({ error: 'GEMINI_ERROR', message: `HTTP ${result.status}` }, 502);
        const jsonStr = extractJson(result.data?.candidates?.[0]?.content?.parts?.[0]?.text || '');
        if (!jsonStr) return jsonRes({ error: 'INVALID_AI_RESPONSE', message: 'Non-JSON Vastu output.' }, 502);
        const parsed = JSON.parse(jsonStr);
        parsed._meta = { mode: 'real_ai', model: result.usedModel };
        return jsonRes(parsed);
      } catch (err) {
        return jsonRes({ error: 'VASTU_MAP_FAILED', message: err?.message || 'Vastu map scan failed.' }, 500);
      }
    }

    // 7. Serve all static frontend files (index.html, manifest.json, sw.js, icons)
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('MAHAJYOTISH Worker Active — Static ASSETS binding missing.', { status: 200 });
  }
};