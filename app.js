(function () {
'use strict';
const $ = id => document.getElementById(id);
const cfg = window.PV_CONFIG || {};
const sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true } });
const ic = (n, cls) => `<svg class="ic${cls ? ' ' + cls : ''}"><use href="#i-${n}"/></svg>`;

// ---------- Konto i rola (ustawiane po zalogowaniu) ----------
// ME – profil zalogowanego (rola: admin | manager | handlowiec), USERS – widoczne konta, TER – widoczne tereny.
// Uprawnienia pilnuje baza (RLS); tutaj tylko ukrywamy to, czego dana rola i tak nie może zrobić.
let ME = null, USERS = {}, TER = [];
const ROLE_LBL = { admin: 'Administrator', manager: 'Menedżer', handlowiec: 'Handlowiec' };
const isAdmin = () => !!ME && ME.rola === 'admin';
const uname = id => !id ? '' : ME && id === ME.id ? 'Ty' : (USERS[id] && (USERS[id].imie || USERS[id].email)) || 'inny użytkownik';
const fullName = u => u ? (u.imie || u.email || '') : '';

// ---------- Statusy i kolory ----------
// who: 'admin' – widzi tylko administrator; 'team' – tylko menedżer i handlowiec; brak – wszyscy.
// Zespół nie widzi rozróżnienia pewne/prawdopodobne – dla nich to po prostu „Do odwiedzenia”.
// Dawne „stare pinezki” administratora są liczone jako „Nowe – pewne”.
// „usun” to pinezki ukryte przez administratora (kolumna ukryta_admin) – tylko u niego, zespół dalej je widzi.
const STAT = {
  nowe_p:   { label: 'Nowe – pewne',          color: '#16a34a', on: true,  who: 'admin' },
  nowe_m:   { label: 'Nowe – prawdopodobne',  color: '#86efac', on: true,  who: 'admin' },
  nowe:     { label: 'Do odwiedzenia',        color: '#16a34a', on: true,  who: 'team' },
  reczne:   { label: 'Dodane ręcznie',        color: '#9333ea', on: true },
  ponownie: { label: 'Odwiedzić ponownie',    short: 'Ponownie',  color: '#f59e0b', on: true, icon: 'again', big: true },
  lead:     { label: 'Lead zebrany',          short: 'Leady',     color: '#0d9488', on: true, icon: 'lead',  big: true },
  spotkanie:{ label: 'Spotkanie umówione',    short: 'Spotkania', color: '#7c3aed', on: true, icon: 'meet',  big: true },
  umowa:    { label: 'Umowa',                 short: 'Umowy',     color: '#2563eb', on: true, icon: 'deal',  big: true },
  potencjal:{ label: 'Potencjał',             short: 'Potencjał', color: '#db2777', on: true, icon: 'star',  big: true, who: 'admin' },
  nie:      { label: 'Nie zainteresowany',    color: '#dc2626', on: false, icon: 'no' },
  usun:     { label: 'Usunięte (tylko u mnie)', color: '#374151', on: false, who: 'admin' }
};
const forMe = k => !STAT[k].who || (STAT[k].who === 'admin') === isAdmin();
const TILES = ['ponownie', 'lead', 'spotkanie', 'umowa', 'potencjal', 'nie'];   // kolejność na karcie domu
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
L.control.zoom({ position: 'bottomleft' }).addTo(map);
const ORTO = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:2180';
const Orto = L.TileLayer.extend({ getTileUrl: c => `${ORTO}&TILEMATRIX=EPSG:2180:${c.z + 2}&TILEROW=${c.y}&TILECOL=${c.x}` });
new Orto('', { tileSize: 512, maxNativeZoom: 14, maxZoom: 15, attribution: 'Ortofotomapa, adresy, granice © GUGiK' }).addTo(map);
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
function cat(p) {
  if (isAdmin() && p.ukryta_admin) return 'usun';
  if (p.status && STAT[p.status]) return p.status;
  if (p.zrodlo === 'reczne') return 'reczne';
  if (!isAdmin()) return 'nowe';
  return p.zrodlo === 'stare' || p.pewnosc === 'pewne' ? 'nowe_p' : 'nowe_m';
}
function dist(a, b) { const R = 6371000, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
const fmtDist = m => m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km';

// ---------- Dane ----------
let P = [], byId = {}, cur = null, me = null, meMarker = null;
const R = L.canvas({ tolerance: 10 });
const layer = L.layerGroup().addTo(map);

async function loadMe() {
  const { data: s } = await sb.auth.getSession(); const user = s && s.session && s.session.user;
  if (!user) throw new Error('brak sesji');
  const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw error;
  ME = data || { id: user.id, email: user.email, rola: null };
  document.body.classList.remove('role-admin', 'role-manager', 'role-handlowiec');
  if (ME.rola) document.body.classList.add('role-' + ME.rola);
  const n = fullName(ME);
  $('who').innerHTML = `<div class="ava">${esc((n || '?').trim().charAt(0).toUpperCase())}</div><div><div class="n">${esc(n)}</div>` +
    (ME.imie ? `<small>${esc(ME.email || '')}</small>` : '') + `<span class="badge ${esc(ME.rola || '')}">${esc(ROLE_LBL[ME.rola] || 'Brak roli')}</span></div>`;
  $('teambtn').querySelector('span').textContent = isAdmin() ? 'Zespół i tereny' : 'Moi handlowcy i tereny';
  updTrackInfo(); await loadDay(); flushTrack();
  renderTiles();
}
async function loadTeam() {
  const [u, t] = await Promise.all([sb.from('profiles').select('*'), sb.from('tereny').select('id,user_id,nazwa,poly,teryt').order('id')]);
  if (u.error) throw u.error; if (t.error) throw t.error;
  USERS = Object.fromEntries(u.data.map(x => [x.id, x])); TER = t.data;
  renderTer(); if ($('team').classList.contains('open')) fillTeam();
}
// Zespół wczytuje cały swój teren. Administrator (wiele powiatów) wczytuje tylko widoczny obszar mapy
// oraz wszystkie leady/spotkania/umowy (do list i grafiku); liczniki liczy mu baza (pv_liczniki).
const MINZ = 4;            // od tego przybliżenia administrator widzi pinezki (ok. 50 km szerokości na telefonie)
let VIEWB = null, CNT = null;
const viewMode = () => isAdmin();
async function fetchWhere(fn) {
  let all = [], from = 0;
  for (;;) {
    const { data, error } = await fn(sb.from('pins').select('*')).order('id').range(from, from + 999);
    if (error) throw error;
    all = all.concat(data); if (data.length < 1000) break; from += 1000;
  }
  return all;
}
const fetchAllPins = () => fetchWhere(q => q);
async function loadAll() {
  if (!viewMode()) P = await fetchAllPins();
  else {
    const deals = await fetchWhere(q => q.in('status', DEALS));
    let area = [];
    if (map.getZoom() >= MINZ) {
      const b = map.getBounds().pad(0.3); VIEWB = b;
      area = await fetchWhere(q => q.gte('lat', b.getSouth()).lte('lat', b.getNorth()).gte('lon', b.getWest()).lte('lon', b.getEast()));
    } else VIEWB = null;
    const m = new Map(); for (const x of area.concat(deals)) m.set(x.id, x); P = [...m.values()];
    refreshCounts(true);
  }
  byId = Object.fromEntries(P.map(p => [p.id, p]));
  applyQueue(); render();
}
async function refreshCounts(now) {
  if (!viewMode()) return;
  clearTimeout(refreshCounts.t);
  const go = async () => { try { const { data, error } = await sb.rpc('pv_liczniki'); if (!error) { CNT = Object.fromEntries(data.map(r => [r.kat, Number(r.n)])); render(); } } catch (e) {} };
  if (now) go(); else refreshCounts.t = setTimeout(go, 800);
}
map.on('moveend', () => {
  if (!viewMode() || !started) return; clearTimeout(map._pvT);
  map._pvT = setTimeout(() => { if (map.getZoom() >= MINZ && !(VIEWB && VIEWB.contains(map.getBounds()))) reload(true); else render(); }, 450);
});
async function reload(quiet) {
  try { await loadAll(); if (!quiet) msg('Dane odświeżone (' + P.length + ' pinezek)'); }
  catch (e) { msg('Nie udało się pobrać danych: ' + (e.message || e), 5000); }
}

let lastCnt = () => 0;
function renderStats() {
  const C = lastCnt, todo = isAdmin() ? C('nowe_p') + C('nowe_m') : C('nowe');
  const chip = (k, label, n) => `<span class="chip"><span class="dot" style="background:${STAT[k].color}"></span>${label} <b>${n}</b></span>`;
  let h = '';
  if (OQ.length) h += `<button class="chip wait" id="qchip">${ic('refresh')}Do wysłania <b>${OQ.length}</b></button>`;
  if (tracked()) h += DAY ? `<button class="chip work on" data-day>W pracy</button>` : `<button class="chip work" data-day>${ic('next')}Zacznij dzień</button>`;
  if (viewMode() && map.getZoom() < MINZ) h += `<button class="chip work" id="zoomchip">${ic('plus')}Przybliż, by zobaczyć domy</button>`;
  $('stats').innerHTML = h + chip(isAdmin() ? 'nowe_p' : 'nowe', 'Do odwiedzenia', todo) +
    ['ponownie', 'lead', 'spotkanie', 'umowa', 'potencjal'].filter(forMe).map(k => chip(k, STAT[k].short, C(k))).join('');
}
$('stats').addEventListener('click', e => {
  if (e.target.closest('#qchip')) { msg(OQ.length + ' zmian czeka na internet. Wyślę je automatycznie.', 3500); syncQueue(); }
  if (e.target.closest('[data-day]')) { $('panel').classList.add('open'); }
  if (e.target.closest('#zoomchip')) map.setZoom(MINZ);
});
function render() {
  layer.clearLayers(); const cnt = {}; for (const k in STAT) cnt[k] = 0;
  for (const p of P) {
    const c = cat(p); cnt[c] = (cnt[c] || 0) + 1; if (!STAT[c] || !STAT[c].on) continue;
    const s = STAT[c], ring = c === 'reczne';   // ręcznie dodane: biały środek, fioletowa obwódka
    const m = L.circleMarker([p.lat, p.lon], { renderer: R, radius: s.big ? 10 : 8, color: ring ? s.color : '#fff', weight: ring ? 3.5 : 2,
      fillColor: ring ? '#fff' : s.color, fillOpacity: 1, bubblingMouseEvents: false });
    m.on('click', e => { L.DomEvent.stop(e); if (editing()) { toolClick(e.latlng); return; } open(p); }); m.addTo(layer);
  }
  const C = viewMode() && CNT ? k => CNT[k] || 0 : k => cnt[k] || 0;
  lastCnt = C;
  renderStats();
  const mine = Object.keys(STAT).filter(forMe);
  $('filtsum').textContent = mine.filter(k => STAT[k].on).length + ' z ' + mine.length;
  $('filters').innerHTML = Object.entries(STAT).filter(([k]) => forMe(k)).map(([k, v]) =>
    `<label class="tog"><input type="checkbox" class="sw" data-k="${k}" ${v.on ? 'checked' : ''}><span class="dot" style="background:${v.color}"></span>${v.label}<span class="cnt">${C(k)}</span></label>`).join('');
  for (const k of DEALS) $('cnt_' + k).textContent = P.filter(p => p.status === k).length || '';
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  $('cnt_grafik').textContent = P.filter(p => p.status === 'spotkanie' && p.termin && new Date(p.termin) >= today0).length || '';
  $('produkty').innerHTML = [...new Set(P.map(p => p.produkt).filter(Boolean))].sort().map(v => `<option value="${esc(v)}">`).join('');
  if ($('list').classList.contains('open')) fillList();
  if ($('deals').classList.contains('open')) fillDeals();
  if ($('grafik').classList.contains('open')) fillGrafik();
}
$('filters').addEventListener('change', e => {
  const k = e.target.dataset.k; if (!k) return; STAT[k].on = e.target.checked;
  try { localStorage.setItem('pv_filters', JSON.stringify(Object.fromEntries(Object.entries(STAT).map(([k, v]) => [k, v.on])))); } catch (_) {}
  render();
});
$('menubtn').onclick = () => $('panel').classList.toggle('open');
try { $('filtgrp').open = localStorage.getItem('pv_filtopen') === '1'; } catch (e) {}
$('filtgrp').addEventListener('toggle', () => { try { localStorage.setItem('pv_filtopen', $('filtgrp').open ? '1' : '0'); } catch (e) {} });

// ---------- Tereny na mapie ----------
// poly terenu: [[lat,lon],…] (narysowany) albo [[[lat,lon],…],…] (granica gminy/powiatu, kilka obwodów).
const rings = poly => Array.isArray(poly[0][0]) ? poly : [poly];
map.createPane('tereny'); map.getPane('tereny').style.zIndex = 350; map.getPane('tereny').style.pointerEvents = 'none';
const TR = L.svg({ pane: 'tereny' });
// trasy rysujemy NAD pinezkami (ale pod znacznikami osób), też bez przechwytywania stuknięć
map.createPane('trasy'); map.getPane('trasy').style.zIndex = 450; map.getPane('trasy').style.pointerEvents = 'none';
const RR = L.svg({ pane: 'trasy' });
const terLayer = L.layerGroup().addTo(map), toolLayer = L.layerGroup().addTo(map);
const PAL = ['#0ea5e9', '#14b8a6', '#eab308', '#8b5cf6', '#ef4444', '#22c55e', '#ec4899', '#06b6d4'];
function tcolor(t) {
  const u = USERS[t.user_id]; if (u && u.rola === 'manager') return '#f97316';
  let h = 0; for (const c of String(t.user_id)) h = (h * 31 + c.charCodeAt(0)) | 0; return PAL[Math.abs(h) % PAL.length];
}
try { $('terLayer').checked = localStorage.getItem('pv_ter') !== '0'; } catch (e) {}
$('terLayer').onchange = e => { try { localStorage.setItem('pv_ter', e.target.checked ? '1' : '0'); } catch (_) {} renderTer(); };
function renderTer() {
  terLayer.clearLayers(); if (!$('terLayer').checked) return;
  for (const t of TER) {
    const mgr = USERS[t.user_id] && USERS[t.user_id].rola === 'manager', col = tcolor(t);
    const pg = L.polygon(rings(t.poly), { renderer: TR, pane: 'tereny', interactive: false, color: col, weight: mgr ? 4 : 3, dashArray: mgr ? '10 7' : null,
      fillColor: col, fillOpacity: mgr ? 0.04 : 0.1 }).addTo(terLayer);
    // etykieta: teren handlowca w środku, teren menedżera przy górnej krawędzi (żeby się nie nakładały)
    const b = pg.getBounds(), at = mgr ? [b.getNorth(), (b.getWest() + b.getEast()) / 2] : b.getCenter();
    L.tooltip({ permanent: true, direction: mgr ? 'top' : 'center', className: 'tlabel', interactive: false })
      .setLatLng(at).setContent(esc(uname(t.user_id) + (t.nazwa ? ': ' + t.nazwa : ''))).addTo(terLayer);
  }
}
function fitTer(list) {
  const pts = list.flatMap(t => rings(t.poly).flat()); if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
}
$('myterbtn').onclick = () => {
  $('panel').classList.remove('open'); const mine = TER.filter(t => ME && t.user_id === ME.id);
  if (mine.length) fitTer(mine); else msg('Nie masz jeszcze przydzielonego terenu.', 3500);
};

// ---------- Dodawanie pominiętego domu ----------
let addMode = false;
function setAdd(on) { addMode = on; $('addbtn').classList.toggle('on', on); $('addhint').style.display = on ? 'block' : 'none'; }
$('addbtn').onclick = () => { if (tool) return; close(); $('panel').classList.remove('open'); setAdd(!addMode); };
async function reverseAddr(lat, lon) {
  try {
    const u = 'https://services.gugik.gov.pl/uug/?request=GetAddressReverse&srid=4326&radius=80&location=' + encodeURIComponent(`POINT(${lon} ${lat})`);
    const r = await fetch(u); const d = await r.json(); const v = d.results && d.results['1']; if (!v) return null;
    return { adres: (v.street || v.city) + ' ' + v.number, miejscowosc: v.city, gmina: (v.jednostka || '').replace(/[{}"]/g, '').split(',').pop() || null };
  } catch (e) { return null; }
}
async function addPin(lat, lon) {
  setAdd(false);
  const p = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), adres: null, miejscowosc: null, gmina: null,
    lat: +lat.toFixed(6), lon: +lon.toFixed(6), zrodlo: 'reczne', pewnosc: null, wynik: null, obszar: null, status: null, notatka: null, pv: 'jest',
    zmieniono: new Date().toISOString() };
  const a = navigator.onLine ? await reverseAddr(p.lat, p.lon) : null; if (a) Object.assign(p, a);
  let error = null;
  if (OQ.length) error = new Error('offline');
  else { try { ({ error } = await sb.from('pins').insert(p)); } catch (e) { error = e; } }
  if (error && !isNet(error)) {
    msg(/row-level security/i.test(error.message) ? 'Możesz dodawać domy tylko na swoim terenie.' : 'Nie udało się dodać pinezki: ' + error.message, 5000);
    return;
  }
  if (error) enqueue('insert', p, p);
  if (ME) p.zmienil = ME.id;
  P.push(p); byId[p.id] = p; render(); open(p);
  msg(error ? 'Dom zapisany w telefonie – wyślę go, gdy wróci internet.' : 'Dodano dom z PV' + (p.adres ? ': ' + p.adres : ''), 3500); refreshCounts();
}
const editing = () => !!tool && (tool.mode === 'pick' || tool.mode === 'draw');
map.on('click', e => {
  if (editing()) { toolClick(e.latlng); return; }
  if (tool) { close(); return; }
  if (addMode) { addPin(e.latlng.lat, e.latlng.lng); return; }
  $('panel').classList.remove('open'); close();
});

// ---------- Przydział terenu: granica gminy/powiatu z GUGiK albo rysowanie ----------
// Granice pobiera usługa ULDK (GUGiK). Upraszczamy je do ok. 10 m, żeby baza liczyła szybko.
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const k = Math.cos(pts[0][0] * Math.PI / 180), keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1;
    const ax = pts[a][1] * k, ay = pts[a][0], bx = pts[b][1] * k, by = pts[b][0], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][1] * k, py = pts[i][0];
      let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy); if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function parseWkt(w) {
  const out = []; const re = /\(([^()]+)\)/g; let m;
  while ((m = re.exec(w))) {
    let pts = m[1].split(',').map(s => { const [x, y] = s.trim().split(/\s+/).map(Number); return [y, x]; });
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    pts = simplify(pts, 0.0001).map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]);
    if (pts.length >= 3) out.push(pts);
  }
  return out;
}
async function fetchBoundary(lat, lon, level) {
  const req = level === 'powiat' ? 'GetCountyByXY' : 'GetCommuneByXY';
  const r = await fetch(`https://uldk.gugik.gov.pl/?request=${req}&xy=${lon},${lat},4326&result=teryt,commune,county,geom_wkt&srid=4326`);
  const lines = (await r.text()).split('\n').map(s => s.trim()); const i = lines.indexOf('0');
  if (i < 0 || !lines[i + 1]) throw new Error('W tym miejscu nie znaleziono granicy.');
  const f = lines[i + 1].split('|'), poly = parseWkt(f[3] || '');
  if (!poly.length) throw new Error('Nie udało się odczytać granicy.');
  return { teryt: f[0], name: level === 'powiat' ? f[2] : 'gm. ' + f[1], poly };
}

