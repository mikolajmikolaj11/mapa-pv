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
  reczne:   { label: 'Dodane ręcznie',        color: '#9333ea', on: true },
  ponownie: { label: 'Odwiedzić ponownie',    color: '#f59e0b', on: true },
  potencjal:{ label: 'Potencjał',             color: '#db2777', on: true },
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
function cat(p) { if (p.status) return p.status; if (p.zrodlo === 'stare') return 'stare'; if (p.zrodlo === 'reczne') return 'reczne'; return p.pewnosc === 'pewne' ? 'nowe_p' : 'nowe_m'; }
function dist(a, b) { const R = 6371000, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
const fmtDist = m => m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km';

// ---------- Dane ----------
let P = [], byId = {}, cur = null, me = null, meMarker = null;
const R = L.canvas({ tolerance: 10 });
const layer = L.layerGroup().addTo(map);

// ---------- Konto, rola, zespół, tereny ----------
// ME – profil zalogowanego (rola: admin | manager | handlowiec), USERS – widoczne konta, TER – widoczne tereny.
// Uprawnienia pilnuje baza (RLS); tutaj tylko ukrywamy to, czego dana rola i tak nie może zrobić.
let ME = null, USERS = {}, TER = [];
const ROLE_LBL = { admin: 'Administrator', manager: 'Menedżer', handlowiec: 'Handlowiec' };
const isAdmin = () => !!ME && ME.rola === 'admin';
const uname = id => !id ? '' : ME && id === ME.id ? 'Ty' : (USERS[id] && (USERS[id].imie || USERS[id].email)) || 'inny użytkownik';
const fullName = u => u ? (u.imie || u.email || '') : '';

async function loadMe() {
  const { data: s } = await sb.auth.getSession(); const user = s && s.session && s.session.user;
  if (!user) throw new Error('brak sesji');
  const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw error;
  ME = data || { id: user.id, email: user.email, rola: null };
  document.body.classList.remove('role-admin', 'role-manager', 'role-handlowiec');
  if (ME.rola) document.body.classList.add('role-' + ME.rola);
  if (!isAdmin()) STAT.usun.on = false;
  $('who').innerHTML = `${esc(fullName(ME))}<span class="badge ${esc(ME.rola || '')}">${esc(ROLE_LBL[ME.rola] || 'brak roli')}</span>` +
    (ME.imie ? `<small>${esc(ME.email || '')}</small>` : '');
  $('teambtn').textContent = isAdmin() ? '👥 Zespół i tereny' : '👥 Moi handlowcy i tereny';
}
async function loadTeam() {
  const [u, t] = await Promise.all([sb.from('profiles').select('*'), sb.from('tereny').select('*').order('id')]);
  if (u.error) throw u.error; if (t.error) throw t.error;
  USERS = Object.fromEntries(u.data.map(x => [x.id, x])); TER = t.data;
  renderTer(); if ($('team').classList.contains('open')) fillTeam();
}

// Tereny rysujemy pod pinezkami, w osobnej warstwie, która nie przechwytuje stuknięć.
map.createPane('tereny'); map.getPane('tereny').style.zIndex = 350; map.getPane('tereny').style.pointerEvents = 'none';
const TR = L.svg({ pane: 'tereny' });
const terLayer = L.layerGroup().addTo(map), drawLayer = L.layerGroup().addTo(map);
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
    const pg = L.polygon(t.poly, { renderer: TR, pane: 'tereny', interactive: false, color: col, weight: mgr ? 4 : 3, dashArray: mgr ? '10 7' : null,
      fillColor: col, fillOpacity: mgr ? 0.04 : 0.1 }).addTo(terLayer);
    // etykieta: teren handlowca w środku, teren menedżera przy górnej krawędzi (żeby się nie nakładały)
    const b = pg.getBounds(), at = mgr ? [b.getNorth(), (b.getWest() + b.getEast()) / 2] : b.getCenter();
    L.tooltip({ permanent: true, direction: mgr ? 'top' : 'center', className: 'tlabel', interactive: false })
      .setLatLng(at).setContent(esc(uname(t.user_id) + (t.nazwa ? ' · ' + t.nazwa : ''))).addTo(terLayer);
  }
}
function fitTer(list) {
  const pts = list.flatMap(t => t.poly); if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
}
$('myterbtn').onclick = () => {
  $('panel').classList.remove('open'); const mine = TER.filter(t => ME && t.user_id === ME.id);
  if (mine.length) fitTer(mine); else msg('Nie masz jeszcze przydzielonego terenu.', 3500);
};

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
    const big = c === 'umowa' || c === 'ponownie' || c === 'potencjal';
    const m = L.circleMarker([p.lat, p.lon], { renderer: R, radius: big ? 10 : 8, color: '#fff', weight: 2, fillColor: STAT[c].color, fillOpacity: 1, bubblingMouseEvents: false });
    m.on('click', e => { L.DomEvent.stop(e); if (draw) { addVertex(e.latlng); return; } open(p); }); m.addTo(layer);
  }
  $('stats').innerHTML =
    `<span><span class="dot" style="background:${STAT.nowe_p.color}"></span>Do odwiedzenia <b>${cnt.nowe_p + cnt.nowe_m}</b></span>` +
    `<span><span class="dot" style="background:${STAT.ponownie.color}"></span>Ponownie <b>${cnt.ponownie}</b></span>` +
    `<span><span class="dot" style="background:${STAT.potencjal.color}"></span>Potencjał <b>${cnt.potencjal}</b></span>` +
    `<span><span class="dot" style="background:${STAT.umowa.color}"></span>Umowy <b>${cnt.umowa}</b></span>`;
  $('filters').innerHTML = '<h4 style="margin-top:6px">Pokaż</h4>' + Object.entries(STAT).filter(([k]) => k !== 'usun' || isAdmin()).map(([k, v]) =>
    `<label><input type="checkbox" data-k="${k}" ${v.on ? 'checked' : ''}><span class="dot" style="background:${v.color}"></span>${v.label}<span class="cnt">${cnt[k]}</span></label>`).join('');
  if ($('list').classList.contains('open')) fillList();
}
$('filters').addEventListener('change', e => {
  const k = e.target.dataset.k; if (!k) return; STAT[k].on = e.target.checked;
  try { localStorage.setItem('pv_filters', JSON.stringify(Object.fromEntries(Object.entries(STAT).map(([k, v]) => [k, v.on])))); } catch (_) {}
  render();
});
$('menubtn').onclick = () => $('panel').classList.toggle('open');
let addMode = false;
function setAdd(on) { addMode = on; $('addbtn').classList.toggle('on', on); $('addhint').style.display = on ? 'block' : 'none'; }
$('addbtn').onclick = () => { if (draw) return; close(); $('panel').classList.remove('open'); setAdd(!addMode); };
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
  const a = await reverseAddr(p.lat, p.lon); if (a) Object.assign(p, a);
  const { error } = await sb.from('pins').insert(p);
  if (error) {
    msg(/row-level security/i.test(error.message) ? 'Możesz dodawać domy tylko na swoim terenie.' : 'Nie udało się dodać pinezki: ' + error.message, 5000);
    return;
  }
  if (ME) p.zmienil = ME.id;
  P.push(p); byId[p.id] = p; render(); open(p); msg('Dodano dom z PV' + (p.adres ? ': ' + p.adres : ''));
}
map.on('click', e => {
  if (draw) { addVertex(e.latlng); return; }
  if (addMode) { addPin(e.latlng.lat, e.latlng.lng); return; }
  $('panel').classList.remove('open'); close();
});

