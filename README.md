# Meet — video meetings

A browser-based video meeting app built with React, LiveKit and Express.

## Current build
- Responsive landing page
- Start an instant meeting or join with a room name/ID
- LiveKit-powered group video and audio
- LiveKit VideoConference interface, including participant controls, chat and screen sharing
- Server-side access-token generation (API secrets are never sent to the browser)

## Required setup
Create a project in [LiveKit Cloud](https://cloud.livekit.io/) and copy its WebSocket URL, API key and API secret into a local `.env` file (use `.env.example` as the template).

Install and run:

```bash
npm install
cp .env.example .env
npm run dev
```

The `npm run dev` command starts both the Vite frontend and Express token API; Vite proxies `/api` requests to the API on port 3000. For production, build with `npm run build` and run with `npm start` after setting `NODE_ENV=production`.

## Deployment requirements
Deploy this as a Node.js web service (not a static-only site), set `NODE_ENV=production`, and add the three LiveKit environment variables. Never commit real API secrets.

## Performance approach
LiveKit/WebRTC handles media transport. Screen sharing uses the built-in LiveKit conference UI. Actual smoothness depends on device encoding support, browser, network conditions and LiveKit region; test with multiple devices and networks before calling it production-ready.

AI transcription, translation and summaries are intentionally deferred until the core meeting experience is stable.
