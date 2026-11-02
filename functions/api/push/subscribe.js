function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ error: "The push database is not connected yet." }, 503);
    const body = await request.json();
    const identity = typeof body.identity === "string" ? body.identity.trim().slice(0, 50) : "";
    const subscription = body.subscription;
    if (!identity || !subscription?.endpoint?.startsWith("https://") || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return json({ error: "A valid display name and push subscription are required." }, 400);
    }
    await env.DB.prepare(
      "INSERT INTO push_subscriptions (identity_key, endpoint, subscription_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET identity_key = excluded.identity_key, subscription_json = excluded.subscription_json, created_at = excluded.created_at"
    ).bind(identity.toLowerCase(), subscription.endpoint, JSON.stringify(subscription), Date.now()).run();
    return json({ ok: true });
  } catch (error) {
    return json({ error: error.message || "Could not save push subscription." }, 500);
  }
}
