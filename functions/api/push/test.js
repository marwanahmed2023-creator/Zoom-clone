import { buildPushPayload } from "@block65/webcrypto-web-push";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      return json({ error: "Background push is not fully configured on the server." }, 503);
    }
    const body = await request.json();
    const identity = typeof body.identity === "string" ? body.identity.trim().slice(0, 50) : "";
    if (!identity) return json({ error: "Your saved display name is required." }, 400);

    const rows = await env.DB.prepare(
      "SELECT endpoint, subscription_json FROM push_subscriptions WHERE identity_key = ?"
    ).bind(identity.toLowerCase()).all();

    if (!rows.results?.length) {
      return json({ sent: 0, message: "No push subscription is saved for this display name. Enable notifications again on this device." });
    }

    let sent = 0;
    let expired = 0;
    let failed = 0;
    for (const row of rows.results) {
      try {
        const subscription = JSON.parse(row.subscription_json);
        const payload = await buildPushPayload({
          data: JSON.stringify({
            title: "Meet test notification",
            body: "Background notifications are reaching this device.",
            url: "/"
          }),
          options: { ttl: 120 }
        }, subscription, {
          subject: "https://zoom-clone.pages.dev",
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY
        });
        const response = await fetch(row.endpoint, payload);
        if (response.ok) {
          sent += 1;
        } else if (response.status === 404 || response.status === 410) {
          expired += 1;
          await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(row.endpoint).run();
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }

    if (sent > 0) return json({ sent, expired, failed });
    return json({
      sent: 0,
      expired,
      failed,
      error: failed ? "The push service rejected or could not deliver the test. The server recorded a delivery failure." : "The saved push subscription has expired. Enable notifications again on this device."
    }, 502);
  } catch (error) {
    return json({ error: error.message || "Could not send a test notification." }, 500);
  }
}
