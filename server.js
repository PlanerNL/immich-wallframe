import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import ical from 'node-ical';

const env = process.env;
const list = (s, sep = ',') => (Array.isArray(s) ? s : String(s ?? '').split(sep)).map(x => String(x).trim()).filter(Boolean);

// CALENDARS="Gezin|#e8a33d|https://...ics;Werk|#6fb3d2|https://...ics"
function parseCalendars(s) {
  return list(s, ';').map((entry, i) => {
    const parts = entry.split('|');
    const url = parts.pop();
    parts.forEach((x, j) => (parts[j] = x.replace(/\\/g, '').trim()));
    return { name: parts[0] || `Agenda ${i + 1}`, color: parts[1] || '', url };
  });
}

// ---------- fonts that can be chosen per block (Google Fonts spec, or null for a local font) ----------
const FONTS = {
  'Bricolage Grotesque': 'Bricolage+Grotesque:opsz,wght@12..96,300..700',
  'Figtree': 'Figtree:wght@300..700',
  'Inter': 'Inter:wght@300..700',
  'Roboto': 'Roboto:wght@300;400;500;700',
  'Open Sans': 'Open+Sans:wght@300..700',
  'Lato': 'Lato:wght@300;400;700',
  'Montserrat': 'Montserrat:wght@300..700',
  'Poppins': 'Poppins:wght@300;400;500;600;700',
  'Nunito': 'Nunito:wght@300..700',
  'Outfit': 'Outfit:wght@300..700',
  'Manrope': 'Manrope:wght@300..700',
  'Space Grotesk': 'Space+Grotesk:wght@300..700',
  'Quicksand': 'Quicksand:wght@300..700',
  'Comfortaa': 'Comfortaa:wght@300..700',
  'Raleway': 'Raleway:wght@300..700',
  'Oswald': 'Oswald:wght@300..700',
  'Bebas Neue': 'Bebas+Neue',
  'Playfair Display': 'Playfair+Display:wght@400..700',
  'Fraunces': 'Fraunces:opsz,wght@9..144,300..700',
  'Lora': 'Lora:wght@400..700',
  'Merriweather': 'Merriweather:wght@300;400;700',
  'DM Serif Display': 'DM+Serif+Display',
  'Caveat': 'Caveat:wght@400..700',
  'JetBrains Mono': 'JetBrains+Mono:wght@300..700',
  'Systeemlettertype': null,
  'Georgia': null,
};
const FONT_BLOCKS = { fontClock: 'clock', fontDate: 'date', fontWeather: 'weather', fontForecast: 'forecast',
                      fontAgendaDays: 'agendaDays', fontAgenda: 'agenda', fontCaption: 'caption' };
const fontCss = name => name === 'Systeemlettertype' ? 'system-ui, sans-serif'
  : name === 'Georgia' ? 'Georgia, serif' : `'${name}', system-ui, sans-serif`;
const fontUrl = names => {
  const specs = [...new Set(names)].map(n => FONTS[n]).filter(Boolean);
  return specs.length ? `https://fonts.googleapis.com/css2?${specs.map(f => `family=${f}`).join('&')}&display=swap` : '';
};

