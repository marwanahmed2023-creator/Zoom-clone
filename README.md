# Meet — video meetings

A browser-based video meeting app built with React and LiveKit.

## Current build
- Responsive landing page
- Start an instant meeting or join with a room name/ID
- LiveKit-powered group video and audio
- LiveKit VideoConference interface, including participant controls, chat and screen sharing
- Server-side access-token generation (API secrets are never sent to the browser)

## Deploy on Netlify

This repository is configured for Netlify. Netlify hosts the website and the secure token endpoint as a Netlify Function. LiveKit carries the real-time audio/video and screen-share media; that media does not pass through Netlify.

1. Push this repository to GitHub.
2. In Netlify, choose **Add new site → Import an existing project** and connect this GitHub repository.
3. Keep the build command as `npm run build` and publish directory as `dist` (the included `netlify.toml` already sets these).
4. In **Site configuration → Environment variables**, add:
   - `LIVEKIT_URL` — the LiveKit server URL (starts with `wss://`)
   - `LIVEKIT_API_KEY` — your LiveKit API key
   - `LIVEKIT_API_SECRET` — your LiveKit API secret
5. Trigger a deploy. Do not put the API secret in frontend code or commit it to GitHub.

The app's `/api/token` endpoint is routed to the Netlify Function in production. The existing Express server remains available for local development.

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
