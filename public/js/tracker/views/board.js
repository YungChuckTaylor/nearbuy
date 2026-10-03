// Board — the drag & drop heart of the tracker.
import { h, iconHtml, toast, confirmDialog, modal, icon } from '../ui.js';
import { dnd } from '../dnd.js';
import * as store from '../state.js';
import { featureCard, openWorkspaceModal, openPlanModal, openMoveModal } from '../components.js';

export function renderBoard() {
  const { state } = store;
  const wrap = h('div', {});

  if (!state.workspaces.length) {
    wrap.append(h('div', { class: 'empty' }, h('div', { class: 'ic', text: '🗂️' }), h('h4', { text: 'No workspaces yet' }),
      h('p', { class: 'small', text: 'A workspace is a board you fill by dragging features in — start with “MVP features”.' }),
      h('button', { class: 'btn primary', html: iconHtml('plus', 16), text: 'Create workspace', onclick: () => openWorkspaceModal({}) })));
    return wrap;
  }

  const ws = store.workspaceById(state.activeWorkspace) || state.workspaces[0];
  state.activeWorkspace = ws.id;
  const stages = store.stagesOf(ws);
  const cards = store.inWorkspace(ws.id);

  /* ------------------------------------------------------------- header ---- */
  wrap.append(h('div', { class: 'page-head' },
    h('div', {}, h('h2', { text: `${ws.icon || '🗂️'} ${ws.name}` }),
      h('p', { text: ws.purpose || 'Drag cards between columns, or drag a card onto another workspace tab to move it.' })),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', html: iconHtml('plus', 16), text: 'Add features', onclick: () => openAddSheet(ws) }),
      h('button', { class: 'btn', html: iconHtml('sparkle', 16), text: 'Auto-plan', onclick: () => openPlanModal(ws.id) }),
      h('button', { class: 'btn ghost', html: iconHtml('pencil', 16), text: 'Settings', onclick: () => openWorkspaceModal({ workspace: ws }) }))));

  /* ------------------------------------------------------- workspace tabs ---- */
  const tabs = h('div', { class: 'ws-tabs' }, state.workspaces.map((w) => {
    const tab = h('button', { class: `ws-tab${w.id === ws.id ? ' active' : ''}`, onclick: () => { state.activeWorkspace = w.id; store.emit('change'); } },
      h('span', { text: w.icon || '🗂️' }), h('span', { text: w.name }),
      h('span', { class: 'n', text: String(store.inWorkspace(w.id).length) }));
    dnd.zone(tab, {
      key: `ws:${w.id}`,
      accept: (p) => p.kind === 'features' && (p.from?.workspaceId !== w.id || (p.placementIds?.length && w.id !== p.from?.workspaceId)),
      onDrop: (p) => {
        const first = store.stagesOf(w)[0].id;
        if (p.placementIds?.length) store.movePlacements(p.placementIds, { workspaceId: w.id, stage: p.from?.stage || first, index: null });
        else store.placeFeatures(p.ids, w.id, first);
        state.activeWorkspace = w.id;
        store.emit('change');
      },
    });
    return tab;
  }));
  wrap.append(h('div', { class: 'board-head' }, tabs));

  /* ------------------------------------------------------------- columns ---- */
  const board = h('div', { class: 'board' });
  for (const stage of stages) {
    const colCards = cards.filter((c) => c.stage === stage.id).sort((a, b) => (a.position || 0) - (b.position || 0));
    const overLimit = ws.wip_limit && colCards.length > ws.wip_limit;
    const body = h('div', { class: 'col-body', role: 'list', 'aria-label': `${stage.label} column` });

    for (const card of colCards) {
      const feature = store.featureById(card.feature_id);
      if (!feature) continue;
      const el = featureCard(feature, { placement: card });
      el.dataset.placement = card.placement_id;
      body.append(el);
    }
    if (!colCards.length) body.append(h('div', { class: 'empty-col', text: 'Drop features here' }));

    dnd.zone(body, {
      key: `stage:${ws.id}:${stage.id}`,
      axis: 'y',
      accept: (p) => p.kind === 'features',
      onDrop: (p, { index }) => {
        if (p.placementIds?.length) store.movePlacements(p.placementIds, { workspaceId: ws.id, stage: stage.id, index });
        else store.placeFeatures(p.ids, ws.id, stage.id, index);
      },
    });

    const col = h('section', { class: 'col', dataset: { stage: stage.id } },
      h('div', { class: 'col-head' },
        h('span', { class: 'dot', style: { background: stage.color } }),
        h('span', { class: 'name', text: stage.label }),
        h('span', { class: `n${overLimit ? ' over' : ''}`, text: `${colCards.length}${ws.wip_limit ? `/${ws.wip_limit}` : ''}` }),
        h('button', { class: 'icon-btn tiny add', html: iconHtml('plus', 15), title: `Add a feature to ${stage.label}`, onclick: () => openAddSheet(ws, stage.id) })),
      body,
      h('div', { class: 'col-foot', text: overLimit ? '⚠️ Over the WIP limit — finish something first' : '' }));
    board.append(col);
  }
  wrap.append(board);

  /* footer actions for the whole board */
  wrap.append(h('div', { class: 'row', style: { gap: '10px', marginTop: '4px', flexWrap: 'wrap' } },
    h('span', { class: 'small muted', text: `${cards.length} cards · ${cards.length - cards.filter((c) => c.stage === stages.at(-1).id).length} still open` }),
    h('span', { class: 'spacer' }),
    h('button', {
      class: 'btn ghost sm', html: iconHtml('x', 15), text: 'Clear this board',
      onclick: async () => {
        if (!await confirmDialog('Clear board?', `All ${cards.length} cards leave “${ws.name}”. The features stay in the backlog.`)) return;
        await store.removePlacements(cards.map((c) => c.placement_id));
      },
    })));

  return wrap;
}

