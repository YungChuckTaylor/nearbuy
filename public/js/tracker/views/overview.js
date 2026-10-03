// Overview — project health at a glance, straight from the database.
import { h, icon, iconHtml, sparkline, timeAgo, avatar } from '../ui.js';
import * as store from '../state.js';
import { openWorkspaceModal, openImportModal, openPlanModal, STATUS_COLOR, STATUS_LABEL } from '../components.js';

export function renderOverview() {
  const { state } = store;
  const stats = state.stats;
  const wrap = h('div', {});

  wrap.append(h('div', { class: 'page-head' },
    h('div', {}, h('h2', { text: 'Overview' }),
      h('p', { text: `${state.project?.name} · ${state.features.length} features imported from the feature document` })),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', html: iconHtml('sparkle', 16), text: 'Auto-plan', onclick: () => openPlanModal(state.activeWorkspace || state.workspaces[0]?.id) }),
      h('button', { class: 'btn', html: iconHtml('upload', 16), text: 'Import doc', onclick: () => openImportModal() }),
      h('button', { class: 'btn primary', html: iconHtml('plus', 16), text: 'New workspace', onclick: () => openWorkspaceModal({}) }))));

  if (!stats) { wrap.append(h('div', { class: 'grid g4' }, Array.from({ length: 4 }, () => h('div', { class: 'card pad skeleton', style: { height: '104px' } })))); return wrap; }

  const t = stats.totals;
  const donePct = t.features ? Math.round((t.shipped / t.features) * 100) : 0;

  const kpi = (label, value, sub, extra) => h('div', { class: 'card pad kpi' },
    h('span', { class: 'label', text: label }),
    h('span', { class: 'value' }, String(value), sub ? h('small', { text: ` ${sub}` }) : null),
    extra || h('span', { class: 'sub', text: '' }));

  wrap.append(h('div', { class: 'grid g4' },
    kpi('Features', t.features, 'in the plan'),
    kpi('Shipped', t.shipped, `(${donePct}%)`,
      h('div', { class: 'bar', style: { marginTop: '8px' } }, h('i', { class: 'ok', style: { width: `${donePct}%` } }))),
    kpi('In flight', t.in_progress, 'doing + review'),
    kpi('On a board', t.placed, `of ${t.features}`,
      h('div', { class: 'bar', style: { marginTop: '8px' } }, h('i', { class: 'warn', style: { width: `${t.features ? Math.round((t.placed / t.features) * 100) : 0}%` } }))),
  ));

  wrap.append(h('div', { class: 'grid g4', style: { marginTop: '14px' } },
    kpi('Workspaces', t.workspaces, 'boards'),
    kpi('Unplanned', t.unplaced, 'not on any board'),
    kpi('From the audit', `${t.source_shipped}✓ ${t.source_partial}◐ ${t.source_missing}✗`, 'built · partial · to build'),
    kpi('Activity', t.activity, `${t.comments} comments`),
  ));

  /* section breakdown */
  const sectionCard = h('div', { class: 'card pad', style: { marginTop: '14px' } },
    h('div', { class: 'row spread', style: { marginBottom: '10px' } },
      h('h3', { text: 'Feature document by section', style: { fontSize: '1rem' } }),
      h('div', { class: 'row tiny muted', style: { gap: '10px' } },
        h('span', { class: 'row', style: { gap: '5px' } }, h('i', { style: { width: '9px', height: '9px', borderRadius: '3px', background: STATUS_COLOR.shipped, display: 'inline-block' } }), 'built'),
        h('span', { class: 'row', style: { gap: '5px' } }, h('i', { style: { width: '9px', height: '9px', borderRadius: '3px', background: STATUS_COLOR.in_progress, display: 'inline-block' } }), 'partial'),
        h('span', { class: 'row', style: { gap: '5px' } }, h('i', { style: { width: '9px', height: '9px', borderRadius: '3px', background: '#cbd2e4', display: 'inline-block' } }), 'to build'))));
  for (const s of stats.by_section) {
    const pct = Math.round((s.shipped / s.total) * 100);
    sectionCard.append(h('div', { class: 'section-row' },
      h('span', { class: 'section-name', title: s.section, text: `${s.index}. ${s.section}` }),
      h('div', { class: 'bar' },
        h('i', { class: 'ok', style: { width: `${(s.shipped / s.total) * 100}%` } }),
        h('i', { class: 'warn', style: { width: `${(s.partial / s.total) * 100}%` } }),
        h('i', { class: 'bad', style: { width: `${(s.missing / s.total) * 100}%` } })),
      h('span', { class: 'section-pct', text: `${pct}%` })));
  }
  wrap.append(sectionCard);

  /* momentum + workspaces */
  const momentum = h('div', { class: 'card pad' },
    h('h3', { text: 'Momentum (14 days)', style: { fontSize: '1rem', marginBottom: '8px' } }),
    sparkline(stats.trend.map((d) => d.touched)),
    h('div', { class: 'row tiny muted', style: { justifyContent: 'space-between', marginTop: '4px' } },
      h('span', { text: stats.trend[0]?.label || '' }),
      h('span', { text: `${stats.trend.reduce((a, d) => a + d.done, 0)} completed · ${stats.trend.reduce((a, d) => a + d.touched, 0)} changes` }),
      h('span', { text: stats.trend.at(-1)?.label || '' })));

  const wsCard = h('div', { class: 'card pad' },
    h('div', { class: 'row spread', style: { marginBottom: '10px' } },
      h('h3', { text: 'Workspaces', style: { fontSize: '1rem' } }),
      h('button', { class: 'btn xs', text: 'Board view', onclick: () => { location.hash = '#/board'; } })),
    stats.by_workspace.length ? stats.by_workspace.map((w) => h('div', { class: 'section-row', style: { gridTemplateColumns: '1fr 130px 48px' } },
      h('span', { class: 'section-name', text: w.name }),
      h('div', { class: 'bar' }, h('i', { class: 'ok', style: { width: `${w.progress}%` } })),
      h('span', { class: 'section-pct', text: `${w.done}/${w.total}` }))) : h('p', { class: 'small muted', text: 'No workspaces yet.' }));

  wrap.append(h('div', { class: 'grid g2', style: { marginTop: '14px' } }, momentum, wsCard));

  /* recent activity */
  wrap.append(h('div', { class: 'card pad', style: { marginTop: '14px' } },
    h('h3', { text: 'Recent activity', style: { fontSize: '1rem', marginBottom: '6px' } }),
    stats.recent?.length ? stats.recent.map((a) => feedRow(a)) : h('p', { class: 'small muted', text: 'Nothing yet — drag a feature into a workspace to get started.' })));

  return wrap;
}

