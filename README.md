# Meet — video meetings

A browser-based video meeting app built with React and LiveKit.

## Current build
- Responsive landing page
- Start an instant meeting or join with a room name/ID
- LiveKit-powered group video and audio
- LiveKit VideoConference interface, including participant controls, chat and screen sharing
- Server-side access-token generation (API secrets are never sent to the browser)

## Deploy on Cloudflare Pages (free hosting)

Cloudflare Pages serves the React site globally and runs the secure `/api/token` endpoint as a Pages Function. LiveKit carries the actual audio, video and screen-share media; that media does not pass through the website host.

1. In Cloudflare, open **Workers & Pages → Create → Pages → Connect to Git** and select this GitHub repository.
2. Use `main` as the production branch, `npm run build` as the build command, and `dist` as the build output directory.
3. In the Pages project settings, add these three variables for both Production and Preview:
   - `LIVEKIT_URL` — the LiveKit server URL (starts with `wss://`)
   - `LIVEKIT_API_KEY` — your LiveKit API key
   - `LIVEKIT_API_SECRET` — your LiveKit API secret
4. Redeploy. Keep the API secret in Cloudflare's environment settings only; never put it in frontend code or GitHub.

The Cloudflare Pages Function at `functions/api/token.js` creates the short-lived meeting token using the Web Crypto API. The existing Express server remains available for local development. The Cloudflare Free plan includes 100,000 dynamic function requests per day; static asset requests are free and unlimited.

## Local development

Create a `.env` file from `.env.example`, add your LiveKit values, then run:

```bash
npm install
npm run dev
```

This starts the Vite frontend and Express token API; Vite proxies `/api` requests to port 3000.

## Performance approach

LiveKit/WebRTC handles media transport. Screen sharing uses the built-in LiveKit conference UI. Actual smoothness depends on device encoding support, browser, network conditions and LiveKit region; test with multiple devices and networks before calling it production-ready.

AI transcription, translation and summaries are intentionally deferred until the core meeting experience is stable.
