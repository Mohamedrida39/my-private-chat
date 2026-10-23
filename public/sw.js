'use strict';
const SHELL = 'shell-v1';
const ASSETS = ['/', '/style.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// نخزّن هيكل الواجهة فقط (شبكة أولاً). لا نلمس /api ولا /socket.io أبداً — لا بيانات محادثة في الكاش.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// الجرس: إشعار صامت تماماً.
// ملاحظة: لا نمرّر vibrate مع silent:true (المتصفح يرفض الجمع بينهما).
self.addEventListener('push', (e) => {
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const focused = wins.find((w) => w.visibilityState === 'visible' && w.focused);
      if (focused) {
        focused.postMessage({ t: 'bell' }); // التطبيق مفتوح أمامه: حركة الجرس داخل الواجهة فقط
        return;
      }
      await self.registration.showNotification('🔔', {
        body: '',
        icon: '/icons/bell-192.png',
        badge: '/icons/badge-96.png',
        tag: 'bell',
        silent: true,
        renotify: false,
        requireInteraction: false,
        data: { url: '/' },
      });
    })()
  );
});

// الضغط على الإشعار يفتح/يُظهر التطبيق فقط ولا يؤثر على المحادثة
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (wins.length) return wins[0].focus();
      return self.clients.openWindow('/');
    })()
  );
});
