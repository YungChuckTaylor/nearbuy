// Team — members, invites, database status and exports.
import { h, iconHtml, icon, avatar, toast } from '../ui.js';
import { api } from '../api.js';
import * as store from '../state.js';
import { openInviteModal } from '../components.js';

function memberRow(m) {
  const email = m.account?.email || '';
  return h('tr', {},
    h('td', {},
      h('div', { class: 'row', style: { gap: '9px' } },
        avatar(m.account || { name: 'Guest' }),
        h('div', {},
          h('div', { class: 'bold', text: m.account?.name || 'Guest' }),
          h('div', { class: 'tiny muted', text: email.endsWith('@guest.local') ? 'demo guest session' : email })))),
    h('td', {}, h('span', { class: 'pill tag', text: m.role })),
    h('td', { class: 'small muted', text: new Date(m.created).toLocaleDateString() }));
}

function dbRow(label, value, mono = false) {
  return h('tr', {}, h('td', { class: 'muted small', text: label }), h('td', { class: `small${mono ? ' mono' : ''}`, text: value }));
}

export function renderTeam() {
  const { state } = store;
  const wrap = h('div', {});

  wrap.append(h('div', { class: 'page-head' },
    h('div', {}, h('h2', { text: 'Team & data' }),
      h('p', { text: 'Who can see this project, where the data lives, and how to get it out.' })),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', html: iconHtml('plus', 16), text: 'Invite teammate', onclick: () => openInviteModal() }))));

  const members = state.members || [];
  const table = h('table', { class: 'table' },
    h('thead', {}, h('tr', {},
      h('th', { text: 'Person' }),
      h('th', { text: 'Role' }),
      h('th', { text: 'Joined' }))),
    h('tbody', {}, members.map(memberRow)));

  wrap.append(h('div', { class: 'card pad' },
    h('h3', { text: `Members (${members.length})`, style: { fontSize: '1rem', marginBottom: '10px' } }),
    members.length ? table : h('p', { class: 'small muted', text: 'Just you so far.' })));

  const db = state.database || {};
  const modeText = db.mode === 'neon' ? 'SQL tables (nb_trk_*)'
    : db.mode === 'kv' ? 'gzip JSON document (nbg:tracker:v1)'
      : db.mode === 'file' ? 'local .data/tracker.json'
        : 'ephemeral memory';

  const dbCard = h('div', { class: 'card pad' },
    h('div', { class: 'row', style: { gap: '10px', marginBottom: '8px' } }, icon('database', 20), h('h3', { text: 'Database', style: { fontSize: '1rem' } })),
    h('p', { class: 'small muted', text: 'Storage is auto-detected, so the same code runs locally and on Vercel.' }),
    h('table', { class: 'table' },
      dbRow('Driver', db.mode || 'unknown'),
      dbRow('Location', db.label || '—', true),
      dbRow('Shape', modeText)),
    db.mode === 'memory' ? h('p', { class: 'small', style: { color: 'var(--warn)' }, text: '⚠️ No database attached on this deployment — attach Neon Postgres or Vercel KV (Vercel → Storage), then redeploy.' }) : null);

  const exportCard = h('div', { class: 'card pad' },
    h('h3', { text: 'Export & backup', style: { fontSize: '1rem', marginBottom: '8px' } }),
    h('p', { class: 'small muted', text: 'Everything here is your data: feature rows, placements, comments and history.' }),
    h('div', { class: 'col', style: { gap: '8px' } },
      h('a', { class: 'btn ghost', href: api.exportUrl('json'), target: '_blank' }, icon('download', 16), 'features.json'),
      h('a', { class: 'btn ghost', href: api.exportUrl('csv'), target: '_blank' }, icon('download', 16), 'features.csv'),
      h('button', {
        class: 'btn ghost', html: iconHtml('refresh', 16), text: 'Reload from server',
        onclick: async () => { await store.load(state.project.id); await store.loadStats(); toast('Reloaded from the database', { type: 'ok' }); },
      })));

  wrap.append(h('div', { class: 'grid g2', style: { marginTop: '14px' } }, dbCard, exportCard));

  return wrap;
}