let tool = null;   // { mode: 'pick' | 'draw', userId, level, found, busy, pts }
function startTool(mode, userId) {
  closeSheets(); setAdd(false);
  tool = { mode, userId, level: 'gmina', found: null, busy: false, pts: [] };
  document.body.classList.add('tooling'); renderTool();
}
function endTool(back) {
  const m = tool && tool.mode; tool = null; toolLayer.clearLayers(); document.body.classList.remove('tooling');
  if (back) (m === 'trasa' || m === 'zespol') ? openTrack() : openTeam();
}
// podgląd terenu czytelny na zdjęciu lotniczym: biała linia z ciemną obwódką
function hiPoly(poly, dashed) {
  L.polygon(poly, { renderer: TR, pane: 'tereny', interactive: false, color: '#172033', weight: 7, opacity: 0.55, fill: false }).addTo(toolLayer);
  L.polygon(poly, { renderer: TR, pane: 'tereny', interactive: false, color: '#fff', weight: 3, dashArray: dashed ? '8 6' : null, fillColor: '#fff', fillOpacity: 0.18 }).addTo(toolLayer);
}
function renderTool() {
  toolLayer.clearLayers(); if (!tool) return;
  const who = esc(fullName(USERS[tool.userId])); let h;
  if (tool.mode === 'trasa') {
    const pts = tool.pts, u = USERS[tool.userId], col = pcolor(tool.userId);
    let km = 0; for (let i = 1; i < pts.length; i++) km += dist(pts[i - 1], pts[i]) / 1000;
    const tm = t => new Date(t).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    const dl = new Date(tool.day + 'T12:00:00').toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'long' });
    h = `<div class="tt">Trasa: ${who}</div><div class="ts">${pts.length ? `${tm(pts[0].czas)}–${tm(pts[pts.length - 1].czas)}, około ${km.toFixed(1).replace('.', ',')} km, ${pts.length} punktów` : 'Brak pozycji tego dnia. Trasa zapisuje się tylko w czasie pracy („Zaczynam dzień”) i przy otwartej aplikacji. Pozycje są przechowywane 7 dni.'}</div>
      <div class="r"><button class="ico" data-a="prev" aria-label="Poprzedni dzień">${ic('back')}</button><button data-a="day" disabled style="opacity:1">${esc(dl)}</button><button class="ico" data-a="next" aria-label="Następny dzień" ${tool.day >= todayStr() ? 'disabled' : ''}>${ic('next')}</button><button class="pri" data-a="cancel">Zamknij</button></div>`;
    if (pts.length) {
      const ll = pts.map(p => [p.lat, p.lon]);
      L.polyline(ll, { renderer: RR, pane: 'trasy', interactive: false, color: '#fff', weight: 8, opacity: 0.9 }).addTo(toolLayer);
      L.polyline(ll, { renderer: RR, pane: 'trasy', interactive: false, color: col, weight: 4.5 }).addTo(toolLayer);
      L.circleMarker(ll[0], { renderer: RR, pane: 'trasy', interactive: false, radius: 7, color: '#fff', weight: 3, fillColor: '#16a34a', fillOpacity: 1 }).addTo(toolLayer)
        .bindTooltip('Start ' + tm(pts[0].czas), { permanent: true, direction: 'left', offset: [-8, 0], className: 'tlabel' });
      L.marker(ll[ll.length - 1], { icon: tmark(u), interactive: false }).addTo(toolLayer)
        .bindTooltip(esc(fullName(u)) + ', ' + tm(pts[pts.length - 1].czas), { permanent: true, direction: 'right', offset: [18, 0], className: 'tlabel' });
    }
  } else if (tool.mode === 'zespol') {
    const ppl = trackPeople(), on = ppl.filter(u => LAST[u.id]);
    h = `<div class="tt">Zespół na mapie</div><div class="ts">Ostatnie znane pozycje ${on.length} z ${ppl.length} osób, odświeżane co minutę. Stuknij osobę, by zobaczyć jej dzisiejszą trasę.</div>
      <div class="r"><button class="pri" data-a="cancel">Zamknij</button></div>`;
    for (const u of on) {
      const l = LAST[u.id], old = Date.now() - new Date(l.czas) > 15 * 60000;
      L.marker([l.lat, l.lon], { icon: tmark(u, old ? 'old' : ''), zIndexOffset: 2000 }).addTo(toolLayer)
        .bindTooltip(esc(fullName(u)) + ', ' + ago(l.czas), { permanent: true, direction: 'right', offset: [18, 0], className: 'tlabel' })
        .on('click', () => showRoute(u.id, todayStr()));
    }
  } else if (tool.mode === 'pick') {
    h = `<div class="tt">Teren dla: ${who}</div>
      <div class="seg" id="lvl"><button data-l="gmina" class="${tool.level === 'gmina' ? 'on' : ''}">Gmina</button><button data-l="powiat" class="${tool.level === 'powiat' ? 'on' : ''}">Powiat</button></div>` +
      (tool.found ? `<div class="found">${ic('check')}${esc(tool.found.name)}</div>`
                  : `<div class="ts">${tool.busy ? 'Pobieram granicę z GUGiK…' : 'Stuknij w mapę w środku ' + (tool.level === 'gmina' ? 'gminy' : 'powiatu') + ', którą chcesz przydzielić.'}</div>`) +
      `<div class="r"><button data-a="cancel">Anuluj</button><button class="pri" data-a="save" ${tool.found ? '' : 'disabled'}>${ic('check')}Przydziel</button></div>`;
    if (tool.found) hiPoly(tool.found.poly, false);
  } else {
    const pts = tool.pts;
    h = `<div class="tt">Rysujesz teren dla: ${who}</div><div class="ts">Stukaj w mapę w narożnikach obszaru. Punkty: ${pts.length} (min. 3)</div>
      <input id="toolname" placeholder="Nazwa terenu, np. Końskie – północ" maxlength="80" value="${esc(tool.name || '')}">
      <div class="r"><button data-a="undo" ${pts.length ? '' : 'disabled'}>${ic('undo')}Cofnij</button><button data-a="cancel">Anuluj</button><button class="pri" data-a="save" ${pts.length >= 3 ? '' : 'disabled'}>${ic('check')}Zapisz</button></div>`;
    if (pts.length >= 2) hiPoly(pts, true);
    pts.forEach(p => L.circleMarker(p, { renderer: TR, pane: 'tereny', interactive: false, radius: 6, color: '#fff', weight: 2, fillColor: '#172033', fillOpacity: 1 }).addTo(toolLayer));
  }
  $('tool').innerHTML = h;
}
async function toolClick(ll) {
  if (tool.mode === 'draw') { tool.name = ($('toolname') || {}).value; tool.pts.push([+ll.lat.toFixed(6), +ll.lng.toFixed(6)]); renderTool(); return; }
  if (tool.busy) return; tool.busy = true; tool.found = null; renderTool();
  const t = tool;
  try { const f = await fetchBoundary(ll.lat, ll.lng, t.level); if (tool !== t) return; t.found = f; }
  catch (e) { msg(e.message || 'Nie udało się pobrać granicy. Sprawdź internet.', 4000); }
  t.busy = false; if (tool === t) { renderTool(); if (t.found) map.fitBounds(L.latLngBounds(t.found.poly.flat()), { padding: [40, 40] }); }
}
$('tool').addEventListener('click', async e => {
  const l = e.target.closest('[data-l]'); if (l && tool) { tool.level = l.dataset.l; tool.found = null; renderTool(); return; }
  const b = e.target.closest('button[data-a]'); if (!b || !tool) return; const a = b.dataset.a;
  if (a === 'cancel') { endTool(true); return; }
  if (a === 'prev' || a === 'next') {
    const d = new Date(tool.day + 'T12:00:00'); d.setDate(d.getDate() + (a === 'prev' ? -1 : 1));
    showRoute(tool.userId, d.toISOString().slice(0, 10)); return;
  }
  if (a === 'undo') { tool.name = ($('toolname') || {}).value; tool.pts.pop(); renderTool(); return; }
  if (a === 'save') {
    const row = tool.mode === 'pick'
      ? { user_id: tool.userId, nazwa: tool.found.name, poly: tool.found.poly, teryt: tool.found.teryt }
      : { user_id: tool.userId, nazwa: ($('toolname').value || '').trim() || null, poly: tool.pts };
    b.disabled = true;
    const { error } = await sb.from('tereny').insert(row);
    if (error) { b.disabled = false; msg('Nie zapisano terenu: ' + error.message, 5000); return; }
    msg('Przydzielono teren' + (row.nazwa ? ': ' + row.nazwa : ''));
    try { await loadTeam(); } catch (_) {}
    endTool(true);
  }
});

