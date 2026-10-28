// Tracker psa – analizy na wzór Traccara, liczone w telefonie (bez serwera, działa offline):
// odtwarzanie trasy, przejścia i postoje, wykres baterii i prędkości, strefy z alarmem wyjścia,
// dziennik zdarzeń, statystyki z ostatnich dni, eksport GPX/KML/CSV.
// Korzysta z app.js: S, H, $, t, tf, num, distM, fmtDist, dur, fmtTime, fmtDay, dayKey, histGet, histDays,
// showAlarm, store, drawHist.
'use strict';

const STOP_RADIUS = 40;          // m – punkty bliżej siebie to ten sam postój
const STOP_MIN = 5 * 60000;      // ms – krótsze zatrzymanie nie jest postojem
const FAST_KMH = 15;             // szybki bieg (ucieczka, pościg)
const LOW_BATT = 20;             // % – ostrzeżenie o baterii trackera

const A = {
  zones: store.get('zones', []),          // [{id, name, lat, lon, r, on}]
  events: store.get('events', []),        // [{t, type, text}] od najstarszego
  inside: store.get('zones-in', {}),      // id strefy -> czy pies był w środku przy ostatnim meldunku
  play: null, playSpeed: 1, sel: null,    // sel: indeks wybranego przejścia/postoju
};

// ------------------------------------------------------------------ przejścia i postoje

// segmenty dnia: {type: 'stop'|'trip', i0, i1, t0, t1, lat, lon, m, avg, max}
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
      const d = distM(pts[k - 1].lat, pts[k - 1].lon, pts[k].lat, pts[k].lon);
      s.m += d;
      s.max = Math.max(s.max, speedKmh(pts[k - 1], pts[k]));
    }
    s.avg = s.t1 > s.t0 ? (s.m / ((s.t1 - s.t0) / 1000)) * 3.6 : 0;
  }
  return out.filter((s) => s.type === 'stop' || s.m >= 20);   // pomija drgania GPS
}

function speedKmh(a, b) {
  const dt = (b.t - a.t) / 1000;
  return dt >= 10 ? (distM(a.lat, a.lon, b.lat, b.lon) / dt) * 3.6 : 0;
}

const kmh = (v) => num(v, v < 10 ? 1 : 0) + ' km/h';

function renderSegments() {
  const list = $('hist-trips');
  list.textContent = '';
  H.segs = H.pts.length > 1 ? segments(H.pts) : [];
  if (!H.segs.length) { list.hidden = true; return; }
  list.hidden = false;
  H.segs.forEach((s, n) => {
    const li = document.createElement('li');
    li.className = s.type + (A.sel === n ? ' sel' : '');
    const tm = document.createElement('time');
    tm.textContent = fmtTime(s.t0) + '–' + fmtTime(s.t1);
    const txt = s.type === 'stop'
      ? t('Postój') + ' · ' + dur(s.t1 - s.t0)
      : t('Przejście') + ' · ' + fmtDist(s.m) + ' · ' + dur(s.t1 - s.t0) + ' · ' + t('śr.') + ' ' + kmh(s.avg) + ' · ' + t('maks.') + ' ' + kmh(s.max);
    li.append(tm, document.createTextNode(txt));
    li.addEventListener('click', () => {
      A.sel = A.sel === n ? null : n;
      $('hist-pos').value = A.sel === null ? H.pts.length - 1 : s.i0;
      renderSegments(); drawHist();
    });
    list.append(li);
  });
}

