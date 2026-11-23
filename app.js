(function () {
'use strict';
const $ = id => document.getElementById(id);
const cfg = window.PV_CONFIG || {};
const sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true } });

// ---------- Statusy i kolory ----------
const STAT = {
  nowe_p:   { label: 'Nowe – pewne',          color: '#16a34a', on: true },
  nowe_m:   { label: 'Nowe – prawdopodobne',  color: '#86efac', on: true },
  stare:    { label: 'Moje stare pinezki',    color: '#9ca3af', on: true },
  ponownie: { label: 'Odwiedzić ponownie',    color: '#f59e0b', on: true },
  umowa:    { label: 'Umowa',                 color: '#2563eb', on: true },
  nie:      { label: 'Nie zainteresowany',    color: '#dc2626', on: false },
  usun:     { label: 'Usunięte',              color: '#374151', on: false }
};
try { const f = JSON.parse(localStorage.getItem('pv_filters') || 'null'); if (f) for (const k in f) if (STAT[k]) STAT[k].on = f[k]; } catch (e) {}

// ---------- Mapa: ortofotomapa Geoportalu na żywo (układ PUWG 1992) ----------
const RES = [2116.6709, 1058.335450, 529.167725, 264.583862, 132.291931, 66.145965, 26.458386, 13.229193,
             6.614596, 2.645838, 1.322919, 0.529167, 0.264583, 0.132291, 0.066145, 0.033072];