// ---------- Panel „Zespół i tereny” ----------
function openTeam() {
  if (!ME || (ME.rola !== 'admin' && ME.rola !== 'manager')) return;
  fillTeam(); $('team').classList.add('open'); close(); $('panel').classList.remove('open'); $('list').classList.remove('open');
}
function closeTeam() { $('team').classList.remove('open'); }
$('teambtn').onclick = async () => { try { await loadTeam(); } catch (e) { msg('Nie udało się pobrać zespołu: ' + (e.message || e), 5000); } openTeam(); };
$('teamclose').onclick = closeTeam;

function terList(userId, canEdit) {
  const list = TER.filter(t => t.user_id === userId);
  const rows = list.map(t => `<div class="ter"><span class="dot" style="background:${tcolor(t)}"></span><span class="tn">${esc(t.nazwa || 'Teren bez nazwy')}</span>` +
    `<button data-a="show" data-t="${t.id}">Pokaż</button>` + (canEdit ? `<button class="del" data-a="del" data-t="${t.id}">Usuń</button>` : '') + '</div>').join('');
  return `<div class="ters">${rows || '<div class="ter none">Brak przydzielonego terenu</div>'}</div>`;
}
const assignBtns = () => `<div class="two"><button data-a="pick">${ic('map')}Gmina / powiat</button><button class="sec" data-a="draw">${ic('pencil')}Narysuj</button></div>`;
function fillTeam() {
  const all = Object.values(USERS), byName = (a, b) => fullName(a).localeCompare(fullName(b), 'pl');
  const managers = all.filter(u => u.rola === 'manager').sort(byName);
  let h = '';
  if (isAdmin()) {
    $('teamtitle').textContent = 'Zespół i tereny';
    $('teamsub').textContent = 'Przydzielasz menedżerom handlowców i główny teren.';
    const roleSel = u => `<select data-f="rola" ${u.id === ME.id ? 'disabled' : ''}>` +
      Object.entries(ROLE_LBL).map(([k, v]) => `<option value="${k}" ${u.rola === k ? 'selected' : ''}>${v}</option>`).join('') + '</select>';
    const mgrSel = u => '<select data-f="manager_id"><option value="">brak</option>' +
      managers.map(m => `<option value="${m.id}" ${u.manager_id === m.id ? 'selected' : ''}>${esc(fullName(m))}</option>`).join('') + '</select>';
    const card = u => {
      const team = all.filter(x => x.rola === 'handlowiec' && x.manager_id === u.id).sort(byName).map(fullName);
      return `<div class="card" data-u="${u.id}">` +
        `<input class="nm" data-f="imie" value="${esc(u.imie || '')}" placeholder="Wpisz imię i nazwisko">` +
        `<small>${esc(u.email || '')}</small>` +
        `<div class="cr"><label>Rola ${roleSel(u)}</label>` + (u.rola === 'handlowiec' ? `<label>Menedżer ${mgrSel(u)}</label>` : '') + '</div>' +
        (u.rola === 'manager' ? `<small>${team.length ? 'Handlowcy: ' + esc(team.join(', ')) : 'Nie ma jeszcze handlowców – wybierz menedżera w karcie handlowca.'}</small>` : '') +
        (u.rola === 'handlowiec' && !u.manager_id ? '<small class="warn">Bez menedżera handlowiec nie widzi żadnych domów.</small>' : '') +
        (u.rola !== 'admin' ? terList(u.id, true) + assignBtns() : '') +
        (u.id !== ME.id ? `<div class="accrow">${u.zablokowany ? '<span class="blocked">Konto zablokowane</span>' : ''}` +
          `<button data-a="pass">Nowe hasło</button><button data-a="block" class="${u.zablokowany ? '' : 'red'}">${u.zablokowany ? 'Odblokuj' : 'Zablokuj'}</button></div>` +
          `<div class="pwset" hidden><div class="pw"><input value="${genPass()}" aria-label="Nowe hasło"><button data-a="passok" class="pri">Ustaw</button></div></div>` : '') +
        '</div>';
    };
    h += `<details class="card addacc" id="addacc"><summary>${ic('plus')}Dodaj konto</summary><form id="accform" novalidate>
      <div class="fld"><label for="a_imie">Imię i nazwisko</label><input id="a_imie" autocomplete="off"></div>
      <div class="fld"><label for="a_email">E-mail (login)</label><input id="a_email" type="email" autocomplete="off"></div>
      <div class="fld"><label for="a_haslo">Hasło (min. 8 znaków)</label><div class="pw"><input id="a_haslo" autocomplete="off" value="${genPass()}"><button type="button" data-a="gen">Nowe</button></div></div>
      <div class="cr"><label>Rola <select id="a_rola">${Object.entries(ROLE_LBL).map(([k, v]) => `<option value="${k}" ${k === 'handlowiec' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label id="a_mgrl">Menedżer <select id="a_mgr"><option value="">brak</option>${managers.map(m => `<option value="${m.id}">${esc(fullName(m))}</option>`).join('')}</select></label></div>
      <div class="fbtn"><button type="submit" class="pri">Utwórz konto</button></div>
      <div class="hint" id="accres"></div></form></details>`;
    h += '<div class="h">Menedżerowie</div>' + (managers.map(card).join('') || '<div class="hint">Nie ma jeszcze menedżerów.</div>');
    h += '<div class="h">Handlowcy</div>' + (all.filter(u => u.rola === 'handlowiec').sort(byName).map(card).join('') || '<div class="hint">Nie ma jeszcze handlowców.</div>');
    h += '<div class="h">Administratorzy</div>' + all.filter(u => u.rola === 'admin').sort(byName).map(card).join('');
  } else {
    $('teamtitle').textContent = 'Moi handlowcy i tereny';
    $('teamsub').textContent = 'Przydzielasz swoim handlowcom konkretne tereny.';
    h += `<div class="h">Twój teren</div><div class="card"><div class="nmt">${esc(fullName(ME))}</div><small>Przydziela administrator</small>${terList(ME.id, false)}</div>`;
    const mine = all.filter(u => u.rola === 'handlowiec' && u.manager_id === ME.id).sort(byName);
    h += '<div class="h">Twoi handlowcy</div>';
    h += mine.map(u => `<div class="card" data-u="${u.id}"><div class="nmt">${esc(fullName(u))}</div><small>${esc(u.email || '')}</small>` +
      terList(u.id, true) + assignBtns() + '</div>').join('') ||
      '<div class="hint">Administrator nie przydzielił Ci jeszcze handlowców.</div>';
    h += '<div class="hint">Handlowiec widzi tylko domy, które leżą jednocześnie w jego terenie i w Twoim.</div>';
  }
  $('teambody').innerHTML = h;
}
// ---------- Konta (administrator): funkcja pv-konta w Supabase ----------
function genPass() {
  const A = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789', r = new Uint32Array(10); crypto.getRandomValues(r);
  return Array.from(r, x => A[x % A.length]).join('');
}
async function konta(body) {
  let res;
  try { res = await sb.functions.invoke('pv-konta', { body }); } catch (e) { throw new Error('Brak połączenia z funkcją pv-konta.'); }
  const { data, error } = res;
  if (error) {
    let m = error.message || '';
    try { const j = await error.context.json(); if (j && j.error) m = j.error; } catch (_) {}
    if (/Failed to send|not found|404|FunctionsFetchError|FunctionsRelayError/i.test(m)) m = 'Funkcja pv-konta nie jest jeszcze wdrożona w Supabase (instrukcja w KONTEKST.md).';
    throw new Error(m);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}
$('teambody').addEventListener('submit', async e => {
  if (e.target.id !== 'accform') return; e.preventDefault();
  const body = { akcja: 'utworz', imie: $('a_imie').value.trim(), email: $('a_email').value.trim(), haslo: $('a_haslo').value,
    rola: $('a_rola').value, manager_id: $('a_rola').value === 'handlowiec' ? $('a_mgr').value || null : null };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) { $('accres').textContent = 'Wpisz poprawny adres e-mail.'; return; }
  if (body.haslo.length < 8) { $('accres').textContent = 'Hasło musi mieć co najmniej 8 znaków.'; return; }
  const btn = e.target.querySelector('[type=submit]'); btn.disabled = true; $('accres').textContent = 'Tworzę konto…';
  try {
    await konta(body);
    try { await loadTeam(); } catch (_) {} fillTeam(); $('addacc').open = true;
    $('accres').innerHTML = `Konto utworzone. Przekaż tej osobie dane logowania:<br><b>${esc(body.email)}</b><br>hasło: <b>${esc(body.haslo)}</b>`;
  } catch (err) { $('accres').textContent = err.message; btn.disabled = false; }
});
$('teambody').addEventListener('change', e => { if (e.target.id === 'a_rola') $('a_mgrl').hidden = e.target.value !== 'handlowiec'; }, true);
async function setProfile(id, patch) {
  const prev = USERS[id];
  if (patch.rola && patch.rola !== 'handlowiec') patch.manager_id = null;
  const { error } = await sb.from('profiles').update(patch).eq('id', id);
  if (error) msg('Nie zapisano: ' + error.message, 5000);
  else {
    // menedżer przestał być menedżerem → jego handlowcy zostają bez menedżera
    if (prev && prev.rola === 'manager' && patch.rola && patch.rola !== 'manager')
      await sb.from('profiles').update({ manager_id: null }).eq('manager_id', id);
    msg('Zapisano');
  }
  try { await loadTeam(); } catch (e) {}
  fillTeam();
}
$('teambody').addEventListener('change', e => {
  if (e.target.closest('#accform')) return;
  const f = e.target.dataset.f, card = e.target.closest('[data-u]'); if (!f || !card || !isAdmin()) return;
  const v = e.target.value.trim(); setProfile(card.dataset.u, { [f]: v || null });
});
$('teambody').addEventListener('click', async e => {
  const b = e.target.closest('button[data-a]'); if (!b) return; const a = b.dataset.a;
  if (a === 'pick' || a === 'draw') { startTool(a, b.closest('[data-u]').dataset.u); return; }
  if (a === 'gen') { $('a_haslo').value = genPass(); return; }
  const card = b.closest('[data-u]'), uid = card && card.dataset.u;
  if (a === 'pass') { card.querySelector('.pwset').hidden = !card.querySelector('.pwset').hidden; return; }
  if (a === 'passok') {
    const pw = card.querySelector('.pwset input').value; b.disabled = true;
    try { await konta({ akcja: 'haslo', user_id: uid, haslo: pw }); msg('Nowe hasło ustawione: ' + pw + ' – przekaż je tej osobie.', 8000); card.querySelector('.pwset').hidden = true; }
    catch (err) { msg(err.message, 6000); }
    b.disabled = false; return;
  }
  if (a === 'block') {
    const blok = !USERS[uid].zablokowany;
    if (blok && !b.classList.contains('sure')) { b.classList.add('sure'); b.textContent = 'Na pewno zablokować?'; setTimeout(() => { b.classList.remove('sure'); b.textContent = 'Zablokuj'; }, 4000); return; }
    b.disabled = true;
    try { await konta({ akcja: 'blokuj', user_id: uid, zablokuj: blok }); msg(blok ? 'Konto zablokowane – ta osoba nie zobaczy już żadnych danych.' : 'Konto odblokowane'); }
    catch (err) { msg(err.message, 6000); }
    try { await loadTeam(); } catch (_) {} fillTeam(); return;
  }
  const t = TER.find(x => String(x.id) === b.dataset.t); if (!t) return;
  if (a === 'show') { closeTeam(); fitTer([t]); return; }
  if (a === 'del') {
    if (!b.classList.contains('sure')) { b.classList.add('sure'); b.textContent = 'Na pewno?'; setTimeout(() => { b.classList.remove('sure'); b.textContent = 'Usuń'; }, 4000); return; }
    const { error } = await sb.from('tereny').delete().eq('id', t.id);
    if (error) msg('Nie usunięto terenu: ' + error.message, 5000); else msg('Teren usunięty');
    try { await loadTeam(); } catch (e) {} fillTeam();
  }
});

// ---------- Karta pinezki ----------
// Statusy z danymi klienta: przed zapisem trzeba wypełnić formularz (baza też tego pilnuje).
const DEALS = ['lead', 'spotkanie', 'umowa'];
const FORM = {
  lead:      [['klient_imie', 'Imię', 1], ['klient_nazwisko', 'Nazwisko', 0], ['klient_telefon', 'Telefon', 1, 'tel'], ['notatka', 'Notatka', 1, 'area']],
  spotkanie: [['klient_imie', 'Imię', 1], ['klient_nazwisko', 'Nazwisko', 0], ['klient_telefon', 'Telefon', 1, 'tel'], ['termin', 'Termin spotkania', 1, 'datetime-local'], ['notatka', 'Notatka', 1, 'area']],
  umowa:     [['klient_imie', 'Imię', 1], ['klient_nazwisko', 'Nazwisko', 1], ['produkt', 'Sprzedany produkt', 1, 'text', 'produkty'], ['klient_telefon', 'Telefon', 0, 'tel'], ['notatka', 'Notatka', 0, 'area']]
};
const CLIENT = ['klient_imie', 'klient_nazwisko', 'klient_telefon', 'produkt', 'termin'];
const digits = t => String(t || '').replace(/\D/g, '');
const clientName = p => [p.klient_imie, p.klient_nazwisko].filter(Boolean).join(' ');
const fmtWhen = t => t ? new Date(t).toLocaleString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const toLocalInput = t => { if (!t) return ''; const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
function fieldError(k, v, req) {
  const t = String(v || '').trim();
  if (req && !t) return k === 'notatka' ? 'Wpisz notatkę' : k === 'produkt' ? 'Wpisz sprzedany produkt' : k === 'termin' ? 'Wybierz dzień i godzinę spotkania' : 'To pole jest wymagane';
  if (k === 'klient_telefon' && t && digits(t).length < 9) return 'Numer telefonu musi mieć co najmniej 9 cyfr';
  return '';
}
function renderKlient(p) {
  const box = $('klient'), name = clientName(p);
  if (!name && !p.klient_telefon && !p.produkt) { box.className = 'klient'; box.innerHTML = ''; return; }
  const k = DEALS.includes(p.status) ? p.status : null, col = k ? STAT[k].color : '#6b7280';
  const det = [k === 'umowa' && p.produkt ? 'Produkt: ' + p.produkt : '', k === 'spotkanie' && p.termin ? 'Spotkanie: ' + fmtWhen(p.termin) : '', p.klient_telefon || ''].filter(Boolean);
  box.className = 'klient on'; box.style.setProperty('--c', col);
  box.innerHTML = `<div class="kn">${ic(k ? STAT[k].icon : 'user')}${esc(name || 'Klient')}</div>` +
    (det.length ? `<div class="kd">${det.map(esc).join('<br>')}</div>` : '') +
    `<div class="kr">${p.klient_telefon ? `<a class="call" href="tel:${esc(digits(p.klient_telefon))}">${ic('phone')}Zadzwoń</a>` : ''}` +
    (k ? `<button type="button" id="kedit">${ic('pencil')}Edytuj dane</button>` : '') + '</div>' +
    (k ? `<div class="kown"><span>Zebrał(a): <b>${esc(uname(autor(p)) || '–')}</b></span>` +
      (canAssign() ? `<label>Prowadzi <select id="kassign">${assignOptions(p)}</select></label>`
                   : p.przypisany ? `<span>Prowadzi: <b>${esc(uname(p.przypisany))}</b></span>` : '') + '</div>' : '');
  const b = $('kedit'); if (b) b.onclick = () => openForm(k);
  const a = $('kassign'); if (a) a.onchange = async () => {
    const v = a.value || null; if (await save(p, { przypisany: v })) msg(v ? 'Przekazano: ' + uname(v) : 'Cofnięto przekazanie');
  };
}
const canAssign = () => !!ME && (ME.rola === 'admin' || ME.rola === 'manager');
function assignOptions(p) {
  const o = (id, l) => `<option value="${id}" ${(p.przypisany || '') === id ? 'selected' : ''}>${esc(l)}</option>`;
  let ppl;
  if (isAdmin()) ppl = Object.values(USERS).filter(u => !u.zablokowany && (u.rola === 'manager' || u.rola === 'handlowiec')).sort(byName);
  else ppl = [ME, ...teamOf(ME.id)];
  if (p.przypisany && !ppl.some(u => u.id === p.przypisany)) ppl.push(USERS[p.przypisany] || { id: p.przypisany });
  return o('', 'osoba, która zebrała') + ppl.map(u => o(u.id, u.id === ME.id ? 'Ja' : fullName(u) || 'inny użytkownik')).join('');
}
function openForm(k) {
  if (!cur) return; const p = cur, st = STAT[k];
  $('formview').innerHTML = `<div class="fh" style="--c:${st.color}"><div class="fi">${ic(st.icon)}</div><div><b>${st.label}</b><small>${esc(title(p))}</small></div></div>` +
    FORM[k].map(([f, label, req, type, list]) => {
      const v = f === 'termin' ? toLocalInput(p[f]) : (p[f] || '');
      const inp = type === 'area' ? `<textarea name="${f}" id="f_${f}">${esc(v)}</textarea>`
        : `<input name="${f}" id="f_${f}" type="${type === 'tel' ? 'tel' : type || 'text'}" value="${esc(v)}"${type === 'tel' ? ' inputmode="tel" autocomplete="off"' : ''}${list ? ` list="${list}"` : ''}>`;
      return `<div class="fld" data-f="${f}"><label for="f_${f}">${label} ${req ? '<i>*</i>' : '<em>(opcjonalnie)</em>'}</label>${inp}<div class="fe"></div></div>`;
    }).join('') +
    `<div class="fbtn"><button type="button" data-a="cancel">Anuluj</button><button type="submit" class="pri">Zapisz: ${st.label}</button></div>` +
    (p.status === k ? `<div class="foot"><button type="button" class="lnk red" data-a="clear">${ic('close')}Usuń status „${st.label}”</button></div>` : '');
  $('formview').dataset.k = k; $('sheet').classList.add('form'); $('sheet').scrollTop = 0;
  const first = FORM[k].find(([f, , req]) => req && !String(p[f] || '').trim()); if (first) setTimeout(() => $('f_' + first[0]).focus(), 250);
}
function closeForm() { $('sheet').classList.remove('form'); $('formview').innerHTML = ''; }
$('formview').addEventListener('click', e => {
  const a = e.target.closest('[data-a]'); if (!a) return;
  if (a.dataset.a === 'cancel') closeForm();
  if (a.dataset.a === 'clear') { const k = $('formview').dataset.k; closeForm(); setStatus(k, true); }
});
$('formview').addEventListener('submit', async e => {
  e.preventDefault(); if (!cur) return; const k = $('formview').dataset.k, p = cur, patch = { status: k };
  let bad = null;
  for (const [f, , req] of FORM[k]) {
    const el = $('f_' + f), err = fieldError(f, el.value, req), box = el.closest('.fld');
    box.classList.toggle('bad', !!err); box.querySelector('.fe').textContent = err; if (err && !bad) bad = el;
    patch[f] = f === 'termin' ? (el.value ? new Date(el.value).toISOString() : null) : (el.value.trim() || null);
  }
  if (bad) { bad.focus(); return; }
  if (k === 'umowa' && !p.pv) patch.pv = 'jest';
  if (await save(p, patch)) { closeForm(); msg('Zapisano: ' + STAT[k].label); }
});
function renderTiles() {
  const list = TILES.filter(forMe);
  $('tiles').innerHTML = list.map((k, i) => `<button class="st${list.length % 2 && i === list.length - 1 ? ' wide' : ''}" data-s="${k}" style="--c:${STAT[k].color}">${ic(STAT[k].icon)}${STAT[k].label}</button>`).join('');
}
function open(p) {
  if (cur !== p) closeForm();
  cur = p;
  $('t').textContent = title(p);
  const src = p.zrodlo === 'reczne' ? 'Dodany ręcznie'
    : !isAdmin() ? 'Dom z fotowoltaiką'
    : p.zrodlo === 'stare' ? 'Twoja wcześniejsza pinezka' : 'Wykryty automatycznie' + (p.pewnosc ? ', ' + p.pewnosc : '');
  renderKlient(p);
  $('sub').innerHTML = [src, p.gmina ? 'gm. ' + p.gmina : '', me ? fmtDist(dist(me, p)) + ' stąd' : ''].filter(Boolean).map(s => `<span>${esc(s)}</span>`).join('');
  $('nav').href = navUrl(p);
  $('gm').href = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
  document.querySelectorAll('.st').forEach(b => b.classList.toggle('on', b.dataset.s === p.status));
  document.querySelectorAll('.pvb').forEach(b => b.classList.toggle('on', b.dataset.v === p.pv));
  $('delbtn').querySelector('span').textContent = p.ukryta_admin ? 'Przywróć pinezkę' : 'Usuń pinezkę (tylko u mnie)';
  $('note').value = p.notatka || '';
  $('saved').textContent = p.status || p.notatka || p.pv ? 'Zmiana: ' + new Date(p.zmieniono).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) +
    (p.zmienil ? ', ' + uname(p.zmienil) : '') : '';
  if (cur !== open.lastHist) { open.lastHist = cur; $('hist').open = false; $('delask').hidden = true; loadHist(p); }
  $('sheet').classList.add('open'); $('panel').classList.remove('open'); $('list').classList.remove('open');
}
function close() { $('sheet').classList.remove('open'); closeForm(); cur = null; open.lastHist = null; }

// ---------- Historia domu ----------
const PV_LBL = { jest: 'Jest PV', nie: 'Nie ma PV' };
function histLine(h) {
  switch (h.rodzaj) {
    case 'status': return h.status_po ? (STAT[h.status_po] ? STAT[h.status_po].label : h.status_po) + (h.opis ? ' (' + h.opis + ')' : '') : 'Status wyczyszczony';
    case 'notatka': return 'Notatka: ' + (h.opis || '');
    case 'pv': return PV_LBL[h.opis] || 'Wyczyszczono informację o PV';
    case 'przekazanie': return h.przypisany ? 'Przekazano: ' + uname(h.przypisany) : 'Cofnięto przekazanie';
    default: return h.opis || h.rodzaj;
  }
}
async function loadHist(p) {
  const box = $('hist'); box.hidden = false; $('histn').textContent = '';
  try {
    const { data, error } = await sb.from('historia').select('*').eq('pin_id', p.id).order('czas', { ascending: false }).limit(40);
    if (error) throw error; if (cur !== p) return;
    $('histn').textContent = data.length ? '(' + data.length + ')' : '';
    $('histul').innerHTML = data.map(h => `<li><small>${esc(new Date(h.czas).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }))}${h.user_id ? ', ' + esc(uname(h.user_id)) : ''}</small>` +
      `<div>${esc(histLine(h))}</div></li>`).join('') || '<li><div>Brak wpisów. Historia zapisuje się od teraz przy każdej zmianie.</div></li>';
  } catch (e) { $('histul').innerHTML = '<li><div>Historia jest dostępna z internetem.</div></li>'; }
}
$('close').onclick = close;

// ---------- Praca bez zasięgu: kolejka zmian w telefonie ----------
// Zmiana zapisuje się od razu na ekranie; gdy nie ma internetu, czeka w telefonie i wysyła się sama.
const isNet = e => !navigator.onLine || /fetch|network|load failed|timeout|offline|abort/i.test(String((e && (e.message || e)) || ''));
const errText = e => { const m = (e && e.message) || ''; return /^Wpisz/.test(m) ? m + '.' : /uprawnie|row-level/i.test(m) ? 'Brak uprawnień do tej zmiany.' : 'Nie zapisano: ' + m; };
let OQ = []; try { OQ = JSON.parse(localStorage.getItem('pv_queue') || '[]'); } catch (e) {}
function oqSave() { try { localStorage.setItem('pv_queue', JSON.stringify(OQ)); } catch (e) {} renderStats(); }
function pinRow(p) {
  const row = { status: p.status, notatka: p.notatka, pv: p.pv || null, zmieniono: p.zmieniono, przypisany: p.przypisany ?? null };
  for (const f of CLIENT) row[f] = p[f] ?? null;
  if (isAdmin()) row.ukryta_admin = !!p.ukryta_admin;
  return row;
}
function enqueue(op, p, row) {
  const ex = OQ.find(x => x.id === p.id);
  if (ex) Object.assign(ex.row, row); else OQ.push({ op, id: p.id, row: { ...row }, label: title(p) });
  oqSave();
}
function applyQueue() {   // po wczytaniu z bazy pokaż zmiany, które jeszcze czekają w telefonie
  for (const it of OQ) {
    if (byId[it.id]) Object.assign(byId[it.id], it.row);
    else if (it.op === 'insert') { const p = { ...it.row }; P.push(p); byId[p.id] = p; }
  }
}
let syncing = false;
async function syncQueue() {
  if (syncing || !OQ.length) return; syncing = true; let sent = 0, failed = 0;
  try {
    while (OQ.length) {
      const it = OQ[0]; let r;
      try {
        r = it.op === 'insert' ? await sb.from('pins').insert(it.row) : await sb.from('pins').update(it.row).eq('id', it.id).select('id');
        if (!r.error && it.op === 'update' && (!r.data || !r.data.length)) r.error = new Error('brak uprawnień');
      } catch (e) { r = { error: e }; }
      if (r.error && isNet(r.error)) break;
      OQ.shift(); oqSave();
      if (r.error) { failed++; msg('Nie zapisano zmiany przy „' + it.label + '”. ' + errText(r.error), 7000); } else sent++;
    }
  } finally { syncing = false; }
  if (sent && !OQ.length && !failed) msg('Wysłano zmiany zapisane bez internetu (' + sent + ').');
  if (sent || failed) { reload(true); refreshCounts(); }
}
window.addEventListener('online', syncQueue);
setInterval(syncQueue, 30000);

let busy = false;
async function save(p, patch) {
  if (busy) { msg('Chwila, zapisuję…'); return false; }
  const FIELDS = ['status', 'notatka', 'pv', 'zmieniono', 'zmienil', 'ukryta_admin', 'przypisany', 'autor_statusu', ...CLIENT];
  busy = true; const prev = Object.fromEntries(FIELDS.map(f => [f, p[f]]));
  if ('status' in patch && patch.status !== prev.status) p.autor_statusu = patch.status ? (ME && ME.id) : null;
  Object.assign(p, patch, { zmieniono: new Date().toISOString(), zmienil: ME ? ME.id : p.zmienil }); render(); if (cur === p) open(p);
  const row = pinRow(p);
  try {
    if (OQ.length) { enqueue('update', p, row); msg('Zapisano w telefonie – wyślę, gdy wróci internet.', 3500); return true; }
    const { data, error } = await sb.from('pins').update(row).eq('id', p.id).select('id');
    if (error) throw error;
    if (!data || !data.length) throw new Error('brak uprawnień');
    refreshCounts(); if (cur === p) loadHist(p);
    return true;
  } catch (e) {
    if (isNet(e)) { enqueue('update', p, row); msg('Brak internetu – zmiana zapisana w telefonie, wyślę ją automatycznie.', 4000); return true; }
    Object.assign(p, prev); render(); if (cur === p) open(p);
    msg(errText(e), 4500); return false;
  } finally { busy = false; }
}
async function setStatus(s0, clear) {
  if (!cur) return; if (!forMe(s0)) return;
  if (DEALS.includes(s0) && !clear) { openForm(s0); return; }
  const p = cur; const s = p.status === s0 ? null : s0;
  const patch = { status: s, notatka: $('note').value.trim() || null };
  if (!(await save(p, patch))) return;
  msg(s ? 'Zapisano: ' + STAT[s].label : 'Status wyczyszczony');
}
$('tiles').addEventListener('click', e => { const b = e.target.closest('.st'); if (b) setStatus(b.dataset.s); });
// Usuwanie (tylko u administratora): gdy dom nie ma jeszcze oceny PV, najpierw pytamy o nią –
// dzięki temu każda usunięta pinezka zostaje w eksporcie z informacją „jest / nie ma PV” dla modelu.
async function hidePin(pv) {
  const p = cur; if (!p) return; $('delask').hidden = true;
  const patch = { ukryta_admin: true }; if (pv) patch.pv = pv;
  if (!(await save(p, patch))) return;
  close(); msg('Pinezka zniknęła tylko u Ciebie – zespół nadal ją widzi. Przywrócisz ją w Menu → Usunięte.', 4500);
}
$('delbtn').onclick = async () => {
  if (!isAdmin() || !cur) return; const p = cur;
  if (p.ukryta_admin) { if (await save(p, { ukryta_admin: false })) msg('Pinezka przywrócona'); return; }
  if (p.pv) { hidePin(null); return; }
  $('delask').hidden = false; $('delask').scrollIntoView({ block: 'nearest' });
};
$('delask').addEventListener('click', e => {
  const b = e.target.closest('[data-pv]'); if (!b) return;
  if (b.dataset.pv === 'anuluj') { $('delask').hidden = true; return; }
  hidePin(b.dataset.pv === 'nie_wiem' ? null : b.dataset.pv);
});
document.querySelectorAll('.pvb').forEach(b => b.onclick = async () => {
  if (!cur) return; const p = cur; const v = p.pv === b.dataset.v ? null : b.dataset.v;
  if (await save(p, { pv: v })) msg(v === 'jest' ? 'Zapisano: jest PV' : v === 'nie' ? 'Zapisano: nie ma PV' : 'Wyczyszczono informację o PV');
});
$('note').addEventListener('change', async () => {
  if (!cur) return; const n = $('note').value.trim() || null; if ((cur.notatka || null) === n) return;
  if (await save(cur, { notatka: n })) msg('Notatka zapisana');
});

// ---------- Śledzenie: wysyłanie własnej pozycji (menedżer i handlowiec, gdy aplikacja jest otwarta) ----------
const tracked = () => !!ME && (ME.rola === 'manager' || ME.rola === 'handlowiec');
let lastSent = null, tq = [], gpsState = 'wait', DAY = null, lastPos = null;
try { tq = JSON.parse(localStorage.getItem('pv_tq') || '[]'); } catch (e) {}
const tqSave = () => { try { localStorage.setItem('pv_tq', JSON.stringify(tq.slice(-500))); } catch (e) {} };
// Dzień pracy: śledzenie działa tylko od „Zaczynam dzień” do „Kończę pracę”, najpóźniej do 21:00.
const end21 = start => { const d = new Date(start); d.setHours(21, 0, 0, 0); return d; };
const dayOver = d => !d || Date.now() >= end21(d.start).getTime();
async function loadDay() {
  if (!tracked()) return;
  try {
    const { data, error } = await sb.from('dni_pracy').select('*').eq('user_id', ME.id).is('koniec', null).order('start', { ascending: false }).limit(1);
    if (error) throw error; DAY = data[0] || null;
    if (DAY && dayOver(DAY)) await endDay(true);
  } catch (e) {}
  updDayUI();
}
async function startDay() {
  if (new Date().getHours() >= 21) { msg('Po 21:00 śledzenie nie działa. Dzień zaczniesz jutro.', 4000); return; }
  const { data, error } = await sb.from('dni_pracy').insert({}).select().single();
  if (error) { msg(isNet(error) ? 'Do rozpoczęcia dnia potrzebny jest internet. Spróbuj za chwilę.' : 'Nie udało się rozpocząć dnia: ' + error.message, 4500); return; }
  DAY = data; lastSent = null; updDayUI(); if (lastPos) trackPos(lastPos); msg('Dzień rozpoczęty – przełożony widzi Twoją trasę do „Kończę pracę” (najpóźniej 21:00).', 4500);
  startGps(false);
}
async function endDay(auto) {
  if (!DAY) return; const d = DAY;
  await flushTrack();
  const koniec = auto ? end21(d.start) : new Date();
  const { error } = await sb.from('dni_pracy').update({ koniec: koniec.toISOString(), auto: !!auto }).eq('id', d.id);
  if (error && !auto) { msg(isNet(error) ? 'Do zakończenia dnia potrzebny jest internet. Spróbuj za chwilę.' : 'Nie udało się zakończyć dnia: ' + error.message, 4500); return; }
  DAY = null; updDayUI(); if (!auto) msg('Koniec pracy – śledzenie wyłączone.');
}
setInterval(() => { if (DAY && dayOver(DAY)) endDay(true); }, 60000);
function updDayUI() {
  const b = $('daybtn'); b.hidden = !tracked();
  if (tracked()) {
    b.className = 'daybtn' + (DAY ? ' on' : '');
    b.innerHTML = DAY ? `<b>Kończę pracę</b><small>W pracy od ${new Date(DAY.start).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}, śledzenie włączone</small>`
                      : `<b>Zaczynam dzień</b><small>Włącza udostępnianie lokalizacji przełożonemu (do 21:00)</small>`;
  }
  updTrackInfo(); renderStats();
}
$('daybtn').onclick = () => DAY ? endDay(false) : startDay();
function trackPos(pos) {
  if (!tracked() || !DAY || dayOver(DAY)) return; const c = pos.coords; if (c.accuracy > 150) return;
  const pt = { lat: +c.latitude.toFixed(6), lon: +c.longitude.toFixed(6), dokladnosc: Math.round(c.accuracy), czas: new Date(pos.timestamp || Date.now()).toISOString() };
  const dt = lastSent ? Date.now() - lastSent.t : Infinity, dd = lastSent ? dist(lastSent, pt) : Infinity;
  if (!(dt > 300000 || (dt > 45000 && dd > 40))) return;   // co 5 min albo po przejechaniu 40 m (nie częściej niż co 45 s)
  lastSent = { ...pt, t: Date.now() }; tq.push(pt); tqSave(); flushTrack();
}
async function flushTrack() {
  if (flushTrack.busy || !tq.length) return; flushTrack.busy = true;
  const batch = tq.splice(0, 100);
  try { const { error } = await sb.from('pozycje').insert(batch); if (error) throw error; }
  catch (e) { if (isNet(e)) tq = batch.concat(tq).slice(-500); }   // brak internetu: spróbujemy później (pozycje spoza dnia pracy baza odrzuca)
  tqSave();
  flushTrack.busy = false; updTrackInfo();
}
setInterval(flushTrack, 60000);
function updTrackInfo() {
  const el = $('trackinfo'); el.hidden = !tracked(); if (!tracked()) return;
  el.className = 'trk ' + (!DAY ? '' : gpsState === 'ok' ? 'on' : gpsState === 'off' ? 'off' : '');
  el.textContent = !DAY ? 'Śledzenie wyłączone – włącza się po „Zaczynam dzień”.'
    : gpsState === 'off' ? 'Lokalizacja wyłączona – przełożony nie widzi Twojej trasy. Włącz ją w ustawieniach przeglądarki.'
    : gpsState === 'ok' ? 'Udostępniasz lokalizację przełożonemu, gdy aplikacja jest otwarta' + (tq.length ? ' (czeka na wysłanie: ' + tq.length + ')' : '')
    : 'Czekam na sygnał GPS…';
}

// ---------- GPS ----------
function startGps(center) {
  if (!navigator.geolocation) { msg('Ten telefon nie udostępnia lokalizacji.'); return; }
  if (startGps.w == null) startGps.w = navigator.geolocation.watchPosition(pos => {
    const first = !me; me = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    lastPos = pos; if (gpsState !== 'ok') { gpsState = 'ok'; updTrackInfo(); } trackPos(pos);
    if (!meMarker) meMarker = L.marker([me.lat, me.lon], { icon: L.divIcon({ className: '', html: '<div class="medot"></div>', iconSize: [18, 18] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    else meMarker.setLatLng([me.lat, me.lon]);
    if (first && startGps.center) { map.setView([me.lat, me.lon], Math.max(map.getZoom(), 11)); startGps.center = false; }
  }, err => { if (err.code === 1) { gpsState = 'off'; updTrackInfo(); } if (startGps.center) msg('Brak dostępu do lokalizacji. Zezwól na nią w ustawieniach przeglądarki.', 4000); startGps.center = false; },
  { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  if (center) { if (me) map.setView([me.lat, me.lon], Math.max(map.getZoom(), 12)); else startGps.center = true; }
}
$('me').onclick = () => startGps(true);

// ---------- Lista najbliższych ----------
function fillList() {
  const ref = me || { lat: map.getCenter().lat, lon: map.getCenter().lng };
  const vis = P.filter(p => STAT[cat(p)] && STAT[cat(p)].on).map(p => [dist(ref, p), p]).sort((a, b) => a[0] - b[0]).slice(0, 40);
  $('listsub').textContent = (me ? 'Od Twojej pozycji' : 'Od środka mapy (włącz lokalizację, by liczyć od siebie)') + ', według filtrów';
  $('ul').innerHTML = vis.map(([d, p]) =>
    `<li data-id="${esc(p.id)}"><span class="dot" style="background:${STAT[cat(p)].color}"></span><div class="t"><div>${esc(title(p))}</div><small>${fmtDist(d)}${p.notatka ? ', ' + esc(p.notatka) : ''}</small></div><a class="go" href="${navUrl(p)}" target="_blank" rel="noopener">${ic('nav')}Jedź</a></li>`).join('') || '<li>Brak domów przy obecnych filtrach.</li>';
}
$('listbtn').onclick = () => { fillList(); $('list').classList.add('open'); close(); $('panel').classList.remove('open'); };
$('listclose').onclick = () => $('list').classList.remove('open');
$('ul').addEventListener('click', e => {
  if (e.target.closest('a')) return; const li = e.target.closest('li[data-id]'); if (!li) return;
  const p = byId[li.dataset.id]; if (!p) return; map.setView([p.lat, p.lon], Math.max(map.getZoom(), 13)); open(p);
});

// ---------- Śledzenie zespołu: lista osób, trasa dnia, wszyscy na mapie ----------
const PCOL = ['#2563eb', '#0d9488', '#7c3aed', '#ea580c', '#db2777', '#0891b2', '#65a30d', '#b45309'];
const pcolor = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0; return PCOL[Math.abs(h) % PCOL.length]; };
const initial = u => (fullName(u) || '?').trim().charAt(0).toUpperCase();
function ago(t) {
  const m = Math.round((Date.now() - new Date(t)) / 60000);
  return m < 1 ? 'przed chwilą' : m < 60 ? m + ' min temu' : m < 1440 ? Math.floor(m / 60) + ' godz. temu' : new Date(t).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
}
const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
let LAST = {};
async function loadLast() {
  const { data, error } = await sb.rpc('pv_ostatnie_pozycje'); if (error) throw error;
  LAST = Object.fromEntries((data || []).map(r => [r.user_id, r]));
}
function trackPeople() {   // kogo wolno śledzić: menedżer – swoich handlowców; admin – menedżerów i handlowców
  const all = Object.values(USERS);
  if (isAdmin()) return all.filter(u => u.rola === 'manager' || u.rola === 'handlowiec');
  return ME && ME.rola === 'manager' ? teamOf(ME.id) : [];
}
async function openTrack() {
  closeSheets(); if (!$('trackday').value) $('trackday').value = todayStr();
  $('trackbody').innerHTML = '<div class="empty">Wczytuję pozycje…</div>'; $('track').classList.add('open');
  try { await loadTeam(); await loadLast(); await loadDays(); } catch (e) { msg('Nie udało się pobrać pozycji: ' + (e.message || e), 5000); }
  fillTrack();
}
let DAYS = {};
async function loadDays() {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const { data, error } = await sb.from('dni_pracy').select('*').gte('start', t0.toISOString()).order('start'); if (error) throw error;
  DAYS = {}; for (const d of data) DAYS[d.user_id] = d;   // ostatni dzień danej osoby z dziś
}
function dayText(u) {
  const d = DAYS[u.id], hm = t => new Date(t).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  if (!d) return 'Dziś nie rozpoczął(a) pracy';
  if (!d.koniec && !dayOver(d)) return 'W pracy od ' + hm(d.start);
  return 'Pracował(a) ' + hm(d.start) + '–' + hm(d.koniec || end21(d.start)) + (d.auto ? ' (koniec automatyczny)' : '');
}
function fillTrack() {
  const row = (u, sub) => {
    const l = LAST[u.id], d = DAYS[u.id], working = d && !d.koniec && !dayOver(d);
    return `<div class="person${sub ? ' sub' : ''}"><div class="av" style="background:${pcolor(u.id)}">${esc(initial(u))}</div>` +
      `<div class="pi"><b>${esc(fullName(u))}</b><small class="${working ? 'live' : ''}">${esc(dayText(u))}</small>` +
      `<small>${l ? 'Ostatnia pozycja: ' + ago(l.czas) : 'Brak pozycji z ostatnich 7 dni'}</small></div>` +
      (l ? `<button data-a="where" data-u="${u.id}">Gdzie</button>` : '') + `<button class="pri" data-a="route" data-u="${u.id}">Trasa</button></div>`;
  };
  let h = '';
  if (isAdmin()) {
    const all = Object.values(USERS);
    for (const m of all.filter(u => u.rola === 'manager').sort(byName)) h += `<div class="day">Zespół: ${esc(fullName(m))}</div>` + row(m) + teamOf(m.id).map(u => row(u, 1)).join('');
    const loose = all.filter(u => u.rola === 'handlowiec' && !u.manager_id).sort(byName);
    if (loose.length) h += '<div class="day">Bez menedżera</div>' + loose.map(u => row(u)).join('');
  } else h += '<div class="day">Twoi handlowcy</div>' + (teamOf(ME.id).map(u => row(u)).join('') || '<div class="hint">Nie masz jeszcze przypisanych handlowców.</div>');
  $('trackbody').innerHTML = h || '<div class="empty">Nie ma jeszcze nikogo do śledzenia.</div>';
}
async function showRoute(userId, day) {
  const from = new Date(day + 'T00:00:00'), to = new Date(from); to.setDate(to.getDate() + 1);
  const { data, error } = await sb.from('pozycje').select('lat,lon,czas').eq('user_id', userId)
    .gte('czas', from.toISOString()).lt('czas', to.toISOString()).order('czas').limit(5000);
  if (error) { msg('Nie udało się pobrać trasy: ' + error.message, 5000); return; }
  closeSheets(); setAdd(false);
  tool = { mode: 'trasa', userId, day, pts: data || [] }; document.body.classList.add('tooling'); renderTool();
  if (tool.pts.length) map.fitBounds(L.latLngBounds(tool.pts.map(p => [p.lat, p.lon])), { padding: [40, 40], maxZoom: 14 });
}
async function showTeamMap(focusId) {
  try { await loadLast(); } catch (e) { msg('Nie udało się pobrać pozycji.', 4000); return; }
  closeSheets(); setAdd(false);
  if (!tool || tool.mode !== 'zespol') { tool = { mode: 'zespol' }; document.body.classList.add('tooling'); }
  renderTool();
  const ids = trackPeople().map(u => u.id).filter(id => LAST[id]);
  const pts = (focusId ? [focusId] : ids).filter(id => LAST[id]).map(id => [LAST[id].lat, LAST[id].lon]);
  if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 13)); else if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 14 });
  clearInterval(showTeamMap.t); showTeamMap.t = setInterval(async () => { if (!tool || tool.mode !== 'zespol') return clearInterval(showTeamMap.t); try { await loadLast(); renderTool(); } catch (e) {} }, 60000);
}
const tmark = (u, cls) => L.divIcon({ className: '', html: `<div class="tmark ${cls || ''}" style="background:${pcolor(u ? u.id : '')}">${esc(initial(u))}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
$('trackbtn').onclick = openTrack;
$('trackclose').onclick = () => $('track').classList.remove('open');
$('trackall').onclick = () => showTeamMap();
$('trackbody').addEventListener('click', e => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  if (b.dataset.a === 'route') showRoute(b.dataset.u, $('trackday').value || todayStr());
  if (b.dataset.a === 'where') showTeamMap(b.dataset.u);
});

