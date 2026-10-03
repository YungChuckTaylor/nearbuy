// Backlog — every feature in the document, filterable, multi-selectable and draggable.
import { h, iconHtml, toast, confirmDialog, debounce } from '../ui.js';
import { dnd } from '../dnd.js';
import * as store from '../state.js';
import { featureRow, openMoveModal, openImportModal, openPlanModal, STATUS_LABEL } from '../components.js';

const PAGE = 80;

export function renderBacklog() {
  const { state } = store;
  const wrap = h('div', {});
  let shown = PAGE;

  wrap.append(h('div', { class: 'page-head' },
    h('div', {}, h('h2', { text: 'Backlog' }),
      h('p', { text: 'Drag a row onto a workspace in the sidebar, drop it on a board column, or select several and use the bulk bar.' })),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', html: iconHtml('sparkle', 16), text: 'Auto-plan', onclick: () => openPlanModal(state.activeWorkspace || state.workspaces[0]?.id) }),
      h('button', { class: 'btn', html: iconHtml('upload', 16), text: 'Import', onclick: () => openImportModal() }))));

  /* ------------------------------------------------------------ filters ---- */
  const q = h('input', { class: 'input', placeholder: 'Search features…', value: state.filters.q });
  q.addEventListener('input', debounce(() => { state.filters.q = q.value; paint(); }, 200));

  const sectionSel = h('select', { class: 'input', style: { width: 'auto' }, onchange: (e) => { state.filters.section = e.target.value; paint(); } },
    h('option', { value: '' }, 'All sections'),
    state.sections.map((s) => h('option', { value: s.index, selected: String(state.filters.section) === String(s.index) }, `${s.index}. ${s.name} (${s.total})`)));

  const statusSel = h('select', { class: 'input', style: { width: 'auto' }, onchange: (e) => { state.filters.status = e.target.value; paint(); } },
    h('option', { value: '' }, 'Any status'),
    Object.entries(STATUS_LABEL).map(([k, v]) => h('option', { value: k, selected: state.filters.status === k }, v)));

  const prioritySel = h('select', { class: 'input', style: { width: 'auto' }, onchange: (e) => { state.filters.priority = e.target.value; paint(); } },
    h('option', { value: '' }, 'Any priority'),
    ['critical', 'high', 'medium', 'low'].map((p) => h('option', { value: p, selected: state.filters.priority === p }, p)));

  const sourceSel = h('select', { class: 'input', style: { width: 'auto' }, onchange: (e) => { state.filters.source_status = e.target.value; paint(); } },
    h('option', { value: '' }, 'Any audit state'),
    h('option', { value: 'missing', selected: state.filters.source_status === 'missing' }, '✗ To build'),
    h('option', { value: 'partial', selected: state.filters.source_status === 'partial' }, '◐ Partial'),
    h('option', { value: 'shipped', selected: state.filters.source_status === 'shipped' }, '✓ Built'));

  const countLabel = h('span', { class: 'small muted' });
  const selectAllBtn = h('button', { class: 'btn ghost sm', text: 'Select all filtered', onclick: () => { for (const f of store.filteredFeatures()) state.selection.add(f.id); store.emit('selection'); paint(); } });

  const toolbar = h('div', { class: 'toolbar' }, q, sectionSel, statusSel, prioritySel, sourceSel, selectAllBtn, h('span', { class: 'spacer' }), countLabel);

  const listBox = h('div', {});
  const bulk = h('div', {});
  wrap.append(toolbar, listBox, bulk);

  /* --------------------------------------------------------------- list ---- */
  function paint() {
    const rows = store.filteredFeatures();
    countLabel.textContent = `${rows.length} feature${rows.length === 1 ? '' : 's'}`;
    listBox.innerHTML = '';
    let lastSection = null;
    const slice = rows.slice(0, shown);
    for (const f of slice) {
      if (f.section !== lastSection) {
        lastSection = f.section;
        const s = state.sections.find((x) => x.name === f.section);
        listBox.append(h('div', { class: 'sec-load' },
          h('span', { text: `${s?.index ?? ''}. ${f.section}` }),
          h('span', { class: 'line' }),
          h('span', { text: `${s ? s.total : ''}` })));
      }
      listBox.append(featureRow(f));
    }
    if (!rows.length) listBox.append(h('div', { class: 'empty' }, h('div', { class: 'ic', text: '🔍' }), h('h4', { text: 'No features match' }), h('p', { class: 'small', text: 'Try clearing a filter or searching for something else.' })));
    if (rows.length > shown) {
      listBox.append(h('button', { class: 'btn ghost block', style: { marginTop: '10px' }, text: `Show ${Math.min(PAGE, rows.length - shown)} more of ${rows.length}`, onclick: () => { shown += PAGE; paint(); } }));
    }
    paintBulk();
  }

  function paintBulk() {
    const ids = store.selectedIds();
    bulk.innerHTML = '';
    if (!ids.length) return;
    const setPri = h('select', { class: 'input', style: { width: 'auto', minHeight: '34px' }, onchange: (e) => { store.patchFeatures(ids, { priority: e.target.value }); } },
      h('option', { value: '' }, 'Set priority…'), ['critical', 'high', 'medium', 'low'].map((p) => h('option', { value: p }, p)));
    const setStatus = h('select', { class: 'input', style: { width: 'auto', minHeight: '34px' }, onchange: (e) => { store.patchFeatures(ids, { status: e.target.value }); } },
      h('option', { value: '' }, 'Set status…'), Object.entries(STATUS_LABEL).map(([k, v]) => h('option', { value: k }, v)));

    bulk.append(h('div', { class: 'bulkbar' },
      h('span', { class: 'n', text: `${ids.length} selected` }),
      h('button', { class: 'btn sm', html: iconHtml('plus', 15), text: 'Add to workspace…', onclick: () => openMoveModal(ids, { after: () => paint() }) }),
      setPri,
      setStatus,
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'btn sm danger', html: iconHtml('trash', 15), text: 'Delete',
        onclick: async () => { if (await confirmDialog('Delete features?', `${ids.length} features will be permanently removed.`)) { await store.deleteFeatures(ids); paint(); } },
      }),
      h('button', { class: 'btn sm', text: 'Clear', onclick: () => { store.clearSelection(); paint(); } })));
  }

  // re-render when the selection changes elsewhere (board cards, palette…)
  const off = store.on('selection', () => { for (const row of listBox.querySelectorAll('.frow')) row.classList.toggle('selected', state.selection.has(row.dataset.feature)); for (const cb of listBox.querySelectorAll('input[type=checkbox]')) cb.checked = state.selection.has(cb.closest('.frow')?.dataset.feature); paintBulk(); });
  wrap.addEventListener('tracker:teardown', off);

  paint();
  return wrap;
}
