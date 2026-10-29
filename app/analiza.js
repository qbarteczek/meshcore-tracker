// Tracker psa – analizy na wzór Traccara, liczone w telefonie (bez serwera, działa offline):
// historia po dniach (IndexedDB, bez limitu), odtwarzanie trasy na mapie, przejścia i postoje, wykres baterii
// i prędkości, strefy z alarmem wyjścia, dziennik zdarzeń, statystyki z ostatnich dni, eksport GPX/KML/CSV.
// Korzysta z app.js: S, $, esc, t, tf, num, store, distM, motion, pathStats, fmtDist, fmtSpd, dur, hm, hms, when,
// sameDay, fmtPos, showAlarm, notify, lastFix, dogName, map, rpLine, rpSel, rpStops, rpMarker, zonesLayer, pinIcon,
// cssVar, showTab, followUI, JUMP_KMH.
'use strict';

const STOP_RADIUS = 40;          // m – punkty bliżej siebie to ten sam postój
const STOP_MIN = 5 * 60000;      // ms – krótsze zatrzymanie nie jest postojem
const FAST_KMH = 15;             // szybki bieg (ucieczka, pościg)
const LOW_BATT = 20;             // % – ostrzeżenie o baterii trackera

const A = {
  zones: store.get('zones', []),          // [{id, name, lat, lon, r, on}]
  events: store.get('events', []),        // [{t, type, text, lat?, lon?}] od najstarszego
  inside: store.get('zones-in', {}),      // id strefy -> czy pies był w środku przy ostatnim meldunku
  evFilter: 'ev', evSeen: store.get('evseen', 0),
};

// wersja 8 miała jedną strefę („trk.geo”) – przenieś ją na listę stref
(() => {
  const g = store.get('geo', null);
  if (!g) return;
  A.zones.push({ id: 'g' + Date.now().toString(36), name: t('Strefa') + ' ' + (A.zones.length + 1), lat: g.lat, lon: g.lon, r: g.r, on: true });
  store.set('zones', A.zones);
  try { localStorage.removeItem('trk.geo'); localStorage.removeItem('trk.geoin'); } catch { /* */ }
})();

// ------------------------------------------------------------------ historia: pozycje psa po dniach (IndexedDB)
// S.reports trzyma ostatnie meldunki (mapa na żywo, radar). Każda pozycja psa trafia też do IndexedDB,
// bez limitu i pogrupowana po dniach (czas lokalny telefonu), żeby można było wrócić do starszych dni.

const H = { db: null, mem: null };   // mem: pokaz #demo (bez zapisu)

const dayKey = (ms) => {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const fmtDay = (day) => new Date(day + 'T12:00:00').toLocaleDateString(LANG, { weekday: 'short', day: 'numeric', month: 'long' });
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
  if (!fixes.length) return;
  if (H.mem) { for (const r of fixes) if (!H.mem.some((p) => p.t === r.t)) H.mem.push({ ...r, day: dayKey(r.t), tracker: r.dev || S.tracker }); return; }
  try {
    const st = await histStore('readwrite');
    // klucz = czas meldunku, więc ponowny zapis tego samego meldunku nic nie dubluje
    for (const r of fixes) {
      st.put({ t: r.t, day: dayKey(r.t), lat: r.lat, lon: r.lon, mv: r.mv, pct: r.pct, temp: r.temp,
        sats: r.sats, int: r.int, search: r.search, tracker: r.dev || S.tracker });
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
      await new Promise((res, rej) => {   // same klucze indeksu – bez czytania całych rekordów
        const r = idx.openKeyCursor();
        r.onsuccess = () => { const c = r.result; if (!c) { res(); return; } m.set(c.key, (m.get(c.key) || 0) + 1); c.continue(); };
        r.onerror = () => rej(r.error);
      });
    } catch { return []; }
  }
  return [...m].map(([day, n]) => ({ day, n })).sort((a, b) => (a.day < b.day ? 1 : -1));
}

async function histGet(day) {
  if (H.mem) return H.mem.filter((p) => p.day === day).map((p) => ({ ...p })).sort((a, b) => a.t - b.t);
  try { return (await reqP((await histStore('readonly')).index('day').getAll(day))).sort((a, b) => a.t - b.t); }
  catch { return []; }
}

async function histDelete(day) {
  if (H.mem) { H.mem = H.mem.filter((p) => p.day !== day); return; }
  const st = await histStore('readwrite');
  for (const k of await reqP(st.index('day').getAllKeys(day))) st.delete(k);
  await new Promise((res) => { st.transaction.oncomplete = res; st.transaction.onerror = res; });
}

