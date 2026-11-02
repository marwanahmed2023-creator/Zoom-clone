import { buildPushPayload } from "@block65/webcrypto-web-push";

export async function sendCallPush(env, callee, caller, room) {
  if (!env.DB || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  try {
    const rows = await env.DB.prepare(
      "SELECT endpoint, subscription_json FROM push_subscriptions WHERE identity_key = ?"
    ).bind(callee.trim().toLowerCase()).all();
    for (const row of rows.results || []) {
      try {
        const subscription = JSON.parse(row.subscription_json);
        const payload = await buildPushPayload({
          data: JSON.stringify({
            title: "Incoming Meet call",
            body: caller + " is calling you.",
            url: "/?incomingCall=" + encodeURIComponent(room)
          }),
          options: { ttl: 60 }
        }, subscription, {
          subject: "https://zoom-clone.pages.dev",
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY
        });
        const response = await fetch(row.endpoint, payload);
        if (response.status === 404 || response.status === 410) {
          await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(row.endpoint).run();
        }
      } catch {}
    }
  } catch {}
}
