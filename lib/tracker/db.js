/**
 * NearBuyGoods Project Tracker — storage drivers.
 *
 * Auto-detects the best available database, in this order:
 *
 *   1. Neon / Postgres over HTTP   → DATABASE_URL (Vercel Postgres, Neon,
 *      any Postgres with the Neon serverless HTTP endpoint). Real SQL tables
 *      `nb_trk_*`, created + indexed on first request. No npm dependency:
 *      we speak the documented `/sql` HTTP protocol with fetch().
 *   2. Vercel KV / Upstash REST    → KV_REST_API_URL + KV_REST_API_TOKEN
 *      (same store the main app already uses). One gzip'd JSON document.
 *   3. Local file / in-memory      → `node server.js` developer mode.
 *
 * All three expose the identical row API, so the tracker's business logic
 * never branches on which database is attached.
 *
 *   const store = await openStore();
 *   await store.insert('features', {...});
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { TABLES } from './schema.js';

const PK = (t) => TABLES[t].pk;
const COLS = (t) => Object.entries(TABLES[t].columns);

const pgCast = (table, col, placeholder) => {
  const type = TABLES[table].columns[col];
  return isJson(type) ? `${placeholder}::jsonb` : isTs(type) ? `${placeholder}::timestamptz` : type === 'bool' ? `${placeholder}::boolean` : type === 'int' ? `${placeholder}::int` : placeholder;
};
const pgValue = (table, col, v) => {
  const type = TABLES[table].columns[col];
  if (isJson(type)) return v == null ? null : JSON.stringify(v);
  if (type === 'int') return v == null ? null : Math.trunc(Number(v)) || 0;
  if (type === 'bool') return !!v;
  return v == null ? null : String(v);
};

const isJson = (type) => type === 'jsonb';
const isTs = (type) => type === 'timestamptz';

/** Normalise a hydrated row: dates → ISO strings, jsonb → object. */
function hydrate(table, row) {
  if (row == null) return null;
  const out = {};
  for (const [col, type] of COLS(table)) {
    let v = row[col];
    if (v === undefined) v = null;
    if (isTs(type) && v != null) {
      const d = v instanceof Date ? v : new Date(v);
      v = Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (type === 'int' && v != null) v = Number(v);
    if (type === 'bool' && v != null) v = v === true || v === 'true' || v === 't' || v === 1;
    if (isJson(type) && typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
    out[col] = v;
  }
  return out;
}

/* ----------------------------------------------------------- Neon (SQL) ---- */

function parseConn(conn) {
  // postgresql://user:pass@host/db?sslmode=require
  const u = new URL(conn);
  const host = u.hostname;
  const rest = host.split('.').slice(1).join('.');
  return { conn, host, altHost: rest ? `api.${rest}` : null };
}

class NeonDriver {
  constructor(conn, { endpoint = '' } = {}) {
    this.mode = 'neon';
    this.label = `Neon Postgres (${new URL(conn).hostname})`;
    this.info = parseConn(conn);
    this.base = endpoint ? endpoint.replace(/\/+$/, '') : null; // TRACKER_SQL_ENDPOINT
    this.endpoint = null; // resolved on first query
  }

  async sql(query, params = []) {
    if (this.base) return this.post(`${this.base}/sql`, query, params);
    const hosts = [this.endpoint?.host || this.info.host, this.info.altHost].filter(Boolean);
    let lastErr;
    for (const host of hosts) {
      const url = `https://${host}/sql`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': this.info.conn },
          body: JSON.stringify({ query, params }),
        });
        const text = await res.text();
        let data;
        try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 300) }; }
        if (!res.ok) throw new Error(`Neon ${res.status}: ${data.message || data.error || 'query failed'}`);
        this.endpoint = { host };
        return data;
      } catch (e) {
        lastErr = e;
        // Only fall through to the alternate host when the request never reached
        // the database (DNS/TLS). SQL errors are real errors — surface them.
        if (/^Neon \d/.test(e.message)) throw e;
      }
    }
    throw new Error(`Neon unreachable: ${lastErr?.message || 'network error'}`);
  }

  async post(url, query, params) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': this.info.conn },
      body: JSON.stringify({ query, params }),
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 300) }; }
    if (!res.ok) throw new Error(`Neon ${res.status}: ${data.message || data.error || 'query failed'}`);
    return data;
  }

  /** Raw escape hatch (analytics, ad-hoc reads). */
  async raw(query, params = []) { const r = await this.sql(query, params); return (r.rows || []).map((row) => row); }

  async ensure() {
    // One batched round trip: CREATE TABLE/CREATE INDEX IF NOT EXISTS are
    // idempotent, and a cold start shouldn't pay 20 HTTP calls for DDL.
    const stmts = [];
    for (const [table, def] of Object.entries(TABLES)) {
      const cols = COLS(table).map(([c, t]) => `${c} ${t === 'jsonb' ? 'jsonb' : t === 'timestamptz' ? 'timestamptz' : t === 'int' ? 'integer' : t === 'bool' ? 'boolean' : 'text'}`);
      stmts.push(`CREATE TABLE IF NOT EXISTS nb_trk_${table} (${cols.join(', ')}, PRIMARY KEY (${PK(table)}))`);
      for (const idx of def.indexes || []) {
        stmts.push(`CREATE INDEX IF NOT EXISTS nb_trk_${table}_${idx.join('_')}_idx ON nb_trk_${table} (${idx.join(', ')})`);
      }
    }
    await this.sql(stmts.join(';\n'));
  }

  async all(table) {
    const r = await this.sql(`SELECT * FROM nb_trk_${table}`);
    return (r.rows || []).map((row) => hydrate(table, row));
  }

  async get(table, id) {
    const r = await this.sql(`SELECT * FROM nb_trk_${table} WHERE ${PK(table)} = $1 LIMIT 1`, [String(id)]);
    return r.rows?.[0] ? hydrate(table, r.rows[0]) : null;
  }

  /** `col IN ($1, $2, …)` — explicit lists bind identically on every Postgres client. */
  whereClause(entries, params, cast = String) {
    return entries.map(([col, v]) => {
      if (Array.isArray(v)) {
        const list = v.map(cast).filter((x) => x !== '' && x != null);
        if (!list.length) return 'FALSE';
        return `${col} IN (${list.map((x) => { params.push(x); return `$${params.length}`; }).join(', ')})`;
      }
      params.push(cast(v));
      return `${col} = $${params.length}`;
    });
  }

  async find(table, where = {}) {
    const entries = Object.entries(where).filter(([, v]) => v !== undefined);
    if (!entries.length) return this.all(table);
    const params = [];
    const clauses = this.whereClause(entries, params);
    const r = await this.sql(`SELECT * FROM nb_trk_${table} WHERE ${clauses.join(' AND ')}`, params);
    return (r.rows || []).map((row) => hydrate(table, row));
  }

  async insert(table, rows) {
    const list = Array.isArray(rows) ? rows : [rows];
    if (!list.length) return list;
    const cols = COLS(table).map(([c]) => c);
    // One round trip per ~3000 parameters (max is 65535): a 389-row import or a
    // 40-card drag lands in a couple of statements instead of hundreds.
    const chunkSize = Math.max(1, Math.min(list.length, Math.floor(3000 / cols.length)));
    for (let i = 0; i < list.length; i += chunkSize) {
      const params = [];
      const groups = list.slice(i, i + chunkSize).map((row) => `(${cols
        .map((col) => { params.push(pgValue(table, col, row[col] ?? null)); return pgCast(table, col, `$${params.length}`); })
        .join(', ')})`);
      await this.sql(
        `INSERT INTO nb_trk_${table} (${cols.join(', ')}) VALUES ${groups.join(', ')}`
        + ` ON CONFLICT (${PK(table)}) DO UPDATE SET ${cols.filter((c) => c !== PK(table)).map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
        params,
      );
    }
    return list;
  }

  /** Patch many rows with one statement (`UPDATE … WHERE id = ANY(ids)`). */
  async updateMany(table, ids, patch) {
    const list = (ids || []).map(String).filter(Boolean);
    const entries = Object.entries(patch || {}).filter(([c]) => c in TABLES[table].columns && c !== PK(table));
    if (!list.length || !entries.length) return 0;
    const params = [];
    const sets = entries.map(([col, v]) => {
      params.push(pgValue(table, col, v));
      return `${col} = ${pgCast(table, col, `$${params.length}`)}`;
    });
    const ph = list.map((id) => { params.push(id); return `$${params.length}`; });
    const r = await this.sql(`UPDATE nb_trk_${table} SET ${sets.join(', ')} WHERE ${PK(table)} IN (${ph.join(', ')})`, params);
    return r.rowCount || list.length;
  }

  async update(table, id, patch) {
    const entries = Object.entries(patch).filter(([c]) => c in TABLES[table].columns && c !== PK(table));
    if (!entries.length) return this.get(table, id);
    const params = [];
    const sets = entries.map(([col, v]) => {
      params.push(pgValue(table, col, v));
      return `${col} = ${pgCast(table, col, `$${params.length}`)}`;
    });
    params.push(String(id));
    await this.sql(`UPDATE nb_trk_${table} SET ${sets.join(', ')} WHERE ${PK(table)} = $${params.length}`, params);
    return this.get(table, id);
  }

  async remove(table, id) { await this.sql(`DELETE FROM nb_trk_${table} WHERE ${PK(table)} = $1`, [String(id)]); }

  async removeWhere(table, where = {}) {
    const entries = Object.entries(where).filter(([, v]) => v !== undefined);
    if (!entries.length) return 0;
    const params = [];
    const clauses = this.whereClause(entries, params);
    const r = await this.sql(`DELETE FROM nb_trk_${table} WHERE ${clauses.join(' AND ')}`, params);
    return r.rowCount || 0;
  }

  async count(table) {
    const r = await this.sql(`SELECT COUNT(*)::int AS n FROM nb_trk_${table}`);
    return r.rows?.[0]?.n ?? 0;
  }

  flush() { /* every statement is already durable */ }
  async batch(fn) { return fn(); }   // one row per statement; no client-side batching needed
  async health() {
    const r = await this.sql('SELECT version() AS v');
    return { ok: true, detail: String(r.rows?.[0]?.v || '').split(',')[0] };
  }
}

/* ----------------------------------------------- Vercel KV / Upstash REST ---- */

class JsonDocDriver {
  constructor({ mode, label, key, file = null, url = '', token = '' }) {
    this.mode = mode; this.label = label; this.key = key; this.file = file; this.url = url; this.token = token;
    this.doc = null;
    this.dirty = false;            // changes not yet written
    this.queue = Promise.resolve(); // serialised write queue
    this.batching = 0;             // >0 while coalescing a bulk operation
  }

  async kvCmd(cmd) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    if (!res.ok) throw new Error(`KV ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).result;
  }

  blank() {
    const doc = { v: 1 };
    for (const t of Object.keys(TABLES)) doc[t] = [];
    return doc;
  }

  async ensure() {
    if (this.doc) return;
    if (this.url) {
      const blob = await this.kvCmd(['GET', this.key]).catch((e) => { console.error('[tracker/kv] load failed:', e.message); return null; });
      if (blob) {
        let parsed = null;
        try {
          parsed = typeof blob === 'string' && blob.startsWith('gz:')
            ? JSON.parse(gunzipSync(Buffer.from(blob.slice(3), 'base64')).toString('utf8'))
            : typeof blob === 'string' ? JSON.parse(blob) : blob;
        } catch (e) { console.error('[tracker/kv] corrupt payload, reseeding:', e.message); }
        this.doc = parsed || null;
      }
    } else if (this.file && fs.existsSync(this.file)) {
      try { this.doc = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.doc = null; }
    }
    const fresh = this.blank();
    const isNew = !this.doc;
    this.doc = this.doc || fresh;
    for (const t of Object.keys(TABLES)) if (!Array.isArray(this.doc[t])) this.doc[t] = [];
    if (isNew) { this.dirty = true; await this.flush(); }
  }

  /**
   * Persist the document. Writes are eager and awaitable (serverless functions
   * get frozen the moment the response is sent, so a debounce would lose data);
   * `batch()` coalesces them into one write for bulk operations.
   */
  /** The only place that touches storage. Serialised so concurrent writes can't interleave. */
  async writeSnapshot(snapshot) {
    if (this.url) {
      const gz = 'gz:' + gzipSync(Buffer.from(snapshot)).toString('base64');
      await this.kvCmd(['SET', this.key, gz]);
    } else if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, snapshot);
    }
  }

  /**
   * Persist the document. Writes are eager and awaitable (a serverless function
   * is frozen the moment it responds, so a debounce would lose data); `batch()`
   * coalesces many mutations into a single write.
   */
  async flush() {
    if (!this.doc) return;
    if (this.batching) { this.dirty = true; return; }
    if (!this.dirty) return this.queue;
    this.dirty = false;
    const snapshot = JSON.stringify(this.doc);   // captured before any await
    this.queue = this.queue
      .then(() => this.writeSnapshot(snapshot))
      .catch((e) => { this.dirty = true; console.error(`[tracker/${this.mode}] save failed:`, e.message); });
    await this.queue;
    if (this.dirty) return this.flush();         // changed while writing → write again
  }

  /** Run many mutations with a single write at the end (imports, bulk moves, seeding). */
  async batch(fn) {
    this.batching += 1;
    try { return await fn(); } finally {
      this.batching -= 1;
      if (!this.batching) await this.flush();
    }
  }

  async all(table) { return (this.doc[table] || []).map((r) => hydrate(table, r)); }

  async get(table, id) {
    const row = (this.doc[table] || []).find((r) => String(r[PK(table)]) === String(id));
    return row ? hydrate(table, row) : null;
  }

  async find(table, where = {}) {
    const entries = Object.entries(where).filter(([, v]) => v !== undefined);
    const rows = (this.doc[table] || []).filter((r) => entries.every(([c, v]) => (Array.isArray(v) ? v.map(String).includes(String(r[c])) : String(r[c]) === String(v))));
    return rows.map((r) => hydrate(table, r));
  }

  async insert(table, rows) {
    const list = Array.isArray(rows) ? rows : [rows];
    for (const row of list) {
      const clean = { id: String(row[PK(table)]) };
      for (const [col] of COLS(table)) clean[col] = row[col] ?? null;
      const arr = this.doc[table];
      const i = arr.findIndex((r) => String(r[PK(table)]) === String(clean[PK(table)]));
      if (i >= 0) arr[i] = { ...arr[i], ...clean }; else arr.push(clean);
    }
    this.dirty = true;
    await this.flush();
    return list;
  }

  async update(table, id, patch) {
    const arr = this.doc[table];
    const i = arr.findIndex((r) => String(r[PK(table)]) === String(id));
    if (i < 0) return null;
    for (const [col, v] of Object.entries(patch)) if (col in TABLES[table].columns) arr[i][col] = v ?? null;
    this.dirty = true;
    await this.flush();
    return hydrate(table, arr[i]);
  }

  async updateMany(table, ids, patch) {
    const wanted = new Set((ids || []).map(String));
    const arr = this.doc[table];
    let n = 0;
    for (let i = 0; i < arr.length; i += 1) {
      if (!wanted.has(String(arr[i][PK(table)]))) continue;
      for (const [col, v] of Object.entries(patch || {})) if (col in TABLES[table].columns) arr[i][col] = v ?? null;
      n += 1;
    }
    if (n) { this.dirty = true; await this.flush(); }
    return n;
  }

  async remove(table, id) {
    const arr = this.doc[table];
    const i = arr.findIndex((r) => String(r[PK(table)]) === String(id));
    if (i >= 0) { arr.splice(i, 1); this.dirty = true; await this.flush(); }
  }

  async removeWhere(table, where = {}) {
    const entries = Object.entries(where).filter(([, v]) => v !== undefined);
    const arr = this.doc[table];
    const keep = arr.filter((r) => !entries.every(([c, v]) => (Array.isArray(v) ? v.map(String).includes(String(r[c])) : String(r[c]) === String(v))));
    const removed = arr.length - keep.length;
    this.doc[table] = keep;
    if (removed) { this.dirty = true; await this.flush(); }
    return removed;
  }

  async count(table) { return (this.doc[table] || []).length; }
  async raw() { throw new Error('raw SQL is only available with a Postgres/Neon database'); }
  async health() { return { ok: true, detail: this.url ? 'KV reachable' : `file ${this.file}` }; }
}

