// Tracker psa – aplikacja w przeglądarce (Chrome na Androidzie) dla bazy polowej meshcore-tracker.
// Łączy się przez Web Bluetooth z companionem MeshCore (firmware TRACKER_BASE), czyta meldunki trackera
// (czytelne wiadomości od kontaktu trackera) i wysyła polecenia (#SZUKAJ, #STOP, #CO n, #BT, #DOM).
// Protokół: companion BLE MeshCore (Nordic UART), jedna ramka = jedna wartość charakterystyki.
// Widoki jak w Traccarze: mapa z kartą urządzenia, trasa (odtwarzanie, raport, przejścia i postoje, wykres),
// strefy (geofence), zdarzenia. Analizy i historia po dniach są w analiza.js.
// Wszystko działa bez internetu; z sieci pobierane są tylko kafelki mapy OSM (i zostają w telefonie, sw.js).
'use strict';

const VERSION = 'trk2-app-11-beta';
const UART = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';   // zapis do urządzenia
const UART_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';   // powiadomienia z urządzenia

const CMD = { APP_START: 1, SEND_TXT: 2, GET_CONTACTS: 4, SET_TIME: 6, SYNC_NEXT: 10, DEVICE_QUERY: 22 };
const RESP = { OK: 0, ERR: 1, CONTACTS_START: 2, CONTACT: 3, END_CONTACTS: 4, SELF_INFO: 5, SENT: 6,
  MSG: 7, NO_MORE: 10, DEVICE_INFO: 13, MSG_V3: 16 };
const PUSH = { ADVERT: 0x80, SEND_CONFIRMED: 0x82, MSG_WAITING: 0x83, NEW_ADVERT: 0x8a };

const MAX_REPORTS = 3000;      // ostatnie meldunki (mapa na żywo, radar); pełna historia po dniach: IndexedDB (analiza.js)
const JUMP_KMH = 80;           // szybsze "przeskoki" to błąd GPS, nie bieg psa – pomijane w dystansie

const $ = (id) => document.getElementById(id);
const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ stan (zapisany w telefonie)

const store = {
  get(k, d) { try { const v = localStorage.getItem('trk.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('trk.' + k, JSON.stringify(v)); } catch { /* brak miejsca / tryb prywatny */ } },
};

const S = {
  device: null, rx: null, wantConnected: false, connected: false,
  baseName: '', contacts: new Map(),           // prefix(12 hex) -> {name, lat, lon}
  tracker: store.get('tracker', ''),           // prefix wybranego trackera (karta, polecenia, trasa)
  dogName: store.get('dogname', ''),           // nazwa wybranego trackera z wersji < 11
  names: store.get('names', {}),               // prefix -> nazwa na mapie
  reports: store.get('reports', []),           // {t, lat, lon, fix, mv, pct, temp, sats, int, search, text, spd, crs}
  myTrail: store.get('mytrail', []),           // [lat, lon, t]
  battWarn: store.get('battwarn', true),
  me: null, heading: null, northUp: store.get('northup', true),
  tab: store.get('tab', 'map'), follow: store.get('follow', true),
  pendingCmd: null,                            // {text, ack, t, button}
  alarmShown: false, alarmMuted: 0, sound: store.get('sound', true), wake: null, lateEvent: false,
  syncing: false, writeChain: Promise.resolve(),
  rp: { list: [], cum: [], idx: 0, timer: null, segs: [], sel: null },
};

// ------------------------------------------------------------------ Bluetooth

async function connect() {
  if (!navigator.bluetooth) {
    status(t('Ta przeglądarka nie obsługuje Bluetooth. Użyj Chrome na Androidzie.'));
    return;
  }
  try {
    if (!S.device) {
      S.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'MeshCore-' }], optionalServices: [UART],
      });
      S.device.addEventListener('gattserverdisconnected', onDisconnected);
    }
    S.wantConnected = true;
    await openGatt();
  } catch (e) {
    if (e && e.name === 'NotFoundError') status(t('Nie wybrano urządzenia.'));
    else status(t('Nie udało się połączyć:') + ' ' + (e && e.message ? e.message : e));
  }
}

