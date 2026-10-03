/**
 * Tracker shell: sign-in gate, sidebar, routing, live sync and shortcuts.
 */
import { h, icon, iconHtml, toast, avatar, debounce } from './ui.js';
import { api, setToken, getToken } from './api.js';
import { dnd } from './dnd.js';
import * as store from './state.js';
import { openWorkspaceModal, openImportModal, openPalette, openHelp, openAccountSheet } from './components.js';
import { renderOverview } from './views/overview.js';
import { renderBacklog } from './views/backlog.js';
import { renderBoard } from './views/board.js';
import { renderActivity } from './views/activity.js';
import { renderTeam } from './views/team.js';

const $ = (id) => document.getElementById(id);
const NAV = [
  ['#/overview', 'chart', 'Overview'],
  ['#/backlog', 'list', 'Backlog'],
  ['#/board', 'board', 'Board'],
  ['#/activity', 'activity', 'Activity'],
  ['#/team', 'users', 'Team & data'],
];

/* ================================================================= gate === */

const INVITE_KEY = 'nbg_tracker_invite';

async function boot() {
  try { window.__health = await api.health().catch(() => null); } catch { /* offline */ }

  const hashInvite = location.hash.startsWith('#/join/') ? location.hash.split('/')[2] : null;
  if (hashInvite) sessionStorage.setItem(INVITE_KEY, hashInvite);

  if (!getToken()) return showGate();
  try {
    const me = await api.me();
    if (!me.account) return showGate();
    return startApp();
  } catch (e) {
    if (e.status === 401) { setToken(null); return showGate(); }
    return showGate(e.message);
  }
}