// ---------- settings: defaults < environment < settings.json (admin page) ----------
const FIELDS = {
  immichUrl:       { env: 'IMMICH_URL', type: 'url', def: '' },
  immichKey:       { env: 'IMMICH_API_KEY', type: 'secret', def: '' },
  albumIds:        { env: 'IMMICH_ALBUM_IDS', type: 'list', def: [] },
  favoritesOnly:   { env: 'IMMICH_FAVORITES_ONLY', type: 'bool', def: false },
  imageSize:       { env: 'IMMICH_IMAGE_SIZE', type: 'enum', options: ['preview', 'fullsize'], def: 'preview' },
  photoInterval:   { env: 'PHOTO_INTERVAL', type: 'int', min: 5, max: 3600, def: 45 },
  progressBar:     { env: 'PROGRESS_BAR', type: 'bool', def: true },
  calendars:       { env: 'CALENDARS', type: 'calendars', def: [] },
  calendarDays:    { env: 'CALENDAR_DAYS', type: 'int', min: 1, max: 60, def: 10 },
  calendarRefresh: { env: 'CALENDAR_REFRESH', type: 'int', min: 1, max: 1440, def: 5 },
  lat:             { env: 'LATITUDE', type: 'number', min: -90, max: 90, def: 52.37 },
  lon:             { env: 'LONGITUDE', type: 'number', min: -180, max: 180, def: 4.90 },
  locale:          { env: 'LOCALE', type: 'locale', def: 'nl-NL' },
  nightStart:      { env: 'NIGHT_START', type: 'time', def: '' },
  nightEnd:        { env: 'NIGHT_END', type: 'time', def: '' },
  nightMode:       { env: 'NIGHT_MODE', type: 'enum', options: ['black', 'clock'], def: 'black' },
  wakeMinutes:     { env: 'NIGHT_WAKE_MINUTES', type: 'int', min: 1, max: 120, def: 2 },
  forecastDays:    { env: 'FORECAST_DAYS', type: 'int', min: 1, max: 14, def: 5 },
  showEmptyDays:   { env: 'SHOW_EMPTY_DAYS', type: 'bool', def: false },
  adminButton:     { env: 'ADMIN_BUTTON', type: 'bool', def: true },
  fontClock:       { env: 'FONT_CLOCK', type: 'font', def: '' },
  fontDate:        { env: 'FONT_DATE', type: 'font', def: '' },
  fontWeather:     { env: 'FONT_WEATHER', type: 'font', def: '' },
  fontForecast:    { env: 'FONT_FORECAST', type: 'font', def: '' },
  fontAgendaDays:  { env: 'FONT_AGENDA_DAYS', type: 'font', def: '' },
  fontAgenda:      { env: 'FONT_AGENDA', type: 'font', def: '' },
  fontCaption:     { env: 'FONT_CAPTION', type: 'font', def: '' },
  sizeClock:      { env: 'SIZE_CLOCK', type: 'int', min: 50, max: 250, def: 100 },
  sizeDate:       { env: 'SIZE_DATE', type: 'int', min: 50, max: 250, def: 100 },
  sizeWeather:    { env: 'SIZE_WEATHER', type: 'int', min: 50, max: 250, def: 100 },
  sizeForecast:   { env: 'SIZE_FORECAST', type: 'int', min: 50, max: 250, def: 100 },
  sizeAgendaDays: { env: 'SIZE_AGENDA_DAYS', type: 'int', min: 50, max: 250, def: 100 },
  sizeAgenda:     { env: 'SIZE_AGENDA', type: 'int', min: 50, max: 250, def: 100 },
  sizeCaption:    { env: 'SIZE_CAPTION', type: 'int', min: 50, max: 250, def: 100 },
  wastePostcode:   { env: 'WASTE_POSTCODE', type: 'postcode', def: '' },
  wasteHouseNumber:{ env: 'WASTE_HOUSE_NUMBER', type: 'housenr', def: '' },
  wasteHouseLetter:{ env: 'WASTE_HOUSE_LETTER', type: 'short', def: '' },
  wasteShowNext:   { env: 'WASTE_SHOW_NEXT', type: 'bool', def: true },
  wasteBannerFrom: { env: 'WASTE_BANNER_FROM', type: 'time', def: '17:00' },
  wasteInAgenda:   { env: 'WASTE_IN_AGENDA', type: 'bool', def: true },
  placeNamesOsm:   { env: 'PLACE_NAMES_OSM', type: 'bool', def: true },
  captionFields:   { env: 'CAPTION', type: 'multi', options: ['date', 'time', 'ago', 'place', 'album', 'people', 'camera'],
                     def: ['date', 'time', 'ago', 'place', 'album'] },
};