async function openGatt() {
  status(tf('Łączenie z {name}…', { name: S.device.name }));
  const server = await S.device.gatt.connect();
  const svc = await server.getPrimaryService(UART);
  S.rx = await svc.getCharacteristic(UART_RX);
  const tx = await svc.getCharacteristic(UART_TX);
  tx.addEventListener('characteristicvaluechanged', (ev) => {
    const v = ev.target.value;
    onFrame(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  });
  await tx.startNotifications();       // tu Android pyta o PIN parowania bazy
  S.connected = true;
  S.syncing = false;
  updateConnUI();
  await send([CMD.DEVICE_QUERY, 3]);
  await send([CMD.APP_START, 3, 32, 32, 32, 32, 32, 32, ...enc.encode('tracker-psa')]);
  const now = Math.floor(Date.now() / 1000);
  await send([CMD.SET_TIME, ...u32(now)]);   // zegar bazy z telefonu (baza może nie mieć RTC)
  await send([CMD.GET_CONTACTS]);
  syncMessages();
}

function onDisconnected() {
  S.connected = false;
  S.rx = null;
  updateConnUI();
  if (!S.wantConnected) return;
  addEvent('disc', t('Rozłączono z bazą'));
  status(t('Rozłączono z bazą – ponawiam połączenie…'));
  setTimeout(async function retry() {
    if (!S.wantConnected || S.connected) return;
    try { await openGatt(); } catch { setTimeout(retry, 5000); }
  }, 2000);
}

function disconnect() {
  S.wantConnected = false;
  if (S.device && S.device.gatt.connected) S.device.gatt.disconnect();
}

function send(bytes) {
  // zapisy po kolei – charakterystyka nie przyjmuje równoległych zapisów
  S.writeChain = S.writeChain.then(async () => {
    if (!S.rx) throw new Error('brak połączenia');
    const data = new Uint8Array(bytes);
    if (S.rx.writeValueWithoutResponse) await S.rx.writeValueWithoutResponse(data);
    else await S.rx.writeValue(data);
  }).catch((e) => { console.warn('zapis BLE:', e); });
  return S.writeChain;
}

const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const rdU32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const rdI32 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
const cstr = (b) => { const z = b.indexOf(0); return dec.decode(z >= 0 ? b.subarray(0, z) : b); };

async function syncMessages() {
  if (S.syncing || !S.connected) return;
  S.syncing = true;
  await send([CMD.SYNC_NEXT]);   // odpowiedź: wiadomość albo NO_MORE; kolejne pobieranie w onFrame
}

function onFrame(b) {
  const code = b[0];
  switch (code) {
    case RESP.SELF_INFO:
      S.baseName = cstr(b.subarray(58));
      status(tf('Połączono z bazą {name}.', { name: S.baseName }));
      addEvent('conn', tf('Połączono z bazą {name}.', { name: S.baseName }));
      break;
    case RESP.CONTACT: {
      const prefix = hex(b.subarray(1, 7));
      S.contacts.set(prefix, { name: cstr(b.subarray(100, 132)), lat: rdI32(b, 136) / 1e6, lon: rdI32(b, 140) / 1e6 });
      break;
    }
    case RESP.END_CONTACTS:
      fillTrackerSelect();
      render();
      break;
    case RESP.MSG_V3:
      onMessage(hex(b.subarray(4, 10)), rdU32(b, 12), dec.decode(b.subarray(16)), b[11]);
      send([CMD.SYNC_NEXT]);
      break;
    case RESP.MSG:
      onMessage(hex(b.subarray(1, 7)), rdU32(b, 9), dec.decode(b.subarray(13)), b[8]);
      send([CMD.SYNC_NEXT]);
      break;
    case RESP.NO_MORE:
      S.syncing = false;
      break;
    case PUSH.MSG_WAITING:
      syncMessages();
      break;
    case RESP.SENT:
      if (S.pendingCmd && S.pendingCmd.ack === null) {
        S.pendingCmd.ack = rdU32(b, 2);
        cmdStatus(tf('Polecenie „{c}” czeka w bazie na meldunek psa.', { c: S.pendingCmd.text }));
      }
      break;
    case PUSH.SEND_CONFIRMED:
      if (S.pendingCmd && S.pendingCmd.ack === rdU32(b, 1)) {
        cmdStatus(tf('Pies przyjął polecenie „{c}”.', { c: S.pendingCmd.text }));
        addEvent('cmd', tf('Pies przyjął polecenie „{c}”.', { c: S.pendingCmd.text }));
        if (S.pendingCmd.button) S.pendingCmd.button.classList.remove('pending');
        S.pendingCmd = null;
        if (navigator.vibrate) navigator.vibrate(60);
      }
      break;
    case RESP.ERR:
      if (S.pendingCmd && S.pendingCmd.ack === null) {
        cmdStatus(tf('Baza odrzuciła polecenie (kod {c}).', { c: b[1] }));
        if (S.pendingCmd.button) S.pendingCmd.button.classList.remove('pending');
        S.pendingCmd = null;
      }
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------------ meldunki

// Tekst z bazy (TrackerBase): "[✅ kontakt wrócił · ]<odl/GPS ok/bez GPS> · 3,98 V 82% · 22°C · 9 sat · co 60 s
// [· SZUKANIE][· po przerwie]\n[ostatnio: ]https://maps.google.com/?q=lat,lon"   albo   "⚠ brak meldunku od N min ..."
function parseReport(text) {
  const r = { text };
  const q = text.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (q) { r.lat = parseFloat(q[1]); r.lon = parseFloat(q[2]); }
  if (/^\s*⚠ brak meldunku/.test(text)) { r.alarm = true; return r; }
  const v = text.match(/(\d+),(\d+) V (\d+)%/);
  const sats = text.match(/(\d+) sat/);
  const iv = text.match(/co (\d+) s/);
  if (!v && !iv) return null;   // to nie jest meldunek
  r.fix = !!q && !/bez GPS/.test(text) && !/ostatnio:/.test(text);
  if (v) { r.mv = parseInt(v[1], 10) * 1000 + parseInt(v[2].padEnd(3, '0').slice(0, 3), 10); r.pct = parseInt(v[3], 10); }
  const tc = text.match(/(-?\d+)°C/);
  if (tc) r.temp = parseInt(tc[1], 10);
  r.sats = sats ? parseInt(sats[1], 10) : 0;
  r.int = iv ? parseInt(iv[1], 10) : 0;
  r.search = /SZUKANIE/.test(text);
  r.back = /kontakt wrócił/.test(text);
  return r;
}

// prędkość (km/h) i kurs z poprzedniej pozycji GPS
function motion(p, r) {
  if (!p) return;
  const dt = (r.t - p.t) / 1000;
  if (dt <= 0 || dt > 3 * 3600) return;
  const d = distM(p.lat, p.lon, r.lat, r.lon);
  r.spd = (d / dt) * 3.6;
  r.crs = d > 5 ? bearing(p.lat, p.lon, r.lat, r.lon) : p.crs;
}

function prepReports() {
  const prev = {};
  for (const r of S.reports) {
    if (r.text) r.text = r.text.split('\n')[0];
    const d = devOf(r);
    if (r.fix) { if (r.spd == null) motion(prev[d], r); prev[d] = r; }
  }
}

function onMessage(prefix, ts, text) {
  const r = parseReport(text);
  if (!r) return;                                   // zwykła wiadomość czatu – nie dla tej strony
  if (!S.tracker) { S.tracker = prefix; store.set('tracker', prefix); fillTrackerSelect(); }
  r.dev = prefix;                                   // kilka trackerów naraz – jak lista urządzeń w Traccarze
  const now = Date.now();
  r.t = ts > 1.6e9 && ts * 1000 < now + 120000 ? ts * 1000 : now;   // czas bazy (ustawiany z telefonu)
  r.text = text.split('\n')[0];
  if (r.alarm) {
    addEvent('alarm', r.text, true, r.t, r.lat != null ? r : null);
    return;
  }
  const prev = lastReport(prefix);
  if (r.fix) motion(lastFix(prefix), r);
  S.reports.push(r);
  if (S.reports.length > MAX_REPORTS) S.reports.splice(0, S.reports.length - MAX_REPORTS);
  store.set('reports', S.reports);
  checkEvents(r, prev);                             // strefy, bateria, szybki bieg… (analiza.js)
  if (r.fix) histAdd([r]).then(() => { if (S.tab === 'replay' && prefix === S.tracker) { fillDays(); loadReplay(false); } });
  if (prefix === S.tracker) {
    S.lateEvent = false;
    hideAlarm();
    if (S.follow && r.fix && map) map.panTo([r.lat, r.lon]);
  }
  render();
  renderDevices();
  if (A.evFilter === 'rep') renderEvents();
}

const devOf = (r) => r.dev || S.tracker;          // meldunki sprzed wersji 11 nie mają dev
function lastReport(dev = S.tracker) {
  for (let i = S.reports.length - 1; i >= 0; i--) if (devOf(S.reports[i]) === dev) return S.reports[i];
  return null;
}
function lastFix(dev = S.tracker) {
  for (let i = S.reports.length - 1; i >= 0; i--) if (S.reports[i].fix && devOf(S.reports[i]) === dev) return S.reports[i];
  return null;
}
const fixes = (dev = S.tracker) => S.reports.filter((r) => r.fix && devOf(r) === dev);
// trackery: wybrany pierwszy, potem pozostałe w kolejności ostatniego meldunku
function devices() {
  const out = S.tracker ? [S.tracker] : [];
  for (let i = S.reports.length - 1; i >= 0; i--) { const d = devOf(S.reports[i]); if (d && !out.includes(d)) out.push(d); }
  return out;
}
function selectDevice(dev) {
  if (!dev || dev === S.tracker) return;
  for (const r of S.reports) if (!r.dev) r.dev = S.tracker;   // utrwal przypisanie starych meldunków
  store.set('reports', S.reports);
  S.tracker = dev; store.set('tracker', dev);
  S.lateEvent = false; hideAlarm();
  lastDotsN = -1; if (dogMarker) dogMarker._key = null;
  fillTrackerSelect();
  $('inp-name').value = S.names[dev] || '';
  render(); renderDevices(); renderZones();
  if (S.tab === 'replay') fillDays().then(() => loadReplay(true));
  else centerOn('dog');
}

// ------------------------------------------------------------------ powiadomienia

function notify(text) {
  if ('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
    navigator.serviceWorker.ready.then((r) => r.showNotification(t('Tracker psa'), { body: text, tag: 'trk', renotify: true })).catch(() => {});
  }
}

// ------------------------------------------------------------------ polecenia

function sendCommand(text, button) {
  if (!S.connected || !S.tracker) {
    cmdStatus(S.connected ? t('Najpierw musi przyjść meldunek od psa (albo wybierz tracker w ustawieniach).')
      : t('Najpierw połącz się z bazą.'));
    return;
  }
  if (S.pendingCmd && S.pendingCmd.button) S.pendingCmd.button.classList.remove('pending');
  S.pendingCmd = { text, ack: null, t: Date.now(), button };
  if (button) button.classList.add('pending');
  const pre = S.tracker.match(/../g).map((h) => parseInt(h, 16));
  const ts = Math.floor(Date.now() / 1000);
  send([CMD.SEND_TXT, 0, 0, ...u32(ts), ...pre, ...enc.encode(text)]);
  cmdStatus(tf('Wysyłanie „{c}” do bazy…', { c: text }));
}

// ------------------------------------------------------------------ geografia

const R = 6371000, K = Math.PI / 180;
function distM(a, b, c, d) {
  const x = (c - a) * K, y = (d - b) * K;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a * K) * Math.cos(c * K) * Math.sin(y / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b, c, d) {
  const y = Math.sin((d - b) * K) * Math.cos(c * K);
  const x = Math.cos(a * K) * Math.sin(c * K) - Math.sin(a * K) * Math.cos(c * K) * Math.cos((d - b) * K);
  return (Math.atan2(y, x) / K + 360) % 360;
}
const DIRS = ['północ', 'pn.-wsch.', 'wschód', 'pd.-wsch.', 'południe', 'pd.-zach.', 'zachód', 'pn.-zach.'];
const dirName = (br) => t(DIRS[Math.round(br / 45) % 8]);
const fmtDist = (m) => m < 1000 ? Math.round(m) + ' m'
  : num(m / 1000, m < 10000 ? 2 : 1).replace(/[.,]?0+$/, '') + ' km';   // 1 km, 1,5 km, 4,01 km
const fmtSpd = (v) => num(v, v < 10 ? 1 : 0) + ' km/h';
function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + ' s';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  return Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' min';
}
function ago(ts) { return tf('{d} temu', { d: dur(Date.now() - ts) }); }
const hm = (ts) => new Date(ts).toLocaleTimeString(LANG, { hour: '2-digit', minute: '2-digit' });
const hms = (ts) => new Date(ts).toLocaleTimeString(LANG, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const when = (ts) => sameDay(ts, Date.now()) ? hm(ts)
  : new Date(ts).toLocaleDateString(LANG, { day: 'numeric', month: 'short' }) + ' ' + hm(ts);
const fmtPos = (p) => p.lat.toFixed(5) + ', ' + p.lon.toFixed(5);

// dystans po trasie, z pominięciem przeskoków GPS
function pathStats(list) {
  const cum = [0];
  let dist = 0, move = 0, max = 0, far = 0;
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    const d = distM(a.lat, a.lon, b.lat, b.lon), dt = (b.t - a.t) / 1000;
    const v = dt > 0 ? (d / dt) * 3.6 : 0;
    if (dt > 0 && v <= JUMP_KMH) {
      dist += d;
      if (v >= 1.5 && dt <= 15 * 60) move += dt;
      if (dt <= 10 * 60) max = Math.max(max, v);
    }
    cum.push(dist);
    far = Math.max(far, distM(list[0].lat, list[0].lon, b.lat, b.lon));
  }
  return { cum, dist, move, max, far };
}

// ------------------------------------------------------------------ GPS i kompas telefonu

function startSensors() {
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition((p) => {
      S.me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
      const l = S.myTrail[S.myTrail.length - 1];
      if (!l || distM(l[0], l[1], S.me.lat, S.me.lon) > 15) {
        S.myTrail.push([S.me.lat, S.me.lon, S.me.t]);
        if (S.myTrail.length > 3000) S.myTrail.splice(0, S.myTrail.length - 3000);
        store.set('mytrail', S.myTrail);
      }
      render();
    }, (e) => status(t('GPS telefonu:') + ' ' + e.message), { enableHighAccuracy: true, maximumAge: 5000 });
  }
  const onOri = (e) => {
    if (e.absolute === false && e.type !== 'deviceorientationabsolute') return;
    if (e.alpha == null) return;
    S.heading = (360 - e.alpha) % 360;
    if (!S.northUp && S.tab === 'radar') drawRadar();
  };
  window.addEventListener('deviceorientationabsolute', onOri);
}

// ------------------------------------------------------------------ mapa (Leaflet + OSM)

let map = null, tiles = null, dogMarker = null, meMarker = null, meAcc = null, dogLine = null, myLine = null,
  dots = null, others = null, poiLayer = null, zonesLayer = null, rpLine = null, rpSel = null, rpMarker = null, rpStops = null, lastDotsN = -1;
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function pinIcon(cls, crs, label) {
  const arrow = crs != null ? `<div class="r" style="transform:rotate(${Math.round(crs)}deg)"><div class="a"></div></div>` : '';
  return L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -14],
    html: `<div class="pin ${cls}">${arrow}<div class="c"></div>${label ? `<div class="pin-label">${esc(label)}</div>` : ''}</div>` });
}

