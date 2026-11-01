import { AccessToken } from "livekit-server-sdk";

export default async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST" },
    });
  }

  try {
    const { room, identity } = await request.json();
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
      return new Response(JSON.stringify({ error: "LiveKit is not configured. Add the three LiveKit environment variables in Netlify." }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (typeof room !== "string" || !room.trim() || typeof identity !== "string" || !identity.trim()) {
      return new Response(JSON.stringify({ error: "Room and name are required." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const roomName = room.trim().slice(0, 80);
    const participantName = identity.trim().slice(0, 50);
    const token = new AccessToken(apiKey, apiSecret, {
      identity: participantName,
      ttl: "2h",
    });
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return new Response(JSON.stringify({ token: await token.toJwt(), url: livekitUrl }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Token creation failed:", error);
    return new Response(JSON.stringify({ error: "Could not create meeting token." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