// pozycje z przedziału [a, b), z prędkością i kursem
async function histRange(a, b) {
  const d0 = dayKey(a), d1 = dayKey(b - 1);
  const days = (await histDays()).map((d) => d.day).filter((d) => d >= d0 && d <= d1).sort();
  let out = [];
  for (const d of days) out = out.concat(await histGet(d));
  out = out.filter((p) => p.t >= a && p.t < b && (!p.tracker || p.tracker === S.tracker)).sort((x, y) => x.t - y.t);
  let prev = null;
  for (const p of out) { p.fix = true; p.spd = null; p.crs = null; motion(prev, p); prev = p; }
  return out;
}

// ------------------------------------------------------------------ przejścia i postoje

function speedKmh(a, b) {
  const dt = (b.t - a.t) / 1000;
  return dt >= 10 ? (distM(a.lat, a.lon, b.lat, b.lon) / dt) * 3.6 : 0;
}

// segmenty: {type: 'stop'|'trip', i0, i1, t0, t1, lat, lon, m, avg, max}
function segments(pts) {
  const out = [];
  let i = 0;
  while (i < pts.length) {
    // najdłuższy ciąg punktów w promieniu STOP_RADIUS od pierwszego
    let j = i;
    while (j + 1 < pts.length && distM(pts[i].lat, pts[i].lon, pts[j + 1].lat, pts[j + 1].lon) <= STOP_RADIUS) j++;
    if (j > i && pts[j].t - pts[i].t >= STOP_MIN) {
      let la = 0, lo = 0;
      for (let k = i; k <= j; k++) { la += pts[k].lat; lo += pts[k].lon; }
      out.push({ type: 'stop', i0: i, i1: j, t0: pts[i].t, t1: pts[j].t, lat: la / (j - i + 1), lon: lo / (j - i + 1) });
      i = j;
      if (i === pts.length - 1) break;
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.type === 'trip') { last.i1 = i + 1 < pts.length ? i + 1 : i; }
    else out.push({ type: 'trip', i0: i, i1: Math.min(i + 1, pts.length - 1) });
    i++;
  }
  for (const s of out) {
    if (s.type !== 'trip') continue;
    s.t0 = pts[s.i0].t; s.t1 = pts[s.i1].t; s.m = 0; s.max = 0;
    for (let k = s.i0 + 1; k <= s.i1; k++) {
      const v = speedKmh(pts[k - 1], pts[k]);
      if (v > JUMP_KMH) continue;                  // przeskok GPS
      s.m += distM(pts[k - 1].lat, pts[k - 1].lon, pts[k].lat, pts[k].lon);
      s.max = Math.max(s.max, v);
    }
    s.avg = s.t1 > s.t0 ? (s.m / ((s.t1 - s.t0) / 1000)) * 3.6 : 0;
  }
  return out.filter((s) => s.type === 'stop' || s.m >= 20);   // pomija drgania GPS
}

// ------------------------------------------------------------------ trasa: odtwarzanie i raport

let rpToken = 0;

function rangeOf(key) {
  const now = Date.now(), d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const day = d0.getTime();
  if (key === 'custom') return customRange();   // narzedzia.js
  if (key === 'h1') return [now - 3600e3, now + 1];
  if (key === 'h6') return [now - 6 * 3600e3, now + 1];
  if (key === 'today') return [day, now + 1];
  if (key === 'yday') { const y = new Date(day - 12 * 3600e3); y.setHours(0, 0, 0, 0); return [y.getTime(), day]; }
  if (key.startsWith('d:')) {
    const a = new Date(key.slice(2) + 'T00:00:00'), b = new Date(a); b.setDate(b.getDate() + 1);
    return [a.getTime(), b.getTime()];
  }
  return [0, now + 1];
}
// klucz jednego dnia dla okresu (do „Usuń ten dzień” i wyróżnienia na wykresie dni) albo ''
function rangeDay(key) {
  if (key === 'today') return dayKey(Date.now());
  if (key === 'yday') return dayKey(rangeOf('yday')[0]);
  return key.startsWith('d:') ? key.slice(2) : '';
}

async function fillDays() {
  const sel = $('rp-range'), keep = sel.value;
  const days = await histDays();
  sel.querySelectorAll('option[data-day]').forEach((o) => o.remove());
  for (const d of days) {
    const o = new Option(fmtDay(d.day) + ' · ' + tf('{n} pkt', { n: d.n }), 'd:' + d.day);
    o.dataset.day = '1';
    sel.add(o);
  }
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : 'today';
}

