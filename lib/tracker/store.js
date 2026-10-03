/**
 * NearBuyGoods Project Tracker — domain logic.
 *
 * Sits on top of the storage driver (Neon / KV / file) and implements the
 * product: accounts, projects, workspaces, features, drag-and-drop
 * placements, comments, an activity feed, planning rules and statistics.
 *
 * Everything here is plain JSON in/out so the same functions power the REST
 * API, the SSE feed and (later) a mobile client.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABLES, FEATURE_STATUSES, PRIORITIES, DEFAULT_STAGES, STARTER_WORKSPACES } from './schema.js';
import { parseToImportRows, parseFeatureDoc } from './parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_FILE = path.resolve(__dirname, '../../docs/FEATURE_AUDIT.md');

const nowIso = () => new Date().toISOString();

/** Board stages that line up with the feature lifecycle (custom stages are ignored). */
const STAGE_STATUS = {
  backlog: 'backlog', next: 'planned', planned: 'planned', todo: 'backlog',
  doing: 'in_progress', 'in-progress': 'in_progress', in_progress: 'in_progress',
  review: 'review', in_review: 'review',
  done: 'shipped', shipped: 'shipped', complete: 'shipped', parked: 'parked',
};
const rid = (prefix) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const uniq = (a) => [...new Set(a)];