// turns input (from env text or the admin form) into a clean value, or throws a readable error
function normalize(key, v) {
  const f = FIELDS[key];
  switch (f.type) {
    case 'url': case 'secret': {
      const t = String(v ?? '').trim();
      if (f.type === 'url' && t && !/^https?:\/\/[^\s]+$/i.test(t)) throw new Error('moet beginnen met http:// of https://');
      return f.type === 'url' ? t.replace(/\/+$/, '') : t;
    }
    case 'list': return list(v);
    case 'font': {
      const t = String(v ?? '').trim();
      if (t && !(t in FONTS)) throw new Error('onbekend lettertype');
      return t;
    }
    case 'postcode': {
      const t = String(v ?? '').replace(/\s+/g, '').toUpperCase();
      if (t && !/^\d{4}[A-Z]{2}$/.test(t)) throw new Error('postcode als 1234AB');
      return t;
    }
    case 'housenr': {
      const t = String(v ?? '').trim();
      if (t && !/^\d{1,5}$/.test(t)) throw new Error('alleen cijfers; letter apart invullen');
      return t;
    }
    case 'short': return String(v ?? '').trim().slice(0, 6);
    case 'multi': {
      const vals = list(v);
      const bad = vals.filter(x => !f.options.includes(x));
      if (bad.length) throw new Error(`onbekend: ${bad.join(', ')}`);
      return f.options.filter(o => vals.includes(o));   // keep a fixed order
    }
    case 'bool': return v === true || v === 'true' || v === 'on' || v === '1';
    case 'enum': { const t = String(v ?? f.def); if (!f.options.includes(t)) throw new Error(`kies uit: ${f.options.join(', ')}`); return t; }
    case 'int': case 'number': {
      const n = Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n) || n < f.min || n > f.max) throw new Error(`getal tussen ${f.min} en ${f.max}`);
      return f.type === 'int' ? Math.round(n) : n;
    }
    case 'time': {
      const t = String(v ?? '').trim();
      if (t && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error('gebruik UU:MM, bijv. 23:00');
      return t;
    }
    case 'locale': { const t = String(v ?? '').trim() || f.def; try { new Intl.DateTimeFormat(t); } catch { throw new Error('onbekende taalcode'); } return t; }
    case 'calendars': {
      const arr = typeof v === 'string' ? parseCalendars(v) : Array.isArray(v) ? v : [];
      return arr.filter(c => c && String(c.url || '').trim()).map((c, i) => {
        const url = String(c.url).trim().replace(/^webcals?:\/\//i, 'https://');
        if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(`agenda ${i + 1}: ongeldige URL`);
        const color = String(c.color || '').trim();
        if (color && !/^#[0-9a-f]{3,8}$/i.test(color)) throw new Error(`agenda ${i + 1}: kleur als #rrggbb`);
        return { name: String(c.name || '').trim() || `Agenda ${i + 1}`, color, url };
      });
    }
  }
}

const SETTINGS_FILE = env.SETTINGS_FILE || new URL('./data/settings.json', import.meta.url).pathname;
let saved = {};
try { saved = JSON.parse(await readFile(SETTINGS_FILE, 'utf8')); } catch {}

const cfg = { port: Number(env.PORT) || 3000 };
const source = {};
function buildConfig() {
  for (const [key, f] of Object.entries(FIELDS)) {
    let value = f.def, from = 'standaard';
    if (env[f.env] !== undefined && env[f.env] !== '') {
      try { value = normalize(key, env[f.env]); from = 'omgeving'; } catch (e) { console.error(`${f.env}: ${e.message}`); }
    }
    if (key in saved) { try { value = normalize(key, saved[key]); from = 'beheerpagina'; } catch {} }
    cfg[key] = value; source[key] = from;
  }
  cfg.version = createHash('sha1').update(JSON.stringify(cfg)).digest('hex').slice(0, 10);
}
buildConfig();

async function saveSettings(input) {
  const next = { ...saved }, errors = {};
  for (const key of Object.keys(FIELDS)) {
    if (!(key in input)) continue;
    if (FIELDS[key].type === 'secret' && input[key] === '') continue;   // empty = keep current key
    try { next[key] = normalize(key, input[key]); } catch (e) { errors[key] = e.message; }
  }
  for (const key of input.reset || []) delete next[key];             // back to environment/default
  if (Object.keys(errors).length) return { errors };
  await mkdir(new URL('.', 'file://' + SETTINGS_FILE).pathname, { recursive: true });
  await writeFile(SETTINGS_FILE + '.tmp', JSON.stringify(next, null, 2));
  await rename(SETTINGS_FILE + '.tmp', SETTINGS_FILE);
  saved = next;
  buildConfig();
  cache.clear();
  return { ok: true };
}

// ---------- admin login ----------
const ADMIN_PASSWORD = env.ADMIN_PASSWORD || '';
const sessions = new Map(); // token -> expiry
const SESSION_MS = 7 * 24 * 3600e3;
const sha = s => createHash('sha256').update(String(s)).digest();
const passwordOk = p => ADMIN_PASSWORD && timingSafeEqual(sha(p), sha(ADMIN_PASSWORD));
function sessionOf(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)wf_session=([a-f0-9]{64})/);
  const exp = m && sessions.get(m[1]);
  return exp && exp > Date.now() ? m[1] : null;
}
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 256e3) throw new Error('Te groot'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
function adminView() {
  const out = {};
  for (const key of Object.keys(FIELDS)) out[key] = FIELDS[key].type === 'secret' ? '' : cfg[key];
  return { values: out, hasKey: !!cfg.immichKey, source,
    fonts: Object.keys(FONTS).map(n => ({ name: n, css: fontCss(n) })), fontUrl: fontUrl(Object.keys(FONTS)), fields: Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, { env: f.env, type: f.type, options: f.options, min: f.min, max: f.max }])) };
}

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  try {
    const v = await fn();
    cache.set(key, { t: Date.now(), v });
    return v;
  } catch (err) {
    if (hit) return hit.v; // serve stale data rather than nothing
    throw err;
  }
}

