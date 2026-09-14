/**
 * NearBuyGoods — API-first backend + static host for the PWA frontend.
 * Zero runtime dependencies (Node >= 18). The same REST API is the service
 * layer for the future native mobile apps (Capacitor / React Native).
 *
 * Run:  node server.js   (PORT env optional, default 3000)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildSeed } from './seed/data.js';
import { vapidPublicKeyB64u, sendPush, setKeys as restoreVapidKeys, getKeys as currentVapidKeys } from './lib/webpush.js';
import { gzipSync, gunzipSync } from 'node:zlib';
import * as paystack from './lib/paystack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.NBG_SECRET || 'nbg-dev-secret-change-in-prod';
const VERSION = '1.1.0';

/* ------------------------------------------------------------------ db ---- */
/* Three storage modes, chosen automatically:
 *  1. local / long-running host  → JSON file data/db.json (classic behaviour)
 *  2. Vercel + KV store attached → one blob in Upstash REST KV, survives cold
 *     starts and redeploys (recommended for vercel.app deploys)
 *  3. Vercel without KV          → in-memory seed per cold start (demo resets;
 *     attach a KV store under Storage → KV to make it persistent)
 */
const KV_URL = process.env.KV_REST_API_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';
const KV_KEY = 'nbg:state:v1';
const onVercel = !!process.env.VERCEL;
const kvMode = onVercel && !!KV_URL && !!KV_TOKEN;

let db = null;
let saveTimer = null;
let storageReady = false;

function seedDb() {
  const seeded = buildSeed();
  for (const u of seeded.users) {
    const { hash, salt } = hashPassword('demo1234');
    u.pass_hash = hash; u.salt = salt;
  }
  return seeded;
}

async function kvCmd(cmd) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`KV ${r.status}`);
  return (await r.json()).result;
}

export async function initStorage() {
  if (storageReady) return;
  if (kvMode) {
    try {
      const blob = await kvCmd(['GET', KV_KEY]);
      if (blob) {
        let parsed;
        if (typeof blob === 'string' && blob.startsWith('gz:')) {
          parsed = JSON.parse(gunzipSync(Buffer.from(blob.slice(3), 'base64')).toString('utf8'));
        } else {
          parsed = typeof blob === 'string' ? JSON.parse(blob) : blob;
        }
        db = parsed.db || null;
        if (parsed.vapid) restoreVapidKeys(parsed.vapid);
      }
    } catch (e) { console.error('[kv] load failed:', e.message); }
    if (!db) { db = seedDb(); saveDb(true); }
    db.push_subs = db.push_subs || []; db.payments = db.payments || []; db.collections = db.collections || [];
    storageReady = true;
    return;
  }
  if (onVercel) {           // ephemeral demo mode
    db = seedDb();
    db.push_subs = db.push_subs || []; db.payments = db.payments || []; db.collections = db.collections || [];
    storageReady = true;
    return;
  }
  if (fs.existsSync(DATA_FILE)) {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db.push_subs = db.push_subs || [];
    db.payments = db.payments || [];
    db.collections = db.collections || [];
  } else {
    db = seedDb();
    saveDb(true);
  }
  storageReady = true;
}

function saveDb(now = false) {
  if (!db) return;
  if (kvMode) {
    clearTimeout(saveTimer);
    const run = () => {
      // gzip: JSON blobs (base64 photos!) compress ~10x, staying well under KV value limits
      const gz = 'gz:' + gzipSync(Buffer.from(JSON.stringify({ db, vapid: currentVapidKeys() }))).toString('base64');
      kvCmd(['SET', KV_KEY, gz]).catch((e) => console.error('[kv] save failed:', e.message));
    };
    if (now) run(); else saveTimer = setTimeout(run, 250);
    return;
  }
  if (onVercel) return; // ephemeral mode — nothing to persist
  if (now) { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(db)); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFileSync(DATA_FILE, JSON.stringify(db)), 250);
}
process.on('SIGINT', () => { saveDb(true); process.exit(0); });
process.on('SIGTERM', () => { saveDb(true); process.exit(0); });

const nid = (k) => `${k}${++db.counters[k] || (db.counters[k] = 1)}`;
const byId = (list, id) => list.find((x) => x.id === id);

/* ---------------------------------------------------------------- auth ---- */
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return { hash, salt };
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function signToken(payload) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }));
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyToken(tok) {
  try {
    const [h, b, s] = tok.split('.');
    const expect = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
    if (s !== expect) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

/* ----------------------------------------------------------------- geo ---- */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const GEOHASH_ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';
function geohash(lat, lng, precision = 6) { // stored on writes for future index-scale lookups
  let laMin = -90, laMax = 90, loMin = -180, loMax = 180, hash = '', bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) { const mid = (loMin + loMax) / 2; if (lng > mid) { ch |= 1 << (4 - bit); loMin = mid; } else loMax = mid; }
    else { const mid = (laMin + laMax) / 2; if (lat > mid) { ch |= 1 << (4 - bit); laMin = mid; } else laMax = mid; }
    even = !even;
    if (++bit === 5) { hash += GEOHASH_ALPHABET[ch]; bit = 0; ch = 0; }
  }
  return hash;
}
function isOpenNow(store, at = new Date()) {
  const tz = store.tz ?? 1;
  const local = new Date(at.getTime() + tz * 3600e3);
  const dow = local.getUTCDay();
  const hrs = store.hours?.[dow];
  if (!hrs) return { open: false, label: 'Closed today' };
  const mins = (local.getUTCHours() * 60 + local.getUTCMinutes());
  const [oh, om] = hrs[0].split(':').map(Number);
  const [ch, cm] = hrs[1].split(':').map(Number);
  const open = mins >= oh * 60 + om && mins < ch * 60 + cm;
  return { open, label: open ? `Open · closes ${hrs[1]}` : `Closed · opens ${hrs[0]}` };
}

/* ------------------------------------------------------------- helpers ---- */
const CATEGORIES = [
  { id: 'electronics', name: 'Electronics', emoji: '🔌' },
  { id: 'fashion', name: 'Fashion', emoji: '👗' },
  { id: 'groceries', name: 'Groceries', emoji: '🧺' },
  { id: 'home', name: 'Home & Living', emoji: '🛋️' },
  { id: 'beauty', name: 'Beauty', emoji: '💄' },
  { id: 'pharmacy', name: 'Pharmacy', emoji: '💊' },
  { id: 'sports', name: 'Sports', emoji: '⚽' },
  { id: 'books', name: 'Books & Stationery', emoji: '📚' },
];
const fmtN = (n) => Number(n).toLocaleString('en-NG');

function storeSummary(s, origin) {
  const open = isOpenNow(s);
  return {
    id: s.id, name: s.name, area: s.area, city: s.city, lat: s.lat, lng: s.lng, emoji: s.emoji,
    tags: s.tags, verified: s.verified, rating: ratingFor(s.id), open_now: open.open, hours_label: open.label,
    delivery: s.delivery, curbside: s.curbside, pickup: s.pickup,
    distance_km: origin ? round1(haversineKm(origin.lat, origin.lng, s.lat, s.lng)) : undefined,
  };
}
function ratingFor(storeId) {
  const rs = db.reviews.filter((r) => r.store_id === storeId);
  if (!rs.length) return 0;
  return Math.round((rs.reduce((a, r) => a + r.rating, 0) / rs.length) * 10) / 10;
}
const round1 = (n) => Math.round(n * 10) / 10;