// ---------- Kto nadał status: filtr osoby dla menedżera i administratora ----------
// WHO: '' – wszyscy, 'u:<id>' – jedna osoba, 't:<id menedżera>' – menedżer razem z jego handlowcami.
let WHO = '';
const autor = p => p.autor_statusu || p.zmienil;
const byName = (a, b) => fullName(a).localeCompare(fullName(b), 'pl');
const teamOf = id => Object.values(USERS).filter(u => u.rola === 'handlowiec' && u.manager_id === id).sort(byName);
function whoSet() {
  if (!WHO) return null; const [t, id] = WHO.split(':');
  return new Set(t === 'u' ? [id] : [id, ...teamOf(id).map(u => u.id)]);
}
const byWho = p => { const s = whoSet(); return !s || s.has(autor(p)) || (!!p.przypisany && s.has(p.przypisany)); };
const owner = p => p.przypisany || autor(p);   // kto prowadzi klienta
function whoSelect() {
  if (!ME || (ME.rola !== 'admin' && ME.rola !== 'manager')) return '';
  const opt = (v, l) => `<option value="${v}" ${WHO === v ? 'selected' : ''}>${esc(l)}</option>`;
  let o = opt('', 'Wszyscy');
  if (isAdmin()) {
    const all = Object.values(USERS);
    for (const m of all.filter(u => u.rola === 'manager').sort(byName))
      o += `<optgroup label="${esc(fullName(m))}">` + opt('t:' + m.id, 'Cały zespół: ' + fullName(m)) + opt('u:' + m.id, fullName(m) + ' (osobiście)') +
        teamOf(m.id).map(h => opt('u:' + h.id, fullName(h))).join('') + '</optgroup>';
    const loose = all.filter(u => u.rola === 'handlowiec' && !u.manager_id).sort(byName);
    if (loose.length) o += '<optgroup label="Bez menedżera">' + loose.map(h => opt('u:' + h.id, fullName(h))).join('') + '</optgroup>';
    o += '<optgroup label="Administratorzy">' + all.filter(u => u.rola === 'admin').sort(byName).map(a => opt('u:' + a.id, fullName(a))).join('') + '</optgroup>';
  } else {
    o += opt('u:' + ME.id, 'Ja') + teamOf(ME.id).map(h => opt('u:' + h.id, fullName(h))).join('');
  }
  return `<label for="whosel">Osoba</label><select id="whosel" data-who>${o}</select>`;
}
document.addEventListener('change', e => {
  if (!e.target.matches('select[data-who]')) return; WHO = e.target.value;
  if ($('deals').classList.contains('open')) fillDeals();
  if ($('grafik').classList.contains('open')) fillGrafik();
});
function closeSheets() {
  close(); closeTeam(); ['panel', 'list', 'deals', 'grafik', 'track'].forEach(id => $(id).classList.remove('open'));
}

