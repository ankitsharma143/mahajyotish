# MAHAJYOTISH — Cloudflare Pages (via GitHub) Deployment Guide
Developed by **Mahaindustries** (Pro. **Ankit Sharma** • Contact: **7500343487**)

## Cloudflare Pages पर GitHub से लाइव करने के 4 आसान स्टेप्स:
1. इस `MAHAJYOTISH_Cloudflare_Ready.zip` को अनज़िप करें और सभी फाइलें (`index.html`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` और `functions/` फोल्डर) अपनी GitHub Repository के मुख्य (root) फोल्डर में अपलोड करें।
2. **Cloudflare Dashboard** → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → अपनी GitHub Repo चुनें।
3. **Build settings** में:
   - Framework preset: **None**
   - Build command: *(खाली छोड़ें)*
   - Build output directory: `/` (या खाली)
4. **Settings → Environment variables** में जाकर जोड़ें:
   - Variable name: `GEMINI_API_KEY`
   - Value: *(आपकी असली Gemini API Key)*
   - Save करके **Retry deployment** करें।

बस! आपकी `*.pages.dev` साइट पर **Frontend + PWA Install + Real Gemini AI (`/api/analyze-palm`, `/api/analyze-face`, `/api/ask-palm`)** सब अपने आप चलने लगेगा!