function offerView(o, origin, badges = []) {
  const product = byId(db.products, o.product_id);
  const store = byId(db.stores, o.store_id);
  return {
    offer_id: o.id,
    product: { id: product.id, name: product.name, brand: product.brand, category: product.category, emoji: product.emoji, colors: product.colors },
    store: storeSummary(store, origin),
    price: o.price, currency: o.currency, stock: o.stock,
    stock_label: o.stock === 0 ? 'out_of_stock' : o.stock <= 3 ? 'low_stock' : 'in_stock',
    condition: o.condition, updated_at: o.updated_at, badges,
  };
}
function notify(user_id, type, title, body, data = {}) {
  db.notifications.unshift({ id: nid('notification'), user_id, type, title, body, data, read: false, created: new Date().toISOString() });
  db.notifications = db.notifications.slice(0, 200);
  dispatchPush(user_id, type, title, body, data);
}
async function dispatchPush(user_id, type, title, body, data) {
  const subs = db.push_subs.filter((s) => s.user_id === user_id);
  if (!subs.length) return;
  const payload = { title, body, tag: type, url: data?.route || '/#/alerts', icon: '/assets/icon-192.png', badge: '/assets/icon-180.png' };
  for (const sub of subs) {
    const result = await sendPush(sub.subscription, payload).catch(() => ({ ok: false, status: 0 }));
    if (!result.ok && (result.status === 404 || result.status === 410)) {
      db.push_subs = db.push_subs.filter((x) => x.endpoint !== sub.subscription.endpoint);
    }
  }
}
function award(user, pts, stat) {
  user.points = (user.points || 0) + pts;
  if (stat) user.stats[stat] = (user.stats[stat] || 0) + 1;
  recomputeBadges(user);
}
function recomputeBadges(u) {
  const s = u.stats || {};
  const have = new Set(u.badges || []);
  const give = (id, cond) => { if (cond && !have.has(id)) { have.add(id); notify(u.id, 'badge', 'Badge unlocked 🏅', `You earned "${id.replace(/_/g, ' ')}".`); } };
  give('first_search', s.searches >= 1);
  give('explorer', s.searches >= 10);
  give('saver', s.saves >= 1);
  give('reviewer', s.reviews >= 1);
  give('deal_hunter', s.reservations >= 1);
  give('local_hero', s.reservations >= 5);
  u.badges = [...have];
}

/* ------------------------------------------------------------ routing ---- */
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, keys, handler, opts });
};
const rateBuckets = new Map();
function rateLimited(ip, limit = 20, windowMs = 60e3) {
  const arr = rateBuckets.get(ip) || [];
  const nowT = Date.now();
  const fresh = arr.filter((t) => nowT - t < windowMs);
  fresh.push(nowT);
  rateBuckets.set(ip, fresh);
  return fresh.length > limit;
}

/* ---- auth endpoints ---- */
route('POST', '/api/v1/auth/register', (ctx) => {
  const { name, email, password, role = 'shopper', phone } = ctx.body;
  if (!name || !email || !password || password.length < 8) return ctx.send(400, { error: 'name, email and password (8+ chars) required' });
  if (db.users.some((u) => u.email === email)) return ctx.send(409, { error: 'email already registered' });
  const { hash, salt } = hashPassword(password);
  const user = {
    id: nid('user'), name, email, phone: phone || null,
    role: ['shopper', 'store_owner'].includes(role) ? role : 'shopper',
    pass_hash: hash, salt, points: 25, stats: { searches: 0, saves: 0, reviews: 0, reservations: 0 }, badges: [],
    prefs: { radius_km: 10, units: 'km', currency: 'NGN', lat: 6.5244, lng: 3.3792, loc_label: 'Lagos, NG', notify_push: true, notify_email: false, notify_deals: true, notify_stock: true, font_scale: 1, high_contrast: false, reduce_motion: false },
    created: new Date().toISOString(),
  };
  db.users.push(user);
  notify(user.id, 'welcome', 'Welcome to NearBuyGoods 🎉', 'You have 25 welcome points. Try a photo search!');
  ctx.send(201, { token: signToken({ sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + 86400 * 30 }) , user: publicUser(user) });
}, { limit: 10 });
route('POST', '/api/v1/auth/login', (ctx) => {
  const { email, password } = ctx.body;
  const user = db.users.find((u) => u.email === (email || '').toLowerCase?.() || u.email === email);
  if (!user) return ctx.send(401, { error: 'invalid credentials' });
  const { hash } = hashPassword(password || '', user.salt);
  if (hash !== user.pass_hash) return ctx.send(401, { error: 'invalid credentials' });
  ctx.send(200, { token: signToken({ sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + 86400 * 30 }), user: publicUser(user) });
}, { limit: 10 });
route('POST', '/api/v1/auth/otp/request', (ctx) => {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  ctx.send(200, { message: 'OTP sent (dev mode returns code)', dev_code: code, expires_in: 300 });
}, { limit: 5 });
route('GET', '/api/v1/auth/me', (ctx) => {
  if (!ctx.user) return ctx.send(401, { error: 'unauthorized' });
  ctx.send(200, { user: publicUser(ctx.user) });
}, { auth: true });
route('PUT', '/api/v1/auth/prefs', (ctx) => {
  Object.assign(ctx.user.prefs, ctx.body.prefs || {});
  if (ctx.body.name) ctx.user.name = ctx.body.name;
  ctx.send(200, { user: publicUser(ctx.user) });
}, { auth: true });
function publicUser(u) {
  const { pass_hash, salt, ...rest } = u;
  return rest;
}

/* ---- catalog & discovery ---- */
route('GET', '/api/v1/meta', (ctx) => {
  ctx.send(200, {
    version: VERSION, currency: db.meta.currency, city: db.meta.city, feature_flags: db.meta.flags,
    categories: CATEGORIES,
    demo_accounts: [
      { role: 'shopper', email: 'shopper@nearbuygoods.app', password: 'demo1234' },
      { role: 'store_owner', email: 'owner@nearbuygoods.app', password: 'demo1234' },
      { role: 'admin', email: 'admin@nearbuygoods.app', password: 'demo1234' },
    ],
  });
});
route('GET', '/api/v1/categories', (ctx) => ctx.send(200, { categories: CATEGORIES }));
route('GET', '/api/v1/trending', (ctx) => {
  ctx.send(200, { trending: [...db.searches].sort((a, b) => b.count - a.count).slice(0, 8) });
});

route('POST', '/api/v1/search', (ctx) => {
  const b = ctx.body || {};
  const origin = ctx.user?.prefs?.lat != null && b.lat == null ? { lat: ctx.user.prefs.lat, lng: ctx.user.prefs.lng } : { lat: b.lat ?? 6.5244, lng: b.lng ?? 3.3792 };
  const radius = Number(b.radius_km ?? ctx.user?.prefs?.radius_km ?? 10);
  const q = (b.q || '').toLowerCase().trim();
  const tokens = q.split(/\s+/).filter(Boolean);
  if (q && ctx.user) { award(ctx.user, 2, 'searches'); }
  if (q) {
    const ex = db.searches.find((s) => s.q === q);
    if (ex) ex.count++; else db.searches.push({ q, count: 1 });
  }
  let offers = db.offers.slice();
  if (ctx.user && q && !b.incognito) {
    ctx.user.history = ctx.user.history || [];
    ctx.user.history.unshift({ id: nid('hist'), q, ts: new Date().toISOString(), n: 0 });
    ctx.user.history = ctx.user.history.slice(0, 40);
    if (ctx.user.history[0]) ctx.user.history[0].n = 0;
  }
  if (Array.isArray(b.product_ids) && b.product_ids.length) offers = offers.filter((o) => b.product_ids.includes(o.product_id));
  else if (tokens.length) {
    offers = offers.filter((o) => {
      const p = byId(db.products, o.product_id);
      const hay = `${p.name} ${p.brand} ${p.category} ${p.tags.join(' ')}`.toLowerCase();
      return tokens.some((t) => hay.includes(t));
    });
  }
  let rows = offers.map((o) => {
    const store = byId(db.stores, o.store_id);
    const d = haversineKm(origin.lat, origin.lng, store.lat, store.lng);
    return { o, store, d, p: byId(db.products, o.product_id) };
  }).filter((r) => r.d <= radius);
  // filters
  const f = b.filters || {};
  if (f.category) rows = rows.filter((r) => r.p.category === f.category);
  if (f.brand) rows = rows.filter((r) => r.p.brand.toLowerCase().includes(f.brand.toLowerCase()));
  if (f.min_price != null) rows = rows.filter((r) => r.o.price >= Number(f.min_price));
  if (f.max_price != null) rows = rows.filter((r) => r.o.price <= Number(f.max_price));
  if (f.in_stock) rows = rows.filter((r) => r.o.stock > 0);
  if (f.open_now) rows = rows.filter((r) => isOpenNow(r.store).open);
  if (f.min_rating) rows = rows.filter((r) => ratingFor(r.store.id) >= Number(f.min_rating));
  if (f.delivery) rows = rows.filter((r) => r.store.delivery);
  if (f.store_type) rows = rows.filter((r) => r.store.tags.includes(f.store_type));
  // sort
  const sort = b.sort || 'relevance';
  if (sort === 'distance') rows.sort((a, b2) => a.d - b2.d);
  else if (sort === 'price_asc') rows.sort((a, b2) => a.o.price - b2.o.price);
  else if (sort === 'price_desc') rows.sort((a, b2) => b2.o.price - a.o.price);
  else if (sort === 'rating') rows.sort((a, b2) => ratingFor(b2.store.id) - ratingFor(a.store.id));
  else rows.sort((a, b2) => (a.o.price / 1000 + a.d) - (b2.o.price / 1000 + b2.d)); // best value: price + travel proxy
  // badges
  const inStock = rows.filter((r) => r.o.stock > 0);
  const closest = rows.length ? rows.reduce((m, r) => (r.d < m.d ? r : m)) : null;
  const best = inStock.length ? inStock.reduce((m, r) => (r.o.price < m.o.price ? r : m)) : null;
  const page = Math.max(1, Number(b.page || 1)), per = 12;
  const slice = rows.slice((page - 1) * per, page * per);
  const results = slice.map((r) => {
    const badges = [];
    if (best && r === best) badges.push('best_deal');
    if (closest && r === closest) badges.push('closest');
    if (db.deals.some((d) => d.store_id === r.store.id && (d.product_ids.length === 0 || d.product_ids.includes(r.p.id)) && new Date(d.ends_at) > new Date())) badges.push('on_deal');
    storeMatchBump(r.store, r.o);
    return offerView(r.o, origin, badges);
  });
  if (ctx.user && q && !b.incognito && ctx.user.history?.[0]?.q === q) ctx.user.history[0].n = rows.length;
  ctx.send(200, { results, total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / per)), origin, radius_km: radius, sort });
});
function storeMatchBump(store, offer) { store.matches = (store.matches || 0) + 0; }

