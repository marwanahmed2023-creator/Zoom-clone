function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function base64Url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\\+/g, "-").replace(/\\//g, "_");
}

async function createLiveKitToken(apiKey, apiSecret, room, identity) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: apiKey,
    sub: identity,
    iat: now,
    nbf: now,
    exp: now + 7200,
    video: {
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  }));
  const unsignedToken = header + "." + payload;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsignedToken));
  return unsignedToken + "." + base64Url(signature);
}

export async function onRequestPost({ request, env }) {
  try {
    const { room, identity } = await request.json();
    const apiKey = env.LIVEKIT_API_KEY;
    const apiSecret = env.LIVEKIT_API_SECRET;
    const livekitUrl = env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
      return json({ error: "LiveKit is not configured. Add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to Cloudflare Pages environment variables." }, 503);
    }

    if (typeof room !== "string" || !room.trim() || typeof identity !== "string" || !identity.trim()) {
      return json({ error: "Room and name are required." }, 400);
    }

    const roomName = room.trim().slice(0, 80);
    const participantName = identity.trim().slice(0, 50);
    const token = await createLiveKitToken(apiKey, apiSecret, roomName, participantName);
    return json({ token, url: livekitUrl });
  } catch (error) {
    console.error("Token creation failed:", error);
    return json({ error: "Could not create meeting token." }, 500);
  }
}
