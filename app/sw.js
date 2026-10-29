// Tryb offline: pliki aplikacji z pamięci telefonu, w tle sprawdzana nowsza wersja (gdy jest internet).
// Pliki zawsze pobierane z pominięciem pamięci przeglądarki (cache: 'reload' / 'no-cache'): Cloudflare każe
// przeglądarce trzymać .js przez kilka godzin, więc inaczej nowa wersja instalowałaby stare pliki.
// Kafelki mapy OSM: każdy obejrzany kafelek zostaje w osobnej pamięci (nie znika przy nowej wersji aplikacji),
// najpierw z pamięci, z sieci tylko brakujące; najstarsze usuwane powyżej MAX_TILES.
const CACHE = 'tracker-psa-v8';
const TILES = 'tracker-psa-tiles';
const MAX_TILES = 6000;   // ok. 100–150 MB
const FILES = ['./', 'index.html', 'app.css', 'lang.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'vendor/leaflet.js', 'vendor/leaflet.css'];

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
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== TILES).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

let puts = 0;
async function trimTiles(c) {
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);   // keys() w kolejności zapisu
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(e.request.url);
      if (hit) return hit;
      try {
        const r = await fetch(e.request);
        if (r.ok) { await c.put(e.request.url, r.clone()); if (++puts % 100 === 0) trimTiles(c); }
        return r;
      } catch {
        return new Response('', { status: 504 });   // brak internetu i brak kafelka: puste pole na mapie
      }
    }));
    return;
  }
  if (url.origin !== location.origin) return;
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
