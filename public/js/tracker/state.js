/**
 * Client-side store: one source of truth for the tracker UI.
 *
 * Writes are optimistic — the board reacts instantly to a drop and rolls back
 * with a toast if the API rejects it. Every mutation also goes on an undo
 * stack so "moved 3 features to Done" can be reverted with one tap.
 */
import { api, getProjectId, setProjectId, setToken, getToken } from './api.js';
import { toast, confetti } from './ui.js';

const listeners = {};
export const on = (ev, fn) => ((listeners[ev] = listeners[ev] || []).push(fn), () => off(ev, fn));
export const off = (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); };
export const emit = (ev, data) => (listeners[ev] || []).forEach((fn) => fn(data));

export const state = {
  ready: false,
  signedIn: false,
  me: null,
  database: null,
  capabilities: {},
  projects: [],
  project: null,
  workspaces: [],
  features: [],
  placements: [],
  sections: [],
  members: [],
  activity: [],
  comments: [],
  viewers: 0,
  live: false,          // SSE connected?
  online: navigator.onLine,
  selection: new Set(), // selected feature ids
  undo: [],
  filters: { q: '', section: '', status: '', priority: '', source_status: '', owner_id: '' },
  view: 'overview',
  activeWorkspace: null,
};

/* ------------------------------------------------------------- loading ---- */

export async function load(projectId = getProjectId()) {
  const data = await api.bootstrap(projectId);
  Object.assign(state, {
    me: data.me, signedIn: !!data.me, database: data.database,
    projects: data.projects || [], project: data.project,
    workspaces: data.workspaces || [], features: data.features || [],
    placements: data.placements || [], sections: data.sections || [],
    members: data.members || [], activity: data.activity || [], comments: data.comments || [],
    viewers: data.viewers || 0, capabilities: data.capabilities || {},
    ready: true,
    activeWorkspace: state.activeWorkspace && data.workspaces?.some((w) => w.id === state.activeWorkspace)
      ? state.activeWorkspace
      : (data.workspaces || [])[0]?.id || null,
  });
  if (state.project) setProjectId(state.project.id);
  emit('loaded', state);
  return state;
}

export async function loadStats() {
  try { state.stats = await api.stats(); emit('stats', state.stats); } catch { /* offline */ }
  return state.stats;
}

export async function switchProject(id) {
  setProjectId(id);
  state.selection.clear();
  await load(id);
  stopLive();
  startLive();
}

/* -------------------------------------------------------------- lookups ---- */

export const featureById = (id) => state.features.find((f) => f.id === id);
export const workspaceById = (id) => state.workspaces.find((w) => w.id === id);
export const placementsOf = (featureId) => state.placements.filter((p) => p.feature_id === featureId);
export const stagesOf = (ws) => (ws?.settings?.stages?.length ? ws.settings.stages : [
  { id: 'backlog', label: 'Backlog' }, { id: 'next', label: 'Up next' }, { id: 'doing', label: 'In progress' },
  { id: 'review', label: 'Review' }, { id: 'done', label: 'Done' },
]);
export const stageLabel = (ws, id) => stagesOf(ws).find((s) => s.id === id)?.label || id;

