import { AccessToken } from "livekit-server-sdk";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function clean(value, max = 50) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function sameName(a, b) {
  return String(a || "").trim().toLocaleLowerCase() === String(b || "").trim().toLocaleLowerCase();
}

async function serviceRequest(env, method, body) {
  const key = clean(env.LIVEKIT_API_KEY, 200);
  const secret = clean(env.LIVEKIT_API_SECRET, 300);
  const wsUrl = clean(env.LIVEKIT_URL, 300);
  if (!key || !secret || !wsUrl) throw new Error("LiveKit is not configured.");
  const base = wsUrl.replace(/^wss:/, "https:").replace(/\/$/, "");
  const access = new AccessToken(key, secret, { identity: "meet-call-service", ttl: "5m" });
  // Room-admin operations must be scoped to the exact room being updated.
  const grant = {};
  if (method === "CreateRoom") grant.roomCreate = true;
  if (method === "ListRooms") grant.roomList = true;
  if (method === "UpdateRoomMetadata") {
    grant.roomAdmin = true;
    grant.room = clean(body.room, 100);
    if (!grant.room) throw new Error("A room name is required to update call status.");
  }
  access.addGrant(grant);
  const jwt = await access.toJwt();
  const response = await fetch(base + "/twirp/livekit.RoomService/" + method, {
    method: "POST",
    headers: { "Authorization": "Bearer " + jwt, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.error || "LiveKit call service request failed.");
  return data;
}

async function getRoom(env, room) {
  const data = await serviceRequest(env, "ListRooms", { names: [room] });
  return data.rooms?.[0] || null;
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const identity = clean(url.searchParams.get("identity"));
    if (!identity) return json({ error: "Your display name is required." }, 400);

    if (type === "incoming") {
      const data = await serviceRequest(env, "ListRooms", { names: [] });
      const calls = (data.rooms || []).flatMap((room) => {
        let meta;
        try { meta = JSON.parse(room.metadata || "{}"); } catch { return []; }
        if (meta.status !== "ringing" || !sameName(meta.callee, identity)) return [];
        if (!meta.createdAt || Date.now() - meta.createdAt > 60000) return [];
        return [{ room: room.name, caller: meta.caller, createdAt: meta.createdAt }];
      });
      return json({ calls: calls.slice(0, 3) });
    }

    if (type === "status") {
      const roomName = clean(url.searchParams.get("room"), 100);
      if (!roomName) return json({ error: "Call room is required." }, 400);
      const room = await getRoom(env, roomName);
      if (!room) return json({ status: "expired" });
      let meta = {};
      try { meta = JSON.parse(room.metadata || "{}"); } catch {}
      if (!sameName(meta.caller, identity)) return json({ error: "This call does not belong to you." }, 403);
      if (meta.status === "ringing" && Date.now() - meta.createdAt > 60000) return json({ status: "expired" });
      return json({ status: meta.status || "expired" });
    }
    return json({ error: "Unknown call request." }, 400);
  } catch (error) {
    return json({ error: error.message || "Call service unavailable." }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const action = clean(body.action, 20);

    if (action === "invite") {
      const caller = clean(body.caller);
      const callee = clean(body.callee);
      if (!caller || !callee) return json({ error: "Both display names are required." }, 400);
      if (sameName(caller, callee)) return json({ error: "You cannot call yourself." }, 400);
      const room = "call-" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
      const metadata = JSON.stringify({ caller, callee, status: "ringing", createdAt: Date.now() });
      await serviceRequest(env, "CreateRoom", {
        name: room,
        emptyTimeout: 90,
        maxParticipants: 2,
        metadata,
      });
      return json({ room });
    }

    if (action === "respond") {
      const roomName = clean(body.room, 100);
      const identity = clean(body.identity);
      if (!roomName || !identity) return json({ error: "Call and display name are required." }, 400);
      const room = await getRoom(env, roomName);
      if (!room) return json({ error: "This call has expired." }, 404);
      let meta = {};
      try { meta = JSON.parse(room.metadata || "{}"); } catch {}
      const isCaller = sameName(meta.caller, identity);
      const isCallee = sameName(meta.callee, identity);
      if (body.cancel && isCaller) {
        meta.status = "cancelled";
      } else if (isCallee && meta.status === "ringing") {
        meta.status = body.accept ? "accepted" : "declined";
      } else {
        return json({ error: "You are not allowed to respond to this call." }, 403);
      }
      await serviceRequest(env, "UpdateRoomMetadata", { room: roomName, metadata: JSON.stringify(meta) });
      return json({ ok: true, status: meta.status });
    }

    return json({ error: "Unknown call action." }, 400);
  } catch (error) {
    return json({ error: error.message || "Call service unavailable." }, 500);
  }
}