export function feedRow(a) {
  const verbs = {
    'project.created': 'created the project', 'project.planned': 'planned the MVP', 'project.updated': 'updated the project',
    'workspace.created': 'created workspace', 'workspace.updated': 'updated workspace', 'workspace.deleted': 'deleted workspace',
    'feature.created': 'added feature', 'feature.updated': 'updated', 'feature.completed': 'completed', 'feature.deleted': 'deleted',
    'features.imported': 'imported features from', 'features.bulk_updated': 'bulk-updated', 'placement.added': 'added cards to',
    'placement.moved': 'moved cards in', 'placement.removed': 'removed cards from', 'comment.added': 'commented on',
    'member.joined': 'joined', 'invite.created': 'invited someone to',
  };
  return h('div', { class: 'feed-item' },
    avatar({ name: a.actor_name, color: '#5c6ac4' }, 'sm'),
    h('div', { class: 'grow' },
      h('div', { class: 'what' }, h('b', { text: a.actor_name }), ' ', h('span', { class: 'muted', text: verbs[a.verb] || a.verb.replace(/[._]/g, ' ') }), ' ', h('span', { class: 'bold', text: a.subject_label || '' })),
      h('div', { class: 'when', text: timeAgo(a.created) })));
}

export { icon, iconHtml, STATUS_LABEL };