async function loadReplay(fit) {
  stopPlay();
  const my = ++rpToken;
  const key = $('rp-range').value;
  const [a, b] = rangeOf(key);
  const list = await histRange(a, b);
  if (my !== rpToken) return;                       // w międzyczasie wybrano inny okres
  const st = pathStats(list);
  S.rp.list = list; S.rp.cum = st.cum; S.rp.sel = null;
  S.rp.segs = list.length > 1 ? segments(list) : [];
  $('rp-slider').max = Math.max(0, list.length - 1);
  $('rp-slider').disabled = $('rp-play').disabled = list.length < 2;
  $('rp-count').textContent = list.length ? tf('{n} pozycji', { n: list.length }) : '';
  const stops = S.rp.segs.filter((s) => s.type === 'stop');
  // raport
  const dash = '–';
  $('r-dist').textContent = list.length > 1 ? fmtDist(st.dist) : dash;
  $('r-dur').textContent = list.length > 1 ? dur(list[list.length - 1].t - list[0].t) : dash;
  $('r-move').textContent = list.length > 1 ? dur(st.move * 1000) : dash;
  $('r-avg').textContent = st.move > 60 ? fmtSpd((st.dist / st.move) * 3.6) : dash;
  $('r-max').textContent = list.length > 1 ? fmtSpd(st.max) : dash;
  $('r-far').textContent = list.length > 1 ? fmtDist(st.far) : dash;
  $('r-stops').textContent = list.length ? stops.length + (stops.length ? ' · ' + dur(stops.reduce((s, x) => s + x.t1 - x.t0, 0)) : '') : dash;
  const withB = list.filter((r) => r.pct != null);
  $('r-batt').textContent = withB.length ? withB[0].pct + '% → ' + withB[withB.length - 1].pct + '%' : dash;
  for (const id of ['rp-gpx', 'rp-kml', 'rp-csv']) $(id).disabled = !list.length;
  $('rp-del').hidden = !rangeDay(key);
  $('rp-del').disabled = !list.length;
  $('rp-empty').hidden = list.length > 0;
  // mapa
  if (map) {
    rpLine.setLatLngs(list.map((r) => [r.lat, r.lon]));
    rpSel.setLatLngs([]);
    rpStops.clearLayers();
    for (const s of stops) {
      L.circleMarker([s.lat, s.lon], { radius: 8, color: cssVar('--replay'), weight: 2, fillColor: '#fff', fillOpacity: 0.9 })
        .bindPopup(`<b>${esc(t('Postój'))}</b><br>${esc(hm(s.t0) + '–' + hm(s.t1))}<br>${esc(dur(s.t1 - s.t0))}`).addTo(rpStops);
    }
    if (list.length) {   // start (zielony)
      L.circleMarker([list[0].lat, list[0].lon], { radius: 6, color: '#fff', weight: 2, fillColor: cssVar('--ok'), fillOpacity: 1 })
        .bindPopup(`<b>${esc(t('Start'))}</b><br>${esc(when(list[0].t))}`).addTo(rpStops);
    }
  }
  renderSegments();
  setIdx(list.length ? list.length - 1 : 0);
  if (fit && map && list.length > 1) map.fitBounds(rpLine.getBounds(), { padding: [30, 30], maxZoom: 17 });
  else if (fit && map && list.length) map.setView([list[0].lat, list[0].lon], 16);
  renderStats(rangeDay(key));
  renderDaysTable();
}

function renderSegments() {
  const ol = $('r-trips');
  ol.textContent = '';
  const segs = S.rp.segs || [];
  segs.forEach((s, n) => {
    const li = document.createElement('li');
    li.className = 'click ' + s.type + (S.rp.sel === n ? ' sel' : '');
    const txt = s.type === 'stop'
      ? t('Postój') + ' · ' + dur(s.t1 - s.t0)
      : t('Przejście') + ' · ' + fmtDist(s.m) + ' · ' + dur(s.t1 - s.t0) + ' · ' + t('śr.') + ' ' + fmtSpd(s.avg) + ' · ' + t('maks.') + ' ' + fmtSpd(s.max);
    li.innerHTML = `<span class="i">${s.type === 'stop' ? '⏸️' : '🐾'}</span><span class="x">${esc(txt)}</span><time>${esc(hm(s.t0) + '–' + hm(s.t1))}</time>`;
    li.addEventListener('click', () => selectSeg(S.rp.sel === n ? null : n));
    ol.append(li);
  });
  if (!segs.length) ol.innerHTML = `<li><span class="x muted">${esc(t('Brak przejść i postojów.'))}</span></li>`;
}

