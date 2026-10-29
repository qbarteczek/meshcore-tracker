// Tracker psa – narzędzia na wzór Traccara (działa offline):
// lista trackerów, punkty (POI), strefy rysowane na mapie, miarka, udostępnianie pozycji (też SMS-em, bez internetu),
// reguły powiadomień, raport dni z licznikiem kilometrów.
// Korzysta z app.js i analiza.js (S, A, $, t, tf, esc, store, map, poiLayer, devices, lastFix, lastReport, devState,
// dogName, selectDevice, distM, fmtDist, fmtSpd, dur, ago, hm, when, fmtPos, saveNewZone, histDays, histGet,
// pathStats, segments, RULE_TYPES, ruleOf).
'use strict';

const POI_ICONS = ['🚗', '⛺', '🏠', '💧', '🅿️', '📍'];
const N = {
  pois: store.get('pois', []),               // [{id, name, icon, lat, lon}]
  mode: null,                                // 'measure' | 'draw' | null
  pts: [], line: null, marks: null,
};

// ------------------------------------------------------------------ lista trackerów (jak lista urządzeń w Traccarze)

function renderDevices() {
  const ol = $('dev-list');
  if (!ol) return;
  const devs = devices();
  $('devices-card').hidden = devs.length < 2;
  ol.textContent = '';
  for (const d of devs) {
    const rep = lastReport(d), f = lastFix(d), st = devState(d);
    const li = document.createElement('li');
    li.className = 'click' + (d === S.tracker ? ' sel' : '');
    const parts = [rep ? ago(rep.t) : t('brak danych')];
    if (rep && rep.pct != null) parts.push(rep.pct + '%');
    if (f && S.me) parts.push(fmtDist(distM(S.me.lat, S.me.lon, f.lat, f.lon)));
    li.innerHTML = `<span class="dot ${st}"></span><span class="x"><b>${esc(dogName(d))}</b><br><small class="muted">${esc(parts.join(' · '))}</small></span>`;
    li.addEventListener('click', () => selectDevice(d));
    ol.append(li);
  }
}

// ------------------------------------------------------------------ punkty (POI)

function savePois() { store.set('pois', N.pois); }

function nearestPoi(fix) {
  if (!fix || !N.pois.length) return null;
  let best = null;
  for (const q of N.pois) {
    const d = distM(q.lat, q.lon, fix.lat, fix.lon);
    if (!best || d < best.d) best = { ...q, d };
  }
  return best;
}

function drawPois() {
  if (!map) return;
  poiLayer.clearLayers();
  for (const q of N.pois) {
    L.marker([q.lat, q.lon], { zIndexOffset: 500, icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
      html: `<div class="poi"><span>${esc(q.icon)}</span><div class="pin-label">${esc(q.name)}</div></div>` }) })
      .bindPopup(() => {
        const f = lastFix();
        return `<b>${esc(q.icon + ' ' + q.name)}</b>` + (f ? `<br>${esc(t('Pies') + ': ' + fmtDist(distM(q.lat, q.lon, f.lat, f.lon)))}` : '')
          + (S.me ? `<br>${esc(t('Od Ciebie') + ': ' + fmtDist(distM(q.lat, q.lon, S.me.lat, S.me.lon)))}` : '') + `<br>${esc(fmtPos(q))}`;
      }).addTo(poiLayer);
  }
}