// ---------- Immich ----------
async function immich(path, opts = {}) {
  if (!cfg.immichUrl || !cfg.immichKey) throw new Error('IMMICH_URL of IMMICH_API_KEY ontbreekt');
  const r = await fetch(cfg.immichUrl + path, {
    ...opts,
    headers: { 'x-api-key': cfg.immichKey, 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`Immich ${path}: HTTP ${r.status}`);
  return r;
}

// ---------- place names in the display language ----------
// Immich stores city/province/country in English. We ask OpenStreetMap (Nominatim) for the names in the
// display language, using the photo's GPS position; if that isn't possible we at least translate the country.
const NOMINATIM = env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/reverse';
const placeCache = new Map();          // "lat,lon,lang" -> place string
let lastNominatim = 0;

const enCountryToCode = (() => {
  const en = new Intl.DisplayNames(['en'], { type: 'region' }), map = new Map();
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    try { const name = en.of(code); if (name && name !== code) map.set(name.toLowerCase(), code); } catch {}
  }
  map.set('the netherlands', 'NL'); map.set('united states of america', 'US'); map.set('czech republic', 'CZ');
  return map;
})();
function translateCountry(name, lang) {
  const code = name && enCountryToCode.get(String(name).toLowerCase());
  if (!code) return name;
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || name; } catch { return name; }
}
const joinPlace = (city, state, country) => [city, state && state !== city ? state : null, country].filter(Boolean).join(', ');