// rysowane przez drawHist (app.js) na mapce dnia: strefy, postoje, wybrany odcinek
function drawHistExtras(g, proj, sc, col) {
  for (const z of A.zones) {
    if (!z.on) continue;
    const [x, y] = proj(z);
    g.strokeStyle = col('--ok'); g.lineWidth = 1.5; g.setLineDash([5, 4]);
    g.beginPath(); g.arc(x, y, z.r * sc, 0, 2 * Math.PI); g.stroke(); g.setLineDash([]);
  }
  (H.segs || []).forEach((s, n) => {
    if (s.type === 'stop') {
      const [x, y] = proj(s);
      g.fillStyle = col('--warn'); g.globalAlpha = A.sel === n ? 0.9 : 0.5;
      g.beginPath(); g.arc(x, y, A.sel === n ? 8 : 5, 0, 2 * Math.PI); g.fill(); g.globalAlpha = 1;
    } else if (A.sel === n) {
      g.strokeStyle = col('--me'); g.lineWidth = 5; g.globalAlpha = 0.6; g.beginPath();
      for (let k = s.i0; k <= s.i1; k++) { const [x, y] = proj(H.pts[k]); k === s.i0 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke(); g.globalAlpha = 1;
    }
  });
}

// ------------------------------------------------------------------ wykres: bateria i prędkość

function drawChart() {
  const cv = $('hist-chart'), dpr = window.devicePixelRatio || 1;
  cv.hidden = H.pts.length < 2;   // przed pomiarem: ukryty canvas ma szerokość 0
  const w = cv.clientWidth, h = Math.round(w * 0.36);
  if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const pts = H.pts;
  if (pts.length < 2) return;
  const l = 34, r = 40, top = 10, bot = 20, t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const X = (tt) => l + ((tt - t0) / Math.max(1, t1 - t0)) * (w - l - r);
  const spd = pts.map((p, i) => (i ? speedKmh(pts[i - 1], p) : 0));
  const vmax = Math.max(5, ...spd) * 1.1;
  // siatka i osie
  g.strokeStyle = col('--line'); g.lineWidth = 1; g.fillStyle = col('--muted'); g.font = '11px system-ui, sans-serif';
  for (let k = 0; k <= 4; k++) {
    const y = top + (k / 4) * (h - top - bot);
    g.beginPath(); g.moveTo(l, y); g.lineTo(w - r, y); g.stroke();
    g.textAlign = 'right'; g.fillText(100 - k * 25 + '%', l - 4, y + 4);
    g.textAlign = 'left'; g.fillText(Math.round(vmax - (k * vmax) / 4), w - r + 4, y + 4);
  }
  g.textAlign = 'left'; g.fillText(fmtTime(t0), l, h - 4);
  g.textAlign = 'right'; g.fillText(fmtTime(t1), w - r, h - 4);
  g.fillText('km/h', w - 2, h - 4);
  const Y = (v, max) => top + (1 - v / max) * (h - top - bot);
  // prędkość (słupki) i bateria (linia)
  g.fillStyle = col('--trail');
  pts.forEach((p, i) => { if (i && spd[i]) { const x0 = X(pts[i - 1].t), x1 = X(p.t); g.fillRect(x0, Y(spd[i], vmax), Math.max(1, x1 - x0 - 0.5), Y(0, vmax) - Y(spd[i], vmax)); } });
  g.strokeStyle = col('--ok'); g.lineWidth = 2; g.beginPath();
  let started = false;
  for (const p of pts) { if (p.pct == null) continue; const x = X(p.t), y = Y(p.pct, 100); started ? g.lineTo(x, y) : g.moveTo(x, y); started = true; }
  g.stroke();
  // znacznik wybranego punktu
  const sel = pts[+$('hist-pos').value];
  if (sel) { g.strokeStyle = col('--me'); g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(sel.t), top); g.lineTo(X(sel.t), h - bot); g.stroke(); }
}

// ------------------------------------------------------------------ odtwarzanie

function togglePlay() {
  const btn = $('hist-play');
  if (A.play) { clearInterval(A.play); A.play = null; btn.textContent = '▶'; return; }
  const pos = $('hist-pos');
  if (+pos.value >= +pos.max) pos.value = 0;
  btn.textContent = '⏸';
  // tempo: cały dzień w ~20 s przy 1×, niezależnie od liczby punktów
  A.play = setInterval(() => {
    const step = Math.max(1, Math.round((H.pts.length / 200) * A.playSpeed));
    pos.value = Math.min(+pos.max, +pos.value + step);
    drawHist();
    if (+pos.value >= +pos.max) togglePlay();
  }, 100);
}

// ------------------------------------------------------------------ strefy (geofence)

function renderZones() {
  const list = $('zones');
  list.textContent = '';
  if (!A.zones.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = t('Brak stref. Dodaj strefę, a aplikacja zaalarmuje, gdy pies z niej wyjdzie.');
    list.append(li);
    return;
  }
  for (const z of A.zones) {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = z.on; cb.setAttribute('aria-label', t('Strefa włączona'));
    cb.addEventListener('change', () => { z.on = cb.checked; saveZones(); drawHist(); });
    const fix = typeof lastFix === 'function' ? lastFix() : null;
    const where = fix ? (distM(z.lat, z.lon, fix.lat, fix.lon) <= z.r ? t('pies w strefie') : t('pies poza strefą')) : '';
    const span = document.createElement('span');
    span.textContent = z.name + ' · ' + fmtDist(z.r) + (where ? ' · ' + where : '');
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'chip'; del.textContent = '✕'; del.setAttribute('aria-label', t('Usuń strefę'));
    del.addEventListener('click', () => {
      if (!confirm(tf('Usunąć strefę „{n}”?', { n: z.name }))) return;
      A.zones = A.zones.filter((x) => x !== z); delete A.inside[z.id]; saveZones(); renderZones(); drawHist();
    });
    li.append(cb, span, del);
    list.append(li);
  }
}