function initMap() {
  if (!window.L) { $('map').textContent = t('Mapa niedostępna.'); return; }
  const f = lastFix();
  map = L.map('map', { zoomControl: true, attributionControl: true })
    .setView(f ? [f.lat, f.lon] : S.me ? [S.me.lat, S.me.lon] : [52.07, 19.48], f || S.me ? 16 : 6);
  map.attributionControl.setPrefix(false);
  // podkłady jak w Traccarze; każdy obejrzany kafelek zostaje w telefonie (sw.js)
  const osm = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const bases = {
    [t('Mapa OSM')]: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true, className: 'tl-street', attribution: osm }),
    [t('Turystyczna (poziomice)')]: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, crossOrigin: true, className: 'tl-street',
      subdomains: 'abc', attribution: osm + ', SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' }),
    [t('Satelita')]: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, crossOrigin: true,
      attribution: 'Esri, Maxar, Earthstar Geographics' }),
  };
  const names = Object.keys(bases);
  const pick = names[store.get('layer', 0)] || names[0];
  tiles = bases[pick].addTo(map);
  L.control.layers(bases, null, { position: 'bottomleft' }).addTo(map);
  map.on('baselayerchange', (e) => { tiles = e.layer; store.set('layer', Math.max(0, names.indexOf(e.name))); });
  L.control.scale({ imperial: false }).addTo(map);
  const dog = cssVar('--dog'), me = cssVar('--me');
  zonesLayer = L.layerGroup().addTo(map);
  myLine = L.polyline([], { color: me, weight: 3, opacity: 0.5, dashArray: '4 8', interactive: false }).addTo(map);
  dogLine = L.polyline([], { color: dog, weight: 4, opacity: 0.75 }).addTo(map);
  dots = L.layerGroup().addTo(map);
  others = L.layerGroup().addTo(map);
  poiLayer = L.layerGroup().addTo(map);
  meAcc = L.circle([0, 0], { radius: 1, color: me, weight: 1, fillOpacity: 0.1, interactive: false });
  meMarker = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 3, fillColor: me, fillOpacity: 1 });
  dogMarker = L.marker([0, 0], { icon: pinIcon('', null), zIndexOffset: 1000 }).bindPopup(() => fixPopup(lastFix(), true));
  rpLine = L.polyline([], { color: cssVar('--replay'), weight: 4, opacity: 0.85 });
  rpSel = L.polyline([], { color: cssVar('--me'), weight: 8, opacity: 0.55, interactive: false });
  rpStops = L.layerGroup();
  rpMarker = L.marker([0, 0], { icon: pinIcon('rp', null), zIndexOffset: 1100 });
  map.on('dragstart', () => { if (S.follow && S.tab === 'map') { S.follow = false; store.set('follow', false); followUI(); } });
}