const crs = new L.Proj.CRS('EPSG:2180',
  '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  { resolutions: RES, origin: [100000, 850000] });
let view = { c: [51.75, 19.45], z: 4 };
try { const v = JSON.parse(localStorage.getItem('pv_view') || 'null'); if (v) view = v; } catch (e) {}
const map = L.map('map', { crs, zoomControl: false, minZoom: 2, maxZoom: 15, preferCanvas: true }).setView(view.c, view.z);
L.control.zoom({ position: 'bottomright' }).addTo(map);
const ORTO = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:2180';
const Orto = L.TileLayer.extend({ getTileUrl: c => `${ORTO}&TILEMATRIX=EPSG:2180:${c.z + 2}&TILEROW=${c.y}&TILECOL=${c.x}` });
new Orto('', { tileSize: 512, maxNativeZoom: 14, maxZoom: 15, attribution: 'Ortofotomapa, adresy © GUGiK' }).addTo(map);
const addr = L.tileLayer.wms('https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaNumeracjiAdresowej', {
  layers: 'A08_Ulice_Linie,A07_Punkty_adresowe', format: 'image/png', transparent: true, version: '1.1.1',
  tileSize: 512, minZoom: 11, maxZoom: 15, zIndex: 5 });
try { $('addrLayer').checked = localStorage.getItem('pv_addr') !== '0'; } catch (e) {}
if ($('addrLayer').checked) addr.addTo(map);
$('addrLayer').onchange = e => { e.target.checked ? addr.addTo(map) : map.removeLayer(addr); try { localStorage.setItem('pv_addr', e.target.checked ? '1' : '0'); } catch (_) {} };
map.on('moveend', () => { try { const c = map.getCenter(); localStorage.setItem('pv_view', JSON.stringify({ c: [c.lat, c.lng], z: map.getZoom() })); } catch (e) {} });

// ---------- Pomocnicze ----------
function msg(t, ms) { const m = $('msg'); m.textContent = t; m.style.display = 'block'; clearTimeout(msg.h); if (ms !== 0) msg.h = setTimeout(() => m.style.display = 'none', ms || 2500); }
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const navUrl = p => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
const title = p => p.adres ? p.adres + (p.miejscowosc && !p.adres.includes(p.miejscowosc) ? ', ' + p.miejscowosc : '') : 'Dom z PV (bez adresu)';
function cat(p) { if (p.status) return p.status; if (p.zrodlo === 'stare') return 'stare'; return p.pewnosc === 'pewne' ? 'nowe_p' : 'nowe_m'; }
function dist(a, b) { const R = 6371000, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
const fmtDist = m => m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km';

// ---------- Dane ----------
let P = [], byId = {}, cur = null, me = null, meMarker = null;
const R = L.canvas({ tolerance: 10 });
const layer = L.layerGroup().addTo(map);

async function loadAll() {
  let all = [], from = 0;
  for (;;) {
    const { data, error } = await sb.from('pins').select('*').range(from, from + 999);
    if (error) throw error;
    all = all.concat(data); if (data.length < 1000) break; from += 1000;
  }
  P = all; byId = Object.fromEntries(P.map(p => [p.id, p]));
  render();
}
async function reload(quiet) {
  try { await loadAll(); if (!quiet) msg('Dane odświeżone (' + P.length + ' pinezek)'); }
  catch (e) { msg('Nie udało się pobrać danych: ' + (e.message || e), 5000); }
}

function render() {
  layer.clearLayers(); const cnt = {}; for (const k in STAT) cnt[k] = 0;
  for (const p of P) {
    const c = cat(p); cnt[c] = (cnt[c] || 0) + 1; if (!STAT[c] || !STAT[c].on) continue;
    const big = c === 'umowa' || c === 'ponownie';
    const m = L.circleMarker([p.lat, p.lon], { renderer: R, radius: big ? 10 : 8, color: '#fff', weight: 2, fillColor: STAT[c].color, fillOpacity: 1, bubblingMouseEvents: false });
    m.on('click', e => { L.DomEvent.stop(e); open(p); }); m.addTo(layer);
  }
  $('stats').innerHTML =
    `<span><span class="dot" style="background:${STAT.nowe_p.color}"></span>Do odwiedzenia <b>${cnt.nowe_p + cnt.nowe_m}</b></span>` +
    `<span><span class="dot" style="background:${STAT.ponownie.color}"></span>Ponownie <b>${cnt.ponownie}</b></span>` +
    `<span><span class="dot" style="background:${STAT.umowa.color}"></span>Umowy <b>${cnt.umowa}</b></span>`;
  $('filters').innerHTML = '<h4 style="margin-top:2px">Pokaż</h4>' + Object.entries(STAT).map(([k, v]) =>
    `<label><input type="checkbox" data-k="${k}" ${v.on ? 'checked' : ''}><span class="dot" style="background:${v.color}"></span>${v.label}<span class="cnt">${cnt[k]}</span></label>`).join('');
  if ($('list').classList.contains('open')) fillList();
}
$('filters').addEventListener('change', e => {
  const k = e.target.dataset.k; if (!k) return; STAT[k].on = e.target.checked;
  try { localStorage.setItem('pv_filters', JSON.stringify(Object.fromEntries(Object.entries(STAT).map(([k, v]) => [k, v.on])))); } catch (_) {}
  render();
});
$('menubtn').onclick = () => $('panel').classList.toggle('open');
map.on('click', () => { $('panel').classList.remove('open'); close(); });

// ---------- Karta pinezki ----------
function open(p) {
  cur = p;
  $('t').textContent = title(p);
  const src = p.zrodlo === 'stare' ? 'Twoja wcześniejsza pinezka' : ('Wykryte automatycznie' + (p.pewnosc ? ' – ' + p.pewnosc : ''));
  $('sub').textContent = src + (p.gmina ? ' · gm. ' + p.gmina : '') + (me ? ' · ' + fmtDist(dist(me, p)) + ' stąd' : '');
  $('nav').href = navUrl(p);
  $('gm').href = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
  document.querySelectorAll('.st').forEach(b => b.classList.toggle('on', b.dataset.s === p.status));
  $('note').value = p.notatka || '';
  $('saved').textContent = p.status || p.notatka ? 'Zmieniono: ' + new Date(p.zmieniono).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '';
  $('sheet').classList.add('open'); $('panel').classList.remove('open'); $('list').classList.remove('open');
}
function close() { $('sheet').classList.remove('open'); cur = null; }
$('close').onclick = close;

let busy = false;
async function save(p, patch) {
  if (busy) { msg('Chwila, zapisuję…'); return false; }
  busy = true; const prev = { status: p.status, notatka: p.notatka, zmieniono: p.zmieniono };
  Object.assign(p, patch, { zmieniono: new Date().toISOString() }); render(); if (cur === p) open(p);
  try {
    const { error } = await sb.from('pins').update({ status: p.status, notatka: p.notatka, zmieniono: p.zmieniono }).eq('id', p.id);
    if (error) throw error; return true;
  } catch (e) {
    Object.assign(p, prev); render(); if (cur === p) open(p);
    msg('Nie zapisano – sprawdź internet i spróbuj ponownie.', 4000); return false;
  } finally { busy = false; }
}
document.querySelectorAll('.st').forEach(b => b.onclick = async () => {
  if (!cur) return; const p = cur; const s = p.status === b.dataset.s ? null : b.dataset.s;
  if (!(await save(p, { status: s, notatka: $('note').value.trim() || null }))) return;
  if (s === 'usun') { close(); msg('Pinezka usunięta. Przywrócisz ją w Menu → Usunięte.', 3500); }
  else msg(s ? 'Zapisano: ' + STAT[s].label : 'Status wyczyszczony');
});
$('note').addEventListener('change', async () => {
  if (!cur) return; const n = $('note').value.trim() || null; if ((cur.notatka || null) === n) return;
  if (await save(cur, { notatka: n })) msg('Notatka zapisana');
});

// ---------- GPS ----------
function startGps(center) {
  if (!navigator.geolocation) { msg('Ten telefon nie udostępnia lokalizacji.'); return; }
  if (startGps.w == null) startGps.w = navigator.geolocation.watchPosition(pos => {
    const first = !me; me = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    if (!meMarker) meMarker = L.marker([me.lat, me.lon], { icon: L.divIcon({ className: '', html: '<div class="medot"></div>', iconSize: [18, 18] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    else meMarker.setLatLng([me.lat, me.lon]);
    if (first && startGps.center) { map.setView([me.lat, me.lon], Math.max(map.getZoom(), 11)); startGps.center = false; }
  }, err => { if (startGps.center) msg('Brak dostępu do lokalizacji. Zezwól na nią w ustawieniach przeglądarki.', 4000); startGps.center = false; },
  { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  if (center) { if (me) map.setView([me.lat, me.lon], Math.max(map.getZoom(), 12)); else startGps.center = true; }
}
$('me').onclick = () => startGps(true);

// ---------- Lista najbliższych ----------
function fillList() {
  const ref = me || { lat: map.getCenter().lat, lon: map.getCenter().lng };
  const vis = P.filter(p => STAT[cat(p)] && STAT[cat(p)].on).map(p => [dist(ref, p), p]).sort((a, b) => a[0] - b[0]).slice(0, 40);
  $('listsub').textContent = (me ? 'od Twojej pozycji' : 'od środka mapy (włącz ◎ dla GPS)') + ' · widoczne filtry';
  $('ul').innerHTML = vis.map(([d, p]) =>
    `<li data-id="${esc(p.id)}"><span class="dot" style="background:${STAT[cat(p)].color}"></span><div class="t"><div>${esc(title(p))}</div><small>${fmtDist(d)}${p.notatka ? ' · ' + esc(p.notatka) : ''}</small></div><a href="${navUrl(p)}" target="_blank" rel="noopener">Jedź</a></li>`).join('') || '<li>Brak pinezek przy obecnych filtrach.</li>';
}
$('listbtn').onclick = () => { fillList(); $('list').classList.add('open'); close(); $('panel').classList.remove('open'); };
$('listclose').onclick = () => $('list').classList.remove('open');
$('ul').addEventListener('click', e => {
  if (e.target.closest('a')) return; const li = e.target.closest('li[data-id]'); if (!li) return;
  const p = byId[li.dataset.id]; if (!p) return; map.setView([p.lat, p.lon], Math.max(map.getZoom(), 13)); open(p);
});

// ---------- Import pinezek z pliku ----------
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const h = rows.shift().map(s => s.trim().toLowerCase());
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
function normalize(r) {
  const lat = parseFloat(r.lat), lon = parseFloat(r.lon); if (!isFinite(lat) || !isFinite(lon)) return null;
  return {
    id: r.id || ('d' + Math.round(lat * 1e5) + '_' + Math.round(lon * 1e5)),
    adres: r.adres || null, miejscowosc: r.miejscowosc || null, gmina: r.gmina || null, lat, lon,
    zrodlo: r.zrodlo || 'nowe', pewnosc: r.pewnosc || null, wynik: r.wynik != null && r.wynik !== '' ? Number(r.wynik) : null,
    obszar: r.obszar || null
  };
}
$('importbtn').onclick = () => $('file').click();
$('file').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const text = await file.text();
    const raw = file.name.toLowerCase().endsWith('.csv') ? parseCSV(text) : JSON.parse(text);
    const rows = raw.map(normalize).filter(Boolean);
    if (!rows.length) { msg('W pliku nie ma pinezek.'); return; }
    const before = P.length; msg('Importuję ' + rows.length + ' pinezek…', 0);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('pins').upsert(rows.slice(i, i + 500), { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw error;
    }
    await loadAll();
    msg('Gotowe: dodano ' + (P.length - before) + ' nowych pinezek (pominięto już istniejące).', 5000);
    $('panel').classList.remove('open');
    const added = rows.filter(r => byId[r.id]);
    if (added.length) map.fitBounds(L.latLngBounds(added.map(r => [r.lat, r.lon])), { padding: [30, 30] });
  } catch (err) { msg('Import nieudany: ' + (err.message || err), 6000); }
};

// ---------- Logowanie ----------
$('reloadbtn').onclick = () => { $('panel').classList.remove('open'); reload(); };
$('logoutbtn').onclick = async () => { await sb.auth.signOut(); location.reload(); };
$('loginform').addEventListener('submit', async e => {
  e.preventDefault(); $('loginerr').textContent = ''; $('loginbtn').disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pass').value });
  $('loginbtn').disabled = false;
  if (error) { $('loginerr').textContent = 'Nieprawidłowy e-mail lub hasło.'; return; }
  $('login').style.display = 'none'; start();
});
let started = false;
async function start() {
  if (started) return; started = true;
  await reload(true);
  if (!localStorage.getItem('pv_view') && P.length) map.fitBounds(L.latLngBounds(P.map(p => [p.lat, p.lon])), { padding: [30, 30] });
  startGps(false);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && started) reload(true); });
(async () => {
  if (!cfg.url || cfg.url.startsWith('WSTAW')) { $('stats').textContent = 'Brak konfiguracji bazy (config.js).'; return; }
  const { data } = await sb.auth.getSession();
  if (data && data.session) start(); else $('login').style.display = 'flex';
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
