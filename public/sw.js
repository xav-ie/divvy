// divvy's service worker exists only so browsers offer to install the app.
// It has no fetch handler on purpose: every page and API request goes to the
// network as usual (balances must never be served stale, and Cloudflare Access
// redirects must reach the browser untouched).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