function fixPopup(f, live) {
  if (!f) return t('brak pozycji');
  const rows = [`<b>${esc(dogName(devOf(f)))}</b>`, (live ? ago(f.t) + ' · ' : '') + when(f.t)];
  if (f.spd != null) rows.push(t('Prędkość') + ': ' + fmtSpd(f.spd) + (f.crs != null && f.spd >= 1.5 ? ' · ' + dirName(f.crs) : ''));
  if (f.pct != null) rows.push(t('Bateria') + ': ' + f.pct + '%' + (f.mv ? ' · ' + num(f.mv / 1000, 2) + ' V' : ''));
  if (f.sats) rows.push('GPS: ' + f.sats + ' sat');
  if (S.me) rows.push(t('Od Ciebie') + ': ' + fmtDist(distM(S.me.lat, S.me.lon, f.lat, f.lon)));
  rows.push(fmtPos(f));
  return rows.join('<br>');
}

function drawMap() {
  if (!map) return;
  const fx = fixes(), f = fx.length ? fx[fx.length - 1] : null;
  const live = S.tab !== 'replay';
  // na żywo: ślad psa z ostatnich 24 h (do 1500 punktów)
  const since = Date.now() - 24 * 3600e3;
  const recent = fx.filter((r) => r.t >= since).slice(-1500);
  dogLine.setLatLngs(live ? recent.map((r) => [r.lat, r.lon]) : []);
  myLine.setLatLngs(live ? S.myTrail.filter((p) => p[2] >= since).map((p) => [p[0], p[1]]) : []);
  if (live && recent.length !== lastDotsN) {        // klikane punkty meldunków (ostatnie 150)
    lastDotsN = recent.length;
    dots.clearLayers();
    for (const r of recent.slice(-150, -1)) {
      L.circleMarker([r.lat, r.lon], { radius: 4, weight: 1, color: '#fff', fillColor: cssVar('--dog'), fillOpacity: 0.8 })
        .bindPopup(() => fixPopup(r, false)).addTo(dots);
    }
  }
  if (!live) { dots.clearLayers(); lastDotsN = -1; }
  if (f && live) {
    const st = devState();
    const key = st + '|' + (f.spd >= 1.5 ? Math.round(f.crs) : '') + '|' + dogName();
    dogMarker.setLatLng([f.lat, f.lon]);
    if (key !== dogMarker._key) { dogMarker._key = key; dogMarker.setIcon(pinIcon(st === 'on' ? '' : 'off', f.spd >= 1.5 ? f.crs : null, dogName())); }
    if (!map.hasLayer(dogMarker)) dogMarker.addTo(map);
  } else if (map.hasLayer(dogMarker)) dogMarker.remove();
  if (S.me) {
    meMarker.setLatLng([S.me.lat, S.me.lon]); meAcc.setLatLng([S.me.lat, S.me.lon]).setRadius(S.me.acc || 1);
    if (!map.hasLayer(meMarker)) { meAcc.addTo(map); meMarker.addTo(map); }
  }
  // pozostałe trackery (szare znaczniki; dotknięcie = wybór)
  others.clearLayers();
  if (live) {
    for (const d of devices().slice(1)) {
      const o = lastFix(d);
      if (!o) continue;
      L.marker([o.lat, o.lon], { icon: pinIcon('other', o.spd >= 1.5 ? o.crs : null, dogName(d)), zIndexOffset: 900 })
        .on('click', () => selectDevice(d)).addTo(others);
    }
  }
}

