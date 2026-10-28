// Tracker psa – aplikacja w przeglądarce (Chrome na Androidzie) dla bazy polowej meshcore-tracker.
// Łączy się przez Web Bluetooth z companionem MeshCore (firmware TRACKER_BASE), czyta meldunki trackera
// (czytelne wiadomości od kontaktu trackera) i wysyła polecenia (#SZUKAJ, #STOP, #CO n, #BT, #DOM).
// Protokół: companion BLE MeshCore (Nordic UART), jedna ramka = jedna wartość charakterystyki.
'use strict';

const VERSION = 'trk2-app-8';
const UART = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';   // zapis do urządzenia
const UART_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';   // powiadomienia z urządzenia

const CMD = { APP_START: 1, SEND_TXT: 2, GET_CONTACTS: 4, SET_TIME: 6, SYNC_NEXT: 10, DEVICE_QUERY: 22 };
const RESP = { OK: 0, ERR: 1, CONTACTS_START: 2, CONTACT: 3, END_CONTACTS: 4, SELF_INFO: 5, SENT: 6,
  MSG: 7, NO_MORE: 10, DEVICE_INFO: 13, MSG_V3: 16 };
const PUSH = { ADVERT: 0x80, SEND_CONFIRMED: 0x82, MSG_WAITING: 0x83, NEW_ADVERT: 0x8a };

const $ = (id) => document.getElementById(id);
const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// ------------------------------------------------------------------ stan (zapisany w telefonie)

