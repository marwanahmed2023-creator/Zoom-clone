import { AccessToken } from "livekit-server-sdk";

function corsHeaders(request) {
  const origin = request?.headers.get("Origin") || "";
  const allowed = new Set(["https://localhost", "http://localhost", "capacitor://localhost", "https://zoom-clone.pages.dev"]);
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
  if (allowed.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status = 200, request = null) {
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: corsHeaders(request),
  });
}

export async function onRequestOptions({ request }) {
  return json(null, 204, request);
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const apiKey = (env.LIVEKIT_API_KEY || "").trim();
    const apiSecret = (env.LIVEKIT_API_SECRET || "").trim();
    const livekitUrl = (env.LIVEKIT_URL || "").trim();

    if (!apiKey || !apiSecret || !livekitUrl) {
      return json({
        error: "LiveKit is not configured. Check the three LIVEKIT variables in Cloudflare Pages Production settings.",
      }, 503, request);
    }

    if (!/^wss:\/\/.+\.livekit\.cloud$/.test(livekitUrl)) {
      return json({ error: "LIVEKIT_URL does not look like a LiveKit Cloud WebSocket URL." }, 500, request);
    }

    const room = typeof body.room === "string" ? body.room.trim().slice(0, 80) : "";
    const identity = typeof body.identity === "string" ? body.identity.trim().slice(0, 50) : "";

    if (!room || !identity) {
      return json({ error: "Room and name are required." }, 400, request);
    }

    // Use LiveKit's official server SDK so its JWT claims and signing
    // stay aligned with the authentication format expected by LiveKit.
    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity,
      name: identity,
      ttl: "2h",
    }, 200, request);

    accessToken.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await accessToken.toJwt();
    return json({ token, url: livekitUrl }, 200, request);
  } catch (error) {
    console.error("LiveKit token endpoint failed:", error);
    return json({ error: "Could not create a valid meeting token. Check the Cloudflare Pages function logs." }, 500, request);
  }
}