function centerOn(what) {
  if (!map) return;
  const f = S.tab === 'replay' ? S.rp.list[S.rp.idx] : lastFix();
  if (what === 'dog' && f) map.setView([f.lat, f.lon], Math.max(map.getZoom(), 16));
  else if (what === 'me' && S.me) map.setView([S.me.lat, S.me.lon], Math.max(map.getZoom(), 16));
  else if (what === 'all') {
    const pts = [];
    if (S.tab === 'replay') S.rp.list.forEach((r) => pts.push([r.lat, r.lon]));
    else { if (f) pts.push([f.lat, f.lon]); dogLine.getLatLngs().forEach((p) => pts.push(p)); }
    if (S.me) pts.push([S.me.lat, S.me.lon]);
    for (const z of A.zones) if (z.on) { const b = zoneBounds(z); pts.push(b.getNorthEast(), b.getSouthWest()); }
    for (const q of N.pois) pts.push([q.lat, q.lon]);
    if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: 17 });
    else if (pts.length) map.setView(pts[0], 16);
  }
}

function followUI() {
  $('btn-follow').classList.toggle('on', S.follow);
  $('btn-follow').textContent = S.follow ? t('Śledzę psa') : t('Śledź psa');
}

// ------------------------------------------------------------------ radar

function drawRadar() {
  const cv = $('radar'), dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth;
  if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = cv.width; }
  const g = cv.getContext('2d');
  const col = cssVar;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, w);
  const c = w / 2, rad = w / 2 - 14;

  const fx = fixes().slice(-40);
  const centre = S.me || (fx.length ? fx[fx.length - 1] : null);
  // skala: najdalszy punkt (pies, ślad) * 1,15, zaokrąglona do 1-2-5
  let far = 50;
  if (centre) for (const f of fx) far = Math.max(far, distM(centre.lat, centre.lon, f.lat, f.lon) * 1.15);
  const steps = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  const range = steps.find((s) => s >= far) || far;
  const rot = !S.northUp && S.heading != null ? S.heading * K : 0;   // kierunek patrzenia u góry
  const proj = (lat, lon) => {
    const dx = (lon - centre.lon) * K * R * Math.cos(centre.lat * K), dy = (lat - centre.lat) * K * R;
    const x = dx * Math.cos(rot) - dy * Math.sin(rot), y = dx * Math.sin(rot) + dy * Math.cos(rot);
    return [c + (x / range) * rad, c - (y / range) * rad];
  };

  g.strokeStyle = col('--ring'); g.lineWidth = 1;
  g.fillStyle = col('--muted'); g.font = '12px system-ui, sans-serif'; g.textAlign = 'left';
  for (let i = 1; i <= 4; i++) {
    g.beginPath(); g.arc(c, c, (rad * i) / 4, 0, 2 * Math.PI); g.stroke();
  }
  g.fillText(fmtDist(range), c + 4, c - rad + 14);
  g.fillText(fmtDist(range / 2), c + 4, c - rad / 2 + 14);
  const nx = c + Math.sin(rot) * (rad + 2) * -1, ny = c - Math.cos(rot) * (rad + 2);
  g.fillStyle = col('--warn'); g.font = 'bold 13px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText('N', nx, ny + 5);
  if (!centre) {
    g.fillStyle = col('--muted'); g.font = '14px system-ui, sans-serif';
    g.fillText(t('czekam na pozycję'), c, c + 5);
    return;
  }
  // strefy
  g.strokeStyle = col('--geo'); g.setLineDash([6, 6]); g.lineWidth = 2;
  for (const z of A.zones) {
    if (!z.on) continue;
    g.beginPath();
    if (z.pts) { z.pts.forEach(([la, lo], i) => { const [x, y] = proj(la, lo); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); }
    else { const [gx, gy] = proj(z.lat, z.lon); g.arc(gx, gy, (z.r / range) * rad, 0, 2 * Math.PI); }
    g.stroke();
  }
  g.setLineDash([]);
  g.strokeStyle = col('--me'); g.globalAlpha = 0.35; g.lineWidth = 2; g.beginPath();
  S.myTrail.slice(-200).forEach(([la, lo], i) => { const [x, y] = proj(la, lo); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke(); g.globalAlpha = 1;
  g.fillStyle = col('--trail');
  fx.slice(0, -1).forEach((f) => { const [x, y] = proj(f.lat, f.lon); g.beginPath(); g.arc(x, y, 3, 0, 2 * Math.PI); g.fill(); });
  if (fx.length) {
    const f = fx[fx.length - 1];
    const [x, y] = proj(f.lat, f.lon);
    g.fillStyle = col('--dog'); g.strokeStyle = col('--card'); g.lineWidth = 3;
    g.beginPath(); g.arc(x, y, 9, 0, 2 * Math.PI); g.fill(); g.stroke();
  }
  if (S.me) {
    g.fillStyle = col('--me'); g.strokeStyle = col('--card'); g.lineWidth = 3;
    g.beginPath(); g.arc(c, c, 7, 0, 2 * Math.PI); g.fill(); g.stroke();
    if (S.heading != null) {
      const a = (S.northUp ? S.heading : 0) * K;
      g.strokeStyle = col('--me'); g.lineWidth = 3; g.beginPath();
      g.moveTo(c, c); g.lineTo(c + Math.sin(a) * 26, c - Math.cos(a) * 26); g.stroke();
    }
  }
}

// ------------------------------------------------------------------ stan urządzenia i karta

function dogName(dev = S.tracker) {
  if (S.names[dev]) return S.names[dev];
  if (dev === S.tracker && S.dogName) return S.dogName;
  const c = S.contacts.get(dev);
  if (c && c.name) return c.name;
  return devices().length > 1 ? t('Pies') + ' ' + (devices().indexOf(dev) + 1) : t('Pies');
}

// 'on' = meldunki na czas, 'late' = spóźniony, 'off' = brak danych
function devState(dev = S.tracker) {
  const rep = lastReport(dev);
  if (!rep) return 'off';
  const late = rep.int && Date.now() - rep.t > (2 * rep.int + 60) * 1000;
  return late ? 'late' : 'on';
}

function setText(id, v, cls) {
  const el = $(id);
  el.textContent = v;
  if (cls !== undefined) { el.classList.toggle('bad', cls === 'bad'); el.classList.toggle('good', cls === 'good'); }
}

function render() {
  const fix = lastFix(), rep = lastReport();
  // odległość i kierunek od telefonu
  let distTxt = '–', dirTxt;
  if (fix && S.me) {
    const d = distM(S.me.lat, S.me.lon, fix.lat, fix.lon), br = bearing(S.me.lat, S.me.lon, fix.lat, fix.lon);
    distTxt = fmtDist(d);
    dirTxt = d < 10 ? t('tuż obok') : dirName(br) + ' · ' + Math.round(br) + '°';
  } else if (fix) dirTxt = S.me ? '' : t('czekam na GPS telefonu');
  else dirTxt = rep ? t('pies bez fixu GPS') : t('brak pozycji');
  $('dist').textContent = distTxt; $('dir').textContent = dirTxt;
  setText('a-dist', distTxt); setText('a-dir', fix && S.me ? dirTxt : '–');

  const st = devState();
  $('d-dot').className = 'dot ' + st;
  $('d-name').textContent = dogName();
  $('d-state').textContent = st === 'on' ? t('meldunki na czas') + (S.connected ? '' : ' · ' + t('baza rozłączona'))
    : st === 'late' ? t('spóźniony meldunek') : t('brak danych');
  if (rep) {
    const late = st === 'late';
    $('age').textContent = tf('meldunek {a}', { a: ago(rep.t) }) + (fix && fix !== rep ? ' · ' + tf('pozycja {a}', { a: ago(fix.t) }) : '');
    $('age').classList.toggle('old', late);
    $('d-upd').textContent = ago(rep.t);
    setText('a-batt', rep.mv ? rep.pct + '% · ' + num(rep.mv / 1000, 2) + ' V' : '–', rep.pct != null && rep.pct <= 20 ? 'bad' : '');
    setText('a-gps', rep.fix ? rep.sats + ' sat' : t('brak fixu'), rep.fix ? '' : 'bad');
    setText('a-temp', rep.temp != null ? rep.temp + ' °C' : '–');
    setText('a-int', rep.int ? (rep.int < 120 ? rep.int + ' s' : Math.round(rep.int / 60) + ' min') + (rep.search ? ' · ' + t('szukanie') : '') : '–');
    let next = '–';
    if (rep.int) {
      const left = Math.round((rep.t + rep.int * 1000 - Date.now()) / 1000);
      next = left > 0 ? (left < 120 ? left + ' s' : Math.round(left / 60) + ' min')
        : left > -60 - rep.int ? t('zaraz') : tf('spóźniony {d}', { d: dur(-left * 1000) });
    }
    setText('a-next', next, st === 'late' ? 'bad' : '');
  }
  setText('a-spd', fix && fix.spd != null ? fmtSpd(fix.spd) + (fix.spd >= 1.5 && fix.crs != null ? ' · ' + dirName(fix.crs) : '') : '–');
  setText('a-pos', fix ? fmtPos(fix) + ' · ' + hm(fix.t) : '–');
  const zs = zonesStatus(fix);
  setText('a-geo', zs.text, zs.cls);
  const today = fixes().filter((r) => sameDay(r.t, Date.now()));
  setText('a-today', today.length > 1 ? fmtDist(pathStats(today).dist) : '–');
  const np = nearestPoi(fix);
  setText('a-poi', np ? np.icon + ' ' + np.name + ' · ' + fmtDist(np.d) : '–');

  // linki do zewnętrznych map
  const p = fix || (rep && rep.lat != null ? rep : null);
  for (const id of ['map-organic', 'map-google', 'map-geo', 'map-nav']) $(id).classList.toggle('disabled', !p);
  $('map-none').hidden = !!p;
  if (p) {
    // Chrome na Androidzie nie otwiera gołych "geo:" ze strony – adresy "intent:" przekazuje do systemu.
    const ll = p.lat.toFixed(6) + ',' + p.lon.toFixed(6);
    const om = 'https://play.google.com/store/apps/details?id=app.organicmaps';
    $('map-organic').href = 'intent://map?v=1&ll=' + ll + '&n=Pies#Intent;scheme=om;package=app.organicmaps;'
      + 'S.browser_fallback_url=' + encodeURIComponent(om) + ';end';
    $('map-google').href = 'https://www.google.com/maps/search/?api=1&query=' + ll;
    $('map-geo').href = 'intent:' + ll + '?q=' + ll + '(Pies)#Intent;scheme=geo;action=android.intent.action.VIEW;end';
    $('map-nav').href = 'https://www.google.com/maps/dir/?api=1&destination=' + ll + '&travelmode=walking';
  }
  if (S.tab === 'radar') drawRadar();
  if (S.tab !== 'replay') drawMap();
  else if (map && S.me) { meMarker.setLatLng([S.me.lat, S.me.lon]); meAcc.setLatLng([S.me.lat, S.me.lon]).setRadius(S.me.acc || 1); }
}

// ------------------------------------------------------------------ alarm

let beepCtx = null;
function beep() {
  try {
    beepCtx = beepCtx || new AudioContext();
    const o = beepCtx.createOscillator(), v = beepCtx.createGain();
    o.frequency.value = 880; v.gain.value = 0.25;
    o.connect(v); v.connect(beepCtx.destination);
    o.start(); o.stop(beepCtx.currentTime + 0.4);
  } catch { /* bez dźwięku */ }
}

function showAlarm(text) {
  $('alarm-text').textContent = text;
  $('alarm').hidden = false;
  if (S.alarmMuted > Date.now()) return;
  if (S.sound) { beep(); if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]); }
  if (!S.alarmShown) notify(text);
  S.alarmShown = true;
}
function hideAlarm() { $('alarm').hidden = true; S.alarmShown = false; }

