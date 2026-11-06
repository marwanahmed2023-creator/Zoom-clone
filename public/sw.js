self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch {}
    const room = String(data.room || "");
    const callee = String(data.callee || "");
    if (!room || !callee) return;

    // Push can be delayed by the OS. Verify that the call is still ringing
    // before showing anything, so a declined/cancelled call never resurfaces.
    try {
      const check = await fetch(
        self.location.origin + "/api/call?type=incoming&identity=" + encodeURIComponent(callee),
        { cache: "no-store" }
      );
      if (!check.ok) return;
      const result = await check.json();
      if (!(result.calls || []).some(call => call.room === room)) return;
    } catch {
      return;
    }

    await self.registration.showNotification(data.title || "Incoming Convo call", {
      body: data.body || "Someone is calling you.",
      tag: "meet-call-" + room,
      renotify: false,
      silent: false,
      requireInteraction: true,
      data: { url: data.url || "/", room }
    });
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
