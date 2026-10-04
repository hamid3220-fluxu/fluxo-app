// FLUXO service worker: shows push notifications and opens the right page
// when one is tapped. It deliberately does no offline caching.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch { message = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(message.title || 'FLUXO', {
    body: message.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: message.tag || undefined,
    data: { url: message.url || '/' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'fluxo-open', url: target });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