function saveZones() { store.set('zones', A.zones); store.set('zones-in', A.inside); }

function addZone() {
  const src = $('zone-src').value;
  const fix = lastFix();
  const c = src === 'me' ? S.me : fix;
  if (!c) { $('zone-msg').textContent = src === 'me' ? t('Brak pozycji telefonu.') : t('Brak pozycji psa.'); return; }
  const name = $('zone-name').value.trim() || t('Strefa') + ' ' + (A.zones.length + 1);
  const z = { id: Date.now().toString(36), name, lat: c.lat, lon: c.lon, r: +$('zone-r').value, on: true };
  A.zones.push(z);
  if (fix) A.inside[z.id] = distM(z.lat, z.lon, fix.lat, fix.lon) <= z.r;
  saveZones();
  $('zone-name').value = '';
  $('zone-msg').textContent = tf('Dodano strefę „{n}”.', { n: name });
  renderZones(); drawHist();
}

// ------------------------------------------------------------------ zdarzenia

const EV_ICON = { zone_out: '🚧', zone_in: '🏠', batt: '🔋', fast: '💨', nofix: '📡', late: '⏰' };

function addEvent(type, text, alarm, tt) {
  const ev = { t: tt || Date.now(), type, text };
  A.events.push(ev);
  if (A.events.length > 300) A.events.splice(0, A.events.length - 300);
  store.set('events', A.events);
  renderEvents();
  if (alarm) showAlarm(text);
}

function renderEvents() {
  const list = $('events');
  list.textContent = '';
  const evs = A.events.slice(-80).reverse();
  if (!evs.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = t('Brak zdarzeń.');
    list.append(li);
    return;
  }
  for (const e of evs) {
    const li = document.createElement('li');
    const tm = document.createElement('time');
    tm.textContent = (dayKey(e.t) === dayKey(Date.now()) ? '' : new Date(e.t).toLocaleDateString(LANG, { day: 'numeric', month: 'numeric' }) + ' ') + fmtTime(e.t);
    li.append(tm, document.createTextNode((EV_ICON[e.type] || '•') + ' ' + e.text));
    list.append(li);
  }
}

// wywoływane przez app.js przy każdym meldunku (prev = poprzedni meldunek)
function checkEvents(r, prev) {
  if (r.pct != null && r.pct <= LOW_BATT && !(prev && prev.pct != null && prev.pct <= LOW_BATT)) {
    addEvent('batt', tf('Niska bateria trackera: {p}%', { p: r.pct }), true, r.t);
  }
  if (!r.fix && prev && prev.fix) addEvent('nofix', t('Tracker stracił GPS'), false, r.t);
  if (!r.fix) return;
  let prevFix = null;
  for (let i = S.reports.length - 2; i >= 0; i--) if (S.reports[i].fix) { prevFix = S.reports[i]; break; }
  if (prevFix) {
    const v = speedKmh(prevFix, r);
    if (v >= FAST_KMH && r.t - prevFix.t <= 10 * 60000) addEvent('fast', tf('Szybki bieg: {v}', { v: kmh(v) }), false, r.t);
  }
  let changed = false;
  for (const z of A.zones) {
    if (!z.on) continue;
    const inside = distM(z.lat, z.lon, r.lat, r.lon) <= z.r;
    if (A.inside[z.id] === undefined) { A.inside[z.id] = inside; changed = true; continue; }
    if (inside !== A.inside[z.id]) {
      A.inside[z.id] = inside; changed = true;
      if (inside) addEvent('zone_in', tf('Pies wrócił do strefy „{n}”', { n: z.name }), false, r.t);
      else addEvent('zone_out', tf('Pies wyszedł ze strefy „{n}” ({d} od środka)', { n: z.name, d: fmtDist(distM(z.lat, z.lon, r.lat, r.lon)) }), true, r.t);
    }
  }
  if (changed) { saveZones(); renderZones(); }
}

// ------------------------------------------------------------------ statystyki dni