export function filteredFeatures() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  return state.features.filter((x) => {
    if (f.section && String(x.section_index) !== String(f.section)) return false;
    if (f.status && x.status !== f.status) return false;
    if (f.priority && x.priority !== f.priority) return false;
    if (f.source_status && x.source_status !== f.source_status) return false;
    if (f.owner_id && x.owner_id !== f.owner_id) return false;
    if (q && !`${x.title} ${x.detail} ${x.code} ${x.section}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export const inWorkspace = (wsId) => state.placements.filter((p) => p.workspace_id === wsId);
export const isPlaced = (featureId) => state.placements.some((p) => p.feature_id === featureId);

/* ------------------------------------------------------ optimistic ops ---- */

function pushUndo(label, restore) {
  state.undo.push({ label, restore, at: Date.now() });
  if (state.undo.length > 25) state.undo.shift();
}

export function undoLast() {
  const last = state.undo.pop();
  if (!last) return false;
  last.restore();
  emit('change');
  toast(`Undid: ${last.label}`, { type: 'ok' });
  return true;
}

/**
 * Place features into a workspace/stage — the drop handler behind every
 * "drag from backlog → workspace" and "drag card → column" gesture.
 */
export async function placeFeatures(ids, workspaceId, stage, index = null, { silent = false, exclusive = true } = {}) {
  const ws = workspaceById(workspaceId);
  if (!ws || !ids.length) return [];
  const stages = stagesOf(ws);
  const target = stages.some((s) => s.id === stage) ? stage : stages[0].id;
  const before = JSON.parse(JSON.stringify(state.placements));

  // optimistic
  const previous = state.placements.filter((p) => ids.includes(p.feature_id));
  if (exclusive) state.placements = state.placements.filter((p) => !ids.includes(p.feature_id));
  let pos = index == null
    ? state.placements.filter((p) => p.workspace_id === workspaceId && p.stage === target).reduce((m, p) => Math.max(m, p.position || 0), 0)
    : Number(index);
  ids.forEach((fid, i) => {
    state.placements.push({
      id: `tmp_${fid}_${Date.now()}_${i}`, project_id: state.project.id, workspace_id: workspaceId,
      feature_id: fid, stage: target, position: index == null ? (pos += 1) : pos + i, added_at: new Date().toISOString(), __tmp: true,
    });
  });
  // dragging into the first/last stage also updates the feature's status server-side
  reflow(workspaceId);
  emit('change', { type: 'place' });

  try {
    const { placements } = await api.place({ workspace_id: workspaceId, feature_ids: ids, stage: target, index, exclusive });
    state.placements = state.placements.filter((p) => !(ids.includes(p.feature_id) && p.__tmp)).concat([]);
    for (const p of placements) state.placements = state.placements.filter((x) => x.id !== p.id && !(x.__tmp && x.feature_id === p.feature_id)).concat([p]);
    await refreshFeatures(ids);
    reflow(workspaceId);
    pushUndo(`added ${ids.length} to ${ws.name}`, () => {
      state.placements = before;
      emit('change');
      api.unplace({ feature_id: ids[0], workspace_id: workspaceId }).catch(() => {});
    });
    if (!silent) toast(`Added ${ids.length} feature${ids.length > 1 ? 's' : ''} to ${ws.name}`, { type: 'ok' });
    const doneStage = stages[stages.length - 1]?.id;
    if (target === doneStage && !silent) confetti(18);
    emit('change');
    return placements;
  } catch (e) {
    state.placements = previous;
    emit('change');
    toast(e.message || 'Could not move those features', { type: 'bad' });
    return [];
  }
}

/**
 * The core drop operation for board cards: one or many placements move to a
 * new stage (and possibly a new workspace) at a given index.
 */
export async function movePlacements(placementIds, { workspaceId, stage, index }) {
  const ids = placementIds.filter((id) => id && !String(id).startsWith('tmp_'));
  if (!ids.length) return;
  const before = JSON.parse(JSON.stringify(state.placements));
  const ws = workspaceById(workspaceId);
  const stages = stagesOf(ws);
  const target = stages.some((s) => s.id === stage) ? stage : stages[0].id;

  const moving = state.placements.filter((p) => ids.includes(p.id));
  const rest = state.placements.filter((p) => !ids.includes(p.id));
  const ordered = [...rest.filter((p) => p.workspace_id === workspaceId && p.stage === target)].sort((a, b) => (a.position || 0) - (b.position || 0));
  const at = index == null ? ordered.length : Math.max(0, Math.min(index, ordered.length));
  const inserted = moving.map((p, i) => ({ ...p, workspace_id: workspaceId, stage: target, position: -(i + 1) }));
  const next = [...ordered.slice(0, at), ...inserted, ...ordered.slice(at)].map((p, i) => ({ ...p, position: i + 1 }));
  state.placements = [...rest.filter((p) => !(p.workspace_id === workspaceId && p.stage === target)), ...next];
  reflow(workspaceId);
  emit('change', { type: 'move' });

  const moves = inserted.map((p, i) => ({ id: p.id, workspace_id: workspaceId, stage: target, position: at + i + 1 }));
  try {
    const { placements } = await api.movePlacements(moves);
    const map = new Map(placements.map((p) => [p.id, p]));
    state.placements = state.placements.map((p) => map.get(p.id) || p);
    await refreshFeatures(moving.map((m) => m.feature_id));
    reflow(workspaceId);
    pushUndo(`moved ${ids.length} card${ids.length > 1 ? 's' : ''}`, () => { state.placements = before; emit('change'); });
    if (stages[stages.length - 1]?.id === target) confetti(12);
    emit('change');
  } catch (e) {
    state.placements = before;
    emit('change');
    toast(e.message || 'Move failed — reverted', { type: 'bad' });
  }
}

/** Keep positions tidy per column (client-side) so the drop-line maths stays sane. */
function reflow(workspaceId) {
  const ws = workspaceById(workspaceId);
  if (!ws) return;
  for (const s of stagesOf(ws)) {
    state.placements
      .filter((p) => p.workspace_id === workspaceId && p.stage === s.id)
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .forEach((p, i) => { p.position = i + 1; });
  }
}

export async function patchFeatures(ids, patch, { silent = false } = {}) {
  const before = ids.map((id) => ({ ...featureById(id) })).filter((f) => f.id);
  applyFeatures(ids.map((id) => ({ ...featureById(id), ...patch, id })));
  emit('change');
  try {
    const { features } = await api.bulk({ ids, patch });
    applyFeatures(features);
    pushUndo(`updated ${ids.length} feature${ids.length > 1 ? 's' : ''}`, () => {
      const prev = new Map(before.map((f) => [f.id, f]));
      state.features = state.features.map((f) => (prev.has(f.id) ? prev.get(f.id) : f));
      emit('change');
      api.bulk({ ids, patch: Object.fromEntries(Object.keys(patch).map((k) => [k, prev.get(ids[0])?.[k] ?? null])) }).catch(() => {});
    });
    if (!silent) toast(`Updated ${ids.length} feature${ids.length > 1 ? 's' : ''}`, { type: 'ok' });
    emit('change');
  } catch (e) {
    toast(e.message || 'Update failed', { type: 'bad' });
    await load(state.project.id);
  }
}

function applyFeatures(list) {
  const map = new Map(state.features.map((f) => [f.id, f]));
  for (const f of list) if (f && f.id) { const prev = map.get(f.id) || {}; const { __tmp, ...clean } = f; map.set(f.id, { ...prev, ...clean }); }
  state.features = [...map.values()];
}

/** Re-pull the rows the server may have changed as a side effect (e.g. stage → status). */
async function refreshFeatures(ids) {
  if (!ids.length) return;
  const all = await api.features('').catch(() => null);
  if (all?.features) applyFeatures(all.features.filter((f) => ids.includes(f.id)));
}

export async function updateFeature(id, patch, opts) { return patchFeatures([id], patch, opts); }

export async function removePlacements(placementIds, { silent = false } = {}) {
  const ids = placementIds.filter(Boolean);
  const before = JSON.parse(JSON.stringify(state.placements));
  state.placements = state.placements.filter((p) => !ids.includes(p.id));
  emit('change');
  try {
    await api.unplace({ placement_id: ids[0] });
    for (const id of ids.slice(1)) await api.unplace({ placement_id: id });
    pushUndo(`removed ${ids.length} card${ids.length > 1 ? 's' : ''}`, () => { state.placements = before; emit('change'); });
    if (!silent) toast('Removed from workspace', { type: 'ok' });
    emit('change');
  } catch (e) {
    state.placements = before; emit('change');
    toast(e.message || 'Could not remove', { type: 'bad' });
  }
}

export async function createWorkspace(data) {
  const { workspace } = await api.createWorkspace(data);
  state.workspaces = [...state.workspaces, workspace];
  state.activeWorkspace = workspace.id;
  emit('change');
  return workspace;
}

export async function deleteWorkspace(id) {
  await api.deleteWorkspace(id);
  state.workspaces = state.workspaces.filter((w) => w.id !== id);
  state.placements = state.placements.filter((p) => p.workspace_id !== id);
  if (state.activeWorkspace === id) state.activeWorkspace = state.workspaces[0]?.id || null;
  emit('change');
}

export async function createFeature(data) {
  const { feature } = await api.createFeature(data);
  state.features = [...state.features, feature];
  emit('change');
  return feature;
}

export async function deleteFeatures(ids) {
  for (const id of ids) await api.deleteFeature(id).catch((e) => toast(e.message, { type: 'bad' }));
  state.features = state.features.filter((f) => !ids.includes(f.id));
  state.placements = state.placements.filter((p) => !ids.includes(p.feature_id));
  state.selection.clear();
  emit('change');
}

/* ------------------------------------------------------------ selection ---- */

export function toggleSelect(id, on) {
  if (on === undefined) on = !state.selection.has(id);
  if (on) state.selection.add(id); else state.selection.delete(id);
  emit('selection');
}
export function clearSelection() { state.selection.clear(); emit('selection'); }
export const selectedIds = () => [...state.selection];

/* ------------------------------------------------------------- live feed ---- */

let source = null;
let pollTimer = null;

export function startLive() {
  if (!state.signedIn || !state.project || !getToken()) return;
  if (state.capabilities?.on_vercel || typeof EventSource === 'undefined') return startPolling();
  try {
    source = new EventSource(api.streamUrl(state.project.id));
  } catch { return startPolling(); }
  source.onopen = () => { state.live = true; emit('live', true); };
  source.onerror = () => {
    state.live = false; emit('live', false);
    source?.close(); source = null;
    if (!pollTimer) startPolling();
  };
  source.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    handleLive(msg);
  };
}
export function stopLive() {
  source?.close(); source = null;
  clearInterval(pollTimer); pollTimer = null;
  state.live = false;
}
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      // One round trip that also carries everyone else's changes.
      const boot = await api.bootstrap(state.project.id);
      Object.assign(state, {
        features: boot.features, placements: boot.placements, workspaces: boot.workspaces,
        activity: boot.activity, sections: boot.sections, comments: boot.comments, viewers: boot.viewers,
      });
      emit('change');
    } catch { /* keep last known state */ }
  }, 15000);
}

function handleLive(msg) {
  if (msg.type === 'activity' && msg.activity) {
    state.activity = [msg.activity, ...state.activity].slice(0, 120);
  }
  if (msg.type === 'presence') {
    state.viewers = msg.count;
    state.viewerList = msg.viewers || [];
  }
  if (msg.type === 'placements') {
    if (msg.action === 'moved' || msg.action === 'added') {
      const map = new Map(state.placements.map((p) => [p.id, p]));
      for (const p of msg.placements || []) map.set(p.id, p);
      state.placements = [...map.values()];
      refreshFeatures((msg.placements || []).map((p) => p.feature_id));
    }
    if (msg.action === 'removed') state.placements = state.placements.filter((p) => !(msg.ids || []).includes(p.id));
  }
  if (msg.type === 'workspace') {
    if (msg.action === 'created') state.workspaces = [...state.workspaces.filter((w) => w.id !== msg.workspace.id), msg.workspace];
    if (msg.action === 'updated') state.workspaces = state.workspaces.map((w) => (w.id === msg.workspace.id ? msg.workspace : w));
    if (msg.action === 'deleted') state.workspaces = state.workspaces.filter((w) => w.id !== msg.id);
  }
  if (msg.type === 'feature') {
    if (msg.action === 'created') state.features = [...state.features.filter((f) => f.id !== msg.feature.id), msg.feature];
    if (msg.action === 'updated') applyFeatures([msg.feature]);
    if (msg.action === 'deleted') state.features = state.features.filter((f) => f.id !== msg.id);
  }
  if (msg.type === 'features' && msg.action === 'bulk') applyFeatures(msg.features || []);
  if (msg.type === 'comment' && msg.comment) state.comments = [...state.comments, msg.comment];
  emit('change');
}

window.addEventListener('online', () => { state.online = true; emit('online', true); });
window.addEventListener('offline', () => { state.online = false; emit('online', false); });

export { setToken };
