// Minimal service worker so the portal can be installed as an app.
// It does not cache anything, so users always get the latest version.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
