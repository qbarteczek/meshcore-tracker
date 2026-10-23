// Tryb offline: pliki aplikacji z pamięci telefonu, w tle sprawdzana nowsza wersja (gdy jest internet).
// Pliki zawsze pobierane z pominięciem pamięci przeglądarki (cache: 'reload' / 'no-cache'): Cloudflare każe
// przeglądarce trzymać .js przez kilka godzin, więc inaczej nowa wersja instalowałaby stare pliki.
const CACHE = 'tracker-psa-v7';
const FILES = ['./', 'index.html', 'app.css', 'lang.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

const key = (url) => { const u = new URL(url, self.location.href); u.search = ''; u.hash = ''; return u.href; };

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(FILES.map((f) =>
    fetch(new Request(f, { cache: 'reload' })).then((r) => {
      if (!r.ok) throw new Error(f + ': ' + r.status);
      return c.put(key(f), r);
    })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const k = key(e.request.url);
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(k);
    const net = fetch(e.request, { cache: 'no-cache' })
      .then((r) => { if (r.ok) c.put(k, r.clone()); return r; })
      .catch(() => hit);
    return hit || net;
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((w) => (w.length ? w[0].focus() : self.clients.openWindow('./'))));
});