function checkLate() {
  const rep = lastReport();
  if (!rep || !rep.int) return;
  const late = Date.now() - rep.t - (2 * rep.int + 60) * 1000;
  if (late > 0) {
    const mins = Math.round((Date.now() - rep.t) / 60000);
    if ($('alarm').hidden || (Math.floor(late / 60000) !== S.lastLateMin)) {
      S.lastLateMin = Math.floor(late / 60000);
      const msg = tf('Brak meldunku od {n} min', { n: mins });
      const first = !S.lateEvent;
      if (first) { S.lateEvent = true; addEvent('late', msg, false, Date.now(), lastFix(), true); }
      const lvl = ruleOf('late');
      if (lvl === 'alarm') showAlarm(msg + (S.connected ? '' : ' ' + t('(baza rozłączona!)')));
      else if (lvl === 'notify' && first) notify(msg);
    }
  }
}

// ------------------------------------------------------------------ interfejs

function status(s) { $('ble-status').textContent = s; }
function cmdStatus(s) { $('cmd-status').textContent = s; }

function updateConnUI() {
  const b = $('btn-connect');
  b.textContent = S.connected ? t('Połączono') : t('Połącz z bazą');
  b.classList.toggle('on', S.connected);
  if (!S.connected && !S.wantConnected) status(t('Nie połączono.'));
}