route('POST', '/api/v1/recognize', (ctx) => {
  const s = ctx.body?.signals || {};
  const tokens = [...new Set(`${s.filename || ''} ${s.text || ''}`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2))];
  const colors = Array.isArray(s.colors) ? s.colors.slice(0, 4) : [];
  const catHint = (s.category || '').toLowerCase();
  const brandHint = (s.brand || '').toLowerCase();
  const hexDist = (a, b) => {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
  };
  const candidates = db.products.map((p) => {
    let score = 0; const matched = [];
    if (s.barcode && p.barcode === s.barcode) { score += 0.95; matched.push('barcode'); }
    const hay = `${p.name} ${p.brand} ${p.tags.join(' ')} ${p.category}`.toLowerCase();
    const hitTokens = tokens.filter((t) => hay.includes(t));
    if (hitTokens.length) { score += Math.min(0.6, hitTokens.length * 0.22); matched.push(`text:${hitTokens.slice(0, 3).join(',')}`); }
    if (colors.length && p.colors.length) {
      const close = colors.some((c) => p.colors.some((pc) => hexDist(c, pc) < 90));
      if (close) { score += 0.3; matched.push('color'); }
    }
    if (catHint && p.category === catHint) { score += 0.15; matched.push('category'); }
    if (brandHint && p.brand.toLowerCase().includes(brandHint)) { score += 0.2; matched.push('brand'); }
    return { p, score: Math.min(0.97, score), matched };
  }).filter((c) => c.score > 0.25).sort((a, b) => b.score - a.score).slice(0, 4);
  const origin = { lat: ctx.body?.lat ?? ctx.user?.prefs?.lat ?? 6.5244, lng: ctx.body?.lng ?? ctx.user?.prefs?.lng ?? 3.3792 };
  const out = candidates.map((c) => {
    const offer = db.offers.filter((o) => o.product_id === c.p.id && o.stock > 0).sort((a, b) => a.price - b.price)[0];
    return {
      product: { id: c.p.id, name: c.p.name, brand: c.p.brand, category: c.p.category, emoji: c.p.emoji },
      confidence: Math.round(c.score * 100) / 100, matched_on: c.matched,
      from_price: offer ? offer.price : null, currency: 'NGN',
    };
  });
  const catGuess = catHint || guessCategory(tokens);
  if (ctx.user) award(ctx.user, 3);
  ctx.send(200, { candidates: out, attributes: { colors, category_guess: catGuess, brand_guess: brandHint || null, tokens: tokens.slice(0, 8) } });
});
function guessCategory(tokens) {
  const map = { phone: 'electronics', charger: 'electronics', earbuds: 'electronics', tv: 'electronics', speaker: 'electronics', watch: 'electronics', shirt: 'fashion', sneakers: 'fashion', bag: 'fashion', handbag: 'fashion', jersey: 'fashion', rice: 'groceries', oil: 'groceries', noodles: 'groceries', semovita: 'groceries', sofa: 'home', fan: 'home', pot: 'home', bulb: 'home', serum: 'beauty', shea: 'beauty', perfume: 'beauty', tablet: 'pharmacy', paracetamol: 'pharmacy', thermometer: 'pharmacy', football: 'sports', yoga: 'sports', book: 'books', jamb: 'books' };
  for (const t of tokens) if (map[t]) return map[t];
  return null;
}

route('GET', '/api/v1/products/:id', (ctx) => {
  const p = byId(db.products, ctx.params.id);
  if (!p) return ctx.send(404, { error: 'product not found' });
  const origin = { lat: ctx.query.lat ? Number(ctx.query.lat) : ctx.user?.prefs?.lat ?? 6.5244, lng: ctx.query.lng ? Number(ctx.query.lng) : ctx.user?.prefs?.lng ?? 3.3792 };
  const offers = db.offers.filter((o) => o.product_id === p.id)
    .map((o) => offerView(o, origin))
    .sort((a, b) => a.price - b.price);
  const reviews = db.reviews.filter((r) => r.product_id === p.id);
  const similar = db.products.filter((x) => x.id !== p.id && x.category === p.category).slice(0, 4);
  ctx.send(200, { product: p, offers, reviews, similar: similar.map((x) => ({ id: x.id, name: x.name, emoji: x.emoji, category: x.category })) });
});
route('GET', '/api/v1/products/:id/history', (ctx) => {
  const offs = db.offers.filter((o) => o.product_id === ctx.params.id);
  ctx.send(200, { history: offs.map((o) => ({ offer_id: o.id, store_id: o.store_id, points: o.price_history })) });
});
route('GET', '/api/v1/products/:id/reviews', (ctx) => ctx.send(200, { reviews: db.reviews.filter((r) => r.product_id === ctx.params.id) }));
route('POST', '/api/v1/products/:id/reviews', (ctx) => {
  const p = byId(db.products, ctx.params.id);
  if (!p) return ctx.send(404, { error: 'product not found' });
  const { rating, text, store_id } = ctx.body;
  const rev = { id: nid('review'), store_id: store_id || null, product_id: p.id, user_id: ctx.user.id, user_name: ctx.user.name, rating: Number(rating) || 3, text: text || '', helpful: 0, responses: [], created: new Date().toISOString() };
  db.reviews.unshift(rev);
  award(ctx.user, 20, 'reviews');
  if (rev.store_id) { const st = byId(db.stores, rev.store_id); notify(st.owner_id, 'review', `New review on ${p.name}`, `${ctx.user.name} rated ${rev.rating}★ at ${st.name}.`, { route: `#/store/${st.id}` }); }
  ctx.send(201, { review: rev });
}, { auth: true });