async function placeName(ex) {
  const lang = cfg.locale.slice(0, 2);
  const fallback = joinPlace(ex.city, ex.state, translateCountry(ex.country, lang));
  const lat = Number(ex.latitude), lon = Number(ex.longitude);
  if (!cfg.placeNamesOsm || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return fallback;
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${lang}`;
  if (placeCache.has(key)) return placeCache.get(key);
  // Nominatim allows at most one request per second; don't hold up the photo for long
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 2500) return fallback;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastNominatim = Date.now();
  try {
    const q = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lon), zoom: '10', 'accept-language': lang });
    const r = await fetch(`${NOMINATIM}?${q}`, {
      headers: { 'user-agent': 'immich-wallframe/1.0 (self-hosted photo frame)' }, signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const a = (await r.json()).address || {};
    const city = a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || ex.city;
    const place = joinPlace(city, a.state || a.province || a.region, a.country) || fallback;
    if (placeCache.size > 5000) placeCache.delete(placeCache.keys().next().value);
    placeCache.set(key, place);
    return place;
  } catch (e) {
    console.error('Plaatsnaam:', e.message);
    return fallback;
  }
}

function cameraName(make, model) {
  make = String(make || '').trim(); model = String(model || '').trim();
  if (!model) return make;
  return make && !model.toLowerCase().startsWith(make.split(' ')[0].toLowerCase()) ? `${make} ${model}` : model;
}

async function nextPhoto() {
  const body = { size: 1, type: 'IMAGE', withExif: true };
  if (cfg.albumIds.length) body.albumIds = [cfg.albumIds[Math.floor(Math.random() * cfg.albumIds.length)]];
  if (cfg.favoritesOnly) body.isFavorite = true;
  const [a] = await (await immich('/api/search/random', { method: 'POST', body: JSON.stringify(body) })).json();
  if (!a) throw new Error('Geen foto gevonden met deze filters');
  const ex = a.exifInfo || {};
  const want = new Set(cfg.captionFields);

  // albums and people need extra permissions (album.read / person.read); skip quietly if missing
  const [albums, detail] = await Promise.allSettled([
    want.has('album') ? immich(`/api/albums?assetId=${a.id}`).then(r => r.json()) : [],
    want.has('people') && !a.people ? immich(`/api/assets/${a.id}`).then(r => r.json()) : a,
  ]);
  const people = (detail.status === 'fulfilled' ? detail.value.people || [] : [])
    .map(p => p.name).filter(Boolean);

  return {
    id: a.id,
    // localDateTime is the wall-clock time where the photo was taken, stored as if it were UTC
    local: a.localDateTime || ex.dateTimeOriginal || a.fileCreatedAt,
    taken: ex.dateTimeOriginal || a.fileCreatedAt,
    place: want.has('place') ? await placeName(ex) : '',
    albums: albums.status === 'fulfilled' ? albums.value.map(x => x.albumName).filter(Boolean) : [],
    people: [...new Set(people)],
    camera: cameraName(ex.make, ex.model),
    show: cfg.captionFields,
  };
}

// ---------- Waste pickups (Twente Milieu, same service as their app and Home Assistant) ----------
const TM_API = env.TWENTE_MILIEU_API || 'https://twentemilieuapi.ximmio.com/api/';
const TM_COMPANY = '8d97bb56-5afd-4cbc-a651-b4f7314264b4';
const WASTE_TYPES = {
  0:  { key: 'rest',    label: 'Restafval', color: '#8e979f' },
  1:  { key: 'gft',     label: 'GFT',       color: '#5fb760' },
  2:  { key: 'papier',  label: 'Papier',    color: '#3d8fd6' },
  6:  { key: 'boom',    label: 'Kerstboom', color: '#2f8a57' },
  10: { key: 'plastic', label: 'Plastic',   color: '#f08a24' },
  56: { key: 'plastic', label: 'Plastic',   color: '#f08a24' },
};
let tmAddress = { key: '', id: null };

async function tmPost(uri, data) {
  const r = await fetch(TM_API + uri, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/plain, */*' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Twente Milieu: HTTP ${r.status}`);
  return r.json();
}

async function waste() {
  if (!cfg.wastePostcode || !cfg.wasteHouseNumber) return { enabled: false, pickups: [] };
  const addrKey = `${cfg.wastePostcode}|${cfg.wasteHouseNumber}|${cfg.wasteHouseLetter}`;
  if (tmAddress.key !== addrKey) {
    const res = await tmPost('FetchAdress', {
      companyCode: TM_COMPANY, postCode: cfg.wastePostcode,
      houseNumber: String(cfg.wasteHouseNumber), houseLetter: cfg.wasteHouseLetter || '',
    });
    const id = res?.dataList?.[0]?.UniqueId;
    if (!id) throw new Error('Twente Milieu: adres niet gevonden');
    tmAddress = { key: addrKey, id };
  }
  const from = new Date(); from.setDate(from.getDate() - 1);
  const to = new Date(); to.setDate(to.getDate() + 90);
  const res = await tmPost('GetCalendar', {
    companyCode: TM_COMPANY, uniqueAddressID: tmAddress.id,
    startDate: localKey(from), endDate: localKey(to),
  });
  const pickups = [];
  for (const item of res?.dataList || []) {
    const type = WASTE_TYPES[item.pickupType ?? item._pickupType];
    if (!type) continue;                               // unknown type: skip rather than fail
    for (const d of item.pickupDates || []) pickups.push({ date: String(d).slice(0, 10), ...type });
  }
  pickups.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { enabled: true, showNext: cfg.wasteShowNext, bannerFrom: cfg.wasteBannerFrom, pickups };
}

