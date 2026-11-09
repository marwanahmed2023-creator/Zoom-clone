import { buildPushPayload } from "@block65/webcrypto-web-push";
import { firestoreClient } from "./_firestore.js";

export async function sendCallPush(env, callee, caller, room) {
  if (!env.FIRESTORE_SERVICE_ACCOUNT_JSON || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;

  try {
    const { request: firestore } = await firestoreClient(env);
    const query = await firestore(":runQuery", {
      method: "POST",
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "push_subscriptions" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "identity_key" },
              op: "EQUAL",
              value: { stringValue: callee.trim().toLowerCase() }
            }
          }
        }
      })
    });

    for (const result of query || []) {
      const document = result.document;
      if (!document?.fields) continue;

      const fields = document.fields;
      const endpoint = fields.endpoint?.stringValue;
      const rawSubscription = fields.subscription_json?.stringValue;
      if (!endpoint || !rawSubscription) continue;

      try {
        const subscription = JSON.parse(rawSubscription);
        const payload = await buildPushPayload({
          data: JSON.stringify({
            title: "Incoming Convo call",
            body: caller + " is calling you.",
            room,
            callee,
            url: "/?incomingCall=" + encodeURIComponent(room)
          }),
          options: { ttl: 60 }
        }, subscription, {
          subject: "https://zoom-clone.pages.dev",
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY
        });

        const response = await fetch(endpoint, payload);
        if (response.status === 404 || response.status === 410) {
          await firestore("https://firestore.googleapis.com/v1/" + document.name, {
            method: "DELETE"
          });
        }
      } catch {
        // A single expired or malformed subscription must not block other devices.
      }
    }
  } catch (error) {
    console.error("Call push delivery failed:", error);
  }
}