/* -------------------------------------------------------------- factory ---- */

let singleton = null;

export async function openStore(env = process.env) {
  if (singleton) return singleton;
  const conn = env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || env.TRACKER_DATABASE_URL || '';
  const kvUrl = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '';
  const kvToken = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '';
  const onVercel = !!env.VERCEL;

  let store;
  if (conn && /^postgres(ql)?:\/\//.test(conn)) {
    store = new NeonDriver(conn, { endpoint: env.TRACKER_SQL_ENDPOINT || '' });
  } else if (kvUrl && kvToken) {
    store = new JsonDocDriver({ mode: 'kv', label: 'Vercel KV (Upstash REST)', key: 'nbg:tracker:v1', url: kvUrl, token: kvToken });
  } else {
    store = new JsonDocDriver({
      mode: onVercel ? 'memory' : 'file',
      label: onVercel ? 'in-memory (ephemeral — attach a database!)' : 'local file .data/tracker.json',
      key: 'local',
      file: onVercel ? null : path.join(process.cwd(), '.data', 'tracker.json'),
    });
  }
  await store.ensure();
  singleton = store;
  if (store.mode === 'memory') console.error('⚠️  [tracker] No database attached — tracker data is EPHEMERAL. Attach Neon Postgres (Vercel → Storage/Marketplace → Neon) or Vercel KV; DATABASE_URL or KV_REST_API_URL is read automatically.');
  return store;
}

export const resetStoreForTests = () => { singleton = null; };
