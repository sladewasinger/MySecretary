const CACHE_NAME = 'my-secretary-v2';
const APP_ASSETS = ['/', '/manifest.webmanifest', '/icons/icon-192.svg', '/icons/icon-512.svg', '/runtime-config.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key === CACHE_NAME) {
            return Promise.resolve();
          }
          return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  const action = event.action || 'open';
  const notificationData = event.notification.data || {};
  event.notification.close();

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      });
      const payload = {
        type: 'notification-action',
        taskId: notificationData.taskId || null,
        action
      };

      if (clientsList.length > 0) {
        const targetClient = clientsList[0];
        targetClient.postMessage(payload);
        if ('focus' in targetClient) {
          await targetClient.focus();
        }
        return;
      }

      const url = new URL(self.location.origin);
      if (notificationData.taskId) {
        url.searchParams.set('taskId', notificationData.taskId);
      }
      url.searchParams.set('action', action);
      await self.clients.openWindow(url.toString());
    })()
  );
});

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  const title = payload.title || 'My Secretary';
  const options = {
    body: payload.body || 'You have a due task.',
    tag: payload.tag || `my-secretary-${payload.taskId || 'task'}`,
    renotify: true,
    requireInteraction: true,
    data: {
      taskId: payload.taskId || null
    },
    actions: [
      { action: 'complete', title: 'Complete' },
      { action: 'snooze_5', title: 'Snooze 5m' },
      { action: 'snooze_10', title: 'Snooze 10m' },
      { action: 'snooze_30', title: 'Snooze 30m' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
