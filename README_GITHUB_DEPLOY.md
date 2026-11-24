# MAHAJYOTISH — GitHub Deployment & Complete Ramayan Data Folder

Developed by **Mahaindustries** (Pro. **Ankit Sharma** • Contact: **7500343487**)

## Folder Structure for GitHub
- `public/index.html` — Complete MAHAJYOTISH Web App (can be deployed directly to **GitHub Pages** or served via `server.js`).
- `public/manifest.json` & `public/sw.js` — PWA Install files (`icon-192.png`, `icon-512.png`).
- `public/data/ramayan/` — Dedicated 7-Kand Ramayan folder (`manifest.json` + `kand_1_bal.json` ... `kand_7_uttar.json`).
  - You can expand any `kand_*.json` file with all 10,900+ public-domain Ramcharitmanas verses in the same `{ "type": "चौपाई", "text": "..." }` format, or load any `.txt` / `.json` Ramayan file directly inside the app's **7-काण्ड रामायण रीडर**.
- `server.js` — Secure Node.js/Express Gemini Vision backend (deploy on Render/Railway/Cloud Run with `GEMINI_API_KEY` in `.env`).