// ---------- Sprzedaż: Wyniki zespołu, Leady zebrane, Spotkania umówione, Umowy ----------
let dealTab = 'lead';
const DEAL_LBL = { zespol: 'Zespół', lead: 'Leady', spotkanie: 'Spotkania', umowa: 'Umowy' };
function openDeals(k) {
  if (k === 'zespol' && !(ME && (ME.rola === 'admin' || ME.rola === 'manager'))) k = 'lead';
  dealTab = k; $('dealsq').value = ''; closeSheets(); fillDeals(); $('deals').classList.add('open');
}
// Wyniki: ile różnych domów dana osoba oznaczyła w okresie (z historii), plus skuteczność lejka.
let SCOREP = 'miesiac', SCORE = {};
const PERIODS = { tydzien: 'Ten tydzień', miesiac: 'Ten miesiąc', poprzedni: 'Poprzedni mies.', wszystko: 'Wszystko' };
function periodRange(k) {
  const now = new Date(), d = new Date(now); d.setHours(0, 0, 0, 0);
  if (k === 'tydzien') { d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [d, new Date(+now + 864e5)]; }
  if (k === 'miesiac') { d.setDate(1); return [d, new Date(+now + 864e5)]; }
  if (k === 'poprzedni') { const a = new Date(d.getFullYear(), d.getMonth() - 1, 1), b = new Date(d.getFullYear(), d.getMonth(), 1); return [a, b]; }
  return [new Date('2000-01-01'), new Date(+now + 864e5)];
}
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '–';
function scoreRow(id, label, cls) {
  const ids = id instanceof Set ? [...id] : [id];
  const n = k => ids.reduce((s, u) => s + ((SCORE[u] || {})[k] || 0), 0);
  const who = id instanceof Set ? cls.who : 'u:' + id, L = n('lead'), S = n('spotkanie'), U = n('umowa');
  const conv = L || S ? `<small class="conv">lead→spotk. ${pct(S, L)}, spotk.→umowa ${pct(U, S)}</small>` : '';
  return `<div class="srow ${cls.row || ''}"><button class="nm ${cls.sub ? 'sub' : ''}" data-who="${who}" data-k="lead">${esc(label)}${conv}</button>` +
    DEALS.map(k => { const v = n(k); return `<button class="pill ${v ? '' : 'z'}" style="--c:${STAT[k].color}" data-who="${who}" data-k="${k}" aria-label="${STAT[k].label}: ${v}">${v}</button>`; }).join('') + '</div>';
}
const scoreHead = '<div class="srow head"><span>Osoba</span><span>Leady</span><span>Spotk.</span><span>Umowy</span></div>';
async function fillScore() {
  const per = `<div class="seg per" id="scoreper">${Object.entries(PERIODS).map(([k, v]) => `<button data-per="${k}" class="${k === SCOREP ? 'on' : ''}">${v}</button>`).join('')}</div>`;
  const [od, doo] = periodRange(SCOREP);
  try {
    const { data, error } = await sb.rpc('pv_wyniki', { p_od: od.toISOString(), p_do: doo.toISOString() });
    if (error) throw error; SCORE = {};
    for (const r of data) (SCORE[r.user_id] = SCORE[r.user_id] || {})[r.status] = Number(r.n);
  } catch (e) { $('dealsul').innerHTML = `<li style="list-style:none">${per}<div class="empty">Wyniki są dostępne z internetem.</div></li>`; return; }
  if (dealTab !== 'zespol') return;
  let h = per;
  const card = (m, title, sub) => {
    const team = teamOf(m.id), ids = new Set([m.id, ...team.map(u => u.id)]);
    return `<div class="score"><div class="sh">${esc(title)}<small>${sub}</small></div>${scoreHead}` +
      scoreRow(ids, 'Razem', { row: 'tot', who: 't:' + m.id }) +
      scoreRow(m.id, m.id === ME.id ? 'Ja' : 'Osobiście', {}) +
      team.map(u => scoreRow(u.id, fullName(u), { sub: 1 })).join('') + '</div>';
  };
  if (isAdmin()) {
    const all = Object.values(USERS);
    for (const m of all.filter(u => u.rola === 'manager').sort(byName)) h += card(m, fullName(m), teamOf(m.id).length + ' handl.');
    const loose = all.filter(u => u.rola === 'handlowiec' && !u.manager_id).sort(byName);
    if (loose.length) h += `<div class="score"><div class="sh">Bez menedżera</div>${scoreHead}${loose.map(u => scoreRow(u.id, fullName(u), {})).join('')}</div>`;
    h += `<div class="score"><div class="sh">Administratorzy</div>${scoreHead}${all.filter(u => u.rola === 'admin').sort(byName).map(u => scoreRow(u.id, fullName(u), {})).join('')}</div>`;
  } else h += card(ME, 'Twój zespół', teamOf(ME.id).length + ' handl.');
  $('dealssub').textContent = 'Ile domów każdy oznaczył w okresie. Stuknij liczbę, by zobaczyć obecną listę tej osoby.';
  $('dealsul').innerHTML = `<li style="list-style:none">${h}</li>`;
}
function fillDeals() {
  const q = $('dealsq').value.trim().toLowerCase(), lead = ME && (ME.rola === 'admin' || ME.rola === 'manager');
  const tabs = (lead ? ['zespol'] : []).concat(DEALS);
  $('dealtabs').style.gridTemplateColumns = `repeat(${tabs.length},1fr)`;
  $('dealtabs').innerHTML = tabs.map(k => `<button data-k="${k}" class="${k === dealTab ? 'on' : ''}">${DEAL_LBL[k]}` +
    (k === 'zespol' ? '' : ` <b>${P.filter(p => p.status === k && byWho(p)).length}</b>`) + '</button>').join('');
  $('dealswho').innerHTML = dealTab === 'zespol' ? '' : whoSelect();
  $('dealsq').style.display = dealTab === 'zespol' ? 'none' : '';
  if (dealTab === 'zespol') { fillScore(); return; }
  let list = P.filter(p => p.status === dealTab && byWho(p));
  if (q) list = list.filter(p => [clientName(p), title(p), p.gmina, p.klient_telefon, p.produkt, p.notatka].join(' ').toLowerCase().includes(q));
  list.sort(dealTab === 'spotkanie'
    ? (a, b) => (a.termin ? 0 : 1) - (b.termin ? 0 : 1) || String(a.termin || '').localeCompare(String(b.termin || '')) || String(b.zmieniono).localeCompare(String(a.zmieniono))
    : (a, b) => String(b.zmieniono).localeCompare(String(a.zmieniono)));
  $('dealssub').textContent = STAT[dealTab].label + (dealTab === 'spotkanie' ? ': najbliższe terminy na górze' : ': najnowsze na górze');
  const c = STAT[dealTab].color;
  $('dealsul').innerHTML = list.map(p => {
    const info = [dealTab === 'umowa' && p.produkt ? 'Produkt: ' + p.produkt : '', dealTab === 'spotkanie' && p.termin ? 'Spotkanie: ' + fmtWhen(p.termin) : '', p.notatka || ''].filter(Boolean);
    return `<li class="deal" data-id="${esc(p.id)}">` +
      `<div class="d1"><span class="dot" style="background:${c}"></span><b>${esc(clientName(p) || 'Brak danych klienta')}</b><small>${esc(new Date(p.zmieniono).toLocaleDateString('pl-PL'))}</small></div>` +
      `<div class="d2">${esc(title(p))}${p.gmina ? ', gm. ' + esc(p.gmina) : ''}</div>` +
      (info.length ? `<div class="d3">${info.map(esc).join('<br>')}</div>` : '') +
      `<div class="d4"><small>${autor(p) ? 'Zebrał(a): ' + esc(uname(autor(p))) : ''}${p.przypisany && p.przypisany !== autor(p) ? '<br>Prowadzi: ' + esc(uname(p.przypisany)) : ''}</small>` +
      (p.klient_telefon ? `<a class="go call" href="tel:${esc(digits(p.klient_telefon))}">${ic('phone')}Zadzwoń</a>` : '') +
      `<a class="go" href="${navUrl(p)}" target="_blank" rel="noopener">${ic('nav')}Jedź</a></div></li>`;
  }).join('') || `<li class="empty">${q ? 'Nic nie pasuje do wyszukiwania.' : 'Nie ma jeszcze domów ze statusem „' + STAT[dealTab].label + '”. Pojawią się tu same, gdy ktoś nada ten status.'}</li>`;
}
document.querySelectorAll('[data-deals]').forEach(b => b.onclick = () => openDeals(b.dataset.deals));
$('dealtabs').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) { dealTab = b.dataset.k; fillDeals(); } });
$('dealsul').addEventListener('click', e => {
  const pb = e.target.closest('[data-per]'); if (pb) { e.stopPropagation(); SCOREP = pb.dataset.per; fillScore(); return; }
  const b = e.target.closest('button[data-who]'); if (!b) return; e.stopPropagation();
  WHO = b.dataset.who; dealTab = b.dataset.k; fillDeals(); $('dealsul').scrollTop = 0;
}, true);
$('dealsq').addEventListener('input', fillDeals);
$('dealsclose').onclick = () => $('deals').classList.remove('open');
$('dealscsv').onclick = () => {
  if (!isAdmin()) return;
  const rows = P.filter(p => DEALS.includes(p.status) && byWho(p)).sort((a, b) => String(b.zmieniono).localeCompare(String(a.zmieniono)));
  if (!rows.length) { msg('Nie ma czego eksportować przy obecnym filtrze.'); return; }
  const dt = t => { if (!t) return ''; const d = new Date(t); const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
  const mgr = id => { const u = USERS[id]; return u && u.rola === 'handlowiec' && u.manager_id ? fullName(USERS[u.manager_id]) : u && u.rola === 'manager' ? fullName(u) : ''; };
  const head = ['Status', 'Ostatnia zmiana', 'Imię', 'Nazwisko', 'Telefon', 'Produkt', 'Termin spotkania', 'Notatka', 'Adres', 'Miejscowość', 'Gmina', 'Powiat',
    'Zebrał(a)', 'Prowadzi', 'Menedżer', 'Szerokość', 'Długość', 'Mapa'];
  const data = rows.map(p => [STAT[p.status].label, dt(p.zmieniono), p.klient_imie, p.klient_nazwisko, p.klient_telefon, p.produkt, dt(p.termin), p.notatka,
    p.adres, p.miejscowosc, p.gmina, p.obszar, uname(autor(p)), p.przypisany ? uname(p.przypisany) : uname(autor(p)), mgr(owner(p)), p.lat, p.lon,
    `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`]);
  const cell = v => { const t = String(v ?? '').replace(/\r?\n/g, ' '); return /[";]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const csv = '\ufeff' + [head, ...data].map(r => r.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'sprzedaz_' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove();
  msg('Pobrano ' + rows.length + ' wierszy. Plik otworzysz w Excelu.', 4000);
};

// ---------- Grafik spotkań ----------
let grafPast = false;
const dayKey = d => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
function dayLabel(d) {
  const t = new Date(); t.setHours(0, 0, 0, 0); const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - t) / 864e5), long = x.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
  return diff === 0 ? 'Dziś, ' + long : diff === 1 ? 'Jutro, ' + long : diff === -1 ? 'Wczoraj, ' + long : long.charAt(0).toUpperCase() + long.slice(1);
}
function openGrafik() { closeSheets(); fillGrafik(); $('grafik').classList.add('open'); }
function fillGrafik() {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const all = P.filter(p => p.status === 'spotkanie' && byWho(p) && (!ME || ME.rola !== 'handlowiec' || owner(p) === ME.id));
  const noDate = all.filter(p => !p.termin);
  const list = all.filter(p => p.termin && (grafPast ? new Date(p.termin) < t0 : new Date(p.termin) >= t0))
    .sort((a, b) => (grafPast ? -1 : 1) * (new Date(a.termin) - new Date(b.termin)));
  $('grafikwho').innerHTML = whoSelect();
  document.querySelectorAll('#grafikseg button').forEach(b => b.classList.toggle('on', (b.dataset.p === '1') === grafPast));
  $('grafiksub').textContent = grafPast ? 'Spotkania, które już się odbyły' : 'Umówione spotkania od dziś';
  const lead = ME && ME.rola !== 'handlowiec';
  const slot = p => {
    const d = p.termin ? new Date(p.termin) : null;
    return `<li class="slot${grafPast ? ' past' : ''}" data-id="${esc(p.id)}"><div class="tm"><b>${d ? d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '–'}</b>` +
      `<small>${d ? d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }) : 'bez terminu'}</small></div><div class="bd"><b>${esc(clientName(p) || 'Klient')}</b>` +
      `<div>${esc(title(p))}${p.gmina ? ', gm. ' + esc(p.gmina) : ''}</div>` + (p.notatka ? `<div>${esc(p.notatka)}</div>` : '') +
      `<div class="d4"><small>${lead && owner(p) ? 'Prowadzi: ' + esc(uname(owner(p))) : ''}</small>` +
      (p.klient_telefon ? `<a class="go call" href="tel:${esc(digits(p.klient_telefon))}">${ic('phone')}Zadzwoń</a>` : '') +
      `<a class="go" href="${navUrl(p)}" target="_blank" rel="noopener">${ic('nav')}Jedź</a></div></div></li>`;
  };
  let h = '', last = '';
  for (const p of list) {
    const d = new Date(p.termin), k = dayKey(d);
    if (k !== last) { last = k; h += `<li class="day${k === dayKey(new Date()) ? ' today' : ''}">${esc(dayLabel(d))}</li>`; }
    h += slot(p);
  }
  if (!grafPast && noDate.length) h += '<li class="day">Bez terminu (dopisz go w karcie domu)</li>' + noDate.map(slot).join('');
  $('grafikul').innerHTML = h || `<li class="empty">${grafPast ? 'Brak minionych spotkań.' : 'Brak umówionych spotkań. Pojawią się tu same po nadaniu statusu „Spotkanie umówione”.'}</li>`;
}
$('grafikbtn').onclick = openGrafik;
$('grafikclose').onclick = () => $('grafik').classList.remove('open');
$('grafikseg').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) { grafPast = b.dataset.p === '1'; fillGrafik(); } });
$('grafikul').addEventListener('click', e => {
  if (e.target.closest('a')) return; const li = e.target.closest('li[data-id]'); if (!li) return;
  const p = byId[li.dataset.id]; if (!p) return;
  $('grafik').classList.remove('open'); map.setView([p.lat, p.lon], Math.max(map.getZoom(), 14)); open(p);
});
$('dealsul').addEventListener('click', e => {
  if (e.target.closest('a')) return; const li = e.target.closest('li[data-id]'); if (!li) return;
  const p = byId[li.dataset.id]; if (!p) return;
  $('deals').classList.remove('open'); map.setView([p.lat, p.lon], Math.max(map.getZoom(), 14)); open(p);
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
$('importbtn').onclick = () => { if (isAdmin()) $('file').click(); };
$('file').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file || !isAdmin()) return;
  try {
    const text = await file.text();
    const raw = file.name.toLowerCase().endsWith('.csv') ? parseCSV(text) : JSON.parse(text);
    const rows = raw.map(normalize).filter(Boolean);
    if (!rows.length) { msg('W pliku nie ma pinezek.'); return; }
    let added = 0; msg('Importuję ' + rows.length + ' pinezek…', 0);
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await sb.from('pins').upsert(rows.slice(i, i + 500), { onConflict: 'id', ignoreDuplicates: true }).select('id');
      if (error) throw error; added += (data || []).length;
    }
    $('panel').classList.remove('open');
    map.fitBounds(L.latLngBounds(rows.map(r => [r.lat, r.lon])), { padding: [30, 30] });
    await loadAll();
    msg('Gotowe: dodano ' + added + ' nowych pinezek (pominięto już istniejące).', 5000);
  } catch (err) { msg('Import nieudany: ' + (err.message || err), 6000); }
};