route('GET', '/api/v1/stores', (ctx) => {
  const lat = Number(ctx.query.lat ?? ctx.user?.prefs?.lat ?? 6.5244);
  const lng = Number(ctx.query.lng ?? ctx.user?.prefs?.lng ?? 3.3792);
  const radius = Number(ctx.query.radius_km ?? 50);
  const stores = db.stores.map((s) => storeSummary(s, { lat, lng })).filter((s) => s.distance_km <= radius).sort((a, b) => a.distance_km - b.distance_km);
  ctx.send(200, { stores });
});
route('GET', '/api/v1/stores/:id', (ctx) => {
  const s = byId(db.stores, ctx.params.id);
  if (!s) return ctx.send(404, { error: 'store not found' });
  const origin = { lat: ctx.query.lat ? Number(ctx.query.lat) : ctx.user?.prefs?.lat ?? 6.5244, lng: ctx.query.lng ? Number(ctx.query.lng) : ctx.user?.prefs?.lng ?? 3.3792 };
  const deals = db.deals.filter((d) => d.store_id === s.id && new Date(d.ends_at) > new Date());
  s.views = (s.views || 0) + 1;
  ctx.send(200, { store: { ...storeSummary(s, origin), ...{ desc: s.desc, address: s.address, phone: s.phone, email: s.email, hours: s.hours, payments: s.payments, wheelchair: s.wheelchair, followers: s.followers, rating_count: db.reviews.filter((r) => r.store_id === s.id).length } }, deals });
});
route('GET', '/api/v1/stores/:id/inventory', (ctx) => {
  const origin = { lat: ctx.user?.prefs?.lat ?? 6.5244, lng: ctx.user?.prefs?.lng ?? 3.3792 };
  const offs = db.offers.filter((o) => o.store_id === ctx.params.id).map((o) => offerView(o, origin));
  ctx.send(200, { inventory: offs });
});
route('GET', '/api/v1/stores/:id/reviews', (ctx) => ctx.send(200, { reviews: db.reviews.filter((r) => r.store_id === ctx.params.id) }));
route('POST', '/api/v1/stores/:id/reviews', (ctx) => {
  const s = byId(db.stores, ctx.params.id);
  if (!s) return ctx.send(404, { error: 'store not found' });
  const rev = { id: nid('review'), store_id: s.id, product_id: ctx.body.product_id || null, user_id: ctx.user.id, user_name: ctx.user.name, rating: Number(ctx.body.rating) || 3, text: ctx.body.text || '', helpful: 0, responses: [], created: new Date().toISOString() };
  db.reviews.unshift(rev);
  award(ctx.user, 20, 'reviews');
  notify(s.owner_id, 'review', `New review for ${s.name}`, `${ctx.user.name} rated ${rev.rating}★.`, { route: `#/store/${s.id}` });
  ctx.send(201, { review: rev });
}, { auth: true });
route('POST', '/api/v1/reviews/:id/helpful', (ctx) => {
  const r = byId(db.reviews, ctx.params.id);
  if (r) r.helpful++;
  ctx.send(200, { helpful: r?.helpful || 0 });
});

route('GET', '/api/v1/deals', (ctx) => {
  const lat = Number(ctx.query.lat ?? ctx.user?.prefs?.lat ?? 6.5244);
  const lng = Number(ctx.query.lng ?? ctx.user?.prefs?.lng ?? 3.3792);
  const radius = Number(ctx.query.radius_km ?? ctx.user?.prefs?.radius_km ?? 10);
  const deals = db.deals.filter((d) => new Date(d.ends_at) > new Date()).map((d) => {
    const s = byId(db.stores, d.store_id);
    return { ...d, store: storeSummary(s, { lat, lng }) };
  }).filter((d) => d.store.distance_km <= radius).sort((a, b) => new Date(a.ends_at) - new Date(b.ends_at));
  ctx.send(200, { deals });
});

/* ---- saved / watchlist ---- */
route('GET', '/api/v1/saved', (ctx) => {
  const origin = { lat: ctx.user.prefs.lat, lng: ctx.user.prefs.lng };
  const items = db.saved.filter((sv) => sv.user_id === ctx.user.id).map((sv) => {
    const p = byId(db.products, sv.product_id);
    const offs = db.offers.filter((o) => o.product_id === sv.product_id).sort((a, b) => a.price - b.price);
    const best = offs[0];
    return {
      saved: sv, product: p ? { id: p.id, name: p.name, brand: p.brand, category: p.category, emoji: p.emoji } : null,
      best_offer: best ? offerView(best, origin) : null,
      price_delta: best ? best.price - sv.saved_price : null,
    };
  });
  ctx.send(200, { items, collections: db.collections.filter((c) => c.user_id === ctx.user.id) });
}, { auth: true });
route('POST', '/api/v1/saved', (ctx) => {
  const { product_id, watch = true, collection_id } = ctx.body;
  const p = byId(db.products, product_id);
  if (!p) return ctx.send(404, { error: 'product not found' });
  let sv = db.saved.find((x) => x.user_id === ctx.user.id && x.product_id === product_id);
  const minPrice = Math.min(...db.offers.filter((o) => o.product_id === product_id).map((o) => o.price));
  if (sv) { sv.watch = watch; if (collection_id !== undefined) sv.collection_id = collection_id || null; }
  else {
    sv = { user_id: ctx.user.id, product_id, watch, saved_price: minPrice, collection_id: collection_id || null, created: new Date().toISOString() };
    db.saved.push(sv);
    award(ctx.user, 5, 'saves');
  }
  ctx.send(200, { saved: sv });
}, { auth: true });
route('DELETE', '/api/v1/saved/:productId', (ctx) => {
  db.saved = db.saved.filter((x) => !(x.user_id === ctx.user.id && x.product_id === ctx.params.productId));
  ctx.send(200, { ok: true });
}, { auth: true });

/* ---- search history & collections ---- */
route('GET', '/api/v1/history', (ctx) => ctx.send(200, { history: ctx.user.history || [] }), { auth: true });
route('DELETE', '/api/v1/history/:id', (ctx) => {
  ctx.user.history = (ctx.user.history || []).filter((x) => x.id !== ctx.params.id);
  ctx.send(200, { ok: true });
}, { auth: true });
route('DELETE', '/api/v1/history', (ctx) => { ctx.user.history = []; ctx.send(200, { ok: true }); }, { auth: true });
route('GET', '/api/v1/collections', (ctx) => {
  const cols = db.collections.filter((c) => c.user_id === ctx.user.id).map((c) => ({ ...c, count: db.saved.filter((s) => s.collection_id === c.id).length }));
  ctx.send(200, { collections: cols });
}, { auth: true });
route('POST', '/api/v1/collections', (ctx) => {
  const name = (ctx.body.name || '').trim();
  if (!name) return ctx.send(400, { error: 'name required' });
  const col = { id: nid('col'), user_id: ctx.user.id, name, created: new Date().toISOString() };
  db.collections.push(col);
  ctx.send(201, { collection: col });
}, { auth: true });
route('DELETE', '/api/v1/collections/:id', (ctx) => {
  db.collections = db.collections.filter((c) => !(c.id === ctx.params.id && c.user_id === ctx.user.id));
  db.saved.forEach((s) => { if (s.collection_id === ctx.params.id) s.collection_id = null; });
  ctx.send(200, { ok: true });
}, { auth: true });

/* ---- geocoding (manual location entry) ---- */
const GAZETTEER = [
  ['Ikeja, Lagos', 6.6018, 3.3515], ['Computer Village, Ikeja', 6.6023, 3.3543], ['Allen Avenue, Ikeja', 6.6041, 3.3619], ['Maryland, Lagos', 6.5733, 3.3726], ['Agege, Lagos', 6.6189, 3.3343], ['Yaba, Lagos', 6.5158, 3.3789], ['Surulere, Lagos', 6.4969, 3.3564], ['Apapa, Lagos', 6.4498, 3.3595], ['Victoria Island, Lagos', 6.4368, 3.4058], ['Oniru, Lagos', 6.4419, 3.4098], ['Lekki Phase 1, Lagos', 6.4398, 3.4219], ['Ajah, Lagos', 6.4674, 3.5095], ['Ikorodu, Lagos', 6.6194, 3.5107], ['Gbagada, Lagos', 6.5535, 3.3892], ['Lagos, Nigeria', 6.5244, 3.3792], ['Abuja, Nigeria', 9.0765, 7.3986], ['Port Harcourt, Nigeria', 4.8156, 7.0498], ['Ibadan, Nigeria', 7.3775, 3.947], ['Kano, Nigeria', 12.0022, 8.592], ['Enugu, Nigeria', 6.4403, 7.4944], ['Benin City, Nigeria', 6.335, 5.6037], ['Accra, Ghana', 5.6037, -0.187], ['Nairobi, Kenya', -1.2921, 36.8219], ['London, UK', 51.5074, -0.1278], ['New York, USA', 40.7128, -74.006],
];
route('GET', '/api/v1/geo/geocode', async (ctx) => {
  const q = (ctx.query.q || '').trim();
  if (!q) return ctx.send(200, { results: [], source: 'none' });
  // 1) try OpenStreetMap Nominatim via server proxy (browser CSP stays locked to 'self')
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3500);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'NearBuyGoods/1.0 (geo-lookup for store discovery)' }, signal: ctl.signal,
    });
    clearTimeout(t);
    if (res.ok) {
      const json = await res.json();
      const rank = (r) => {
        const dn = (r.display_name || '').toLowerCase();
        let score = 0;
        if (dn.includes('nigeria')) score += 4;
        if (dn.includes('lagos')) score += 2;
        if ((r.importance || 0) > 0.5) score += 1;
        return score;
      };
      const results = json
        .sort((a, b) => rank(b) - rank(a))
        .map((r) => ({ label: r.display_name.split(',').slice(0, 3).join(', '), lat: Number(r.lat), lng: Number(r.lon) }));
      if (results.length) return ctx.send(200, { results, source: 'nominatim' });
    }
  } catch { /* offline / blocked — fall through to gazetteer */ }
  // 2) offline gazetteer of serviced cities
  const ql = q.toLowerCase();
  const results = GAZETTEER.filter(([label]) => label.toLowerCase().includes(ql)).slice(0, 6).map(([label, lat, lng]) => ({ label, lat, lng }));
  ctx.send(200, { results, source: 'offline' });
});

