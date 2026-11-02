function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
export async function onRequestGet({ env }) {
  if (!env.VAPID_PUBLIC_KEY) return json({ error: "Background push is not configured yet." }, 503);
  return json({ publicKey: env.VAPID_PUBLIC_KEY });
}
