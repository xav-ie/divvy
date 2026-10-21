// divvy's service worker makes the app installable and shows push
// notifications. It has no fetch handler on purpose: every page and API
// request goes to the network as usual (balances must never be served stale,
// and Cloudflare Access redirects must reach the browser untouched).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

// `{ title, body, url }` from src/services/notifications.ts.
self.addEventListener("push", (event) => {
  const { title, body, url } = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(title ?? "divvy", {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-monochrome-512.png",
      data: { url: url ?? "/" },
    }),
  );
});

// Tapping one opens its page, in an open divvy window when there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", self.location.href);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const open = windows.find((w) => new URL(w.url).origin === url.origin);
      if (!open) return self.clients.openWindow(url.href);
      await open.focus();
      return open.navigate(url.href);
    })(),
  );
});

// The browser rotated the subscription: hand the server the new one.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const next =
        event.newSubscription ??
        (old && (await self.registration.pushManager.subscribe(old.options)));
      if (!next) return;
      await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next.toJSON()),
      });
      if (old)
        await fetch(
          `/api/push/subscriptions?endpoint=${encodeURIComponent(old.endpoint)}`,
          { method: "DELETE" },
        );
    })(),
  );
});