// ---------- Aktualizacja powiatu (nowa wersja modelu) ----------
$('updbtn').onclick = () => { if (isAdmin()) $('updfile').click(); };
$('updfile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file || !isAdmin()) return;
  try {
    const rows = JSON.parse(await file.text()).map(normalize).filter(Boolean);
    const areas = [...new Set(rows.map(r => r.obszar).filter(Boolean))];
    if (!rows.length || !areas.length) { msg('Plik nie wygląda na plik powiatu.'); return; }
    const ALL = await fetchAllPins(), byAll = Object.fromEntries(ALL.map(p => [p.id, p]));   // pełne dane, nie tylko widoczny obszar
    const touched = p => !!(p.status || p.pv || p.notatka || p.zrodlo === 'reczne' || p.ukryta_admin);
    const inArea = ALL.filter(p => areas.includes(p.obszar));
    const newIds = new Set(rows.map(r => r.id));
    const toDelete = inArea.filter(p => !touched(p) && !newIds.has(p.id)).map(p => p.id);
    // nie dodawaj nic obok miejsc już obsłużonych ani obok istniejących pinezek
    const keep = ALL.filter(p => !toDelete.includes(p.id));
    const near = (r, list, m) => list.some(p => dist(p, r) < m);
    const handled = keep.filter(touched);
    const toAdd = rows.filter(r => !byAll[r.id] && !near(r, handled, 30) && !near(r, keep, 15));
    msg(`Aktualizuję ${areas.join(', ')}: usuwam ${toDelete.length} nieruszonych, dodaję ${toAdd.length} nowych…`, 0);
    for (let i = 0; i < toDelete.length; i += 200) {
      const { error } = await sb.from('pins').delete().in('id', toDelete.slice(i, i + 200)); if (error) throw error;
    }
    for (let i = 0; i < toAdd.length; i += 500) {
      const { error } = await sb.from('pins').upsert(toAdd.slice(i, i + 500), { onConflict: 'id', ignoreDuplicates: true }); if (error) throw error;
    }
    await loadAll(); $('panel').classList.remove('open');
    msg(`Gotowe (${areas.join(', ')}): usunięto ${toDelete.length} starych nieruszonych, dodano ${toAdd.length} nowych. Twoje statusy, oceny i ukryte pinezki zostały bez zmian.`, 8000);
  } catch (err) { msg('Aktualizacja nieudana: ' + (err.message || err), 6000); }
};