// ---------- Calendar ----------
const pad = n => String(n).padStart(2, '0');
const localKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// node-ical's rrule hands back occurrences as "floating" times: the wall-clock time stored in the
// UTC fields. Rebuild each occurrence as local time (container TZ) on that date, keeping the event's time of day.
function occurrenceStart(ev, d, allDay) {
  const s = ev.start;
  const floating = allDay ? d.getUTCHours() === 0 && d.getUTCMinutes() === 0
                          : d.getUTCHours() === s.getHours() && d.getUTCMinutes() === s.getMinutes();
  const [y, m, day] = floating ? [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()] : [d.getFullYear(), d.getMonth(), d.getDate()];
  return allDay ? new Date(y, m, day) : new Date(y, m, day, s.getHours(), s.getMinutes(), s.getSeconds());
}
// one-off all-day dates come in as local midnight, recurring ones as UTC midnight
const dateOnly = d => (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getHours() !== 0 ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : d);

function lookup(obj, d) {
  if (!obj) return null;
  const iso = d.toISOString();
  return obj[iso.slice(0, 10)] || obj[iso] || Object.values(obj).find(x => +new Date(x.start || x) === +d) || null;
}

function expand(ev, from, to) {
  const allDay = ev.datetype === 'date';
  const dur = ev.end ? ev.end - ev.start : allDay ? 86400000 : 0;
  const occ = [];
  const push = (start, end, src) => {
    if (src.status === 'CANCELLED') return;
    if (!(start < to && (end > from || +end === +start && start >= from))) return;
    occ.push({ start, end, allDay, title: src.summary || ev.summary || '(geen titel)', location: src.location || '' });
  };
  if (!ev.rrule) {
    const st = allDay ? dateOnly(ev.start) : ev.start;
    push(st, new Date(+st + dur), ev);
    return occ;
  }
  // widen the window by a day on both sides to absorb the floating-time offset, push() trims it again
  for (const d of ev.rrule.between(new Date(+from - dur - 86400000), new Date(+to + 86400000), true)) {
    if (lookup(ev.exdate, d)) continue;
    const ov = lookup(ev.recurrences, d);
    if (ov) { push(ov.start, ov.end || new Date(+ov.start + dur), ov); continue; }
    const st = occurrenceStart(ev, d, allDay);
    push(st, new Date(+st + dur), ev);
  }
  return occ;
}

async function loadCalendar(cal, from, to) {
  const data = await ical.async.fromURL(cal.url);
  const out = [];
  const all = Object.values(data).filter(ev => ev.type === 'VEVENT');
  const info = { name: cal.name, host: new URL(cal.url).host, eventsInFeed: all.length, recurring: all.filter(e => e.rrule).length, inWindow: 0 };
  for (const ev of all) {
    if (!ev.start || ev.recurrenceid) continue;
    for (const o of expand(ev, from, to)) {
      out.push({
        calendar: cal.name,
        color: cal.color,
        title: String(o.title),
        location: String(o.location || ''),
        allDay: o.allDay,
        // all-day events as plain dates so the browser can't shift them across midnight
        start: o.allDay ? localKey(o.start) : o.start.toISOString(),
        end: o.allDay ? localKey(new Date(+o.end - 1)) : o.end.toISOString(),
      });
    }
  }
  info.inWindow = out.length;
  const starts = all.map(e => e.start).filter(Boolean).sort((a, b) => a - b);
  if (starts.length) { info.firstStart = starts[0]; info.lastStart = starts.at(-1); }
  out.info = info;
  return out;
}