const store = {
  get(k, d) { try { const v = localStorage.getItem('trk.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('trk.' + k, JSON.stringify(v)); } catch { /* brak miejsca / tryb prywatny */ } },
};

const S = {
  device: null, rx: null, wantConnected: false, connected: false,
  baseName: '', contacts: new Map(),           // prefix(12 hex) -> {name, lat, lon}
  tracker: store.get('tracker', ''),           // prefix kontaktu trackera
  reports: store.get('reports', []),           // {t, lat, lon, fix, mv, pct, temp, sats, int, search, text}
  myTrail: store.get('mytrail', []),           // [lat, lon, t]
  me: null, heading: null, northUp: store.get('northup', true),
  pendingCmd: null,                            // {text, ack, t, button}
  alarmShown: false, alarmMuted: 0, sound: store.get('sound', true), wake: null,
  syncing: false, writeChain: Promise.resolve(),
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
      break;
    case RESP.CONTACT: {
      const prefix = hex(b.subarray(1, 7));
      S.contacts.set(prefix, { name: cstr(b.subarray(100, 132)), lat: rdI32(b, 136) / 1e6, lon: rdI32(b, 140) / 1e6 });
      break;
    }
    case RESP.END_CONTACTS:
      fillTrackerSelect();
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
  const t = text.match(/(-?\d+)°C/);
  if (t) r.temp = parseInt(t[1], 10);
  r.sats = sats ? parseInt(sats[1], 10) : 0;
  r.int = iv ? parseInt(iv[1], 10) : 0;
  r.search = /SZUKANIE/.test(text);
  return r;
}

function onMessage(prefix, ts, text) {
  const r = parseReport(text);
  if (!r) return;                                   // zwykła wiadomość czatu – nie dla tej strony
  if (!S.tracker) { S.tracker = prefix; store.set('tracker', prefix); fillTrackerSelect(); }
  if (prefix !== S.tracker) return;
  const now = Date.now();
  r.t = ts > 1.6e9 && ts * 1000 < now + 120000 ? ts * 1000 : now;   // czas bazy (ustawiany z telefonu)
  if (r.alarm) {
    addLog(r.t, text, true);
    showAlarm(text.split('\n')[0]);
    return;
  }
  S.reports.push(r);
  if (S.reports.length > 300) S.reports.splice(0, S.reports.length - 300);
  store.set('reports', S.reports);
  if (r.fix) histAdd([r]).then(() => { if (!H.day || H.day === dayKey(r.t)) histRefresh(dayKey(r.t)); });
  addLog(r.t, text.split('\n')[0], false);
  hideAlarm();
  render();
}

// ------------------------------------------------------------------ historia: trasa dnia
// S.reports trzyma tylko ostatnie 300 meldunków (radar). Każda pozycja psa trafia też do IndexedDB,
// bez limitu i pogrupowana po dniach (czas lokalny telefonu), żeby można było wrócić do starszych dni.

const H = { db: null, days: [], day: '', pts: [], mem: null };   // mem: pokaz #demo (bez zapisu)

const dayKey = (ms) => {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

function histDb() {
  if (!H.db) {
    H.db = new Promise((res, rej) => {
      const r = indexedDB.open('tracker-psa', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('fixes', { keyPath: 't' }).createIndex('day', 'day');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return H.db;
}

async function histStore(mode) {
  return (await histDb()).transaction('fixes', mode).objectStore('fixes');
}

async function histAdd(reports) {
  const fixes = reports.filter((r) => r.fix && r.lat != null);
  if (H.mem || !fixes.length) return;
  try {
    const st = await histStore('readwrite');
    // klucz = czas meldunku, więc ponowny zapis tego samego meldunku nic nie dubluje
    for (const r of fixes) {
      st.put({ t: r.t, day: dayKey(r.t), lat: r.lat, lon: r.lon, mv: r.mv, pct: r.pct, temp: r.temp,
        sats: r.sats, search: r.search, tracker: S.tracker });
    }
    await new Promise((res, rej) => { st.transaction.oncomplete = res; st.transaction.onerror = () => rej(st.transaction.error); });
  } catch (e) { console.warn('historia:', e); }
}

async function histDays() {   // [{day, n}] od najnowszego
  const m = new Map();
  if (H.mem) {
    for (const p of H.mem) m.set(p.day, (m.get(p.day) || 0) + 1);
  } else {
    try {
      const idx = (await histStore('readonly')).index('day');
      await new Promise((res, rej) => {   // same klucze indeksu - bez czytania całych rekordów
        const r = idx.openKeyCursor();
        r.onsuccess = () => { const c = r.result; if (!c) { res(); return; } m.set(c.key, (m.get(c.key) || 0) + 1); c.continue(); };
        r.onerror = () => rej(r.error);
      });
    } catch { return []; }
  }
  return [...m].map(([day, n]) => ({ day, n })).sort((a, b) => (a.day < b.day ? 1 : -1));
}

async function histGet(day) {
  if (H.mem) return H.mem.filter((p) => p.day === day);
  try { return (await reqP((await histStore('readonly')).index('day').getAll(day))).sort((a, b) => a.t - b.t); }
  catch { return []; }
}

async function histDelete(day) {
  if (H.mem) { H.mem = H.mem.filter((p) => p.day !== day); return; }
  const st = await histStore('readwrite');
  for (const k of await reqP(st.index('day').getAllKeys(day))) st.delete(k);
  await new Promise((res) => { st.transaction.oncomplete = res; st.transaction.onerror = res; });
}

const fmtDay = (day) => new Date(day + 'T12:00:00').toLocaleDateString(LANG, { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });
const fmtTime = (ms) => new Date(ms).toLocaleTimeString(LANG, { hour: '2-digit', minute: '2-digit' });

async function histRefresh(day) {
  H.days = await histDays();
  if (day !== undefined) H.day = day;
  if (!H.days.some((d) => d.day === H.day)) H.day = H.days.length ? H.days[0].day : '';
  const sel = $('hist-day');
  sel.textContent = '';
  for (const d of H.days) sel.add(new Option(fmtDay(d.day) + ' · ' + tf('{n} pkt', { n: d.n }), d.day, false, d.day === H.day));
  H.pts = H.day ? await histGet(H.day) : [];
  const i = H.days.findIndex((d) => d.day === H.day);
  $('hist-prev').disabled = i < 0 || i >= H.days.length - 1;
  $('hist-next').disabled = i <= 0;
  $('hist-day').disabled = !H.days.length;
  $('hist-gpx').disabled = $('hist-del').disabled = !H.pts.length;
  const pos = $('hist-pos');
  pos.max = Math.max(0, H.pts.length - 1);
  pos.value = pos.max;
  pos.disabled = H.pts.length < 2;
  if (!H.pts.length) {
    $('hist-sum').textContent = t('Brak zapisanych tras. Trasa zapisuje się sama z meldunków z pozycją GPS.');
  } else {
    let m = 0;
    for (let k = 1; k < H.pts.length; k++) m += distM(H.pts[k - 1].lat, H.pts[k - 1].lon, H.pts[k].lat, H.pts[k].lon);
    const a = H.pts[0].t, b = H.pts[H.pts.length - 1].t;
    $('hist-sum').textContent = fmtTime(a) + '–' + fmtTime(b) + ' · ' + dur(b - a) + ' · ' + fmtDist(m)
      + ' · ' + tf('{n} pkt', { n: H.pts.length });
  }
  drawHist();
}

function drawHist() {
  const cv = $('hist-map'), dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = Math.round(w * 0.75);
  if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const pts = H.pts, sel = pts[+$('hist-pos').value];
  $('hist-point').textContent = sel ? fmtTime(sel.t) + (sel.mv ? ' · ' + num(sel.mv / 1000, 2) + ' V ' + sel.pct + '%' : '')
    + (sel.sats ? ' · ' + sel.sats + ' sat' : '') + (sel.search ? ' · ' + t('szukanie') : '') : '';
  if (!pts.length) {
    g.fillStyle = col('--muted'); g.font = '14px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(t('brak pozycji'), w / 2, h / 2);
    return;
  }
  // rzut równoodległościowy wokół środka śladu, skala dobrana do obszaru (min. 100 m)
  let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
  for (const p of pts) { la0 = Math.min(la0, p.lat); la1 = Math.max(la1, p.lat); lo0 = Math.min(lo0, p.lon); lo1 = Math.max(lo1, p.lon); }
  const cl = (la0 + la1) / 2, co = (lo0 + lo1) / 2, kx = K * R * Math.cos(cl * K), ky = K * R;
  const pad = 18;
  const sc = Math.min((w - 2 * pad) / Math.max(100, (lo1 - lo0) * kx), (h - 2 * pad) / Math.max(100, (la1 - la0) * ky));
  const proj = (p) => [w / 2 + (p.lon - co) * kx * sc, h / 2 - (p.lat - cl) * ky * sc];
  // podziałka
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  const bar = steps.filter((s) => s * sc <= w / 3).pop() || steps[0];
  g.strokeStyle = col('--muted'); g.fillStyle = col('--muted'); g.lineWidth = 2; g.font = '12px system-ui, sans-serif'; g.textAlign = 'left';
  g.beginPath(); g.moveTo(10, h - 10); g.lineTo(10 + bar * sc, h - 10); g.stroke();
  g.fillText(fmtDist(bar), 10, h - 16);
  g.fillStyle = col('--warn'); g.font = 'bold 13px system-ui, sans-serif'; g.textAlign = 'right';
  g.fillText('N ↑', w - 8, 16);
  // ślad
  g.strokeStyle = col('--dog'); g.lineWidth = 2.5; g.lineJoin = 'round'; g.beginPath();
  pts.forEach((p, i) => { const [x, y] = proj(p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke();
  g.fillStyle = col('--trail');
  for (const p of pts) { const [x, y] = proj(p); g.beginPath(); g.arc(x, y, 2.5, 0, 2 * Math.PI); g.fill(); }
  // start (zielony), koniec (pomarańczowy), wybrany punkt (niebieski)
  const dot = (p, c, r) => { const [x, y] = proj(p); g.fillStyle = c; g.strokeStyle = col('--card'); g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fill(); g.stroke(); };
  dot(pts[0], col('--ok'), 6);
  dot(pts[pts.length - 1], col('--dog'), 7);
  if (sel && pts.length > 1) dot(sel, col('--me'), 7);
}

function histGpx() {
  const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const name = t('Pies') + ' ' + H.day;
  const pts = H.pts.map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><time>${new Date(p.t).toISOString()}</time></trkpt>`);
  const gpx = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="tracker-psa" xmlns="http://www.topografix.com/GPX/1/1">\n'
    + `<trk><name>${x(name)}</name><trkseg>\n${pts.join('\n')}\n</trkseg></trk>\n</gpx>\n`;
  const file = new File([gpx], 'trasa-psa-' + H.day + '.gpx', { type: 'application/gpx+xml' });
  // Android: „Udostępnij” otwiera listę aplikacji (Organic Maps, OsmAnd, Dysk…); inaczej zwykłe pobranie pliku
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: name }).catch(() => {});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function lastReport() { return S.reports.length ? S.reports[S.reports.length - 1] : null; }
function lastFix() {
  for (let i = S.reports.length - 1; i >= 0; i--) if (S.reports[i].fix) return S.reports[i];
  return null;
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
const fmtDist = (m) => m < 1000 ? Math.round(m) + ' m' : num(m / 1000, m < 10000 ? 1 : 0) + ' km';
function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + ' s';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  return Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' min';
}
function ago(ts) { return tf('{d} temu', { d: dur(Date.now() - ts) }); }

// ------------------------------------------------------------------ GPS i kompas telefonu

function startSensors() {
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition((p) => {
      S.me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
      const l = S.myTrail[S.myTrail.length - 1];
      if (!l || distM(l[0], l[1], S.me.lat, S.me.lon) > 15) {
        S.myTrail.push([S.me.lat, S.me.lon, S.me.t]);
        if (S.myTrail.length > 500) S.myTrail.splice(0, S.myTrail.length - 500);
        store.set('mytrail', S.myTrail);
      }
      render();
    }, (e) => status(t('GPS telefonu:') + ' ' + e.message), { enableHighAccuracy: true, maximumAge: 5000 });
  }
  const onOri = (e) => {
    if (e.absolute === false && e.type !== 'deviceorientationabsolute') return;
    if (e.alpha == null) return;
    S.heading = (360 - e.alpha) % 360;
    if (!S.northUp) render();
  };
  window.addEventListener('deviceorientationabsolute', onOri);
}

// ------------------------------------------------------------------ radar

function render() {
  const fix = lastFix(), rep = lastReport();
  // liczby
  if (fix && S.me) {
    const d = distM(S.me.lat, S.me.lon, fix.lat, fix.lon), br = bearing(S.me.lat, S.me.lon, fix.lat, fix.lon);
    $('dist').textContent = fmtDist(d);
    $('dir').textContent = d < 10 ? t('tuż obok') : t(DIRS[Math.round(br / 45) % 8]) + ' · ' + Math.round(br) + '°';
  } else if (fix) {
    $('dist').textContent = '–';
    $('dir').textContent = S.me ? '' : t('czekam na GPS telefonu');
  } else {
    $('dist').textContent = '–';
    $('dir').textContent = rep ? t('pies bez fixu GPS') : t('brak pozycji');
  }
  if (rep) {
    const late = rep.int && Date.now() - rep.t > (2 * rep.int + 60) * 1000;
    $('age').textContent = tf('meldunek {a}', { a: ago(rep.t) }) + (fix && fix !== rep ? ' · ' + tf('pozycja {a}', { a: ago(fix.t) }) : '');
    $('age').classList.toggle('old', !!late);
    $('s-batt').textContent = rep.mv ? num(rep.mv / 1000, 2) + ' V · ' + rep.pct + '%' : '–';
    $('s-gps').textContent = rep.fix ? rep.sats + ' sat' : t('brak fixu');
    $('s-int').textContent = rep.int ? (rep.int < 120 ? rep.int + ' s' : Math.round(rep.int / 60) + ' min') + (rep.search ? ' · ' + t('szukanie') : '') : '–';
    if (rep.int) {
      const left = Math.round((rep.t + rep.int * 1000 - Date.now()) / 1000);
      $('s-next').textContent = left > 0 ? (left < 120 ? left + ' s' : Math.round(left / 60) + ' min')
        : left > -60 - rep.int ? t('zaraz') : tf('spóźniony {d}', { d: dur(-left * 1000) });
    }
  }
  // linki do map
  const p = fix || (rep && rep.lat != null ? rep : null);
  for (const id of ['map-organic', 'map-google', 'map-geo', 'map-nav']) $(id).classList.toggle('disabled', !p);
  $('map-none').hidden = !!p;
  if (p) {
    // Chrome na Androidzie nie otwiera gołych "geo:" ze strony – adresy "intent:" przekazuje do systemu.
    // Mapy Google: linki https otwierają aplikację Map (bez internetu też, jeśli mapa jest pobrana).
    const ll = p.lat.toFixed(6) + ',' + p.lon.toFixed(6);
    const om = 'https://play.google.com/store/apps/details?id=app.organicmaps';
    $('map-organic').href = 'intent://map?v=1&ll=' + ll + '&n=Pies#Intent;scheme=om;package=app.organicmaps;'
      + 'S.browser_fallback_url=' + encodeURIComponent(om) + ';end';
    $('map-google').href = 'https://www.google.com/maps/search/?api=1&query=' + ll;
    $('map-geo').href = 'intent:' + ll + '?q=' + ll + '(Pies)#Intent;scheme=geo;action=android.intent.action.VIEW;end';
    $('map-nav').href = 'https://www.google.com/maps/dir/?api=1&destination=' + ll + '&travelmode=walking';
  }
  drawRadar();
}

function drawRadar() {
  const cv = $('radar'), dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth;
  if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = cv.width; }
  const g = cv.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, w);
  const c = w / 2, rad = w / 2 - 14;

  const fixes = S.reports.filter((r) => r.fix).slice(-40);
  const centre = S.me || (fixes.length ? fixes[fixes.length - 1] : null);
  // skala: najdalszy punkt (pies, ślad) * 1,15, zaokrąglona do 1-2-5
  let far = 50;
  if (centre) for (const f of fixes) far = Math.max(far, distM(centre.lat, centre.lon, f.lat, f.lon) * 1.15);
  const steps = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  const range = steps.find((s) => s >= far) || far;
  const rot = !S.northUp && S.heading != null ? S.heading * K : 0;   // kierunek patrzenia u góry
  const proj = (lat, lon) => {
    const dx = (lon - centre.lon) * K * R * Math.cos(centre.lat * K), dy = (lat - centre.lat) * K * R;
    const x = dx * Math.cos(rot) - dy * Math.sin(rot), y = dx * Math.sin(rot) + dy * Math.cos(rot);
    return [c + (x / range) * rad, c - (y / range) * rad];
  };

  // pierścienie
  g.strokeStyle = col('--ring'); g.lineWidth = 1;
  g.fillStyle = col('--muted'); g.font = '12px system-ui, sans-serif'; g.textAlign = 'left';
  for (let i = 1; i <= 4; i++) {
    g.beginPath(); g.arc(c, c, (rad * i) / 4, 0, 2 * Math.PI); g.stroke();
  }
  g.fillText(fmtDist(range), c + 4, c - rad + 14);
  g.fillText(fmtDist(range / 2), c + 4, c - rad / 2 + 14);
  // północ
  const nx = c + Math.sin(rot) * (rad + 2) * -1, ny = c - Math.cos(rot) * (rad + 2);
  g.fillStyle = col('--warn'); g.font = 'bold 13px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText('N', nx, ny + 5);
  if (!centre) {
    g.fillStyle = col('--muted'); g.font = '14px system-ui, sans-serif';
    g.fillText(t('czekam na pozycję'), c, c + 5);
    return;
  }
  // mój ślad
  g.strokeStyle = col('--me'); g.globalAlpha = 0.35; g.lineWidth = 2; g.beginPath();
  S.myTrail.slice(-200).forEach(([la, lo], i) => { const [x, y] = proj(la, lo); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke(); g.globalAlpha = 1;
  // ślad psa
  g.fillStyle = col('--trail');
  fixes.slice(0, -1).forEach((f) => { const [x, y] = proj(f.lat, f.lon); g.beginPath(); g.arc(x, y, 3, 0, 2 * Math.PI); g.fill(); });
  // pies
  if (fixes.length) {
    const f = fixes[fixes.length - 1];
    const [x, y] = proj(f.lat, f.lon);
    g.fillStyle = col('--dog'); g.strokeStyle = col('--card'); g.lineWidth = 3;
    g.beginPath(); g.arc(x, y, 9, 0, 2 * Math.PI); g.fill(); g.stroke();
  }
  // ja
  if (S.me) {
    g.fillStyle = col('--me'); g.strokeStyle = col('--card'); g.lineWidth = 3;
    g.beginPath(); g.arc(c, c, 7, 0, 2 * Math.PI); g.fill(); g.stroke();
    if (S.heading != null) {          // kierunek, w którym patrzy telefon
      const a = (S.northUp ? S.heading : 0) * K;
      g.strokeStyle = col('--me'); g.lineWidth = 3; g.beginPath();
      g.moveTo(c, c); g.lineTo(c + Math.sin(a) * 26, c - Math.cos(a) * 26); g.stroke();
    }
  }
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
  if (!S.alarmShown && 'Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
    navigator.serviceWorker.ready.then((r) => r.showNotification(t('Tracker psa'), { body: text, tag: 'alarm', renotify: true })).catch(() => {});
  }
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
      showAlarm(tf('Brak meldunku od {n} min', { n: mins }) + (S.connected ? '' : ' ' + t('(baza rozłączona!)')));
    }
  }
}

// ------------------------------------------------------------------ interfejs

function status(t) { $('ble-status').textContent = t; }
function cmdStatus(t) { $('cmd-status').textContent = t; }

function updateConnUI() {
  const b = $('btn-connect');
  b.textContent = S.connected ? t('Połączono') : t('Połącz z bazą');
  b.classList.toggle('on', S.connected);
  if (!S.connected && !S.wantConnected) status(t('Nie połączono.'));
}

function addLog(t, text, warn) {
  const li = document.createElement('li');
  if (warn) li.className = 'warn';
  const tm = document.createElement('time');
  tm.textContent = new Date(t).toLocaleTimeString(LANG, { hour: '2-digit', minute: '2-digit' });
  li.append(tm, document.createTextNode(text));
  $('log').prepend(li);
  while ($('log').children.length > 60) $('log').lastChild.remove();
}

function fillTrackerSelect() {
  const sel = $('sel-tracker');
  sel.textContent = '';
  const none = new Option(t('– wybierz –'), '');
  sel.add(none);
  for (const [p, c] of S.contacts) sel.add(new Option(c.name || p, p, false, p === S.tracker));
  if (S.tracker && !S.contacts.has(S.tracker)) sel.add(new Option('tracker ' + S.tracker, S.tracker, false, true));
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

// pokaz bez urządzeń: index.html#demo (nic nie zapisuje)
function demo() {
  store.set = () => {};
  const now = Date.now(), lat0 = 52.2297, lon0 = 21.0122;
  S.me = { lat: lat0, lon: lon0, acc: 5, t: now };
  S.heading = 30;
  S.reports = Array.from({ length: 12 }, (_, i) => {
    const lat = lat0 + 0.0009 * i + 0.0003 * Math.sin(i), lon = lon0 + 0.0011 * i;
    return { t: now - (12 - i) * 60000, lat, lon, fix: true, mv: 4050 - i * 5, pct: 84, temp: 14, sats: 9, int: 60,
      search: false, text: fmtDist(distM(lat0, lon0, lat, lon)) + ' · 4,05 V 84% · 14°C · 9 sat · co 60 s' };
  });
  S.myTrail = Array.from({ length: 20 }, (_, i) => [lat0 - 0.0002 * (20 - i), lon0 - 0.0003 * (20 - i), now]);
  // trasa dnia: dziś (meldunki powyżej) i wczoraj (pętla), tylko w pamięci
  const y = now - 86400000;
  H.mem = S.reports.map((r) => ({ ...r, day: dayKey(r.t) })).concat(Array.from({ length: 90 }, (_, i) => {
    const a = (i / 90) * 2 * Math.PI, tt = y - (90 - i) * 60000;
    return { t: tt, day: dayKey(tt), lat: lat0 + 0.004 * Math.sin(a), lon: lon0 + 0.006 * (1 - Math.cos(a)), mv: 4100 - i * 2, pct: 90 - Math.floor(i / 9), sats: 8, search: false };
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
    render();
  });
  $('btn-orient').textContent = S.northUp ? t('Północ u góry') : t('Kierunek patrzenia u góry');
  $('btn-wake').addEventListener('click', toggleWake);
  document.querySelectorAll('.cmd').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
    sendCommand(b.dataset.cmd, b);
  }));
  $('sel-tracker').addEventListener('change', (e) => { S.tracker = e.target.value; store.set('tracker', S.tracker); render(); });
  $('chk-sound').checked = S.sound;
  $('chk-sound').addEventListener('change', (e) => { S.sound = e.target.checked; store.set('sound', S.sound); });
  $('btn-notif').addEventListener('click', async () => {
    if ('Notification' in window) $('btn-notif').textContent = t('Powiadomienia:') + ' ' + await Notification.requestPermission();
  });
  $('btn-clear').addEventListener('click', () => {
    if (!confirm(t('Usunąć zapisane meldunki i ślad?'))) return;
    S.reports = []; S.myTrail = []; store.set('reports', []); store.set('mytrail', []);
    $('log').textContent = ''; render();
  });
  const histStep = (d) => {
    const i = H.days.findIndex((x) => x.day === H.day) + d;
    if (i >= 0 && i < H.days.length) histRefresh(H.days[i].day);
  };
  $('hist-prev').addEventListener('click', () => histStep(1));    // dni są od najnowszego
  $('hist-next').addEventListener('click', () => histStep(-1));
  $('hist-day').addEventListener('change', (e) => histRefresh(e.target.value));
  $('hist-pos').addEventListener('input', drawHist);
  $('hist-gpx').addEventListener('click', histGpx);
  $('hist-del').addEventListener('click', async () => {
    if (!H.day || !confirm(tf('Usunąć trasę z dnia {d}?', { d: fmtDay(H.day) }))) return;
    await histDelete(H.day);
    histRefresh('');
  });
  if (location.hash === '#demo') demo();
  for (const r of S.reports.slice(-30)) addLog(r.t, r.text.split('\n')[0], false);
  // meldunki zapisane przed wersją z historią (i przy każdym starcie, na wszelki wypadek) - put nie dubluje
  histAdd(S.reports).then(() => histRefresh());
  window.addEventListener('resize', drawHist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.wake === null && S.wakeWanted) toggleWake();
  });
  window.addEventListener('resize', drawRadar);
  startSensors();
  setInterval(() => { render(); checkLate(); }, 5000);
  render();
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

init();