// ---------- Eksport ocen (format bez zmian – korzysta z niego model) ----------
$('exportbtn').onclick = async () => {
  if (!isAdmin()) return;
  msg('Przygotowuję eksport…', 0);
  let ALL; try { ALL = await fetchAllPins(); } catch (e) { msg('Eksport wymaga internetu: ' + (e.message || e), 5000); return; }
  // ukryte przez administratora eksportujemy jak dawniej, ze statusem 'usun' (gdy nie mają innego statusu)
  const rows = ALL.filter(p => p.pv || p.status || p.zrodlo === 'reczne' || p.ukryta_admin).map(p => ({ id: p.id, lat: p.lat, lon: p.lon, zrodlo: p.zrodlo, pewnosc: p.pewnosc,
    wynik: p.wynik, obszar: p.obszar, status: p.status || (p.ukryta_admin ? 'usun' : null), pv: p.pv || (p.status === 'umowa' ? 'jest' : null), zmieniono: p.zmieniono }));
  const blob = new Blob([JSON.stringify(rows)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'pv_weryfikacja_' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove();
  msg('Wyeksportowano ' + rows.length + ' pinezek z Twoimi ocenami. Wyślij ten plik do Claude.', 5000);
};

// ---------- Logowanie i start ----------
$('reloadbtn').onclick = async () => { $('panel').classList.remove('open'); try { await loadTeam(); } catch (e) {} reload(); };
$('logoutbtn').onclick = async () => { await sb.auth.signOut(); location.reload(); };
$('loginform').addEventListener('submit', async e => {
  e.preventDefault(); $('loginerr').textContent = ''; $('loginbtn').disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pass').value });
  $('loginbtn').disabled = false;
  if (error) { $('loginerr').textContent = 'Nieprawidłowy e-mail lub hasło.'; return; }
  $('login').style.display = 'none'; start(true);
});
let started = false;
async function start(fresh) {
  if (started) return; started = true;
  try { await loadMe(); await loadTeam(); }
  catch (e) { msg('Nie udało się pobrać danych konta: ' + (e.message || e), 6000); }
  await reload(true);
  if (!ME || !ME.rola) msg('Twoje konto nie ma jeszcze przypisanej roli. Skontaktuj się z administratorem.', 6000);
  else if (!isAdmin()) {
    const mine = TER.filter(t => t.user_id === ME.id);
    if (!mine.length) msg('Nie masz jeszcze przydzielonego terenu. Poproś ' + (ME.rola === 'manager' ? 'administratora' : 'menedżera') + ' o przydział.', 6000);
    else if (fresh || !localStorage.getItem('pv_view')) fitTer(mine);
  } else if (!localStorage.getItem('pv_view') && P.length) {
    map.fitBounds(L.latLngBounds(P.map(p => [p.lat, p.lon])), { padding: [30, 30], animate: false });
    if (viewMode() && map.getZoom() < MINZ) map.setZoom(MINZ, { animate: false });
  }
  startGps(false);
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !started) return;
  try { await loadTeam(); } catch (e) {} reload(true);
});
(async () => {
  if (!cfg.url || cfg.url.startsWith('WSTAW')) { $('stats').textContent = 'Brak konfiguracji bazy (config.js).'; return; }
  const { data } = await sb.auth.getSession();
  if (data && data.session) start(); else $('login').style.display = 'flex';
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