async function agenda() {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + cfg.calendarDays);
  const results = await Promise.allSettled(cfg.calendars.map(c => loadCalendar(c, from, to)));
  const errors = [];
  const sources = [];
  const events = results.flatMap((r, i) => {
    if (r.status === 'fulfilled') { sources.push(r.value.info); return r.value; }
    errors.push(`${cfg.calendars[i].name}: ${r.reason.message}`);
    return [];
  });
  if (cfg.wasteInAgenda) {
    try {
      const w = await cached('waste', 6 * 3600e3, waste);
      const end = localKey(new Date(+to - 1));
      for (const p of w.pickups) {
        if (p.date >= localKey(from) && p.date <= end) {
          events.push({ calendar: 'Afval', color: p.color, title: p.label, location: '', allDay: true, start: p.date, end: p.date, waste: p.key });
        }
      }
    } catch (e) { errors.push(e.message); }
  }
  if (errors.length) console.error('Calendar errors:', errors.join(' | '));
  events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : Number(b.allDay) - Number(a.allDay)));
  if (!cfg.calendars.length && !(cfg.wasteInAgenda && cfg.wastePostcode)) errors.push('Geen agenda ingesteld: variabele CALENDARS is leeg');
  return { from: localKey(from), days: cfg.calendarDays, calendars: cfg.calendars.length, sources, events, errors };
}