/** Complete a pending #/join/<token> handshake after signing in. */
async function completeInvite() {
  const token = sessionStorage.getItem(INVITE_KEY);
  if (!token) return false;
  sessionStorage.removeItem(INVITE_KEY);
  try {
    const res = await fetch(`/api/tracker/invites/${token}/accept`, {
      method: 'POST', headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not accept the invite');
    if (data.project_id) localStorage.setItem('nbg_tracker_project', data.project_id);
    toast(`Joined the project as ${data.role}`, { type: 'ok' });
    return true;
  } catch (e) { toast(e.message, { type: 'bad' }); return false; }
}

function showGate(error = null, afterJoin = null) {
  void afterJoin;
  $('gate').hidden = false;
  $('shell').hidden = true;
  let tab = 'guest';
  const body = $('gate-body');

  const paint = () => {
    body.innerHTML = '';
    const err = h('div', { class: 'form-error', style: { display: error ? '' : 'none' }, text: error || '' });
    const tabs = h('div', { class: 'tabs' },
      h('button', { class: tab === 'guest' ? 'active' : '', text: 'Try the demo', onclick: () => { tab = 'guest'; paint(); } }),
      h('button', { class: tab === 'login' ? 'active' : '', text: 'Sign in', onclick: () => { tab = 'login'; paint(); } }),
      h('button', { class: tab === 'register' ? 'active' : '', text: 'Create account', onclick: () => { tab = 'register'; paint(); } }));

    const name = h('input', { class: 'input', placeholder: 'Your name' });
    const email = h('input', { class: 'input', type: 'email', placeholder: 'you@company.com' });
    const password = h('input', { class: 'input', type: 'password', placeholder: 'At least 8 characters' });
    const go = h('button', { class: 'btn primary block' });
    const field = (label, el) => h('label', { class: 'field' }, h('span', { text: label }), el);

    const submit = async () => {
      err.style.display = 'none';
      go.disabled = true;
      go.innerHTML = '<span class="spin"></span>';
      try {
        let res;
        if (tab === 'guest') res = await api.guest(name.value || undefined);
        else if (tab === 'login') res = await api.login(email.value, password.value);
        else res = await api.register(name.value, email.value, password.value);
        setToken(res.token);
        if (res.project_id) localStorage.setItem('nbg_tracker_project', res.project_id);
        await completeInvite();
        await startApp();
      } catch (e) {
        err.textContent = e.message;
        err.style.display = '';
        go.disabled = false;
        go.textContent = tab === 'guest' ? 'Enter the demo' : tab === 'login' ? 'Sign in' : 'Create account';
      }
    };

    if (tab === 'guest') {
      go.textContent = 'Enter the demo';
      body.append(err,
        h('p', { class: 'small muted', text: 'A one-tap guest session on the shared NearBuyGoods project — drag the 389 features from the audit into “MVP features”, “Next release” and any workspace you create. Reset anytime.' }),
        field('Your name (optional)', name),
        h('p', { class: 'tiny muted', text: 'Demo accounts use the shared project. Create an account for a private one.' }),
        go);
    } else if (tab === 'login') {
      go.textContent = 'Sign in';
      body.append(err, field('Email', email), field('Password', password), go,
        h('p', { class: 'tiny muted', text: 'Seeded demo login: pm@nearbuygoods.app / demo1234 (when demo mode is on).' }));
    } else {
      go.textContent = 'Create account';
      body.append(err, field('Name', name), field('Email', email), field('Password', password), go,
        h('p', { class: 'tiny muted', text: 'You get your own project with the feature document already imported.' }));
    }
    go.addEventListener('click', submit);
    [...body.querySelectorAll('input')].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
    if (tab === 'guest') setTimeout(() => name.focus(), 40); else setTimeout(() => email.focus(), 40);
  };

  paint();
  const db = window.__health?.database;
  if (db) $('gate-body').append(h('p', { class: 'tiny muted', style: { marginTop: '14px' }, text: `Database: ${db.label}` }));
}

/* ================================================================ shell === */

let currentView = null;
let paintQueued = false;

async function startApp() {
  $('gate').hidden = true;
  $('shell').hidden = false;
  try {
    await store.load();
  } catch (e) {
    if (e.status === 401) { setToken(null); return showGate(); }
    toast(e.message, { type: 'bad' });
    return;
  }
  if (!location.hash || location.hash === '#' || location.hash === '#/') location.hash = '#/overview';
  paintChrome();
  window.addEventListener('hashchange', route);
  store.on('change', queueRender);
  store.on('change', debounce(() => { if (store.state.view === 'overview') store.loadStats(); }, 1200));
  store.on('selection', queueRender);
  store.on('stats', queueRender);   // overview blocks paint as soon as stats land
  store.on('live', paintChrome);
  document.addEventListener('keydown', shortcuts);
  store.startLive();
  store.loadStats();
  route();
}

function queueRender() {
  if (dnd.active) return;           // never re-render mid-drag
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => { paintQueued = false; paintCurrent(); paintSidebarCounts(); });
}

function paintChrome() {
  const { state } = store;
  /* project picker */
  const picker = $('project-picker');
  picker.innerHTML = '';
  picker.append(h('select', {
    'aria-label': 'Project',
    onchange: (e) => store.switchProject(e.target.value).then(() => { paintChrome(); paintCurrent(); }),
  }, state.projects.map((p) => h('option', { value: p.id, selected: state.project?.id === p.id }, `${p.key} · ${p.name}`))));

  /* database chip */
  const db = state.database || {};
  const chip = $('dbchip');
  chip.className = `dbchip ${db.mode === 'memory' ? 'warn' : 'ok'}`;
  chip.innerHTML = '';
  chip.append(icon('database', 14), h('span', { text: db.mode === 'neon' ? 'Neon Postgres' : db.mode === 'kv' ? 'Vercel KV' : db.mode === 'file' ? 'Local file DB' : 'Ephemeral' }));
  chip.title = `${db.label || ''} — click for details`;
  chip.onclick = () => openAccountSheet({ onSignOut: signOut });

  /* presence */
  const presence = $('presence');
  presence.innerHTML = '';
  const viewers = state.viewerList?.length ? state.viewerList : [{ name: state.me?.name, id: state.me?.id }];
  for (const v of viewers.slice(0, 4)) presence.append(avatar(v));

  const acc = $('account-btn');
  acc.style.background = state.me?.color || '#5c6ac4';
  acc.textContent = (state.me?.name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  acc.onclick = () => openAccountSheet({ onSignOut: signOut });

  paintNav();
  paintSidebarCounts();
}

function paintNav() {
  const path = (location.hash || '#/overview').split('?')[0];
  const nav = $('nav');
  nav.innerHTML = '';
  for (const [hash, ic, label] of NAV) {
    const active = hash === '#/board' ? path.startsWith('#/board') : path === hash;
    const n = countFor(hash);
    const btn = h('button', { class: active ? 'active' : '', onclick: () => { location.hash = hash; } }, icon(ic, 18), h('span', { class: 'grow', text: label }), n === '' ? null : h('span', { class: 'count', text: n }));
    if (hash === '#/backlog' && store.selectedIds().length) btn.querySelector('.count').textContent = `${store.selectedIds().length} sel`;
    // dropping a placed card on the Backlog row takes it off its board
    dnd.zone(btn, {
      key: 'unplace', accept: (p) => p.kind === 'features' && !!p.placementIds?.length,
      onDrop: (p) => store.removePlacements(p.placementIds),
    });
    nav.append(btn);
  }
}

const countFor = (hash) => {
  const { state } = store;
  if (hash === '#/backlog') return state.features.length;
  if (hash === '#/board') return state.placements.length;
  if (hash === '#/activity') return state.activity.length;
  return '';
};

function paintSidebarCounts() {
  const { state } = store;
  const list = $('ws-list');
  list.innerHTML = '';
  for (const ws of state.workspaces) {
    const cards = store.inWorkspace(ws.id);
    const stages = store.stagesOf(ws);
    const done = cards.filter((c) => c.stage === stages.at(-1).id).length;
    const item = h('button', {
      class: `ws-item${ws.id === state.activeWorkspace ? ' active' : ''}`,
      onclick: () => { state.activeWorkspace = ws.id; location.hash = `#/board/${ws.id}`; paintSidebarCounts(); },
    },
    h('span', { class: 'ico', text: ws.icon || '🗂️' }),
    h('div', { class: 'grow' }, h('div', { text: ws.name }),
      h('div', { class: 'bar' }, h('i', { style: { width: `${cards.length ? (done / cards.length) * 100 : 0}%` } }))),
    h('span', { class: 'n', text: `${cards.length}` }));

    dnd.zone(item, {
      key: `ws:${ws.id}`,
      accept: (p) => p.kind === 'features',
      onDrop: (p) => {
        const stage = p.from?.workspaceId === ws.id ? p.from.stage : store.stagesOf(ws)[0].id;
        if (p.placementIds?.length) store.movePlacements(p.placementIds, { workspaceId: ws.id, stage, index: null });
        else store.placeFeatures(p.ids, ws.id, stage);
        state.activeWorkspace = ws.id;
        paintSidebarCounts();
      },
    });
    list.append(item);
  }
  if (!state.workspaces.length) list.append(h('p', { class: 'tiny', style: { padding: '4px 10px' }, text: 'No workspaces yet.' }));

  const foot = $('side-foot');
  foot.innerHTML = '';
  foot.append(
    h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: `dot-live${state.live ? '' : ' off'}` }),
      h('span', { text: state.live ? `Live · ${state.viewers || 1} viewing` : 'Polling every 15s' })),
    h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } },
      h('a', { text: 'API docs', href: '/api/docs', target: '_blank' }),
      h('a', { text: 'NearBuyGoods app', href: '/', target: '_blank' })));
}