function renderPois() {
  const ol = $('poi-list');
  ol.textContent = '';
  if (!N.pois.length) ol.innerHTML = `<li><span class="x muted">${esc(t('Brak punktów. Dodaj np. auto albo obóz – zobaczysz odległość psa od nich.'))}</span></li>`;
  const f = lastFix();
  for (const q of N.pois) {
    const li = document.createElement('li');
    const parts = [];
    if (f) parts.push(t('pies') + ' ' + fmtDist(distM(q.lat, q.lon, f.lat, f.lon)));
    if (S.me) parts.push(t('Ty') + ' ' + fmtDist(distM(q.lat, q.lon, S.me.lat, S.me.lon)));
    const span = document.createElement('span');
    span.className = 'x click';
    span.textContent = q.icon + ' ' + q.name + (parts.length ? ' · ' + parts.join(' · ') : '');
    span.addEventListener('click', () => { if (map) map.setView([q.lat, q.lon], 17); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'chip'; del.textContent = '✕'; del.setAttribute('aria-label', t('Usuń punkt'));
    del.addEventListener('click', () => {
      if (!confirm(tf('Usunąć punkt „{n}”?', { n: q.name }))) return;
      N.pois = N.pois.filter((x) => x !== q); savePois(); renderPois(); drawPois(); render();
    });
    li.append(span, del);
    ol.append(li);
  }
}

function addPoi() {
  const src = $('poi-src').value, f = lastFix();
  let c = null;
  if (src === 'me') c = S.me;
  else if (src === 'dog') c = f;
  else if (map) { const m = map.getCenter(); c = { lat: m.lat, lon: m.lng }; }
  if (!c) { $('poi-msg').textContent = src === 'me' ? t('Brak pozycji telefonu.') : t('Brak pozycji psa.'); return; }
  const icon = $('poi-icon').value;
  const name = $('poi-name').value.trim() || ({ '🚗': t('Auto'), '⛺': t('Obóz'), '🏠': t('Dom') }[icon] || t('Punkt') + ' ' + (N.pois.length + 1));
  N.pois.push({ id: Date.now().toString(36), name, icon, lat: c.lat, lon: c.lon });
  savePois();
  $('poi-name').value = '';
  $('poi-msg').textContent = tf('Dodano punkt „{n}”.', { n: name });
  renderPois(); drawPois(); render();
}

// ------------------------------------------------------------------ miarka i rysowanie strefy (pasek nad mapą)

function pathLen(pts) {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += distM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return m;
}

function startMode(mode) {
  if (!map) return;
  if (N.mode) endMode(false);
  N.mode = mode; N.pts = [];
  N.line = (mode === 'draw' ? L.polygon([], { color: cssVar('--geo'), weight: 3, fillOpacity: 0.1 })
    : L.polyline([], { color: cssVar('--accent'), weight: 3, dashArray: '8 6' })).addTo(map);
  N.marks = L.layerGroup().addTo(map);
  map.getContainer().classList.add('picking');
  $('btn-measure').classList.toggle('on', mode === 'measure');
  if (S.follow) { S.follow = false; store.set('follow', false); followUI(); }
  modeBar();
  if (mode === 'draw') window.scrollTo({ top: 0, behavior: 'smooth' });
}

function endMode(save) {
  if (N.mode === 'draw' && save) {
    if (N.pts.length < 3) { alert(t('Strefa potrzebuje co najmniej 3 punktów.')); return; }
    const name = $('zone-name').value.trim() || t('Strefa') + ' ' + (A.zones.length + 1);
    saveNewZone({ id: Date.now().toString(36), name, pts: N.pts.map(([la, lo]) => [+la.toFixed(6), +lo.toFixed(6)]), on: true });
  }
  if (N.line) N.line.remove();
  if (N.marks) N.marks.remove();
  N.mode = null; N.pts = []; N.line = N.marks = null;
  if (map) map.getContainer().classList.remove('picking');
  $('btn-measure').classList.remove('on');
  modeBar();
}

function modeBar() {
  const bar = $('map-bar');
  bar.hidden = !N.mode;
  if (!N.mode) return;
  const n = N.pts.length;
  $('mb-text').textContent = N.mode === 'measure'
    ? t('Miarka') + ': ' + (n > 1 ? fmtDist(pathLen(N.pts)) : t('dotknij mapy w kolejnych miejscach'))
    : t('Rysowanie strefy') + ': ' + tf('{n} pkt', { n }) + (n < 3 ? ' · ' + t('dotykaj kolejnych narożników') : '');
  $('mb-done').textContent = N.mode === 'measure' ? t('Koniec') : t('Zapisz strefę');
  $('mb-cancel').hidden = N.mode === 'measure';
  $('mb-undo').disabled = !n;
}

function onMapClick(e) {
  if (!N.mode) return;
  N.pts.push([e.latlng.lat, e.latlng.lng]);
  N.line.setLatLngs(N.pts);
  L.circleMarker(e.latlng, { radius: 5, color: '#fff', weight: 2, fillColor: N.mode === 'draw' ? cssVar('--geo') : cssVar('--accent'), fillOpacity: 1 }).addTo(N.marks);
  modeBar();
}

function undoPoint() {
  N.pts.pop();
  N.line.setLatLngs(N.pts);
  const ls = N.marks.getLayers();
  if (ls.length) N.marks.removeLayer(ls[ls.length - 1]);
  modeBar();
}

// ------------------------------------------------------------------ udostępnianie pozycji (SMS działa bez internetu)

function shareText() {
  const f = lastFix();
  if (!f) return null;
  const ll = f.lat.toFixed(6) + ',' + f.lon.toFixed(6);
  const rep = lastReport();
  return tf('{n}: pozycja z {t}', { n: dogName(), t: when(f.t) }) + (rep && rep.pct != null ? ' · ' + t('bateria') + ' ' + rep.pct + '%' : '')
    + '\n' + ll + '\nhttps://maps.google.com/?q=' + ll;
}

function sharePos(sms) {
  const txt = shareText();
  if (!txt) { alert(t('Brak pozycji psa.')); return; }
  if (!sms && navigator.share) { navigator.share({ title: t('Tracker psa'), text: txt }).catch(() => {}); return; }
  location.href = 'sms:?body=' + encodeURIComponent(txt);
}

// ------------------------------------------------------------------ reguły powiadomień

const RULE_LABEL = {
  zone_out: 'Wyjście ze strefy', zone_in: 'Powrót do strefy', late: 'Brak meldunku', alarm: 'Alarm z bazy',
  batt: 'Niska bateria', nofix: 'Utrata GPS', fast: 'Szybki bieg', back: 'Powrót kontaktu', search: 'Szukanie',
  cmd: 'Polecenie przyjęte', conn: 'Połączenie z bazą', disc: 'Rozłączenie z bazą',
};

function renderRules() {
  const box = $('rules');
  box.textContent = '';
  for (const type of RULE_TYPES) {
    const row = document.createElement('label');
    row.className = 'rule';
    const span = document.createElement('span');
    span.textContent = EV_ICON[type] + ' ' + t(RULE_LABEL[type]);
    const sel = document.createElement('select');
    for (const [v, l] of [['alarm', 'Alarm (dźwięk)'], ['notify', 'Powiadomienie'], ['log', 'Tylko zapis']]) sel.add(new Option(t(l), v, false, ruleOf(type) === v));
    sel.addEventListener('change', () => { A.rules[type] = sel.value; store.set('rules', A.rules); });
    row.append(span, sel);
    box.append(row);
  }
}

// ------------------------------------------------------------------ raport dni (tabela) i licznik kilometrów

let daysToken = 0;
async function renderDaysTable() {
  const my = ++daysToken;
  const days = await histDays();
  const rows = [];
  let total = 0;
  for (const d of days) {
    const pts = (await histGet(d.day)).filter((p) => !p.tracker || p.tracker === S.tracker);
    if (!pts.length) continue;
    const st = pathStats(pts);
    total += st.dist;
    if (rows.length >= 31) continue;
    const segs = segments(pts);
    const stops = segs.filter((s) => s.type === 'stop');
    const move = segs.filter((s) => s.type === 'trip').reduce((a, s) => a + (s.t1 - s.t0), 0);
    const bat = pts.filter((p) => p.pct != null).map((p) => p.pct);
    rows.push({ day: d.day, dist: st.dist, move, max: st.max, stops: stops.length, bmin: bat.length ? Math.min(...bat) : null, n: pts.length });
  }
  if (my !== daysToken) return;
  const tb = $('days-table').querySelector('tbody');
  tb.textContent = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.className = 'click';
    tr.innerHTML = [fmtDay(r.day), fmtDist(r.dist), dur(r.move), fmtSpd(r.max), r.stops, r.bmin != null ? r.bmin + '%' : '–', r.n]
      .map((v, i) => `<td${i ? ' class="num"' : ''}>${esc(v)}</td>`).join('');
    tr.addEventListener('click', () => { $('rp-range').value = 'd:' + r.day; loadReplay(true); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    tb.append(tr);
  }
  $('days-table').hidden = !rows.length;
  $('odometer').textContent = rows.length ? tf('Licznik (cała historia): {d}', { d: fmtDist(total) }) : '';
}

function customRange() {
  const a = Date.parse($('rp-from').value), b = Date.parse($('rp-to').value);
  return [isNaN(a) ? 0 : a, isNaN(b) ? Date.now() + 1 : b];
}

function initCustomRange() {
  const sel = $('rp-range');
  const toLocal = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
  $('rp-from').value = toLocal(Date.now() - 3 * 864e5);
  $('rp-to').value = toLocal(Date.now());
  const show = () => { $('rp-custom').hidden = sel.value !== 'custom'; };
  sel.addEventListener('change', show);
  for (const id of ['rp-from', 'rp-to']) $(id).addEventListener('change', () => loadReplay(true));
  show();
}

// ------------------------------------------------------------------ start

function initNarzedzia() {
  for (const ic of POI_ICONS) $('poi-icon').add(new Option(ic, ic));
  $('poi-add').addEventListener('click', addPoi);
  $('zone-draw').addEventListener('click', () => startMode('draw'));
  $('btn-measure').addEventListener('click', () => (N.mode === 'measure' ? endMode(false) : startMode('measure')));
  $('mb-done').addEventListener('click', () => endMode(true));
  $('mb-cancel').addEventListener('click', () => endMode(false));
  $('mb-undo').addEventListener('click', undoPoint);
  $('btn-share').addEventListener('click', () => sharePos(false));
  $('btn-sms').addEventListener('click', () => sharePos(true));
  if (map) map.on('click', onMapClick);
  initCustomRange();
  renderRules();
  renderPois();
  drawPois();
  renderDevices();
  setInterval(() => { renderDevices(); if (S.tab === 'map') renderPois(); }, 15000);
}