// ---------- Weather (Open-Meteo, no key needed) ----------
async function weather() {
  const q = new URLSearchParams({
    latitude: String(cfg.lat), longitude: String(cfg.lon), timezone: 'auto', forecast_days: String(cfg.forecastDays + 1),
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!r.ok) throw new Error(`Open-Meteo: HTTP ${r.status}`);
  return r.json();
}

// ---------- HTTP ----------
const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(await readFile(new URL('./public/index.html', import.meta.url)));
    }
    if (p === '/icon.png' || p === '/favicon.ico') {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800' });
      return res.end(await readFile(new URL('./public/icon.png', import.meta.url)));
    }
    if (p === '/admin') { res.writeHead(301, { location: 'admin/' }); return res.end(); }
    if (p === '/admin/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' });
      return res.end(await readFile(new URL('./public/admin.html', import.meta.url)));
    }
    if (p === '/admin/api/login' && req.method === 'POST') {
      if (!ADMIN_PASSWORD) return json(res, 403, { error: 'Stel eerst de variabele ADMIN_PASSWORD in op de container.' });
      const { password } = await readBody(req);
      if (!passwordOk(password)) { await new Promise(r => setTimeout(r, 1200)); return json(res, 401, { error: 'Onjuist wachtwoord' }); }
      const token = randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + SESSION_MS);
      res.setHeader('set-cookie', `wf_session=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${SESSION_MS / 1000}`);
      return json(res, 200, { ok: true });
    }
    if (p.startsWith('/admin/api/')) {
      const token = sessionOf(req);
      if (!token) return json(res, 401, { error: 'Niet ingelogd', needsPassword: !ADMIN_PASSWORD });
      if (p === '/admin/api/logout' && req.method === 'POST') {
        sessions.delete(token);
        res.setHeader('set-cookie', 'wf_session=; Path=/admin; Max-Age=0');
        return json(res, 200, { ok: true });
      }
      if (p === '/admin/api/settings' && req.method === 'GET') return json(res, 200, adminView());
      if (p === '/admin/api/settings' && req.method === 'POST') {
        const r = await saveSettings(await readBody(req));
        return json(res, r.errors ? 400 : 200, r.errors ? r : { ...r, ...adminView() });
      }
      if (p === '/admin/api/albums' && req.method === 'GET') {
        // own albums plus albums shared with this user; needs album.read on the API key
        const get = async q => {
          const r = await fetch(`${cfg.immichUrl}/api/albums${q}`, { headers: { 'x-api-key': cfg.immichKey } });
          if (r.status === 401 || r.status === 403) throw Object.assign(new Error('De API-sleutel mist het recht album.read'), { code: 403 });
          if (!r.ok) throw new Error(`Immich: HTTP ${r.status}`);
          return r.json();
        };
        if (!cfg.immichUrl || !cfg.immichKey) return json(res, 400, { error: 'Vul eerst het Immich-adres en de API-sleutel in en sla op' });
        try {
          const [own, shared] = await Promise.all([get(''), get('?shared=true').catch(() => [])]);
          const seen = new Map();
          for (const a of [...own, ...shared]) if (!seen.has(a.id)) seen.set(a.id, {
            id: a.id, name: a.albumName || '(zonder naam)', count: a.assetCount ?? 0,
            thumb: a.albumThumbnailAssetId || null, shared: !!a.shared,
          });
          const albums = [...seen.values()].sort((x, y) => x.name.localeCompare(y.name, cfg.locale));
          return json(res, 200, { albums });
        } catch (e) { return json(res, e.code || 502, { error: e.message }); }
      }
      const th = p.match(/^\/admin\/api\/thumb\/([0-9a-f-]{36})$/);
      if (th) {
        const r = await immich(`/api/assets/${th[1]}/thumbnail?size=thumbnail`);
        res.writeHead(200, { 'content-type': r.headers.get('content-type') || 'image/jpeg', 'cache-control': 'private, max-age=86400' });
        return Readable.fromWeb(r.body).pipe(res);
      }
      if (p === '/admin/api/test' && req.method === 'POST') {
        cache.delete('waste');
        const [photo, weatherR, cal, wasteR] = await Promise.allSettled([nextPhoto(), weather(), agenda(), waste()]);
        return json(res, 200, {
          immich: photo.status === 'fulfilled' ? { ok: true } : { ok: false, error: photo.reason.message },
          weather: weatherR.status === 'fulfilled' ? { ok: true, temp: weatherR.value.current?.temperature_2m } : { ok: false, error: weatherR.reason.message },
          waste: wasteR.status === 'fulfilled'
            ? { ok: true, enabled: wasteR.value.enabled, next: wasteR.value.pickups.filter(p => p.date >= localKey(new Date())).slice(0, 4) }
            : { ok: false, error: wasteR.reason.message },
          calendar: cal.status === 'fulfilled' ? { ok: !cal.value.errors.length, sources: cal.value.sources, errors: cal.value.errors } : { ok: false, errors: [cal.reason.message] },
        });
      }
      return json(res, 404, { error: 'Niet gevonden' });
    }
    if (p === '/api/config') {
      return json(res, 200, { version: cfg.version,
        locale: cfg.locale, photoInterval: cfg.photoInterval, progressBar: cfg.progressBar, calendarDays: cfg.calendarDays,
        nightStart: cfg.nightStart, nightEnd: cfg.nightEnd, nightMode: cfg.nightMode, wakeMinutes: cfg.wakeMinutes,
        forecastDays: cfg.forecastDays, showEmptyDays: cfg.showEmptyDays,
        adminButton: cfg.adminButton && !!ADMIN_PASSWORD,
        sizes: Object.fromEntries(Object.entries(FONT_BLOCKS).map(([k, b]) => [b, cfg['size' + k.slice(4)] / 100])),
        fonts: Object.fromEntries(Object.entries(FONT_BLOCKS).filter(([k]) => cfg[k]).map(([k, b]) => [b, fontCss(cfg[k])])),
        fontUrl: fontUrl(Object.keys(FONT_BLOCKS).map(k => cfg[k]).filter(Boolean)),
      });
    }
    if (p === '/api/photo/next') return json(res, 200, await nextPhoto());
    const m = p.match(/^\/api\/photo\/([0-9a-f-]{36})\/image$/);
    if (m) {
      const r = await immich(`/api/assets/${m[1]}/thumbnail?size=${cfg.imageSize}`);
      res.writeHead(200, { 'content-type': r.headers.get('content-type') || 'image/jpeg', 'cache-control': 'private, max-age=86400' });
      return Readable.fromWeb(r.body).pipe(res);
    }
    if (p === '/api/weather') return json(res, 200, await cached('weather', 30 * 60e3, weather));
    if (p === '/api/waste') return json(res, 200, await cached('waste', 6 * 3600e3, waste));
    if (p === '/api/calendar') return json(res, 200, await cached('calendar', cfg.calendarRefresh * 60e3, agenda));
    if (p === '/health') return json(res, 200, { ok: true });
    json(res, 404, { error: 'Niet gevonden' });
  } catch (err) {
    console.error(p, err.message);
    json(res, 502, { error: err.message });
  }
});

server.listen(cfg.port, () => {
  console.log(`immich-wallframe on :${cfg.port} — ${cfg.calendars.length} calendar(s), albums: ${cfg.albumIds.length || 'all'}`);
});