/* ---- web push subscriptions ---- */
route('GET', '/api/v1/push/vapid-public', (ctx) => ctx.send(200, { public_key: vapidPublicKeyB64u() }));
route('POST', '/api/v1/push/subscribe', (ctx) => {
  const sub = ctx.body.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return ctx.send(400, { error: 'bad subscription' });
  if (!db.push_subs.some((s) => s.subscription.endpoint === sub.endpoint)) {
    db.push_subs.push({ user_id: ctx.user.id, subscription: sub, created: new Date().toISOString() });
  }
  ctx.send(200, { ok: true, count: db.push_subs.filter((s) => s.user_id === ctx.user.id).length });
}, { auth: true });
route('DELETE', '/api/v1/push/subscribe', (ctx) => {
  const endpoint = ctx.body?.endpoint;
  db.push_subs = db.push_subs.filter((s) => !(s.user_id === ctx.user.id && (!endpoint || s.subscription.endpoint === endpoint)));
  ctx.send(200, { ok: true });
}, { auth: true });
route('GET', '/api/v1/push/status', (ctx) => ctx.send(200, { subscribed: db.push_subs.some((s) => s.user_id === ctx.user.id) }), { auth: true });

/* ---- payments (Paystack, test-mode first) ---- */
route('GET', '/api/v1/payments/plans', (ctx) => ctx.send(200, { plans: Object.values(paystack.PLANS), mode: paystack.LIVE ? 'live' : 'test' }));
route('POST', '/api/v1/payments/initialize', async (ctx) => {
  const { type, reservation_id, plan_id } = ctx.body;
  let amount = 0, refLabel = '';
  if (type === 'reservation') {
    const r = byId(db.reservations, reservation_id);
    if (!r || r.user_id !== ctx.user.id) return ctx.send(404, { error: 'reservation not found' });
    const o = db.offers.find((x) => x.store_id === r.store_id && x.product_id === r.product_id);
    amount = (o?.price || 0) * r.qty * 100; // Paystack amounts are in kobo
    refLabel = `Reservation ${r.code}`;
  } else if (type === 'subscription') {
    const plan = paystack.PLANS[plan_id];
    if (!plan) return ctx.send(404, { error: 'plan not found' });
    amount = plan.amount;
    refLabel = plan.name;
  } else return ctx.send(400, { error: 'type must be reservation|subscription' });
  const payment = { id: nid('pay'), ref: `NBGPAY-${Date.now().toString(36).toUpperCase()}`, user_id: ctx.user.id, type, reservation_id: reservation_id || null, plan_id: plan_id || null, label: refLabel, amount, currency: 'NGN', status: 'pending', provider: paystack.LIVE ? 'paystack' : 'paystack-test', created: new Date().toISOString(), paid_at: null };
  db.payments.unshift(payment);
  const proto = ctx.req.headers['x-forwarded-proto'] || 'http';
  const apiOrigin = `${proto}://${ctx.req.headers.host || 'localhost:' + PORT}`;
  const pageOrigin = ctx.req.headers.origin || apiOrigin;
  const returnUrl = `${pageOrigin}/#/premium?pay=${payment.ref}`;
  const init = await paystack.initialize({ email: ctx.user.email, amount, reference: payment.ref, callbackUrl: returnUrl });
  if (init.simulated) init.authorization_url = apiOrigin + init.authorization_url;
  ctx.send(200, { payment, checkout_url: init.authorization_url, simulated: !!init.simulated, mode: paystack.LIVE ? 'live' : 'test' });
}, { auth: true });
async function fulfil(payment) {
  if (!payment || payment.status === 'success') return payment;
  payment.status = 'success';
  payment.paid_at = new Date().toISOString();
  if (payment.type === 'reservation' && payment.reservation_id) {
    const r = byId(db.reservations, payment.reservation_id);
    if (r) {
      r.paid = true;
      if (r.status === 'pending') r.status = 'paid';
      const st = byId(db.stores, r.store_id);
      notify(st.owner_id, 'reservation', `Prepaid reservation ${r.code}`, `${byId(db.users, r.user_id)?.name} paid online — ${byId(db.products, r.product_id)?.name} × ${r.qty}.`, { route: '#/business' });
    }
  }
  if (payment.type === 'subscription' && payment.plan_id) {
    const u = byId(db.users, payment.user_id);
    if (u) {
      u.plan = { id: payment.plan_id, since: payment.paid_at, renews: new Date(Date.now() + 30 * 86400e3).toISOString() };
      notify(u.id, 'badge', `${paystack.PLANS[payment.plan_id].name} active 🎉`, 'Thanks for subscribing. Premium perks are on.', { route: '#/premium' });
    }
  }
  return payment;
}
route('POST', '/api/v1/payments/_sim/confirm', async (ctx) => {
  if (paystack.LIVE) return ctx.send(404, { error: 'simulator disabled in live mode' });
  const payment = db.payments.find((p) => p.ref === ctx.body.ref);
  if (!payment) return ctx.send(404, { error: 'unknown reference' });
  if (ctx.body.ok) await fulfil(payment);
  else payment.status = 'failed';
  ctx.send(200, { payment, return_url: `/#/premium?pay=${payment.ref}` });
});
route('GET', '/api/v1/payments/verify/:ref', async (ctx) => {
  const payment = db.payments.find((p) => p.ref === ctx.params.ref);
  if (!payment) return ctx.send(404, { error: 'unknown reference' });
  if (paystack.LIVE && payment.status === 'pending') {
    const data = await paystack.verify(payment.ref).catch(() => null);
    if (data?.status === 'success') await fulfil(payment);
  }
  ctx.send(200, { payment });
}, { auth: true });
route('GET', '/api/v1/payments', (ctx) => ctx.send(200, { payments: db.payments.filter((p) => p.user_id === ctx.user.id) }), { auth: true });
route('POST', '/api/v1/webhooks/paystack', async (ctx) => {
  const sig = ctx.req.headers['x-paystack-signature'];
  if (paystack.LIVE && !paystack.validWebhookSignature(ctx.raw || '', sig)) return ctx.send(400, { error: 'bad signature' });
  if (ctx.body.event === 'charge.success') {
    const payment = db.payments.find((p) => p.ref === ctx.body.data?.reference);
    if (payment) await fulfil(payment);
  }
  ctx.send(200, { ok: true });
});
route('GET', '/pay/sim', (ctx) => {
  if (paystack.LIVE) return ctx.send(404, { error: 'not found' });
  const payment = db.payments.find((p) => p.ref === ctx.query.ref);
  if (!payment) return ctx.sendDoc('<h1>Unknown payment reference</h1>');
  const amt = `₦${Number(payment.amount / 100).toLocaleString('en-NG')}`;
  ctx.sendDoc(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paystack Test Checkout — NearBuyGoods</title>
  <style>body{font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#f2f4f7;margin:0;display:grid;place-items:center;min-height:100vh;padding:18px}
  .box{width:min(420px,100%);background:#fff;border-radius:18px;box-shadow:0 10px 40px rgba(0,0,0,.12);overflow:hidden}
  .hd{background:#0984e3;color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center}
  .hd b{font-size:1.05rem}.hd span{font-size:.75rem;background:rgba(255,255,255,.2);padding:4px 10px;border-radius:999px}
  .bd{padding:20px}.m{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eef0f4;font-size:.9rem}
  .m b{font-weight:700}.amt{font-size:1.6rem;font-weight:800;margin:14px 0 4px}
  .card{background:#f8f9fb;border:1px dashed #cfd6e0;border-radius:12px;padding:12px 14px;font-family:monospace;font-size:.95rem;margin:14px 0;color:#334}
  .note{font-size:.75rem;color:#68718a;margin:0 0 16px}
  button{width:100%;min-height:48px;border:0;border-radius:12px;font:inherit;font-weight:700;cursor:pointer;margin-top:8px}
  .ok{background:#0984e3;color:#fff}.no{background:#eef0f4;color:#555}</style></head>
  <body><div class="box"><div class="hd"><b>Paystack · Test mode</b><span>SIMULATED</span></div><div class="bd">
  <div class="m"><span>Merchant</span><b>NearBuyGoods</b></div>
  <div class="m"><span>Description</span><b>${payment.label}</b></div>
  <div class="m"><span>Reference</span><b>${payment.ref}</b></div>
  <div class="amt">${amt}</div>
  <div class="card">Card 4084 0840 8408 4081 · Exp any future · CVV any</div>
  <p class="note">No keys configured, so this branded simulator stands in for Paystack's hosted checkout. Set PAYSTACK_SECRET_KEY to switch to the real API — same fulfilment path.</p>
  <button class="ok" id="ok">Pay ${amt} (test success)</button>
  <button class="no" id="no">Simulate failure</button>
  </div></div>
  <script>
  async function go(ok){
    const r = await fetch('/api/v1/payments/_sim/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref:${JSON.stringify(payment.ref)},ok})});
    const j = await r.json();
    location.hash=''; location.href = j.return_url || '/#/premium';
  }
  document.getElementById('ok').onclick=()=>go(true);
  document.getElementById('no').onclick=()=>go(false);
  </script></body></html>`);
});

/* ---- notifications ---- */
route('GET', '/api/v1/notifications', (ctx) => {
  ctx.send(200, { notifications: db.notifications.filter((n) => n.user_id === ctx.user.id) });
}, { auth: true });
route('POST', '/api/v1/notifications/read-all', (ctx) => {
  db.notifications.forEach((n) => { if (n.user_id === ctx.user.id) n.read = true; });
  ctx.send(200, { ok: true });
}, { auth: true });
route('POST', '/api/v1/notifications/:id/read', (ctx) => {
  const n = byId(db.notifications, ctx.params.id);
  if (n && n.user_id === ctx.user.id) n.read = true;
  ctx.send(200, { ok: true });
}, { auth: true });

/* ---- reservations ---- */
route('POST', '/api/v1/reservations', (ctx) => {
  const { store_id, product_id, qty = 1 } = ctx.body;
  const offer = db.offers.find((o) => o.store_id === store_id && o.product_id === product_id);
  if (!offer) return ctx.send(404, { error: 'offer not found' });
  if (offer.stock < qty) return ctx.send(409, { error: 'insufficient stock' });
  offer.stock -= qty;
  const res = { id: nid('reservation'), code: `NBG-${1000 + Math.floor(Math.random() * 9000)}`, user_id: ctx.user.id, store_id, product_id, qty: Number(qty), status: 'pending', created: new Date().toISOString() };
  db.reservations.unshift(res);
  award(ctx.user, 10, 'reservations');
  const st = byId(db.stores, store_id);
  notify(st.owner_id, 'reservation', `New reservation ${res.code}`, `${ctx.user.name} reserved ${qty}× ${byId(db.products, product_id).name}.`, { route: '#/business' });
  ctx.send(201, { reservation: res });
}, { auth: true });
route('GET', '/api/v1/reservations', (ctx) => {
  let list = db.reservations;
  if (ctx.user.role === 'store_owner') {
    const myStores = db.stores.filter((s) => s.owner_id === ctx.user.id).map((s) => s.id);
    list = list.filter((r) => myStores.includes(r.store_id));
  } else if (ctx.user.role !== 'admin') list = list.filter((r) => r.user_id === ctx.user.id);
  const enriched = list.map((r) => ({ ...r, store: byId(db.stores, r.store_id)?.name, product: byId(db.products, r.product_id)?.name, emoji: byId(db.products, r.product_id)?.emoji, customer: byId(db.users, r.user_id)?.name }));
  ctx.send(200, { reservations: enriched });
}, { auth: true });
route('POST', '/api/v1/reservations/:id/status', (ctx) => {
  const r = byId(db.reservations, ctx.params.id);
  if (!r) return ctx.send(404, { error: 'not found' });
  const st = byId(db.stores, r.store_id);
  if (ctx.user.role !== 'admin' && st.owner_id !== ctx.user.id) return ctx.send(403, { error: 'forbidden' });
  const status = ctx.body.status;
  if (!['pending', 'paid', 'ready', 'completed', 'cancelled'].includes(status)) return ctx.send(400, { error: 'bad status' });
  if (status === 'cancelled' && r.status !== 'cancelled') { const o = db.offers.find((x) => x.store_id === r.store_id && x.product_id === r.product_id); if (o) o.stock += r.qty; }
  r.status = status;
  const labels = { ready: 'is ready for pickup 🎉', completed: 'completed ✅', cancelled: 'was cancelled', pending: 'updated' };
  notify(r.user_id, 'reservation', `Reservation ${r.code} ${labels[status]}`, `${st.name} — ${byId(db.products, r.product_id).name}`, { route: '#/saved' });
  ctx.send(200, { reservation: r });
}, { auth: true });

/* ---- analytics events (client beacons) ---- */
route('POST', '/api/v1/events', (ctx) => {
  const { type, offer_id, store_id, product_id } = ctx.body || {};
  const offer = offer_id ? byId(db.offers, offer_id) : null;
  const store = store_id ? byId(db.stores, store_id) : null;
  if (type === 'product_view') { if (offer) offer.views++; if (store) store.views++; }
  if (type === 'offer_click') { if (offer) offer.clicks++; if (store) store.clicks = (store.clicks || 0) + 1; }
  if (type === 'store_view' && store) store.views++;
  ctx.send(204, {});
});

/* ---- business (store owner) ---- */
const ownerStores = (u) => db.stores.filter((s) => s.owner_id === u.id);
route('GET', '/api/v1/business/stores', (ctx) => {
  ctx.send(200, { stores: ownerStores(ctx.user).map((s) => storeSummary(s)) });
}, { auth: true, roles: ['store_owner', 'admin'] });
route('POST', '/api/v1/business/stores', (ctx) => {
  const b = ctx.body;
  const s = { id: nid('store'), name: b.name, owner_id: ctx.user.id, tags: b.tags || [], desc: b.desc || '', address: b.address || '', area: b.area || '', city: b.city || 'Lagos', lat: Number(b.lat) || 6.5244, lng: Number(b.lng) || 3.3792, phone: b.phone || '', email: b.email || '', verified: false, tz: 1, hours: b.hours || { 0: ['09:00', '18:00'], 1: ['09:00', '18:00'], 2: ['09:00', '18:00'], 3: ['09:00', '18:00'], 4: ['09:00', '18:00'], 5: ['09:00', '18:00'], 6: ['09:00', '18:00'] }, payments: ['card', 'transfer'], delivery: !!b.delivery, curbside: false, pickup: true, wheelchair: false, emoji: b.emoji || '🏪', followers: 0, views: 0, matches: 0, clicks: 0, geohash: geohash(Number(b.lat) || 6.5244, Number(b.lng) || 3.3792) };
  db.stores.push(s);
  ctx.send(201, { store: storeSummary(s) });
}, { auth: true, roles: ['store_owner', 'admin'] });
route('GET', '/api/v1/business/inventory', (ctx) => {
  const storeId = ctx.query.store_id;
  const mine = ownerStores(ctx.user).map((s) => s.id);
  const offs = db.offers.filter((o) => (storeId ? o.store_id === storeId : mine.includes(o.store_id)))
    .map((o) => ({ ...o, product: byId(db.products, o.product_id), store_name: byId(db.stores, o.store_id)?.name }));
  ctx.send(200, { inventory: offs });
}, { auth: true, roles: ['store_owner', 'admin'] });
route('POST', '/api/v1/business/inventory', (ctx) => {
  const b = ctx.body;
  const store = byId(db.stores, b.store_id);
  if (!store || (store.owner_id !== ctx.user.id && ctx.user.role !== 'admin')) return ctx.send(403, { error: 'forbidden' });
  let product = b.product_id ? byId(db.products, b.product_id) : null;
  if (!product) {
    product = { id: nid('product'), name: b.name || 'New item', brand: b.brand || store.name, category: b.category || 'groceries', emoji: b.emoji || '📦', tags: (b.tags || '').split(',').map((t) => t.trim()).filter(Boolean), colors: b.colors || [], barcode: b.barcode || null, desc: b.desc || '', created: new Date().toISOString() };
    db.products.push(product);
  }
  const offer = { id: nid('offer'), store_id: store.id, product_id: product.id, price: Number(b.price) || 0, currency: 'NGN', stock: Number(b.stock) || 0, condition: 'new', updated_at: new Date().toISOString(), price_history: [{ t: new Date().toISOString(), price: Number(b.price) || 0 }], views: 0, clicks: 0 };
  db.offers.push(offer);
  ctx.send(201, { offer });
}, { auth: true, roles: ['store_owner', 'admin'] });
route('PUT', '/api/v1/business/inventory/:offerId', (ctx) => {
  const o = byId(db.offers, ctx.params.offerId);
  if (!o) return ctx.send(404, { error: 'not found' });
  const store = byId(db.stores, o.store_id);
  if (store.owner_id !== ctx.user.id && ctx.user.role !== 'admin') return ctx.send(403, { error: 'forbidden' });
  const b = ctx.body;
  if (b.price != null && Number(b.price) !== o.price) {
    const old = o.price;
    o.price = Number(b.price);
    o.price_history.push({ t: new Date().toISOString(), price: o.price });
    o.updated_at = new Date().toISOString();
    if (o.price < old) {
      for (const sv of db.saved.filter((x) => x.product_id === o.product_id && x.watch)) {
        notify(sv.user_id, 'price_drop', `Price drop: ${byId(db.products, o.product_id).name}`, `${store.name} now ₦${fmtN(o.price)} (was ₦${fmtN(old)}).`, { route: `#/product/${o.product_id}` });
      }
    }
  }
  if (b.stock != null) {
    const old = o.stock;
    o.stock = Number(b.stock);
    o.updated_at = new Date().toISOString();
    if (old === 0 && o.stock > 0) {
      for (const sv of db.saved.filter((x) => x.product_id === o.product_id && x.watch)) {
        notify(sv.user_id, 'back_in_stock', `Back in stock: ${byId(db.products, o.product_id).name}`, `Available again at ${store.name} — ₦${fmtN(o.price)}.`, { route: `#/product/${o.product_id}` });
      }
    }
  }
  ctx.send(200, { offer: o });
}, { auth: true, roles: ['store_owner', 'admin'] });
route('POST', '/api/v1/business/deals', (ctx) => {
  const b = ctx.body;
  const store = byId(db.stores, b.store_id);
  if (!store || (store.owner_id !== ctx.user.id && ctx.user.role !== 'admin')) return ctx.send(403, { error: 'forbidden' });
  const deal = { id: nid('deal'), store_id: store.id, title: b.title || 'Special offer', pct: Number(b.pct) || 5, product_ids: b.product_ids || [], ends_at: new Date(Date.now() + (Number(b.days) || 3) * 86400e3).toISOString(), created: new Date().toISOString() };
  db.deals.unshift(deal);
  for (const u of db.users) {
    if (u.id === ctx.user.id || !u.prefs?.notify_deals) continue;
    const d = haversineKm(u.prefs.lat ?? 6.5244, u.prefs.lng ?? 3.3792, store.lat, store.lng);
    if (d <= (u.prefs.radius_km ?? 10)) notify(u.id, 'deal', `Deal near you: ${deal.pct}% off at ${store.name}`, deal.title, { route: `#/store/${store.id}` });
  }
  ctx.send(201, { deal });
}, { auth: true, roles: ['store_owner', 'admin'] });
route('GET', '/api/v1/business/analytics', (ctx) => {
  const storeId = ctx.query.store_id;
  const mine = ownerStores(ctx.user).map((s) => s.id);
  const ids = storeId ? [storeId] : mine;
  const offs = db.offers.filter((o) => ids.includes(o.store_id));
  const ress = db.reservations.filter((r) => ids.includes(r.store_id));
  const revenue = ress.filter((r) => r.status !== 'cancelled').reduce((a, r) => {
    const o = db.offers.find((x) => x.store_id === r.store_id && x.product_id === r.product_id);
    return a + (o ? o.price * r.qty : 0);
  }, 0);
  const top = [...offs].sort((a, b) => b.views - a.views).slice(0, 5).map((o) => ({ product: byId(db.products, o.product_id)?.name, views: o.views, clicks: o.clicks, stock: o.stock }));
  ctx.send(200, {
    kpis: {
      views: offs.reduce((a, o) => a + o.views, 0), clicks: offs.reduce((a, o) => a + o.clicks, 0),
      matches: db.stores.filter((s) => ids.includes(s.id)).reduce((a, s) => a + (s.matches || 0), 0),
      reservations: ress.length, revenue,
    },
    spark: db.meta.spark, top_products: top,
    reservations_by_status: ['pending', 'ready', 'completed', 'cancelled'].map((st) => ({ status: st, count: ress.filter((r) => r.status === st).length })),
  });
}, { auth: true, roles: ['store_owner', 'admin'] });

/* ---- admin ---- */
route('GET', '/api/v1/admin/stats', (ctx) => {
  ctx.send(200, {
    counts: { users: db.users.length, stores: db.stores.length, products: db.products.length, offers: db.offers.length, reservations: db.reservations.length, reviews: db.reviews.length, open_flags: db.flags.filter((f) => f.status === 'open').length },
    top_searches: [...db.searches].sort((a, b) => b.count - a.count).slice(0, 6),
    health: { uptime_s: Math.round(process.uptime()), mem_mb: Math.round(process.memoryUsage().rss / 1e6), node: process.version },
    feature_flags: db.meta.flags,
  });
}, { auth: true, roles: ['admin'] });
route('PUT', '/api/v1/admin/flags/:flagId', (ctx) => {
  ctx.send(200, { feature_flags: Object.assign(db.meta.flags, ctx.body.flags || {}) });
}, { auth: true, roles: ['admin'] });
route('GET', '/api/v1/admin/flags', (ctx) => ctx.send(200, { flags: db.flags }), { auth: true, roles: ['admin'] });
route('POST', '/api/v1/admin/flags/:id/resolve', (ctx) => {
  const f = byId(db.flags, ctx.params.id);
  if (f) f.status = ctx.body.status === 'dismissed' ? 'dismissed' : 'resolved';
  ctx.send(200, { flag: f });
}, { auth: true, roles: ['admin'] });

/* ------------------------------------------------------- openapi/docs ---- */
const OPENAPI = {
  openapi: '3.0.3',
  info: { title: 'NearBuyGoods API', version: VERSION, description: 'REST service layer for the NearBuyGoods web PWA and native mobile clients. JSON in/out, Bearer JWT auth, CORS-enabled for Capacitor origins.' },
  servers: [{ url: '/api/v1' }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
  paths: {
    '/auth/register': { post: { tags: ['auth'], summary: 'Create account (shopper or store_owner)' } },
    '/auth/login': { post: { tags: ['auth'], summary: 'Email + password login, returns JWT' } },
    '/auth/otp/request': { post: { tags: ['auth'], summary: 'Request phone OTP (dev returns code)' } },
    '/auth/me': { get: { tags: ['auth'], summary: 'Current user profile', security: [{ bearerAuth: [] }] } },
    '/auth/prefs': { put: { tags: ['auth'], summary: 'Update preferences (radius, units, currency, a11y)', security: [{ bearerAuth: [] }] } },
    '/meta': { get: { tags: ['catalog'], summary: 'App meta: currency, city, categories, feature flags, demo accounts' } },
    '/categories': { get: { tags: ['catalog'], summary: 'Category taxonomy' } },
    '/trending': { get: { tags: ['catalog'], summary: 'Trending searches' } },
    '/search': { post: { tags: ['discovery'], summary: 'Geo-radius product search with filters, sorting, paging' } },
    '/recognize': { post: { tags: ['discovery'], summary: 'AI item recognition from image signals (colors, filename/text tokens, barcode, hints)' } },
    '/products/{id}': { get: { tags: ['discovery'], summary: 'Product detail with cross-store offers & reviews' } },
    '/products/{id}/history': { get: { tags: ['discovery'], summary: 'Price history per offer' } },
    '/products/{id}/reviews': { post: { tags: ['social'], summary: 'Add product review', security: [{ bearerAuth: [] }] } },
    '/stores': { get: { tags: ['discovery'], summary: 'Stores within radius, nearest first' } },
    '/stores/{id}': { get: { tags: ['discovery'], summary: 'Store profile + live open/closed + active deals' } },
    '/stores/{id}/inventory': { get: { tags: ['discovery'], summary: 'Store inventory (offers)' } },
    '/stores/{id}/reviews': { post: { tags: ['social'], summary: 'Add store review', security: [{ bearerAuth: [] }] } },
    '/deals': { get: { tags: ['deals'], summary: 'Active deals near location' } },
    '/saved': { get: { tags: ['saved'], summary: 'Saved items & watchlist with price deltas', security: [{ bearerAuth: [] }] } },
    '/saved/{productId}': { delete: { tags: ['saved'], summary: 'Remove saved item', security: [{ bearerAuth: [] }] } },
    '/notifications': { get: { tags: ['alerts'], summary: 'Notification center', security: [{ bearerAuth: [] }] } },
    '/notifications/read-all': { post: { tags: ['alerts'], summary: 'Mark all read', security: [{ bearerAuth: [] }] } },
    '/reservations': { post: { tags: ['commerce'], summary: 'Reserve/hold item at store (BOPIS)', security: [{ bearerAuth: [] }] } },
    '/reservations/{id}/status': { post: { tags: ['commerce'], summary: 'Owner updates reservation status', security: [{ bearerAuth: [] }] } },
    '/events': { post: { tags: ['analytics'], summary: 'Beacon: product_view / offer_click / store_view' } },
    '/business/stores': { get: { tags: ['business'], summary: 'My stores', security: [{ bearerAuth: [] }] } },
    '/business/inventory': { post: { tags: ['business'], summary: 'Create listing (new or existing product)', security: [{ bearerAuth: [] }] } },
    '/business/inventory/{offerId}': { put: { tags: ['business'], summary: 'Update price/stock (triggers watch alerts)', security: [{ bearerAuth: [] }] } },
    '/business/deals': { post: { tags: ['business'], summary: 'Post deal (notifies shoppers in radius)', security: [{ bearerAuth: [] }] } },
    '/business/analytics': { get: { tags: ['business'], summary: 'KPIs, sparklines, top products', security: [{ bearerAuth: [] }] } },
    '/admin/stats': { get: { tags: ['admin'], summary: 'Platform counts, top searches, health', security: [{ bearerAuth: [] }] } },
    '/admin/flags': { get: { tags: ['admin'], summary: 'Moderation queue', security: [{ bearerAuth: [] }] } },
    '/admin/flags/{id}/resolve': { post: { tags: ['admin'], summary: 'Resolve/dismiss flag', security: [{ bearerAuth: [] }] } },
    '/geo/geocode': { get: { tags: ['discovery'], summary: 'Geocode manual location entry (Nominatim proxy + offline gazetteer)' } },
    '/push/vapid-public': { get: { tags: ['alerts'], summary: 'VAPID public key for Web Push subscription' } },
    '/push/subscribe': { post: { tags: ['alerts'], summary: 'Register push subscription (RFC 8030)', security: [{ bearerAuth: [] }] } },
    '/push/status': { get: { tags: ['alerts'], summary: 'Is this device push-subscribed?', security: [{ bearerAuth: [] }] } },
    '/history': { get: { tags: ['discovery'], summary: 'Personal search history', security: [{ bearerAuth: [] }] } },
    '/history/{id}': { delete: { tags: ['discovery'], summary: 'Delete one history entry', security: [{ bearerAuth: [] }] } },
    '/collections': { post: { tags: ['saved'], summary: 'Create named collection', security: [{ bearerAuth: [] }] } },
    '/collections/{id}': { delete: { tags: ['saved'], summary: 'Delete collection (items return to All)', security: [{ bearerAuth: [] }] } },
    '/payments/plans': { get: { tags: ['commerce'], summary: 'Subscription plans + gateway mode (test/live)' } },
    '/payments/initialize': { post: { tags: ['commerce'], summary: 'Start Paystack checkout (reservation prepay or subscription)', security: [{ bearerAuth: [] }] } },
    '/payments/verify/{ref}': { get: { tags: ['commerce'], summary: 'Verify & fulfil payment (idempotent)', security: [{ bearerAuth: [] }] } },
    '/payments': { get: { tags: ['commerce'], summary: 'Payment history / digital receipts', security: [{ bearerAuth: [] }] } },
    '/webhooks/paystack': { post: { tags: ['commerce'], summary: 'Paystack charge.success webhook (HMAC-SHA512 verified)' } },
  },
};
route('GET', '/api/openapi.json', (ctx) => ctx.send(200, OPENAPI));
route('GET', '/api/docs', (ctx) => {
  const groups = {};
  for (const [p, methods] of Object.entries(OPENAPI.paths)) for (const [m, def] of Object.entries(methods)) {
    const t = def.tags[0];
    (groups[t] = groups[t] || []).push({ m: m.toUpperCase(), p, s: def.summary, auth: !!def.security });
  }
  const rows = Object.entries(groups).map(([g, items]) => `
    <section><h2>${g}</h2><table>${items.map((i) => `<tr><td><code class="${i.m.toLowerCase()}">${i.m}</code></td><td><code>${i.p}</code></td><td>${i.s}${i.auth ? ' 🔐' : ''}</td></tr>`).join('')}</table></section>`).join('');
  ctx.sendDoc(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NearBuyGoods API docs</title>
  <style>body{font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f6f7fb;color:#243041}header{background:#232c5c;color:#fff;padding:22px 18px}header h1{margin:0;font-size:20px}header p{margin:6px 0 0;opacity:.85;font-size:13px}main{max-width:860px;margin:0 auto;padding:18px}section{background:#fff;border:1px solid #e3e6ef;border-radius:14px;padding:14px 16px;margin:0 0 14px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#e87b29;margin:4px 0 10px}table{width:100%;border-collapse:collapse}td{padding:7px 6px;border-bottom:1px solid #eef0f6;font-size:13px;vertical-align:top}tr:last-child td{border:0}code{background:#f0f2f8;padding:2px 6px;border-radius:6px;font-size:12px}.get{color:#0a7d5c}.post{color:#b3541e}.put{color:#1d4ed8}.delete{color:#b91c1c}a{color:#1d4ed8}</style></head>
  <body><header><h1>NearBuyGoods API</h1><p>Base <code style="background:rgba(255,255,255,.15)">${'/api/v1'}</code> · v${VERSION} · <a style="color:#ffd9b8" href="/api/openapi.json">openapi.json</a> · Bearer JWT 🔐</p></header><main>${rows}</main></body></html>`);
});
route('GET', '/api/health', (ctx) => ctx.send(200, { ok: true, version: VERSION, uptime_s: Math.round(process.uptime()) }));

/* ------------------------------------------------------------- server ---- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

export async function handler(req, res) {
  await initStorage();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const isApi = p.startsWith('/api');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (isApi) {
   try {
    let body = {};
    let raw = '';
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      raw = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (c) => { data += c; if (data.length > 8e6) reject(new Error('too large')); });
        req.on('end', () => resolve(data));
        req.on('error', reject);
      }).catch(() => '');
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    }
    let user = null;
    const authHdr = req.headers.authorization || '';
    if (authHdr.startsWith('Bearer ')) {
      const payload = verifyToken(authHdr.slice(7));
      if (payload) user = byId(db.users, payload.sub) || null;
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.rx.exec(p);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const ip = req.socket.remoteAddress || 'x';
      if (r.opts.limit && rateLimited(ip, r.opts.limit)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'rate limited' })); return; }
      if (r.opts.auth && !user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
      if (r.opts.roles && (!user || !r.opts.roles.includes(user.role))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'forbidden' })); return; }
      const ctx = {
        req, res, body, params, user, raw,
        query: Object.fromEntries(url.searchParams),
        send: (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(code === 204 ? undefined : JSON.stringify(obj)); saveDb(); },
        sendDoc: (html) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); },
      };
      try { await r.handler(ctx); } catch (e) {
        console.error('[api error]', p, e);
        if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'internal error' })); }
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
   } catch (fatal) {
    console.error('[api fatal]', p, fatal);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'internal error' })); }
    return;
   }
  }

  // static files
  let file = p === '/' ? '/index.html' : p;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(full, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Security-Policy': csp() });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const cache = ext === '.html' || file === '/sw.js' ? 'no-cache' : 'public, max-age=86400';
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache };
    if (ext === '.html') headers['Content-Security-Policy'] = csp();
    res.writeHead(200, headers);
    res.end(data);
  });
}
export default handler; // Vercel's serverless launcher requires a default export

function csp() {
  return "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; media-src 'self' blob:; base-uri 'self'";
}
if (!onVercel) {
  const server = http.createServer(handler);
  initStorage().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`NearBuyGoods API + PWA listening on http://0.0.0.0:${PORT} (v${VERSION})`);
    });
  });
}