function fillTrackerSelect() {
  const sel = $('sel-tracker');
  sel.textContent = '';
  sel.add(new Option(t('– wybierz –'), ''));
  for (const [p, c] of S.contacts) sel.add(new Option(c.name || p, p, false, p === S.tracker));
  if (S.tracker && !S.contacts.has(S.tracker)) sel.add(new Option('tracker ' + S.tracker, S.tracker, false, true));
}

function showTab(tab) {
  const prev = S.tab;
  S.tab = tab; store.set('tab', tab);
  document.body.dataset.tab = tab;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (map) {
    setTimeout(() => map.invalidateSize(), 0);
    replayLayers(tab === 'replay');
  }
  if (tab === 'replay') fillDays().then(() => loadReplay(prev !== 'replay'));
  if (tab === 'events') renderEvents();
  if (tab === 'settings') dataInfo();
  render();
  if (prev === 'replay' && tab === 'map' && map) { lastDotsN = -1; drawMap(); }
}

async function dataInfo() {
  const kb = Math.round(((localStorage.getItem('trk.reports') || '').length + (localStorage.getItem('trk.events') || '').length
    + (localStorage.getItem('trk.mytrail') || '').length) / 1024);
  const days = await histDays();
  $('data-info').textContent = tf('W telefonie: {n} meldunków, {e} zdarzeń, ok. {kb} kB.', { n: S.reports.length, e: A.events.length, kb })
    + ' ' + tf('Historia tras: {d} dni, {p} pozycji.', { d: days.length, p: days.reduce((a, d) => a + d.n, 0) });
  try {
    const c = await caches.open('tracker-psa-tiles');
    const n = (await c.keys()).length;
    $('tile-count').textContent = tf('Zapisane fragmenty mapy: {n}.', { n });
  } catch { $('tile-count').textContent = ''; }
}

async function toggleWake() {
  try {
    if (S.wake) { S.wakeWanted = false; await S.wake.release(); S.wake = null; }
    else if ('wakeLock' in navigator) {
      S.wake = await navigator.wakeLock.request('screen');
      S.wakeWanted = true;
      S.wake.addEventListener('release', () => { S.wake = null; $('btn-wake').textContent = t('Ekran: zwykły'); });
    }
  } catch { /* np. oszczędzanie baterii */ }
  $('btn-wake').textContent = S.wake ? t('Ekran: zawsze włączony') : t('Ekran: zwykły');
}

// pokaz bez urządzeń: index.html#demo (nic nie zapisuje) – spacer 2 h z postojem i strefą
function demo() {
  store.set = () => {};
  const now = Date.now(), lat0 = 52.2297, lon0 = 21.0122, n = 60;
  S.me = { lat: lat0 + 0.004, lon: lon0 + 0.006, acc: 8, t: now };
  S.heading = 30;
  S.tracker = 'demo1';
  S.names = { demo1: 'Burek', demo2: 'Luna' };
  S.reports = [];
  for (let i = 0; i < n; i++) {
    const k = i < 25 ? i : i < 33 ? 25 + (i - 25) * 0.03 : i - 7;   // postój w środku spaceru
    const lat = lat0 + 0.00055 * k + 0.0004 * Math.sin(k / 3), lon = lon0 + 0.0007 * k + 0.0003 * Math.cos(k / 4);
    const r = { t: now - (n - i) * 120000, lat, lon, fix: true, mv: 4080 - i * 4, pct: 88 - Math.round(i / 3), temp: 14, sats: 9,
      int: 120, search: false, dev: 'demo1' };
    r.text = fmtDist(distM(lat0, lon0, lat, lon)) + ' · ' + num(r.mv / 1000, 2) + ' V ' + r.pct + '% · 14°C · 9 sat · co 120 s';
    S.reports.push(r);
  }
  for (let i = 0; i < 12; i++) {   // drugi pies, kawałek dalej
    const lat = lat0 + 0.012 + 0.0004 * i, lon = lon0 + 0.03 - 0.0006 * i;
    S.reports.push({ t: now - (12 - i) * 60000 - 30000, lat, lon, fix: true, mv: 3950, pct: 64, temp: 15, sats: 7, int: 60, search: false, dev: 'demo2',
      text: '3,95 V 64% · 15°C · 7 sat · co 60 s' });
  }
  S.reports.sort((a, b) => a.t - b.t);
  prepReports();
  N.pois = [{ id: 'p1', name: 'Auto', icon: '🚗', lat: lat0 - 0.001, lon: lon0 - 0.002 }];
  S.myTrail = Array.from({ length: 40 }, (_, i) => [lat0 + 0.0001 * i, lon0 + 0.00015 * i, now - (40 - i) * 180000]);
  A.zones = [{ id: 'demo', name: t('Obóz'), lat: lat0 + 0.016, lon: lon0 + 0.02, r: 2000, on: true },
    { id: 'demo2', name: 'Park', on: true, pts: [[lat0 + 0.009, lon0 + 0.026], [lat0 + 0.016, lon0 + 0.026], [lat0 + 0.017, lon0 + 0.034], [lat0 + 0.01, lon0 + 0.036]] }];
  A.inside = { demo: true };
  A.events = [
    { t: now - 125 * 60000, type: 'conn', text: tf('Połączono z bazą {name}.', { name: 'BAZA2' }) },
    { t: now - 119 * 60000, type: 'zone_set', text: tf('Dodano strefę „{n}”.', { n: t('Obóz') }) + ' 2 km', lat: lat0 + 0.016, lon: lon0 + 0.02 },
    { t: now - 70 * 60000, type: 'late', text: tf('Brak meldunku od {n} min', { n: 6 }) },
    { t: now - 64 * 60000, type: 'back', text: t('Kontakt z psem wrócił') },
  ];
  // historia tras tylko w pamięci: dziś (meldunki powyżej) i wczoraj (pętla)
  const y = now - 864e5;
  H.mem = S.reports.map((r) => ({ ...r, day: dayKey(r.t), tracker: r.dev })).concat(Array.from({ length: 90 }, (_, i) => {
    const a = (i / 90) * 2 * Math.PI, tt = y - (90 - i) * 60000;
    return { t: tt, day: dayKey(tt), lat: lat0 + 0.004 * Math.sin(a), lon: lon0 + 0.006 * (1 - Math.cos(a)), mv: 4100 - i * 2, pct: 90 - Math.floor(i / 9), sats: 8, int: 60, search: false };
  }));
  status(t('Pokaz (dane przykładowe).'));
}