/* ============================================================== routing === */

function route() {
  paintNav();
  paintCurrent();
  $('main').scrollTop = 0;
  closeMobileNav();
}

const closeMobileNav = () => document.body.classList.remove('nav-open');

function paintCurrent() {
  const { state } = store;
  if (!state.ready) return;
  const path = (location.hash || '#/overview').split('?')[0];
  const main = $('main');
  currentView?.dispatchEvent(new Event('tracker:teardown'));
  main.innerHTML = '';
  let view;
  if (path.startsWith('#/board')) {
    const wsId = path.split('/')[2];
    if (wsId && state.workspaces.some((w) => w.id === wsId)) state.activeWorkspace = wsId;
    view = renderBoard();
    state.view = 'board';
  } else if (path === '#/backlog') { view = renderBacklog(); state.view = 'backlog'; }
  else if (path === '#/activity') { view = renderActivity(); state.view = 'activity'; }
  else if (path === '#/team') { view = renderTeam(); state.view = 'team'; }
  else { view = renderOverview(); state.view = 'overview'; }
  currentView = view;
  main.append(view);
  paintSidebarCounts();
  paintNav();
}

/* =========================================================== shortcuts === */

function shortcuts(e) {
  const typing = /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable;
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); store.undoLast(); return; }
  if (typing || meta) return;
  if (e.key === '?') { e.preventDefault(); openHelp(); return; }
  if (e.key.toLowerCase() === 'n') { e.preventDefault(); openWorkspaceModal({}); return; }
  if (e.key.toLowerCase() === 'b') { location.hash = '#/backlog'; return; }
  if (e.key.toLowerCase() === 'm') { location.hash = '#/board'; return; }
  if (e.key.toLowerCase() === 'i') { openImportModal(); return; }
  if (e.key === 'Escape') { store.clearSelection(); }
}

/* ============================================================== wiring === */

function signOut() {
  setToken(null);
  store.stopLive();
  store.state.signedIn = false;
  location.reload();
}

$('search-btn').onclick = () => openPalette();
$('new-workspace-btn').onclick = () => openWorkspaceModal({});
$('new-workspace-btn-2').onclick = () => openWorkspaceModal({});
$('help-btn').onclick = () => openHelp();
$('menu-btn').onclick = () => document.body.classList.toggle('nav-open');
$('main').addEventListener('click', () => document.body.classList.remove('nav-open'));
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

boot();