// ---------- Rysowanie terenu (admin → menedżer, menedżer → jego handlowiec) ----------
let draw = null;
function startDraw(userId) {
  close(); closeTeam(); $('panel').classList.remove('open'); $('list').classList.remove('open'); setAdd(false);
  draw = { userId, pts: [] }; $('drawwho').textContent = fullName(USERS[userId]); $('drawname').value = '';
  $('drawbar').style.display = 'block'; drawUpd();
}
function drawUpd() {
  drawLayer.clearLayers(); if (!draw) return; const pts = draw.pts;
  if (pts.length >= 2) L.polygon(pts, { renderer: TR, pane: 'tereny', interactive: false, color: '#111827', weight: 3, dashArray: '6 6', fillColor: '#111827', fillOpacity: 0.12 }).addTo(drawLayer);
  pts.forEach(p => L.circleMarker(p, { renderer: TR, pane: 'tereny', interactive: false, radius: 6, color: '#fff', weight: 2, fillColor: '#111827', fillOpacity: 1 }).addTo(drawLayer));
  $('drawcnt').textContent = pts.length + ' pkt'; $('drawsave').disabled = pts.length < 3;
}
function addVertex(ll) { draw.pts.push([+ll.lat.toFixed(6), +ll.lng.toFixed(6)]); drawUpd(); }
function endDraw() { draw = null; drawLayer.clearLayers(); $('drawbar').style.display = 'none'; }
$('drawundo').onclick = () => { if (draw) { draw.pts.pop(); drawUpd(); } };
$('drawcancel').onclick = () => { endDraw(); openTeam(); };
$('drawsave').onclick = async () => {
  if (!draw || draw.pts.length < 3) return; $('drawsave').disabled = true;
  const { error } = await sb.from('tereny').insert({ user_id: draw.userId, nazwa: $('drawname').value.trim() || null, poly: draw.pts });
  if (error) { $('drawsave').disabled = false; msg('Nie zapisano terenu: ' + error.message, 5000); return; }
  endDraw(); msg('Teren zapisany');
  try { await loadTeam(); } catch (e) {}
  openTeam();
};

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
  if (!list.length) return '<div class="ter none">brak przydzielonego terenu</div>';
  return list.map(t => `<div class="ter"><span class="dot" style="background:${tcolor(t)}"></span><span class="tn">${esc(t.nazwa || 'Teren bez nazwy')}</span>` +
    `<button data-a="show" data-t="${t.id}">Pokaż</button>` + (canEdit ? `<button class="del" data-a="del" data-t="${t.id}">Usuń</button>` : '') + '</div>').join('');
}
function fillTeam() {
  const all = Object.values(USERS), byName = (a, b) => fullName(a).localeCompare(fullName(b), 'pl');
  const managers = all.filter(u => u.rola === 'manager').sort(byName);
  let h = '';
  if (isAdmin()) {
    $('teamtitle').textContent = 'Zespół i tereny';
    $('teamsub').textContent = 'Ty przydzielasz menedżerom handlowców i główny teren.';
    const roleSel = u => `<select data-f="rola" ${u.id === ME.id ? 'disabled' : ''}>` +
      Object.entries(ROLE_LBL).map(([k, v]) => `<option value="${k}" ${u.rola === k ? 'selected' : ''}>${v}</option>`).join('') + '</select>';
    const mgrSel = u => '<select data-f="manager_id"><option value="">— brak —</option>' +
      managers.map(m => `<option value="${m.id}" ${u.manager_id === m.id ? 'selected' : ''}>${esc(fullName(m))}</option>`).join('') + '</select>';
    const card = u => {
      const team = all.filter(x => x.rola === 'handlowiec' && x.manager_id === u.id).sort(byName).map(fullName);
      return `<div class="card" data-u="${u.id}">` +
        `<input class="nm" data-f="imie" value="${esc(u.imie || '')}" placeholder="Wpisz imię i nazwisko">` +
        `<small>${esc(u.email || '')}</small>` +
        `<div class="cr"><span>Rola: ${roleSel(u)}</span>` + (u.rola === 'handlowiec' ? `<span>Menedżer: ${mgrSel(u)}</span>` : '') + '</div>' +
        (u.rola === 'manager' ? `<small>Handlowcy: ${team.length ? esc(team.join(', ')) : 'brak – przypisz ich w kartach handlowców poniżej'}</small>` : '') +
        (u.rola === 'handlowiec' && !u.manager_id ? '<small style="color:#dc2626">Bez menedżera handlowiec nic nie widzi.</small>' : '') +
        (u.rola !== 'admin' ? terList(u.id, true) + `<button class="drawb" data-a="draw">✏️ Narysuj ${TER.some(t => t.user_id === u.id) ? 'kolejny ' : ''}teren</button>` : '') +
        '</div>';
    };
    h += '<div class="hint">Nowe konto dodajesz w Supabase → Authentication → Add user. Pojawi się tutaj jako handlowiec bez menedżera – ustaw mu rolę i menedżera.</div>';
    h += '<h4>Menedżerowie</h4>' + (managers.map(card).join('') || '<div class="hint">Brak menedżerów.</div>');
    h += '<h4>Handlowcy</h4>' + (all.filter(u => u.rola === 'handlowiec').sort(byName).map(card).join('') || '<div class="hint">Brak handlowców.</div>');
    h += '<h4>Administratorzy</h4>' + all.filter(u => u.rola === 'admin').sort(byName).map(card).join('');
  } else {
    $('teamtitle').textContent = 'Moi handlowcy i tereny';
    $('teamsub').textContent = 'Przydzielasz swoim handlowcom konkretne tereny.';
    h += `<h4>Twój teren</h4><div class="card"><div class="nmt">${esc(fullName(ME))}</div><small>przydziela administrator</small>${terList(ME.id, false)}</div>`;
    const mine = all.filter(u => u.rola === 'handlowiec' && u.manager_id === ME.id).sort(byName);
    h += '<h4>Twoi handlowcy</h4>';
    h += mine.map(u => `<div class="card" data-u="${u.id}"><div class="nmt">${esc(fullName(u))}</div><small>${esc(u.email || '')}</small>` +
      terList(u.id, true) + `<button class="drawb" data-a="draw">✏️ Narysuj ${TER.some(t => t.user_id === u.id) ? 'kolejny ' : ''}teren</button></div>`).join('') ||
      '<div class="hint">Administrator nie przydzielił Ci jeszcze handlowców.</div>';
    h += '<div class="hint">Handlowiec widzi tylko domy, które leżą jednocześnie w jego terenie i w Twoim terenie.</div>';
  }
  $('teambody').innerHTML = h;
}
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
  const f = e.target.dataset.f, card = e.target.closest('[data-u]'); if (!f || !card || !isAdmin()) return;
  const v = e.target.value.trim(); setProfile(card.dataset.u, { [f]: v || null });
});
$('teambody').addEventListener('click', async e => {
  const b = e.target.closest('button[data-a]'); if (!b) return; const a = b.dataset.a;
  if (a === 'draw') { startDraw(b.closest('[data-u]').dataset.u); return; }
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
function open(p) {
  cur = p;
  $('t').textContent = title(p);
  const src = p.zrodlo === 'stare' ? 'Twoja wcześniejsza pinezka' : p.zrodlo === 'reczne' ? 'Dodane ręcznie' : ('Wykryte automatycznie' + (p.pewnosc ? ' – ' + p.pewnosc : ''));
  $('sub').textContent = src + (p.gmina ? ' · gm. ' + p.gmina : '') + (me ? ' · ' + fmtDist(dist(me, p)) + ' stąd' : '');
  $('nav').href = navUrl(p);
  $('gm').href = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
  document.querySelectorAll('.st').forEach(b => b.classList.toggle('on', b.dataset.s === p.status));
  document.querySelectorAll('.pvb').forEach(b => b.classList.toggle('on', b.dataset.v === p.pv));
  $('note').value = p.notatka || '';
  $('saved').textContent = p.status || p.notatka || p.pv ? 'Zmieniono: ' + new Date(p.zmieniono).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) +
    (p.zmienil ? ' · ' + uname(p.zmienil) : '') : '';
  $('sheet').classList.add('open'); $('panel').classList.remove('open'); $('list').classList.remove('open');
}
function close() { $('sheet').classList.remove('open'); cur = null; }
$('close').onclick = close;

let busy = false;
async function save(p, patch) {
  if (busy) { msg('Chwila, zapisuję…'); return false; }
  busy = true; const prev = { status: p.status, notatka: p.notatka, pv: p.pv, zmieniono: p.zmieniono, zmienil: p.zmienil };
  Object.assign(p, patch, { zmieniono: new Date().toISOString(), zmienil: ME ? ME.id : p.zmienil }); render(); if (cur === p) open(p);
  try {
    const { data, error } = await sb.from('pins').update({ status: p.status, notatka: p.notatka, pv: p.pv || null, zmieniono: p.zmieniono }).eq('id', p.id).select('id');
    if (error) throw error;
    if (!data || !data.length) throw new Error('brak uprawnień');
    return true;
  } catch (e) {
    Object.assign(p, prev); render(); if (cur === p) open(p);
    msg(/uprawnie|row-level/i.test(e.message || '') ? 'Brak uprawnień do tej zmiany.' : 'Nie zapisano – sprawdź internet i spróbuj ponownie.', 4000); return false;
  } finally { busy = false; }
}
document.querySelectorAll('.st').forEach(b => b.onclick = async () => {
  if (!cur) return; if (b.dataset.s === 'usun' && !isAdmin()) return;
  const p = cur; const s = p.status === b.dataset.s ? null : b.dataset.s;
  const patch = { status: s, notatka: $('note').value.trim() || null };
  if (s === 'umowa' && !p.pv) patch.pv = 'jest';
  if (!(await save(p, patch))) return;
  if (s === 'usun') { close(); msg('Pinezka usunięta. Przywrócisz ją w Menu → Usunięte.', 3500); }
  else msg(s ? 'Zapisano: ' + STAT[s].label : 'Status wyczyszczony');
});
document.querySelectorAll('.pvb').forEach(b => b.onclick = async () => {
  if (!cur) return; const p = cur; const v = p.pv === b.dataset.v ? null : b.dataset.v;
  if (await save(p, { pv: v })) msg(v === 'jest' ? 'Zapisano: jest PV' : v === 'nie' ? 'Zapisano: nie ma PV' : 'Wyczyszczono informację o PV');
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
$('importbtn').onclick = () => { if (isAdmin()) $('file').click(); };
$('file').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file || !isAdmin()) return;
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

// ---------- Aktualizacja powiatu (nowa wersja modelu) ----------
$('updbtn').onclick = () => { if (isAdmin()) $('updfile').click(); };
$('updfile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file || !isAdmin()) return;
  try {
    const rows = JSON.parse(await file.text()).map(normalize).filter(Boolean);
    const areas = [...new Set(rows.map(r => r.obszar).filter(Boolean))];
    if (!rows.length || !areas.length) { msg('Plik nie wygląda na plik powiatu.'); return; }
    await loadAll();
    const touched = p => !!(p.status || p.pv || p.notatka || p.zrodlo === 'reczne');
    const inArea = P.filter(p => areas.includes(p.obszar));
    const newIds = new Set(rows.map(r => r.id));
    const toDelete = inArea.filter(p => !touched(p) && !newIds.has(p.id)).map(p => p.id);
    // nie dodawaj nic obok miejsc już obsłużonych ani obok istniejących pinezek
    const keep = P.filter(p => !toDelete.includes(p.id));
    const near = (r, list, m) => list.some(p => dist(p, r) < m);
    const handled = keep.filter(touched);
    const toAdd = rows.filter(r => !byId[r.id] && !near(r, handled, 30) && !near(r, keep, 15));
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

// ---------- Logowanie ----------
$('exportbtn').onclick = () => {
  if (!isAdmin()) return;
  const rows = P.filter(p => p.pv || p.status || p.zrodlo === 'reczne').map(p => ({ id: p.id, lat: p.lat, lon: p.lon, zrodlo: p.zrodlo, pewnosc: p.pewnosc,
    wynik: p.wynik, obszar: p.obszar, status: p.status, pv: p.pv || (p.status === 'umowa' ? 'jest' : null), zmieniono: p.zmieniono }));
  const blob = new Blob([JSON.stringify(rows)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'pv_weryfikacja_' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove();
  msg('Wyeksportowano ' + rows.length + ' pinezek z Twoimi ocenami. Wyślij ten plik do Claude.', 5000);
};
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
  if (!ME || !ME.rola) msg('Twoje konto nie ma jeszcze przypisanej roli – skontaktuj się z administratorem.', 6000);
  else if (!isAdmin()) {
    const mine = TER.filter(t => t.user_id === ME.id);
    if (!mine.length) msg('Nie masz jeszcze przydzielonego terenu – poproś ' + (ME.rola === 'manager' ? 'administratora' : 'menedżera') + ' o przydział.', 6000);
    else if (fresh || !localStorage.getItem('pv_view')) fitTer(mine);
  } else if (!localStorage.getItem('pv_view') && P.length) map.fitBounds(L.latLngBounds(P.map(p => [p.lat, p.lon])), { padding: [30, 30] });
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