function init() {
  applyLang(document.body);
  const sl = $('sel-lang');
  for (const l of LANGS) sl.add(new Option(LANG_NAMES[l], l, false, l === LANG));
  sl.addEventListener('change', () => {
    try { localStorage.setItem('qbart.lang', sl.value); } catch { /* */ }
    location.href = location.pathname + '?lang=' + sl.value + location.hash;
  });
  $('ver').textContent = t('Wersja') + ' ' + VERSION + ' · ' + t('kod:') + ' github.com/qbarteczek/meshcore-tracker';
  $('btn-connect').addEventListener('click', () => (S.connected ? (confirm(t('Rozłączyć z bazą?')) && disconnect()) : connect()));
  $('btn-alarm-ok').addEventListener('click', () => { hideAlarm(); S.alarmMuted = Date.now() + 5 * 60000; });
  $('btn-orient').addEventListener('click', () => {
    S.northUp = !S.northUp; store.set('northup', S.northUp);
    $('btn-orient').textContent = S.northUp ? t('Północ u góry') : t('Kierunek patrzenia u góry');
    drawRadar();
  });
  $('btn-orient').textContent = S.northUp ? t('Północ u góry') : t('Kierunek patrzenia u góry');
  $('btn-wake').addEventListener('click', toggleWake);
  document.querySelectorAll('.cmd').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
    sendCommand(b.dataset.cmd, b);
  }));
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  // mapa
  $('btn-c-dog').addEventListener('click', () => centerOn('dog'));
  $('btn-c-me').addEventListener('click', () => centerOn('me'));
  $('btn-c-all').addEventListener('click', () => centerOn('all'));
  $('btn-follow').addEventListener('click', () => {
    S.follow = !S.follow; store.set('follow', S.follow); followUI();
    if (S.follow) centerOn('dog');
  });
  // ustawienia
  $('sel-tracker').addEventListener('change', (e) => { if (e.target.value) selectDevice(e.target.value); });
  $('inp-name').value = S.names[S.tracker] || S.dogName;
  $('inp-name').placeholder = t('Pies');
  $('inp-name').addEventListener('change', (e) => {
    S.names[S.tracker] = e.target.value.trim(); if (!S.names[S.tracker]) delete S.names[S.tracker];
    store.set('names', S.names); render(); renderDevices();
  });
  $('chk-sound').checked = S.sound;
  $('chk-sound').addEventListener('change', (e) => { S.sound = e.target.checked; store.set('sound', S.sound); });
  $('chk-batt').checked = S.battWarn;
  $('chk-batt').addEventListener('change', (e) => { S.battWarn = e.target.checked; store.set('battwarn', S.battWarn); });
  $('btn-notif').addEventListener('click', async () => {
    if ('Notification' in window) $('btn-notif').textContent = t('Powiadomienia:') + ' ' + await Notification.requestPermission();
  });
  $('btn-tiles-clear').addEventListener('click', async () => {
    if (!confirm(t('Usunąć zapisane fragmenty mapy? Bez internetu mapa będzie pusta.'))) return;
    try { await caches.delete('tracker-psa-tiles'); } catch { /* */ }
    dataInfo();
  });
  $('btn-clear').addEventListener('click', () => {
    if (!confirm(t('Usunąć zapisane meldunki, ślad i zdarzenia?'))) return;
    S.reports = []; S.myTrail = []; A.events = [];
    store.set('reports', []); store.set('mytrail', []); store.set('events', []);
    lastDotsN = -1; renderEvents(); render(); dataInfo();
  });
  if (location.hash === '#demo') demo();
  prepReports();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.wake === null && S.wakeWanted) toggleWake();
  });
  window.addEventListener('resize', () => { if (S.tab === 'radar') drawRadar(); });
  initMap();
  initAnaliza();
  initNarzedzia();
  // meldunki zapisane przed wersją z historią (i przy każdym starcie, na wszelki wypadek) – put nie dubluje
  histAdd(S.reports);
  followUI();
  startSensors();
  const startTab = ['map', 'replay', 'radar', 'events', 'settings'].includes(S.tab) ? S.tab : 'map';
  S.tab = '';
  showTab(startTab);
  setInterval(() => { if (S.tab !== 'replay') render(); checkLate(); }, 5000);
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {   // nowa wersja przejęła stronę
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((r) => r.update()).catch(() => {});
  }
  // aplikacja ma zostać w telefonie na wyjazd bez internetu: prośba, żeby Chrome nie kasował jej plików
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

// analiza.js i narzedzia.js ładują się po app.js – start, gdy wszystkie są gotowe
document.addEventListener('DOMContentLoaded', init);