async function renderStats() {
  const days = (await histDays()).slice(0, 14).reverse();
  const cv = $('stats-chart'), dpr = window.devicePixelRatio || 1;
  $('stats-empty').hidden = days.length > 0;
  cv.hidden = !days.length;
  const w = cv.clientWidth, h = Math.round(w * 0.42);
  if (!w || !days.length) return;
  const rows = [];
  for (const d of days) {
    const pts = await histGet(d.day);
    let m = 0;
    for (let k = 1; k < pts.length; k++) m += distM(pts[k - 1].lat, pts[k - 1].lon, pts[k].lat, pts[k].lon);
    const active = segments(pts).filter((s) => s.type === 'trip').reduce((a, s) => a + (s.t1 - s.t0), 0);
    rows.push({ day: d.day, m, active });
  }
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const top = 18, bot = 20, mmax = Math.max(100, ...rows.map((r) => r.m));
  const bw = (w - 8) / rows.length;
  g.font = '11px system-ui, sans-serif'; g.textAlign = 'center';
  rows.forEach((r, i) => {
    const bh = (r.m / mmax) * (h - top - bot), x = 4 + i * bw;
    g.fillStyle = r.day === H.day ? col('--dog') : col('--trail');
    g.fillRect(x + 3, h - bot - bh, bw - 6, bh);
    g.fillStyle = col('--muted');
    g.fillText(new Date(r.day + 'T12:00:00').getDate(), x + bw / 2, h - 6);
    if (r.m >= 50 && bw > 26) { g.fillStyle = col('--ink'); g.fillText(r.m < 1000 ? Math.round(r.m) : num(r.m / 1000, 1), x + bw / 2, h - bot - bh - 4); }
  });
  const sum = rows.reduce((a, r) => a + r.m, 0), act = rows.reduce((a, r) => a + r.active, 0);
  $('stats-sum').textContent = tf('{n} dni · razem {d} · w ruchu {a}', { n: rows.length, d: fmtDist(sum), a: dur(act) });
}

// ------------------------------------------------------------------ eksport GPX / KML / CSV

function exportDay(fmt) {
  if (!H.pts.length) return;
  const name = t('Pies') + ' ' + H.day;
  const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let body, type;
  if (fmt === 'kml') {
    const coords = H.pts.map((p) => p.lon.toFixed(6) + ',' + p.lat.toFixed(6) + ',0').join(' ');
    const stops = (H.segs || []).filter((s) => s.type === 'stop').map((s) => `<Placemark><name>${x(t('Postój') + ' ' + fmtTime(s.t0) + '–' + fmtTime(s.t1))}</name>`
      + `<Point><coordinates>${s.lon.toFixed(6)},${s.lat.toFixed(6)},0</coordinates></Point></Placemark>`).join('\n');
    body = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
      + `<name>${x(name)}</name><Style id="t"><LineStyle><color>ff0c59e8</color><width>4</width></LineStyle></Style>\n`
      + `<Placemark><name>${x(name)}</name><styleUrl>#t</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>\n`
      + stops + '\n</Document></kml>\n';
    type = 'application/vnd.google-earth.kml+xml';
  } else if (fmt === 'csv') {
    body = 'time;lat;lon;battery_mv;battery_pct;temp_c;sats;search\n' + H.pts.map((p) =>
      [new Date(p.t).toISOString(), p.lat.toFixed(6), p.lon.toFixed(6), p.mv ?? '', p.pct ?? '', p.temp ?? '', p.sats ?? '', p.search ? 1 : 0].join(';')).join('\n') + '\n';
    type = 'text/csv';
  } else {
    const pts = H.pts.map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><time>${new Date(p.t).toISOString()}</time></trkpt>`);
    body = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="tracker-psa" xmlns="http://www.topografix.com/GPX/1/1">\n'
      + `<trk><name>${x(name)}</name><trkseg>\n${pts.join('\n')}\n</trkseg></trk>\n</gpx>\n`;
    type = 'application/gpx+xml';
  }
  const file = new File([body], 'trasa-psa-' + H.day + '.' + fmt, { type });
  // Android: „Udostępnij” otwiera listę aplikacji (Organic Maps, OsmAnd, Dysk…); inaczej zwykłe pobranie pliku
  if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: name }).catch(() => {}); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ------------------------------------------------------------------ start

function initAnaliza() {
  $('hist-play').addEventListener('click', togglePlay);
  $('hist-speed').addEventListener('change', (e) => { A.playSpeed = +e.target.value; });
  for (const f of ['gpx', 'kml', 'csv']) $('hist-' + f).addEventListener('click', () => exportDay(f));
  $('zone-add').addEventListener('click', addZone);
  $('ev-clear').addEventListener('click', () => {
    if (!confirm(t('Wyczyścić dziennik zdarzeń?'))) return;
    A.events = []; store.set('events', []); renderEvents();
  });
  window.addEventListener('resize', () => { drawChart(); renderStats(); });
  renderZones();
  renderEvents();
}
