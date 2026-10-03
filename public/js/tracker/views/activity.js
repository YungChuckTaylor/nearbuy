// Activity — the live feed (SSE when available, polling otherwise).
import { h, iconHtml, timeAgo, avatar } from '../ui.js';
import * as store from '../state.js';

const VERBS = {
  'project.created': 'created the project', 'project.planned': 'scoped the MVP from the audit', 'project.updated': 'updated the project',
  'workspace.created': 'created the workspace', 'workspace.updated': 'updated the workspace', 'workspace.deleted': 'deleted the workspace',
  'feature.created': 'added the feature', 'feature.updated': 'updated', 'feature.completed': 'shipped', 'feature.deleted': 'deleted',
  'features.imported': 'imported from the feature document', 'features.bulk_updated': 'bulk-updated', 'placement.added': 'added cards to',
  'placement.moved': 'moved cards in', 'placement.removed': 'removed cards from', 'comment.added': 'commented on',
  'member.joined': 'joined', 'invite.created': 'invited a teammate to',
};

export function renderActivity() {
  const { state } = store;
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'page-head' },
    h('div', {}, h('h2', { text: 'Activity' }),
      h('p', { text: 'Every change is recorded in the database — this feed updates live when someone else drags a card.' })),
    h('div', { class: 'actions' },
      h('span', { class: 'chip' }, h('span', { class: `dot-live${state.live ? '' : ' off'}` }), state.live ? 'Live' : 'Polling every 15s'),
      h('span', { class: 'chip' }, h('span', { html: iconHtml('users', 15) }), `${state.viewers || 1} viewing`))));

  if (!state.activity.length) {
    wrap.append(h('div', { class: 'empty' }, h('div', { class: 'ic', text: '📡' }), h('h4', { text: 'No activity yet' }), h('p', { class: 'small', text: 'Drag a feature into a workspace and it will show up here.' })));
    return wrap;
  }
  const card = h('div', { class: 'card pad' });
  for (const a of state.activity) {
    card.append(h('div', { class: 'feed-item' },
      avatar({ name: a.actor_name, color: '#5c6ac4' }, 'sm'),
      h('div', { class: 'grow' },
        h('div', { class: 'what' },
          h('b', { text: a.actor_name }), ' ',
          h('span', { class: 'muted', text: VERBS[a.verb] || a.verb.replace(/[._]/g, ' ') }), ' ',
          h('span', { class: 'bold', text: a.subject_label || '' }),
          a.meta?.count ? h('span', { class: 'pill tag', style: { marginLeft: '6px' }, text: `${a.meta.count}×` }) : null),
        h('div', { class: 'when', text: `${timeAgo(a.created)} · ${new Date(a.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` }))));
  }
  wrap.append(card);
  return wrap;
}
