# AI PALM MYSTIC – Your Future in Your Hands

## Architecture
- `public/index.html` — Complete self-contained frontend web app (Live Camera + Gallery Hand Scanner, Client-Side Image Quality Validation, Coordinate-Based Canvas Line Overlay, 22+ Section Bilingual Hindi/English Palmistry Report, Saved History, Share, and Print/PDF Export).
- `server.js` — Secure Node.js/Express backend proxy that keeps `GEMINI_API_KEY` on the server, calls Gemini Vision (`gemini-2.5-flash`), enforces the 31-field JSON schema, and handles timeouts, retries, and rate limits.

## Quick Setup
1. Install dependencies (Node.js 18+ required):
   ```bash
   npm install
   ```
2. Create `.env` from `.env.example` and add your Gemini API Key:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set `GEMINI_API_KEY=...`.
3. Start the server:
   ```bash
   npm start
   ```
4. Open the app in your browser (or deploy `server.js` to Render / Railway / Cloud Run with HTTPS and paste the HTTPS `/api/analyze-palm` URL inside the app's **Backend Settings** panel).

## Security & Honesty Rules
- `GEMINI_API_KEY` is never exposed to the browser.
- If the backend or Gemini API key is not configured, Real AI Mode clearly informs the user instead of faking a reading.
- Demo Preview Mode is completely separate and clearly badged.
- Canvas line overlays are rendered only when verified `[0–1000]` coordinates are returned for a visible line.
