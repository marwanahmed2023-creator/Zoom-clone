import { firestoreClient } from "../../_firestore.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

async function subscriptionId(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const identity = typeof body.identity === "string" ? body.identity.trim().slice(0, 50) : "";
    const subscription = body.subscription;

    if (!identity || !subscription?.endpoint?.startsWith("https://") ||
        !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return json({ error: "A valid display name and push subscription are required." }, 400);
    }

    const { request: firestore } = await firestoreClient(env);
    const id = await subscriptionId(subscription.endpoint);
    const mask = ["identity_key", "endpoint", "subscription_json", "created_at"]
      .map((field) => "updateMask.fieldPaths=" + encodeURIComponent(field))
      .join("&");

    await firestore("/push_subscriptions/" + id + "?" + mask, {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          identity_key: { stringValue: identity.toLowerCase() },
          endpoint: { stringValue: subscription.endpoint },
          subscription_json: { stringValue: JSON.stringify(subscription) },
          created_at: { integerValue: String(Date.now()) }
        }
      })
    });

    return json({ ok: true });
  } catch (error) {
    return json({ error: error.message || "Could not save push subscription." }, 500);
  }
}