/* ------------------------------------------------- add-features modal ---- */

export function openAddSheet(ws, stage) {
  const stages = store.stagesOf(ws);
  const chosen = new Set();
  modal(`Add features to ${ws.name}`, ({ close }) => {
    const body = h('div', {});
    const stageSel = h('select', { class: 'input' }, stages.map((s) => h('option', { value: s.id, selected: s.id === stage }, s.label)));
    const search = h('input', { class: 'input', placeholder: 'Filter by title, section or code…' });
    const listBox = h('div', { class: 'col', style: { gap: '5px', maxHeight: '46vh', overflow: 'auto', marginTop: '10px' } });
    const count = h('span', { class: 'small muted' });

    const paint = () => {
      const q = search.value.trim().toLowerCase();
      const rows = state.features
        .filter((f) => !store.isPlaced(f.id))
        .filter((f) => !q || `${f.title} ${f.section} ${f.code}`.toLowerCase().includes(q))
        .slice(0, 120);
      listBox.innerHTML = '';
      for (const f of rows) {
        const cb = h('input', { type: 'checkbox', checked: chosen.has(f.id) });
        const row = h('label', { class: 'frow', style: { gridTemplateColumns: '22px 1fr auto', cursor: 'pointer' } },
          cb, h('div', { class: 'col' }, h('span', { class: 'title', text: f.title }), h('span', { class: 'tiny muted', text: `${f.code} · ${f.section}` })),
          h('span', { class: 'pill tag', text: f.source_status || 'new' }));
        cb.addEventListener('change', () => { cb.checked ? chosen.add(f.id) : chosen.delete(f.id); count.textContent = `${chosen.size} selected`; });
        row.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT') { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } });
        listBox.append(row);
      }
      if (!rows.length) listBox.append(h('p', { class: 'small muted', text: 'Everything matching is already on a board.' }));
      count.textContent = `${chosen.size} selected`;
    };
    search.addEventListener('input', paint);
    paint();
    body.append(h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', { text: 'Column' }), stageSel),
      h('label', { class: 'field' }, h('span', { text: 'Search' }), search)), listBox, count);
    return body;
  }, {
    footer: ({ close }) => [
      h('button', { class: 'btn ghost', text: 'Cancel', onclick: close }),
      h('button', {
        class: 'btn primary', text: 'Add to board',
        onclick: async () => {
          if (!chosen.size) return toast('Pick at least one feature', { type: 'bad' });
          await store.placeFeatures([...chosen], ws.id, document.querySelector('.modal.show select').value);
          close();
          store.emit('change');
        },
      }),
    ],
  });
}

export { icon };