export function createTracker({ store, secret = 'nbg-tracker-dev-secret', demoMode = true, version = '1.0.0' }) {
  /* ------------------------------------------------------------- auth ---- */

  const hashPassword = (pw, salt = crypto.randomBytes(16).toString('hex')) => ({
    salt,
    hash: crypto.scryptSync(String(pw), salt, 32).toString('hex'),
  });

  const same = (a, b) => {
    const A = Buffer.from(String(a)); const B = Buffer.from(String(b));
    return A.length === B.length && crypto.timingSafeEqual(A, B);
  };

  const sign = (payload) => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  };

  const verify = (token) => {
    if (!token || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    if (!same(sig, expect)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (payload.exp && payload.exp < Date.now()) return null;
      return payload;
    } catch { return null; }
  };

  const publicAccount = (a) => (a ? { id: a.id, name: a.name, email: a.email, role: a.role, kind: a.kind, color: a.color, avatar: a.avatar, created: a.created } : null);

  const tokenFor = (account) => sign({ sub: account.id, typ: 'trk', exp: Date.now() + 1000 * 60 * 60 * 24 * 45 });

  async function accountFromRequest(req) {
    const hdr = req?.headers?.authorization || '';
    if (!hdr.startsWith('Bearer ')) return null;
    const payload = verify(hdr.slice(7));
    if (!payload) return null;
    return store.get('accounts', payload.sub);
  }

  async function register({ name, email, password }) {
    const mail = String(email || '').trim().toLowerCase();
    if (!name || !mail || !password) throw httpError(400, 'name, email and password are required');
    if (String(password).length < 8) throw httpError(400, 'password must be at least 8 characters');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw httpError(400, 'enter a valid email address');
    const existing = await store.find('accounts', { email: mail });
    if (existing.length) throw httpError(409, 'that email is already registered — sign in instead');
    const { hash, salt } = hashPassword(password);
    const account = {
      id: rid('usr'), name: String(name).slice(0, 80), email: mail, pass_hash: hash, salt,
      role: 'owner', kind: 'member', color: pickColor(mail), avatar: initials(name), created: nowIso(), last_seen: nowIso(),
    };
    await store.insert('accounts', account);
    // Everyone starts with their own project so the board is never empty.
    const project = await createProject(account, { name: 'NearBuyGoods', key: 'NBG', seed: 'audit' });
    await log(project.id, account, 'project.created', 'project', project.id, project.name, { seeded: true });
    return { token: tokenFor(account), account: publicAccount(account), project_id: project.id };
  }

  async function login({ email, password }) {
    const mail = String(email || '').trim().toLowerCase();
    const rows = await store.find('accounts', { email: mail });
    const account = rows[0];
    if (!account) throw httpError(401, 'no account with that email');
    const { hash } = hashPassword(password || '', account.salt);
    if (!same(hash, account.pass_hash)) throw httpError(401, 'wrong password');
    await store.update('accounts', account.id, { last_seen: nowIso() });
    return { token: tokenFor(account), account: publicAccount(account) };
  }

  /** Demo door: a throwaway editor account so the tool can be tried instantly. */
  async function guest({ name } = {}) {
    if (!demoMode) throw httpError(403, 'guest access is disabled on this deployment — create an account');
    const n = (name || '').trim() || 'Guest planner';
    const id = rid('usr');
    const account = {
      id, name: n.slice(0, 60), email: `${id}@guest.local`, pass_hash: '', salt: '',
      role: 'owner', kind: 'guest', color: pickColor(id), avatar: initials(n), created: nowIso(), last_seen: nowIso(),
    };
    await store.insert('accounts', account);
    // Guests share the seeded demo project — never someone's private project.
    const projects = await store.all('projects');
    const accounts = await store.all('accounts');
    const demoOwner = new Set(accounts.filter((a) => a.kind === 'demo').map((a) => a.id));
    const shared = projects.find((p) => demoOwner.has(p.owner_id));
    let projectId = null;
    if (shared) {
      projectId = shared.id;
      await store.insert('members', { id: rid('mem'), project_id: projectId, account_id: id, role: 'editor', created: nowIso() });
    } else {
      const p = await createProject(account, { name: 'NearBuyGoods', key: 'NBG', seed: 'audit' });
      projectId = p.id;
    }
    await log(projectId, account, 'member.joined', 'project', projectId, 'Guest session', {});
    return { token: tokenFor(account), account: publicAccount(account), project_id: projectId };
  }

  /* --------------------------------------------------------- utilities ---- */

  function httpError(status, message, extra = {}) {
    const e = new Error(message); e.status = status; Object.assign(e, extra); return e;
  }
  const pickColor = (seed) => {
    const palette = ['#e87b29', '#2fbcc7', '#7c5cff', '#e56a8c', '#0a7d5c', '#1d4ed8', '#b3541e', '#0d7f88'];
    let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
    return palette[h % palette.length];
  };
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

  async function log(project_id, actor, verb, subject_type, subject_id, subject_label, meta = {}) {
    const row = {
      id: rid('act'), project_id, actor_id: actor?.id || null, actor_name: actor?.name || 'System',
      verb, subject_type, subject_id, subject_label: String(subject_label || '').slice(0, 140), meta, created: nowIso(),
    };
    await store.insert('activity', row);
    emit(project_id, { type: 'activity', activity: row });
    return row;
  }

  /* --------------------------------------------------- live subscriptions ---- */
  /* SSE is only meaningful on a long-running server; on serverless the client
     falls back to polling (routes.js advertises which mode it got). */
  const channels = new Map(); // project_id -> Set(res)
  const presence = new Map();  // project_id -> Map(clientId, {name, at})

  function subscribe(projectId, res, meta = {}) {
    if (!channels.has(projectId)) channels.set(projectId, new Set());
    channels.get(projectId).add(res);
    const clientId = rid('sse');
    if (!presence.has(projectId)) presence.set(projectId, new Map());
    presence.get(projectId).set(clientId, { ...meta, at: nowIso() });
    broadcastPresence(projectId);
    return () => {
      channels.get(projectId)?.delete(res);
      presence.get(projectId)?.delete(clientId);
      broadcastPresence(projectId);
    };
  }

  function emit(projectId, payload) {
    const set = channels.get(projectId);
    if (!set?.size) return;
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of set) { try { res.write(frame); } catch { set.delete(res); } }
  }

  function broadcastPresence(projectId) {
    const list = [...(presence.get(projectId)?.values() || [])];
    emit(projectId, { type: 'presence', count: list.length, viewers: list.slice(0, 12) });
  }

  const viewerCount = (projectId) => presence.get(projectId)?.size || 0;

  /* --------------------------------------------------------- projects ---- */

  async function projectsFor(account) {
    if (!account) return [];
    const memberships = await store.find('members', { account_id: account.id });
    const ids = uniq([...memberships.map((m) => m.project_id), ...(await store.find('projects', { owner_id: account.id })).map((p) => p.id)]);
    const all = await store.all('projects');
    return all.filter((p) => ids.includes(p.id) && !p.archived).sort((a, b) => String(a.created).localeCompare(String(b.created)));
  }

  async function requireProject(account, projectId) {
    const project = await store.get('projects', projectId);
    if (!project) throw httpError(404, 'project not found');
    const members = await store.find('members', { project_id: project.id, account_id: account.id });
    if (!members.length && project.owner_id !== account.id) throw httpError(403, 'you are not a member of this project');
    return project;
  }

  async function createProject(account, { name, key, description = '', accent = '#e87b29', seed = 'blank', source_doc = null } = {}) {
    const project = {
      id: rid('prj'), name: String(name || 'Untitled project').slice(0, 80),
      key: String(key || 'PRJ').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'PRJ',
      description: String(description || '').slice(0, 400), accent,
      owner_id: account.id, source_doc, settings: { stages: DEFAULT_STAGES }, created: nowIso(), archived: false,
    };
    await store.insert('projects', project);
    await store.insert('members', { id: rid('mem'), project_id: project.id, account_id: account.id, role: 'owner', created: nowIso() });
    const workspaces = [];
    for (const [i, ws] of STARTER_WORKSPACES.entries()) {
      workspaces.push(await createWorkspace(account, project.id, { ...ws, position: i }));
    }
    if (seed === 'audit') await importDoc(account, project.id, { source: 'audit' });
    emit(project.id, { type: 'project', action: 'created', project });
    return project;
  }

  /* ------------------------------------------------------- workspaces ---- */

  const nextPosition = async (table, where) => {
    const rows = await store.find(table, where);
    return rows.reduce((m, r) => Math.max(m, Number(r.position) || 0), 0) + 1;
  };

  async function createWorkspace(account, projectId, data = {}) {
    const ws = {
      id: rid('wsp'), project_id: projectId,
      name: String(data.name || 'New workspace').slice(0, 60),
      purpose: String(data.purpose || '').slice(0, 300),
      kind: data.kind || 'board',
      color: data.color || pickColor(data.name || 'ws'),
      icon: data.icon || '🗂️',
      position: data.position ?? await nextPosition('workspaces', { project_id: projectId }),
      wip_limit: data.wip_limit == null ? null : clamp(Number(data.wip_limit) || 0, 0, 99),
      kind_note: data.kind_note || '',
      settings: { stages: data.stages || DEFAULT_STAGES },
      created: nowIso(), archived: false,
    };
    await store.insert('workspaces', ws);
    emit(projectId, { type: 'workspace', action: 'created', workspace: ws });
    return ws;
  }

  async function updateWorkspace(account, projectId, id, patch) {
    const ws = await store.get('workspaces', id);
    if (!ws || ws.project_id !== projectId) throw httpError(404, 'workspace not found');
    const allowed = ['name', 'purpose', 'kind', 'color', 'icon', 'position', 'wip_limit', 'kind_note', 'archived', 'settings'];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    if ('wip_limit' in clean) clean.wip_limit = clean.wip_limit == null ? null : clamp(Number(clean.wip_limit) || 0, 0, 99);
    const updated = await store.update('workspaces', id, clean);
    await log(projectId, account, 'workspace.updated', 'workspace', id, ws.name, { fields: Object.keys(clean) });
    emit(projectId, { type: 'workspace', action: 'updated', workspace: updated });
    return updated;
  }

  async function deleteWorkspace(account, projectId, id) {
    const ws = await store.get('workspaces', id);
    if (!ws || ws.project_id !== projectId) throw httpError(404, 'workspace not found');
    await store.removeWhere('placements', { workspace_id: id });
    await store.remove('workspaces', id);
    await log(projectId, account, 'workspace.deleted', 'workspace', id, ws.name, {});
    emit(projectId, { type: 'workspace', action: 'deleted', id });
    return { ok: true };
  }

  function stagesFor(ws) {
    const s = ws?.settings?.stages;
    return Array.isArray(s) && s.length ? s : DEFAULT_STAGES;
  }

  /* --------------------------------------------------------- features ---- */

  const featureFilters = (list, q = {}) => list.filter((f) => {
    if (q.section && String(f.section_index) !== String(q.section)) return false;
    if (q.status && f.status !== q.status) return false;
    if (q.priority && f.priority !== q.priority) return false;
    if (q.source_status && f.source_status !== q.source_status) return false;
    if (q.owner_id && f.owner_id !== q.owner_id) return false;
    if (q.tag && !(f.tags || []).includes(q.tag)) return false;
    if (q.ids && !q.ids.includes(f.id)) return false;
    if (q.q) {
      const needle = String(q.q).toLowerCase();
      const hay = `${f.title} ${f.detail} ${f.code} ${f.section} ${(f.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  async function createFeature(account, projectId, data = {}) {
    const feature = {
      id: rid('fea'), project_id: projectId,
      code: data.code || `${Date.now().toString(36).slice(-4).toUpperCase()}`,
      section: data.section || 'New',
      section_index: data.section_index ?? 0,
      area: data.area || data.section || '',
      title: String(data.title || 'Untitled feature').slice(0, 200),
      detail: String(data.detail || '').slice(0, 1200),
      status: FEATURE_STATUSES.includes(data.status) ? data.status : 'backlog',
      priority: PRIORITIES.includes(data.priority) ? data.priority : 'medium',
      effort: data.effort || 'm',
      owner_id: data.owner_id || null,
      tags: Array.isArray(data.tags) ? data.tags.slice(0, 8) : [],
      source_status: data.source_status || null,
      position: data.position ?? await nextPosition('features', { project_id: projectId }),
      created: nowIso(), updated: nowIso(), completed_at: null,
    };
    await store.insert('features', feature);
    emit(projectId, { type: 'feature', action: 'created', feature });
    return feature;
  }

  async function updateFeature(account, projectId, id, patch, { silent = false } = {}) {
    const f = await store.get('features', id);
    if (!f || f.project_id !== projectId) throw httpError(404, 'feature not found');
    const allowed = ['title', 'detail', 'status', 'priority', 'effort', 'owner_id', 'tags', 'section', 'section_index', 'area', 'code', 'position'];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    if (clean.status && !FEATURE_STATUSES.includes(clean.status)) delete clean.status;
    if (clean.priority && !PRIORITIES.includes(clean.priority)) delete clean.priority;
    if ('tags' in clean && !Array.isArray(clean.tags)) clean.tags = String(clean.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8);
    clean.updated = nowIso();
    if (clean.status === 'shipped' && f.status !== 'shipped') clean.completed_at = nowIso();
    if (clean.status && clean.status !== 'shipped') clean.completed_at = null;
    const updated = await store.update('features', id, clean);
    if (!silent) {
      const verb = clean.status === 'shipped' && f.status !== 'shipped' ? 'feature.completed' : 'feature.updated';
      await log(projectId, account, verb, 'feature', id, updated.title, { fields: Object.keys(clean).filter((k) => k !== 'updated') });
      emit(projectId, { type: 'feature', action: 'updated', feature: updated });
    }
    return updated;
  }

  async function deleteFeature(account, projectId, id) {
    const f = await store.get('features', id);
    if (!f || f.project_id !== projectId) throw httpError(404, 'feature not found');
    await store.removeWhere('placements', { feature_id: id });
    await store.remove('features', id);
    await log(projectId, account, 'feature.deleted', 'feature', id, f.title, {});
    emit(projectId, { type: 'feature', action: 'deleted', id });
    return { ok: true };
  }

  /* ------------------------------------ placement = the drag-and-drop op ---- */

  async function placeMany(account, projectId, { workspace_id, feature_ids = [], stage, index = null, exclusive = true }) {
    const ws = await store.get('workspaces', workspace_id);
    if (!ws || ws.project_id !== projectId) throw httpError(404, 'workspace not found');
    const stages = stagesFor(ws).map((s) => s.id);
    const targetStage = stages.includes(stage) ? stage : stages[0];
    const existing = await store.find('placements', { workspace_id });
    let pos = index == null ? existing.filter((p) => p.stage === targetStage).reduce((m, p) => Math.max(m, p.position), 0) : Number(index);
    const wanted = uniq(feature_ids.map(String));
    const known = wanted.length ? await store.find('features', { id: wanted, project_id: projectId }) : [];
    const valid = new Map(known.map((f) => [String(f.id), f]));
    if (exclusive && valid.size) await store.removeWhere('placements', { feature_id: [...valid.keys()], project_id: projectId });
    const created = [];
    for (const fid of wanted) {
      if (!valid.has(fid)) continue;
      created.push({
        id: rid('plc'), project_id: projectId, workspace_id, feature_id: fid, stage: targetStage,
        position: index == null ? (pos += 1) : pos + created.length,
        added_by: account?.id || null, added_at: nowIso(), meta: {},
      });
    }
    if (created.length) await store.insert('placements', created);
    if (created.length) {
      const synced = await syncStatuses(account, projectId, created, ws);
      await log(projectId, account, 'placement.added', 'workspace', ws.id, ws.name, { count: created.length, features: created.length });
      emit(projectId, { type: 'placements', action: 'added', workspace_id, placements: created });
      if (synced.length) emit(projectId, { type: 'features', action: 'status', features: synced });
    }
    return created;
  }

  async function moveMany(account, projectId, moves = []) {
    const out = [];
    const touched = new Set();
    for (const m of moves) {
      const p = await store.get('placements', m.id);
      if (!p || p.project_id !== projectId) continue;
      const ws = await store.get('workspaces', p.workspace_id);
      const stages = stagesFor(ws).map((s) => s.id);
      const patch = {};
      if (m.stage && stages.includes(m.stage)) patch.stage = m.stage;
      if (m.position != null) patch.position = Number(m.position);
      if (m.workspace_id && m.workspace_id !== p.workspace_id) {
        const target = await store.get('workspaces', m.workspace_id);
        if (target?.project_id === projectId) {
          patch.workspace_id = m.workspace_id;
          if (!patch.stage) patch.stage = stagesFor(target)[0].id;
        }
      }
      if (!Object.keys(patch).length) continue;
      const updated = await store.update('placements', p.id, patch);
      out.push(updated);
      touched.add(updated.workspace_id);
    }
    if (out.length) {
      const synced = [];
      for (const p of out) {
        const ws = await store.get('workspaces', p.workspace_id);
        synced.push(...await syncStatuses(account, projectId, [p], ws, { log: true }));
      }
      emit(projectId, { type: 'placements', action: 'moved', placements: out });
      if (synced.length) emit(projectId, { type: 'features', action: 'status', features: synced });
      // One activity line per workspace touched keeps the feed readable.
      for (const wsId of touched) {
        const ws = await store.get('workspaces', wsId);
        const n = out.filter((p) => p.workspace_id === wsId).length;
        await log(projectId, account, 'placement.moved', 'workspace', wsId, ws?.name || '', { count: n });
      }
    }
    return out;
  }

  /**
   * Dragging a card into "In progress" / "Done" should say so on the feature
   * itself — that is what makes the board and the backlog agree.
   */
  /**
   * Columns carry meaning: dropping a card into “Doing” marks the feature
   * in progress, “Done” marks it shipped (and closes completed_at). One UPDATE
   * per status — a 40-card multi-select drop is a single statement, not 40.
   */
  async function syncStatuses(account, projectId, placements, ws, { log: silentLog = false } = {}) {
    const rows = placements.length ? await store.find('features', { id: uniq(placements.map((p) => p.feature_id)), project_id: projectId }) : [];
    const byId = new Map(rows.map((f) => [String(f.id), f]));
    const groups = new Map(); // status → { ids, features, completed_at }
    for (const p of placements) {
      const status = STAGE_STATUS[p.stage];
      if (!status) continue;
      const feature = byId.get(String(p.feature_id));
      if (!feature || feature.status === status) continue;
      if (!groups.has(status)) groups.set(status, { ids: [], features: [], completed_at: status === 'shipped' ? nowIso() : null });
      const g = groups.get(status);
      if (status === 'shipped' && !g.completed_at) g.completed_at = nowIso();
      g.ids.push(feature.id);
      g.features.push(feature);
    }
    const updated = [];
    for (const [status, g] of groups) {
      await store.updateMany('features', g.ids, { status, updated: nowIso(), completed_at: g.completed_at });
      for (const f of g.features) {
        updated.push({ ...f, status, completed_at: g.completed_at });
        if (status === 'shipped') await log(projectId, account, 'feature.completed', 'feature', f.id, f.title, { via: ws?.name || '' });
        else if (silentLog) await log(projectId, account, 'feature.updated', 'feature', f.id, f.title, { status });
      }
    }
    return updated;
  }

  async function unplace(account, projectId, { placement_id, feature_id, workspace_id }) {
    const where = placement_id ? { id: placement_id } : { feature_id, workspace_id, project_id: projectId };
    const rows = await store.find('placements', where);
    for (const r of rows) await store.remove('placements', r.id);
    if (rows.length) {
      const ws = await store.get('workspaces', rows[0].workspace_id);
      await log(projectId, account, 'placement.removed', 'workspace', rows[0].workspace_id, ws?.name || '', { count: rows.length });
      emit(projectId, { type: 'placements', action: 'removed', ids: rows.map((r) => r.id) });
    }
    return { removed: rows.length };
  }

  /* ------------------------------------------------------ board & cards ---- */

  async function board(projectId, workspaceId) {
    const ws = await store.get('workspaces', workspaceId);
    if (!ws || ws.project_id !== projectId) throw httpError(404, 'workspace not found');
    const [placements, features] = await Promise.all([
      store.find('placements', { workspace_id: workspaceId }),
      store.find('features', { project_id: projectId }),
    ]);
    const byId = new Map(features.map((f) => [f.id, f]));
    const cards = placements
      .map((p) => ({ placement_id: p.id, ...(byId.get(p.feature_id) || { id: p.feature_id, title: '(removed feature)', missing: true }), stage: p.stage, position: p.position, workspace_id: p.workspace_id }))
      .filter((c) => !c.missing)
      .sort((a, b) => (a.position - b.position) || String(a.title).localeCompare(String(b.title)));
    return { workspace: ws, stages: stagesFor(ws), cards };
  }

  /* ---------------------------------------------------------- comments ---- */

  async function addComment(account, projectId, { subject_type = 'feature', subject_id, body }) {
    if (!String(body || '').trim()) throw httpError(400, 'comment is empty');
    const row = {
      id: rid('cmt'), project_id: projectId, subject_type, subject_id,
      author_id: account?.id || null, author_name: account?.name || 'Guest',
      body: String(body).slice(0, 2000), created: nowIso(),
    };
    await store.insert('comments', row);
    await log(projectId, account, 'comment.added', subject_type, subject_id, row.body.slice(0, 60), {});
    emit(projectId, { type: 'comment', comment: row });
    return row;
  }

  /* ----------------------------------------------------------- import ---- */

  async function importDoc(account, projectId, { source = 'audit', text = '', mode = 'merge', group = false }) {
    let content = text;
    if (source === 'audit' && !content) {
      content = fs.existsSync(AUDIT_FILE) ? fs.readFileSync(AUDIT_FILE, 'utf8') : '';
    }
    if (!content.trim()) throw httpError(400, 'nothing to import — paste the feature list or upload the file');
    const parsed = parseToImportRows(content, { defaultProject: { name: 'NearBuyGoods', key: 'NBG' } });
    if (!parsed.rows.length) throw httpError(422, 'could not find any features in that document');

    if (mode === 'replace') {
      await store.removeWhere('placements', { project_id: projectId });
      await store.removeWhere('features', { project_id: projectId });
    }
    const existing = mode === 'merge' ? await store.find('features', { project_id: projectId }) : [];
    const seen = new Set(existing.map((f) => `${f.section_index}|${f.title.toLowerCase()}`));
    let added = 0, skipped = 0;
    const basePos = existing.reduce((m, f) => Math.max(m, Number(f.position) || 0), 0);
    const fresh = [];
    for (const [i, row] of parsed.rows.entries()) {
      const fingerprint = `${row.section_index}|${row.title.toLowerCase()}`;
      if (seen.has(fingerprint)) { skipped += 1; continue; }
      seen.add(fingerprint);
      fresh.push({
        id: rid('fea'), project_id: projectId, code: row.code, section: row.section, section_index: row.section_index,
        area: row.area, title: row.title, detail: row.detail,
        status: row.source_status === 'shipped' ? 'shipped' : 'backlog',
        priority: row.source_status === 'missing' ? 'medium' : 'low',
        effort: 'm', owner_id: null, tags: row.tags || [],
        source_status: row.source_status, position: basePos + i + 1,
        created: nowIso(), updated: nowIso(),
        completed_at: row.source_status === 'shipped' ? nowIso() : null,
      });
      added += 1;
    }
    // Chunked array insert: one statement per 200 features on SQL, one write per batch on KV.
    for (let i = 0; i < fresh.length; i += 200) await store.insert('features', fresh.slice(i, i + 200));
    const sections = parsed.sections.map((s) => ({ index: s.index, name: s.name, count: s.items.length }));
    const project = await store.get('projects', projectId);
    await store.update('projects', projectId, {
      source_doc: (project?.source_doc ? `${project.source_doc}, ` : '') + `audit:${nowIso().slice(0, 10)}`,
      settings: { ...(project?.settings || {}), last_import: { at: nowIso(), added, skipped, sections: sections.length } },
    });
    await log(projectId, account, 'features.imported', 'project', projectId, 'Feature document', { added, skipped, sections: sections.length });
    emit(projectId, { type: 'import', action: 'done', added, skipped });
    return { added, skipped, totals: parsed.totals, sections };
  }

  /* ---------------------------------------------------------- planning ---- */

  /** Rule-based auto-planning: "put every missing §1–§3 feature into MVP". */
  async function plan(account, projectId, { workspace_id, rules = {}, stage, mode = 'add' }) {
    const features = await store.find('features', { project_id: projectId });
    const matched = featureFilters(features, {
      q: rules.q, status: rules.status, priority: rules.priority, source_status: rules.source_status, tag: rules.tag,
    }).filter((f) => {
      if (Array.isArray(rules.sections) && rules.sections.length && !rules.sections.map(String).includes(String(f.section_index))) return false;
      if (Array.isArray(rules.statuses) && rules.statuses.length && !rules.statuses.includes(f.status)) return false;
      if (Array.isArray(rules.priorities) && rules.priorities.length && !rules.priorities.includes(f.priority)) return false;
      if (Array.isArray(rules.source_statuses) && rules.source_statuses.length && !rules.source_statuses.includes(f.source_status)) return false;
      return true;
    });
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    matched.sort((a, b) => (order[a.priority] - order[b.priority]) || (a.section_index - b.section_index) || (a.position - b.position));
    const limit = clamp(Number(rules.limit) || matched.length, 1, 400);
    const chosen = matched.slice(0, limit);
    if (mode === 'preview') return { matched: matched.length, chosen: chosen.map((f) => ({ id: f.id, title: f.title, code: f.code, priority: f.priority, section: f.section })) };
    const placements = await placeMany(account, projectId, { workspace_id, feature_ids: chosen.map((f) => f.id), stage, index: null });
    return { matched: matched.length, placed: placements.length, workspace_id };
  }

  /* ------------------------------------------------------------- stats ---- */

  async function stats(projectId) {
    const [features, placements, workspaces, activity, comments] = await Promise.all([
      store.find('features', { project_id: projectId }),
      store.find('placements', { project_id: projectId }),
      store.find('workspaces', { project_id: projectId }),
      store.find('activity', { project_id: projectId }),
      store.find('comments', { project_id: projectId }),
    ]);
    const byStatus = {}; const byPriority = {}; const bySection = {}; const byEffort = {};
    for (const f of features) {
      byStatus[f.status] = (byStatus[f.status] || 0) + 1;
      byPriority[f.priority] = (byPriority[f.priority] || 0) + 1;
      byEffort[f.effort] = (byEffort[f.effort] || 0) + 1;
      const key = f.section || f.area || 'Other';
      bySection[key] = bySection[key] || { section: key, index: f.section_index || 99, total: 0, shipped: 0, partial: 0, missing: 0 };
      bySection[key].total += 1;
      if (f.source_status === 'shipped') bySection[key].shipped += 1;
      else if (f.source_status === 'partial') bySection[key].partial += 1;
      else bySection[key].missing += 1;
    }
    const wsStats = workspaces.filter((w) => !w.archived).map((w) => {
      const mine = placements.filter((p) => p.workspace_id === w.id);
      const stages = stagesFor(w);
      const doneIds = stages.length ? [stages[stages.length - 1].id] : [];
      const done = mine.filter((p) => doneIds.includes(p.stage)).length;
      const doing = mine.filter((p) => p.stage !== stages[0]?.id && !doneIds.includes(p.stage)).length;
      return { id: w.id, name: w.name, icon: w.icon, color: w.color, total: mine.length, done, doing, todo: mine.length - done - doing, progress: mine.length ? Math.round((done / mine.length) * 100) : 0, wip_limit: w.wip_limit };
    });
    // 14-day completion trend
    const days = [];
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      days.push({
        label: d.toISOString().slice(5, 10),
        done: features.filter((f) => f.completed_at && f.completed_at >= d.toISOString() && f.completed_at < next.toISOString()).length,
        touched: activity.filter((a) => a.created >= d.toISOString() && a.created < next.toISOString()).length,
      });
    }
    const sections = Object.values(bySection).sort((a, b) => a.index - b.index);
    return {
      totals: {
        features: features.length,
        shipped: features.filter((f) => f.status === 'shipped').length,
        in_progress: features.filter((f) => ['in_progress', 'review'].includes(f.status)).length,
        backlog: features.filter((f) => ['backlog', 'planned', 'parked'].includes(f.status)).length,
        placed: placements.length,
        unplaced: features.filter((f) => !placements.some((p) => p.feature_id === f.id)).length,
        workspaces: workspaces.filter((w) => !w.archived).length,
        comments: comments.length,
        activity: activity.length,
        source_shipped: features.filter((f) => f.source_status === 'shipped').length,
        source_partial: features.filter((f) => f.source_status === 'partial').length,
        source_missing: features.filter((f) => f.source_status === 'missing').length,
      },
      by_status: byStatus, by_priority: byPriority, by_effort: byEffort,
      by_section: sections, by_workspace: wsStats, trend: days,
      recent: activity.slice(-8).reverse(),
    };
  }

  /* ------------------------------------------------------------ search ---- */

  async function search(projectId, q, limit = 12) {
    const needle = String(q || '').toLowerCase().trim();
    if (!needle) return { features: [], workspaces: [], sections: [] };
    const [features, workspaces] = await Promise.all([
      store.find('features', { project_id: projectId }),
      store.find('workspaces', { project_id: projectId }),
    ]);
    const rank = (text, title) => {
      const t = String(title).toLowerCase();
      if (t.startsWith(needle)) return 0;
      if (t.includes(needle)) return 1;
      if (String(text).toLowerCase().includes(needle)) return 2;
      return 3;
    };
    return {
      features: features
        .map((f) => ({ f, r: rank(`${f.detail} ${f.code} ${f.section}`, f.title) }))
        .filter((x) => x.r < 3)
        .sort((a, b) => a.r - b.r || String(a.f.title).localeCompare(String(b.f.title)))
        .slice(0, limit).map((x) => x.f),
      workspaces: workspaces.filter((w) => w.name.toLowerCase().includes(needle)).slice(0, 6),
      sections: [...new Set(features.map((f) => f.section))].filter((s) => String(s).toLowerCase().includes(needle)).slice(0, 6),
    };
  }

  /* ---------------------------------------------------------- bootstrap ---- */

  async function bootstrap(account, projectId) {
    const projects = await projectsFor(account);
    const active = projectId ? await requireProject(account, projectId).catch(() => null) : null;
    const project = active || projects[0] || null;
    if (!project) return { me: publicAccount(account), store: { mode: store.mode, label: store.label }, projects: [], project: null };
    const [features, workspaces, placements, members, activity, comments] = await Promise.all([
      store.find('features', { project_id: project.id }),
      store.find('workspaces', { project_id: project.id }),
      store.find('placements', { project_id: project.id }),
      store.find('members', { project_id: project.id }),
      store.find('activity', { project_id: project.id }),
      store.find('comments', { project_id: project.id }),
    ]);
    const accounts = await store.all('accounts');
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const sections = uniq(features.map((f) => f.section)).map((name) => {
      const list = features.filter((f) => f.section === name);
      return {
        name, index: list[0]?.section_index ?? 99, total: list.length,
        shipped: list.filter((f) => f.status === 'shipped').length,
        source_shipped: list.filter((f) => f.source_status === 'shipped').length,
        source_partial: list.filter((f) => f.source_status === 'partial').length,
        source_missing: list.filter((f) => f.source_status === 'missing').length,
      };
    }).sort((a, b) => a.index - b.index);
    return {
      me: publicAccount(account),
      store: { mode: store.mode, label: store.label, version },
      projects: projects.map((p) => ({ id: p.id, name: p.name, key: p.key, accent: p.accent, description: p.description })),
      project,
      members: members.map((m) => ({ ...m, account: publicAccount(accountById.get(m.account_id)) })),
      workspaces: workspaces.filter((w) => !w.archived).sort((a, b) => a.position - b.position),
      features: features.sort((a, b) => a.position - b.position),
      placements,
      sections,
      activity: activity.slice(-80).reverse(),
      comments: comments.slice(-200),
      viewers: viewerCount(project.id),
      capabilities: { live: true, guest: demoMode, seed_source: fs.existsSync(AUDIT_FILE) ? 'docs/FEATURE_AUDIT.md' : null },
    };
  }

  /* ------------------------------------------------------------- export ---- */

  async function exportProject(projectId, format = 'json') {
    const data = await bootstrapLite(projectId);
    if (format === 'csv') {
      const head = ['code', 'section', 'title', 'status', 'priority', 'effort', 'source_status', 'workspaces', 'detail'];
      const rows = data.features.map((f) => [
        f.code, f.section, f.title, f.status, f.priority, f.effort, f.source_status || '',
        data.placements.filter((p) => p.feature_id === f.id).map((p) => `${data.workspaces.find((w) => w.id === p.workspace_id)?.name || '?'}:${p.stage}`).join(' | '),
        f.detail,
      ]);
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      return [head.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
    }
    return data;
  }

  async function bootstrapLite(projectId) {
    const [features, workspaces, placements] = await Promise.all([
      store.find('features', { project_id: projectId }),
      store.find('workspaces', { project_id: projectId }),
      store.find('placements', { project_id: projectId }),
    ]);
    return { features, workspaces, placements, exported_at: nowIso() };
  }

  /* ------------------------------------------------------------- invites ---- */

  async function invite(account, projectId, { email = '', role = 'editor' }) {
    const token = crypto.randomBytes(12).toString('base64url');
    const row = {
      id: rid('inv'), token, project_id: projectId, email: String(email).toLowerCase().slice(0, 120),
      role: ['owner', 'editor', 'viewer'].includes(role) ? role : 'editor',
      created_by: account?.id || null, created: nowIso(),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(), used_by: null, used_at: null,
    };
    await store.insert('invites', row);
    await log(projectId, account, 'invite.created', 'project', projectId, email || 'link', { role });
    return row;
  }

  async function acceptInvite(account, token) {
    const rows = await store.find('invites', { token });
    const inv = rows[0];
    if (!inv) throw httpError(404, 'invite not found');
    if (inv.used_by) throw httpError(410, 'invite already used');
    if (inv.expires && inv.expires < nowIso()) throw httpError(410, 'invite expired');
    await store.insert('members', { id: rid('mem'), project_id: inv.project_id, account_id: account.id, role: inv.role, created: nowIso() });
    await store.update('invites', inv.id, { used_by: account.id, used_at: nowIso() });
    await log(inv.project_id, account, 'member.joined', 'project', inv.project_id, account.name, { role: inv.role });
    return { project_id: inv.project_id, role: inv.role };
  }

  /* -------------------------------------------------------------- seed ---- */

  /** First-run seeding: one account, one project, three starter workspaces. */
  async function seed({ withDemoPlan = true } = {}) {
    const projects = await store.all('projects');
    if (projects.length) return { seeded: false, projects: projects.length };
    let account = (await store.find('accounts', { kind: 'demo' }))[0];
    if (!account) {
      const { hash, salt } = hashPassword(demoMode ? 'demo1234' : crypto.randomBytes(16).toString('hex'));
      account = {
        id: rid('usr'), name: 'Ada (Product)', email: 'pm@nearbuygoods.app', pass_hash: hash, salt,
        role: 'owner', kind: 'demo', color: '#e87b29', avatar: 'AP', created: nowIso(), last_seen: nowIso(),
      };
      await store.insert('accounts', account);
    }
    const project = await createProject(account, {
      name: 'NearBuyGoods', key: 'NBG',
      description: 'Upload any item, find it at stores near you. Feature audit imported from the feature document — plan the MVP here.',
      source_doc: 'docs/FEATURE_AUDIT.md',
      seed: 'audit',
    });
    if (withDemoPlan) await demoPlan(account, project);
    return { seeded: true, project_id: project.id, account: publicAccount(account) };
  }

  /**
   * Give the board a realistic starting shape: MVP workspace holds the
   * highest-value unbuilt features, a few already in flight, plus a couple of
   * shipped ones so progress and the activity feed read as a live project.
   */
  async function demoPlan(account, project) {
    const all = await store.find('features', { project_id: project.id });
    const wsList = await store.find('workspaces', { project_id: project.id });
    const mvp = wsList.find((w) => w.name === 'MVP features') || wsList[0];
    const next = wsList.find((w) => w.name === 'Next release') || wsList[1];
    const icebox = wsList.find((w) => w.name === 'Ideas / icebox') || wsList[2];
    const pick = (pred, n) => all.filter(pred).slice(0, n).map((f) => f.id);
    const criticalSections = [1, 2, 3, 7, 9];
    const mvpIds = pick((f) => f.source_status === 'missing' && criticalSections.includes(f.section_index), 18);
    const shippedIds = pick((f) => f.source_status === 'shipped' && [1, 2, 3].includes(f.section_index), 6);
    const doingIds = mvpIds.slice(0, 3);
    const reviewIds = mvpIds.slice(3, 4);
    const doneIds = shippedIds.slice(0, 4);
    if (mvp) {
      await placeMany(account, project.id, { workspace_id: mvp.id, feature_ids: mvpIds, stage: 'backlog' });
      await placeMany(account, project.id, { workspace_id: mvp.id, feature_ids: doingIds, stage: 'doing' });
      await placeMany(account, project.id, { workspace_id: mvp.id, feature_ids: reviewIds, stage: 'review' });
      await placeMany(account, project.id, { workspace_id: mvp.id, feature_ids: doneIds, stage: 'done' });
    }
    if (next) await placeMany(account, project.id, { workspace_id: next.id, feature_ids: pick((f) => f.source_status === 'partial' && [4, 8, 13].includes(f.section_index), 8), stage: 'backlog' });
    if (icebox) await placeMany(account, project.id, { workspace_id: icebox.id, feature_ids: pick((f) => f.source_status === 'missing' && [6, 15, 17, 19].includes(f.section_index), 10), stage: 'backlog' });
    // priorities + owners so filters and charts have something to show
    const order = { critical: 0, high: 1 };
    for (const [i, id] of [...doingIds, ...reviewIds].entries()) await updateFeature(account, project.id, id, { priority: i % 3 === 0 ? 'critical' : 'high' }, { silent: true });
    for (const id of mvpIds.slice(0, 8)) await updateFeature(account, project.id, id, { priority: 'high' }, { silent: true });
    void order;
    await store.insert('comments', {
      id: rid('cmt'), project_id: project.id, subject_type: 'workspace', subject_id: mvp?.id || '',
      author_id: account.id, author_name: account.name,
      body: 'MVP scope rule: anything that blocks the upload → recognise → compare → reserve loop goes in first.',
      created: nowIso(),
    });
    await log(project.id, account, 'project.planned', 'project', project.id, 'MVP scoped from the feature audit', { mvp: mvpIds.length });
  }

  return {
    store,
    auth: { register, login, guest, accountFromRequest, publicAccount, tokenFor },
    projects: { list: projectsFor, create: createProject, require: requireProject, get: (id) => store.get('projects', id), update: async (a, pid, patch) => { const p = await requireProject(a, pid); const clean = {}; for (const k of ['name', 'key', 'description', 'accent', 'archived', 'settings']) if (k in patch) clean[k] = patch[k]; const u = await store.update('projects', p.id, clean); emit(pid, { type: 'project', action: 'updated', project: u }); return u; } },
    workspaces: { list: (pid) => store.find('workspaces', { project_id: pid }), create: createWorkspace, update: updateWorkspace, remove: deleteWorkspace, board, stagesFor },
    features: { list: (pid, q) => store.find('features', { project_id: pid }).then((rows) => featureFilters(rows.sort((a, b) => a.position - b.position), q)), create: createFeature, update: updateFeature, remove: deleteFeature, filters: featureFilters },
    placements: { placeMany, moveMany, unplace, list: (pid) => store.find('placements', { project_id: pid }) },
    comments: { add: addComment, list: (pid, subject_id) => store.find('comments', { project_id: pid }).then((rows) => rows.filter((c) => !subject_id || c.subject_id === subject_id)) },
    importDoc, plan, stats, search, bootstrap, exportProject, invite, acceptInvite, log, seed, subscribe, emit, viewerCount, stagesFor,
    constants: { FEATURE_STATUSES, PRIORITIES, DEFAULT_STAGES },
  };
}