function selectSeg(n) {
  S.rp.sel = n;
  const s = n === null ? null : S.rp.segs[n];
  if (map) {
    rpSel.setLatLngs(s && s.type === 'trip' ? S.rp.list.slice(s.i0, s.i1 + 1).map((r) => [r.lat, r.lon]) : []);
    if (s && s.type === 'trip' && s.i1 > s.i0) map.fitBounds(rpSel.getBounds(), { padding: [30, 30], maxZoom: 18 });
    else if (s) map.setView([s.lat, s.lon], 17);
  }
  renderSegments();
  setIdx(s ? s.i0 : S.rp.list.length - 1);
  if (s) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setIdx(i) {
  const list = S.rp.list;
  S.rp.idx = Math.max(0, Math.min(i, list.length - 1));
  $('rp-slider').value = S.rp.idx;
  const r = list[S.rp.idx];
  if (!r) {
    $('rp-info').textContent = t('Brak pozycji w tym okresie.');
    if (map && map.hasLayer(rpMarker)) rpMarker.remove();
    drawChart();
    return;
  }
  const parts = [`<b>${esc(hms(r.t))}</b>${sameDay(r.t, Date.now()) ? '' : ' · ' + esc(new Date(r.t).toLocaleDateString(LANG))}`,
    esc(t('od startu') + ' ' + fmtDist(S.rp.cum[S.rp.idx] || 0))];
  if (r.spd != null) parts.push(esc(fmtSpd(r.spd)));
  if (r.pct != null) parts.push(esc(t('bateria') + ' ' + r.pct + '%'));
  if (r.sats) parts.push(esc(r.sats + ' sat'));
  if (r.search) parts.push(esc(t('szukanie')));
  parts.push(esc(fmtPos(r)));
  $('rp-info').innerHTML = parts.join(' · ');
  if (map && S.tab === 'replay') {
    rpMarker.setLatLng([r.lat, r.lon]).setIcon(pinIcon('rp', r.spd >= 1.5 ? r.crs : null, hm(r.t)));
    if (!map.hasLayer(rpMarker)) rpMarker.addTo(map);
    if (S.rp.timer && !map.getBounds().pad(-0.1).contains([r.lat, r.lon])) map.panTo([r.lat, r.lon]);
  }
  drawChart();
}

function togglePlay() {
  if (S.rp.timer) { stopPlay(); return; }
  if (S.rp.list.length < 2) return;
  if (S.rp.idx >= S.rp.list.length - 1) setIdx(0);
  $('rp-play').textContent = '⏸';
  // 1× = cała trasa w ok. 40 s, niezależnie od liczby punktów
  const step = () => {
    const n = S.rp.list.length, k = Math.max(1, Math.round((n / 400) * parseFloat($('rp-speed').value)));
    if (S.rp.idx >= n - 1) { stopPlay(); return; }
    setIdx(S.rp.idx + k);
  };
  S.rp.timer = setInterval(step, 100);
}
function stopPlay() { if (S.rp.timer) clearInterval(S.rp.timer); S.rp.timer = null; $('rp-play').textContent = '▶'; }

function replayLayers(on) {
  if (!map) return;
  for (const l of [rpLine, rpSel, rpStops]) { if (on && !map.hasLayer(l)) l.addTo(map); if (!on && map.hasLayer(l)) l.remove(); }
  if (!on && map.hasLayer(rpMarker)) rpMarker.remove();
  if (on) others.clearLayers();   // na trasie tylko wybrany tracker
  if (!on) stopPlay();
}

// ------------------------------------------------------------------ wykres: bateria i prędkość

function drawChart() {
  const cv = $('rp-chart'), dpr = window.devicePixelRatio || 1;
  const pts = S.rp.list;
  cv.hidden = pts.length < 2;   // przed pomiarem: ukryty canvas ma szerokość 0
  const w = cv.clientWidth, h = Math.round(Math.min(w * 0.36, 220));
  if (!w || pts.length < 2) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'), col = cssVar;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const l = 34, r = 40, top = 10, bot = 20, t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const X = (tt) => l + ((tt - t0) / Math.max(1, t1 - t0)) * (w - l - r);
  const spd = pts.map((p, i) => { const v = i ? speedKmh(pts[i - 1], p) : 0; return v > JUMP_KMH ? 0 : v; });
  const vmax = Math.max(5, ...spd) * 1.1;
  g.strokeStyle = col('--line'); g.lineWidth = 1; g.fillStyle = col('--muted'); g.font = '11px system-ui, sans-serif';
  for (let k = 0; k <= 4; k++) {
    const y = top + (k / 4) * (h - top - bot);
    g.beginPath(); g.moveTo(l, y); g.lineTo(w - r, y); g.stroke();
    g.textAlign = 'right'; g.fillText(100 - k * 25 + '%', l - 4, y + 4);
    g.textAlign = 'left'; g.fillText(Math.round(vmax - (k * vmax) / 4), w - r + 4, y + 4);
  }
  g.textAlign = 'left'; g.fillText(hm(t0), l, h - 4);
  g.textAlign = 'right'; g.fillText(hm(t1), w - r, h - 4);
  g.fillText('km/h', w - 2, h - 4);
  const Y = (v, max) => top + (1 - v / max) * (h - top - bot);
  // prędkość (słupki) i bateria (linia)
  g.fillStyle = col('--trail');
  pts.forEach((p, i) => { if (i && spd[i]) { const x0 = X(pts[i - 1].t), x1 = X(p.t); g.fillRect(x0, Y(spd[i], vmax), Math.max(1, x1 - x0 - 0.5), Y(0, vmax) - Y(spd[i], vmax)); } });
  g.strokeStyle = col('--ok'); g.lineWidth = 2; g.beginPath();
  let started = false;
  for (const p of pts) { if (p.pct == null) continue; const x = X(p.t), y = Y(p.pct, 100); started ? g.lineTo(x, y) : g.moveTo(x, y); started = true; }
  g.stroke();
  const sel = pts[S.rp.idx];
  if (sel) { g.strokeStyle = col('--replay'); g.lineWidth = 2; g.beginPath(); g.moveTo(X(sel.t), top); g.lineTo(X(sel.t), h - bot); g.stroke(); }
}

// ------------------------------------------------------------------ statystyki dni

async function renderStats(selDay) {
  const days = (await histDays()).slice(0, 14).reverse();
  const cv = $('stats-chart'), dpr = window.devicePixelRatio || 1;
  $('stats-empty').hidden = days.length > 0;
  cv.hidden = !days.length;
  const w = cv.clientWidth, h = Math.round(Math.min(w * 0.42, 220));
  if (!w || !days.length) { $('stats-sum').textContent = ''; return; }
  const rows = [];
  for (const d of days) {
    const pts = (await histGet(d.day)).filter((p) => !p.tracker || p.tracker === S.tracker);
    if (!pts.length) continue;
    const st = pathStats(pts);
    const active = segments(pts).filter((s) => s.type === 'trip').reduce((a, s) => a + (s.t1 - s.t0), 0);
    rows.push({ day: d.day, m: st.dist, active });
  }
  if (!rows.length) { cv.hidden = true; $('stats-empty').hidden = false; $('stats-sum').textContent = ''; return; }
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'), col = cssVar;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const top = 18, bot = 20, mmax = Math.max(100, ...rows.map((r) => r.m));
  const bw = (w - 8) / rows.length;
  g.font = '11px system-ui, sans-serif'; g.textAlign = 'center';
  rows.forEach((r, i) => {
    const bh = (r.m / mmax) * (h - top - bot), x = 4 + i * bw;
    g.fillStyle = r.day === selDay ? col('--dog') : col('--trail');
    g.fillRect(x + 3, h - bot - bh, bw - 6, bh);
    g.fillStyle = col('--muted');
    g.fillText(new Date(r.day + 'T12:00:00').getDate(), x + bw / 2, h - 6);
    if (r.m >= 50 && bw > 26) { g.fillStyle = col('--ink'); g.fillText(r.m < 1000 ? Math.round(r.m) : num(r.m / 1000, 1), x + bw / 2, h - bot - bh - 4); }
  });
  const sum = rows.reduce((a, r) => a + r.m, 0), act = rows.reduce((a, r) => a + r.active, 0);
  $('stats-sum').textContent = tf('{n} dni · razem {d} · w ruchu {a}', { n: rows.length, d: fmtDist(sum), a: dur(act) });
}

// ------------------------------------------------------------------ eksport GPX / KML / CSV

function fileStamp(list) {
  const d = new Date(list.length ? list[0].t : Date.now()), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

function exportRange(fmt) {
  const pts = S.rp.list;
  if (!pts.length) return;
  const name = dogName() + ' ' + when(pts[0].t);
  let body, type;
  if (fmt === 'kml') {
    const coords = pts.map((p) => p.lon.toFixed(6) + ',' + p.lat.toFixed(6) + ',0').join(' ');
    const stops = (S.rp.segs || []).filter((s) => s.type === 'stop').map((s) => `<Placemark><name>${esc(t('Postój') + ' ' + hm(s.t0) + '–' + hm(s.t1))}</name>`
      + `<Point><coordinates>${s.lon.toFixed(6)},${s.lat.toFixed(6)},0</coordinates></Point></Placemark>`).join('\n');
    body = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
      + `<name>${esc(name)}</name><Style id="t"><LineStyle><color>ff0c59e8</color><width>4</width></LineStyle></Style>\n`
      + `<Placemark><name>${esc(name)}</name><styleUrl>#t</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>\n`
      + stops + '\n</Document></kml>\n';
    type = 'application/vnd.google-earth.kml+xml';
  } else if (fmt === 'csv') {
    body = 'time;lat;lon;speed_kmh;course;battery_pct;battery_v;temp_c;sats;interval_s;search\n' + pts.map((p) =>
      [new Date(p.t).toISOString(), p.lat.toFixed(6), p.lon.toFixed(6), p.spd != null ? p.spd.toFixed(1) : '', p.crs != null ? Math.round(p.crs) : '',
        p.pct ?? '', p.mv ? (p.mv / 1000).toFixed(3) : '', p.temp ?? '', p.sats ?? '', p.int ?? '', p.search ? 1 : 0].join(';')).join('\n') + '\n';
    type = 'text/csv';
  } else {
    const trk = pts.map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><time>${new Date(p.t).toISOString()}</time></trkpt>`);
    body = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="tracker-psa ${VERSION}" xmlns="http://www.topografix.com/GPX/1/1">\n`
      + `<trk><name>${esc(name)}</name><trkseg>\n${trk.join('\n')}\n</trkseg></trk>\n</gpx>\n`;
    type = 'application/gpx+xml';
  }
  const file = new File([body], 'trasa-psa-' + fileStamp(pts) + '.' + fmt, { type });
  // Android: „Udostępnij” otwiera listę aplikacji (Organic Maps, OsmAnd, Dysk…); inaczej zwykłe pobranie pliku
  if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: name }).catch(() => {}); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ------------------------------------------------------------------ strefy (geofence)
// okrąg {lat, lon, r} albo wielokąt narysowany na mapie {pts: [[lat, lon], …]}

function zoneInside(z, p) {
  if (!z.pts) return distM(z.lat, z.lon, p.lat, p.lon) <= z.r;
  let inside = false;                              // promień w poziomie (ray casting) na lat/lon
  for (let i = 0, j = z.pts.length - 1; i < z.pts.length; j = i++) {
    const [yi, xi] = z.pts[i], [yj, xj] = z.pts[j];
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// odległość od granicy strefy (m), 0 w środku
function zoneOut(z, p) {
  if (zoneInside(z, p)) return 0;
  if (!z.pts) return distM(z.lat, z.lon, p.lat, p.lon) - z.r;
  const kx = K * R * Math.cos(p.lat * K), ky = K * R;
  const xy = ([la, lo]) => [(lo - p.lon) * kx, (la - p.lat) * ky];
  let best = Infinity;
  for (let i = 0; i < z.pts.length; i++) {
    const [ax, ay] = xy(z.pts[i]), [bx, by] = xy(z.pts[(i + 1) % z.pts.length]);
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + u * dx, ay + u * dy));
  }
  return best;
}
function zoneBounds(z) {
  return z.pts ? L.latLngBounds(z.pts) : L.latLng(z.lat, z.lon).toBounds(z.r * 2);
}
function zoneSize(z) {
  if (!z.pts) return fmtDist(z.r);
  const b = zoneBounds(z);
  return t('obszar') + ' ' + fmtDist(distM(b.getSouth(), b.getWest(), b.getNorth(), b.getWest())) + ' × '
    + fmtDist(distM(b.getSouth(), b.getWest(), b.getSouth(), b.getEast()));
}
const inKey = (z, dev) => z.id + '|' + (dev || S.tracker);

function saveZones() { store.set('zones', A.zones); store.set('zones-in', A.inside); }

function renderZones() {
  const list = $('zones');
  list.textContent = '';
  if (!A.zones.length) {
    list.innerHTML = `<li><span class="x muted">${esc(t('Brak stref. Dodaj strefę, a aplikacja zaalarmuje, gdy pies z niej wyjdzie.'))}</span></li>`;
  }
  const fix = lastFix();
  for (const z of A.zones) {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = z.on; cb.setAttribute('aria-label', t('Strefa włączona'));
    cb.addEventListener('change', () => { z.on = cb.checked; saveZones(); drawZones(); render(); });
    const inside = fix ? zoneInside(z, fix) : null;
    const span = document.createElement('span');
    span.className = 'x click' + (z.on && inside === false ? ' bad' : '');
    span.textContent = (z.pts ? '⬠ ' : '◯ ') + z.name + ' · ' + zoneSize(z) + (inside === null ? '' : ' · ' + (inside ? t('pies w strefie') : t('pies poza strefą')));
    span.addEventListener('click', () => { if (map) map.fitBounds(zoneBounds(z).pad(0.2)); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'chip'; del.textContent = '✕'; del.setAttribute('aria-label', t('Usuń strefę'));
    del.addEventListener('click', () => {
      if (!confirm(tf('Usunąć strefę „{n}”?', { n: z.name }))) return;
      A.zones = A.zones.filter((x) => x !== z);
      for (const k of Object.keys(A.inside)) if (k === z.id || k.startsWith(z.id + '|')) delete A.inside[k];
      saveZones(); renderZones(); drawZones(); render();
    });
    li.append(cb, span, del);
    list.append(li);
  }
}

function addZone() {
  const src = $('zone-src').value;
  const fix = lastFix();
  let c = null;
  if (src === 'me') c = S.me;
  else if (src === 'map' && map) { const m = map.getCenter(); c = { lat: m.lat, lon: m.lng }; }
  else if (src === 'dog') c = fix;
  if (!c) { $('zone-msg').textContent = src === 'me' ? t('Brak pozycji telefonu.') : t('Brak pozycji psa.'); return; }
  const name = $('zone-name').value.trim() || t('Strefa') + ' ' + (A.zones.length + 1);
  saveNewZone({ id: Date.now().toString(36), name, lat: c.lat, lon: c.lon, r: +$('zone-r').value, on: true });
}

// wspólne dla okręgu i wielokąta narysowanego na mapie (narzedzia.js)
function saveNewZone(z) {
  A.zones.push(z);
  saveZones();
  $('zone-name').value = '';
  $('zone-msg').textContent = tf('Dodano strefę „{n}”.', { n: z.name });
  const c = zoneBounds(z).getCenter();
  addEvent('zone_set', tf('Dodano strefę „{n}”.', { n: z.name }) + ' ' + zoneSize(z), false, Date.now(), { lat: c.lat, lon: c.lng });
  for (const d of devices()) {
    const f = lastFix(d);
    if (!f) continue;
    A.inside[inKey(z, d)] = zoneInside(z, f);
    if (!A.inside[inKey(z, d)]) {
      addEvent('zone_out', who(d) + tf('Pies wyszedł ze strefy „{n}” ({d} poza granicą)', { n: z.name, d: fmtDist(zoneOut(z, f)) }), true, Date.now(), f);
    }
  }
  saveZones();
  renderZones(); drawZones(); render();
  if (map) map.fitBounds(zoneBounds(z).pad(0.2));
}

function drawZones() {
  if (!map) return;
  zonesLayer.clearLayers();
  for (const z of A.zones) {
    if (!z.on) continue;
    const st = { color: cssVar('--geo'), weight: 2, dashArray: '6 6', fillOpacity: 0.06 };
    (z.pts ? L.polygon(z.pts, st) : L.circle([z.lat, z.lon], { radius: z.r, ...st }))
      .bindTooltip(z.name, { direction: 'top' }).addTo(zonesLayer);
  }
}

// karta psa: strefy, poza którymi jest pies (albo „w strefie”)
function zonesStatus(fix) {
  const on = A.zones.filter((z) => z.on);
  if (!on.length) return { text: t('brak stref'), cls: '' };
  if (!fix) return { text: on.map((z) => z.name).join(', '), cls: '' };
  const out = on.filter((z) => !zoneInside(z, fix));
  if (out.length) return { text: t('POZA strefą') + ' ' + out.map((z) => '„' + z.name + '” +' + fmtDist(zoneOut(z, fix))).join(', '), cls: 'bad' };
  return { text: t('w strefie') + ' ' + on.map((z) => '„' + z.name + '”').join(', '), cls: 'good' };
}

// ------------------------------------------------------------------ zdarzenia

const EV_ICON = { alarm: '⚠️', late: '⏰', zone_out: '🚧', zone_in: '🏠', zone_set: '⭕', batt: '🪫', fast: '💨', nofix: '📡',
  search: '🔍', cmd: '📨', conn: '🔗', disc: '🔌', back: '✅' };
const EV_ALARM = ['alarm', 'late', 'zone_out', 'batt'];
const RULE_TYPES = ['zone_out', 'zone_in', 'late', 'alarm', 'batt', 'nofix', 'fast', 'back', 'search', 'cmd', 'conn', 'disc'];
const RULE_DEFAULT = { zone_out: 'alarm', late: 'alarm', alarm: 'alarm', batt: 'notify', back: 'notify' };
A.rules = store.get('rules', {});
const ruleOf = (type) => A.rules[type] || RULE_DEFAULT[type] || 'log';
// kto: przy kilku trackerach nazwa przed treścią zdarzenia
const who = (dev) => (devices().length > 1 ? dogName(dev) + ': ' : '');
const EV_GOOD = ['zone_in', 'back'];

// silent: tylko zapis (np. „brak meldunku” – alarm obsługuje checkLate według tej samej reguły)
function addEvent(type, text, alarm, tt, pos, silent) {
  const e = { t: tt || Date.now(), type, text };
  if (pos && pos.lat != null) { e.lat = pos.lat; e.lon = pos.lon; }
  A.events.push(e);
  if (A.events.length > 500) A.events.splice(0, A.events.length - 500);
  store.set('events', A.events);
  renderEvents();
  if (silent) return;
  const lvl = ruleOf(type);
  if (lvl === 'alarm') showAlarm(text);
  else if (lvl === 'notify') notify(text);
}

function renderEvents() {
  const ol = $('ev-list');
  ol.textContent = '';
  let items;
  if (A.evFilter === 'rep') {
    items = S.reports.slice(-200).reverse().map((r) => ({ t: r.t, icon: r.fix ? '📍' : '❔', text: r.text || '', lat: r.fix ? r.lat : null, lon: r.lon, cls: '' }));
  } else {
    items = A.events.filter((e) => A.evFilter === 'ev' || EV_ALARM.includes(e.type)).slice(-300).reverse()
      .map((e) => ({ t: e.t, icon: EV_ICON[e.type] || '•', text: e.text, lat: e.lat, lon: e.lon,
        cls: EV_ALARM.includes(e.type) ? 'warn' : EV_GOOD.includes(e.type) ? 'good' : '' }));
  }
  for (const it of items) {
    const li = document.createElement('li');
    li.className = it.cls + (it.lat != null ? ' click' : '');
    li.innerHTML = `<span class="i">${it.icon}</span><span class="x">${esc(it.text)}</span><time>${esc(when(it.t))}</time>`;
    if (it.lat != null) li.addEventListener('click', () => { showTab('map'); S.follow = false; followUI(); if (map) map.setView([it.lat, it.lon], 17); });
    ol.append(li);
  }
  $('ev-empty').hidden = items.length > 0;
  // licznik nowych alarmów na zakładce
  const unseen = A.events.filter((e) => e.t > A.evSeen && EV_ALARM.includes(e.type)).length;
  const badge = $('ev-badge');
  if (S.tab === 'events') { A.evSeen = Date.now(); store.set('evseen', A.evSeen); badge.hidden = true; }
  else { badge.hidden = !unseen; badge.textContent = unseen > 9 ? '9+' : unseen; }
}

// wywoływane przez app.js przy każdym meldunku (prev = poprzedni meldunek)
function checkEvents(r, prev) {
  const dev = r.dev || S.tracker, w = who(dev);
  if (r.back) addEvent('back', w + t('Kontakt z psem wrócił'), false, r.t, r.fix ? r : null);
  if (r.search && !(prev && prev.search)) addEvent('search', w + t('Szukanie włączone (meldunek co 30 s)'), false, r.t);
  if (!r.search && prev && prev.search) addEvent('search', w + t('Szukanie zakończone'), false, r.t);
  if (r.pct != null && r.pct <= LOW_BATT && !(prev && prev.pct != null && prev.pct <= LOW_BATT) && S.battWarn) {
    addEvent('batt', w + tf('Niska bateria trackera: {p}%', { p: r.pct }), false, r.t);
  }
  if (!r.fix && prev && prev.fix) addEvent('nofix', w + t('Tracker stracił GPS'), false, r.t);
  if (!r.fix) return;
  let prevFix = null;
  for (let i = S.reports.length - 1; i >= 0; i--) {
    const q = S.reports[i];
    if (q !== r && q.fix && (q.dev || S.tracker) === dev) { prevFix = q; break; }
  }
  if (prevFix) {
    const v = speedKmh(prevFix, r);
    if (v >= FAST_KMH && v <= JUMP_KMH && r.t - prevFix.t <= 10 * 60000) addEvent('fast', w + tf('Szybki bieg: {v}', { v: fmtSpd(v) }), false, r.t, r);
  }
  let changed = false;
  for (const z of A.zones) {
    if (!z.on) continue;
    const inside = zoneInside(z, r), k = inKey(z, dev);
    if (A.inside[k] === undefined && dev === S.tracker && A.inside[z.id] !== undefined) A.inside[k] = A.inside[z.id];   // wersja < 11
    if (A.inside[k] === undefined) { A.inside[k] = inside; changed = true; continue; }
    if (inside !== A.inside[k]) {
      A.inside[k] = inside; changed = true;
      if (inside) addEvent('zone_in', w + tf('Pies wrócił do strefy „{n}”', { n: z.name }), false, r.t, r);
      else addEvent('zone_out', w + tf('Pies wyszedł ze strefy „{n}” ({d} poza granicą)', { n: z.name, d: fmtDist(zoneOut(z, r)) }), true, r.t, r);
    }
  }
  if (changed) { saveZones(); renderZones(); }
}

// ------------------------------------------------------------------ start

function initAnaliza() {
  $('rp-range').addEventListener('change', () => loadReplay(true));
  $('rp-slider').addEventListener('input', (e) => { stopPlay(); setIdx(parseInt(e.target.value, 10)); });
  $('rp-play').addEventListener('click', togglePlay);
  for (const f of ['gpx', 'kml', 'csv']) $('rp-' + f).addEventListener('click', () => exportRange(f));
  $('rp-del').addEventListener('click', async () => {
    const day = rangeDay($('rp-range').value);
    if (!day || !confirm(tf('Usunąć trasę z dnia {d}?', { d: fmtDay(day) }))) return;
    await histDelete(day);
    await fillDays();
    loadReplay(false);
  });
  $('zone-add').addEventListener('click', addZone);
  $('ev-clear').addEventListener('click', () => {
    if (!confirm(t('Wyczyścić dziennik zdarzeń?'))) return;
    A.events = []; store.set('events', []); renderEvents();
  });
  document.querySelectorAll('.ev-filter .chip').forEach((b) => b.addEventListener('click', () => {
    A.evFilter = b.dataset.f;
    document.querySelectorAll('.ev-filter .chip').forEach((x) => x.classList.toggle('on', x === b));
    renderEvents();
  }));
  window.addEventListener('resize', () => { if (S.tab === 'replay') { drawChart(); renderStats(rangeDay($('rp-range').value)); } });
  renderZones();
  drawZones();
  renderEvents();
}
