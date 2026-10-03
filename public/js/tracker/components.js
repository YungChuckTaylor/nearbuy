/**
 * Shared tracker components: feature cards/rows, the feature detail sheet and
 * every modal (new workspace, move-to, auto-plan, import, palette, help).
 */
import { h, icon, iconHtml, modal, sheet, toast, confirmDialog, avatar, timeAgo, confetti, sparkline, initials } from './ui.js';
import { dnd } from './dnd.js';
import { api } from './api.js';
import * as store from './state.js';

export const { state } = store;

export const STATUS_LABEL = { backlog: 'Backlog', planned: 'Planned', in_progress: 'In progress', review: 'In review', shipped: 'Shipped', parked: 'Parked' };
export const STATUS_COLOR = { backlog: '#8b93a7', planned: '#2fbcc7', in_progress: '#e87b29', review: '#7c5cff', shipped: '#0a7d5c', parked: '#b3541e' };
export const EFFORT_LABEL = { xs: 'XS', s: 'S', m: 'M', l: 'L', xl: 'XL' };
const SOURCE_LABEL = { shipped: 'built', partial: 'partial', missing: 'to build' };
const ICON_CHOICES = ['🚀', '🧭', '🧊', '🔥', '🎯', '🧪', '📦', '🛠️', '💳', '🔔', '🧠', '🏁', '🌍', '🛒', '📱', '🎨', '📈', '🧩'];
const COLORS = ['#e87b29', '#2fbcc7', '#7c5cff', '#e56a8c', '#0a7d5c', '#1d4ed8', '#b3541e', '#232c5c'];

export const sourcePill = (s) => (s ? h('span', { class: `pill ${s}`, text: SOURCE_LABEL[s] || s, title: `From the feature document: ${s}` }) : null);
export const priorityPill = (p) => h('span', { class: `pill ${p}`, text: p });
export const statusPill = (s) => h('span', { class: 'pill', style: { background: '#eef1f8', color: STATUS_COLOR[s] || '#667089' }, text: STATUS_LABEL[s] || s });

/* -------------------------------------------------------------- cards ---- */

export function featureCard(feature, { placement, compact = false } = {}) {
  const selected = state.selection.has(feature.id);
  const el = h('article', { class: `card-f${selected ? ' selected' : ''}`, dataset: { feature: feature.id, dndItem: '1' }, tabindex: '0', role: 'listitem', 'aria-label': `${feature.title}. ${STATUS_LABEL[feature.status]}` });

  const check = h('input', {
    type: 'checkbox', 'aria-label': `Select ${feature.title}`, checked: selected,
    onclick: (e) => e.stopPropagation(),
    onchange: (e) => { store.toggleSelect(feature.id, e.target.checked); },
  });

  const top = h('div', { class: 'top' },
    h('span', { class: 'grip', html: iconHtml('grip', 15), title: 'Drag to another column or workspace' }),
    h('span', { class: 'code mono', text: feature.code || '' }),
    h('span', { class: 'spacer' }),
    check);

  const body = h('div', {},
    h('div', { class: 'ttl', text: feature.title }),
    compact ? null : h('div', { class: 'tiny muted', style: { marginTop: '3px' }, text: (feature.detail || '').slice(0, 120) }));

  const bottom = h('div', { class: 'bottom' },
    priorityPill(feature.priority),
    feature.effort ? h('span', { class: 'pill effort', text: EFFORT_LABEL[feature.effort] || feature.effort }) : null,
    sourcePill(feature.source_status),
    feature.tags?.slice(0, 2).map((t) => h('span', { class: 'pill tag', text: t })));

  const otherWs = feature.__workspaces || [];
  el.append(top, body, bottom);
  if (otherWs.length) el.append(h('div', { class: 'tiny muted', text: `Also in ${otherWs.length} other workspace${otherWs.length > 1 ? 's' : ''}` }));

  el.addEventListener('click', (e) => { if (e.target.closest('input, button')) return; openFeatureSheet(feature.id); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openFeatureSheet(feature.id); });

  dnd.draggable(el, () => {
    const ids = state.selection.has(feature.id) ? [...state.selection] : [feature.id];
    const placementIds = state.placements.filter((p) => ids.includes(p.feature_id)).map((p) => p.id);
    return {
      kind: 'features', ids, placementIds, from: placement ? { workspaceId: placement.workspace_id, stage: placement.stage } : null,
      label: ids.length > 1 ? `${ids.length} features` : feature.title,
    };
  }, { handle: '.grip' });

  return el;
}

export function featureRow(feature) {
  const selected = state.selection.has(feature.id);
  const row = h('div', { class: `frow${selected ? ' selected' : ''}`, dataset: { feature: feature.id, dndItem: '1' }, tabindex: '0', role: 'listitem' });
  const check = h('input', { type: 'checkbox', checked: selected, 'aria-label': `Select ${feature.title}`, onclick: (e) => e.stopPropagation(), onchange: (e) => store.toggleSelect(feature.id, e.target.checked) });
  const placed = store.isPlaced(feature.id) ? store.placementsOf(feature.id).map((p) => store.workspaceById(p.workspace_id)?.name).filter(Boolean) : [];
  row.append(
    check,
    h('span', { class: 'grip', html: iconHtml('grip', 16), title: 'Drag into a workspace' }),
    h('span', { class: 'code mono', text: feature.code || '' }),
    h('div', { class: 'col' },
      h('span', { class: 'title', text: feature.title }),
      h('span', { class: 'tiny muted', text: `${feature.section}${placed.length ? ` · in ${placed.join(', ')}` : ''}` })),
    h('div', { class: 'meta' },
      statusPill(feature.status),
      priorityPill(feature.priority),
      sourcePill(feature.source_status),
      h('button', { class: 'btn xs', html: iconHtml('plus', 14), title: 'Add to a workspace', onclick: (e) => { e.stopPropagation(); openMoveModal([feature.id]); } })),
  );
  row.addEventListener('click', (e) => { if (e.target.closest('input, button')) return; openFeatureSheet(feature.id); });
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter') openFeatureSheet(feature.id); });
  dnd.draggable(row, () => {
    const ids = state.selection.has(feature.id) ? [...state.selection] : [feature.id];
    const placementIds = state.placements.filter((p) => ids.includes(p.feature_id)).map((p) => p.id);
    return { kind: 'features', ids, placementIds, label: ids.length > 1 ? `${ids.length} features` : feature.title };
  }, { handle: '.grip' });
  return row;
}

/* ------------------------------------------------------- feature sheet ---- */

export async function openFeatureSheet(id) {
  const feature = store.featureById(id);
  if (!feature) return;
  const comments = state.comments.filter((c) => c.subject_id === id);
  const activity = state.activity.filter((a) => a.subject_id === id).slice(0, 6);

  sheet(feature.title, ({ close }) => {
    const body = h('div', { class: 'col', style: { gap: '16px' } });

    const save = async (patch) => {
      try { await store.updateFeature(id, patch); toast('Saved', { type: 'ok' }); } catch (e) { toast(e.message, { type: 'bad' }); }
    };

    body.append(h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('span', { class: 'code mono tiny bold', text: feature.code }),
      statusPill(feature.status), priorityPill(feature.priority), sourcePill(feature.source_status),
      h('span', { class: 'tiny muted', text: feature.section })));

    body.append(h('label', { class: 'field' }, h('span', { text: 'Title' }),
      h('input', { class: 'input', value: feature.title, onchange: (e) => save({ title: e.target.value }) })));
    body.append(h('label', { class: 'field' }, h('span', { text: 'Detail' }),
      h('textarea', { class: 'input', rows: 3, onchange: (e) => save({ detail: e.target.value }) }, feature.detail || '')));

    const grid = h('div', { class: 'form-grid' });
    grid.append(
      h('label', { class: 'field' }, h('span', { text: 'Status' }),
        h('select', { class: 'input', onchange: (e) => save({ status: e.target.value }) },
          Object.entries(STATUS_LABEL).map(([k, v]) => h('option', { value: k, selected: feature.status === k }, v)))),
      h('label', { class: 'field' }, h('span', { text: 'Priority' }),
        h('select', { class: 'input', onchange: (e) => save({ priority: e.target.value }) },
          ['critical', 'high', 'medium', 'low'].map((p) => h('option', { value: p, selected: feature.priority === p }, p)))),
      h('label', { class: 'field' }, h('span', { text: 'Effort' }),
        h('select', { class: 'input', onchange: (e) => save({ effort: e.target.value }) },
          ['xs', 's', 'm', 'l', 'xl'].map((p) => h('option', { value: p, selected: feature.effort === p }, p.toUpperCase())))),
      h('label', { class: 'field' }, h('span', { text: 'Tags (comma separated)' }),
        h('input', { class: 'input', value: (feature.tags || []).join(', '), onchange: (e) => save({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) }) })),
    );
    body.append(grid);

    /* placements ---------------------------------------------------------- */
    const placements = store.placementsOf(id);
    body.append(h('div', {},
      h('div', { class: 'row spread', style: { marginBottom: '8px' } },
        h('h4', { text: 'In workspaces', style: { fontSize: '.86rem' } }),
        h('button', { class: 'btn xs', html: iconHtml('plus', 14), text: 'Add to…', onclick: () => openMoveModal([id]) })),
      placements.length ? h('div', { class: 'col', style: { gap: '6px' } }, placements.map((p) => {
        const ws = store.workspaceById(p.workspace_id);
        return h('div', { class: 'row', style: { gap: '8px', padding: '8px 10px', background: '#f7f9fe', borderRadius: '10px' } },
          h('span', { text: ws?.icon || '🗂️' }),
          h('span', { class: 'small bold grow', text: ws?.name || 'workspace' }),
          h('span', { class: 'tiny muted', text: store.stageLabel(ws, p.stage) || p.stage }),
          h('button', { class: 'icon-btn tiny', html: iconHtml('x', 15), title: 'Remove from workspace', onclick: async () => { await store.removePlacements([p.id]); close(); openFeatureSheet(id); } }));
      })) : h('p', { class: 'small muted', text: 'Not in any workspace yet — drag it from the backlog onto a workspace, or use “Add to…”.' })));

    /* comments ------------------------------------------------------------ */
    const commentBox = h('div', { class: 'col', style: { gap: '8px' } });
    comments.forEach((c) => commentBox.append(h('div', { class: 'row', style: { gap: '9px', alignItems: 'flex-start' } },
      avatar({ name: c.author_name }, 'sm'),
      h('div', {},
        h('div', { class: 'tiny bold', text: c.author_name }),
        h('div', { class: 'small', text: c.body }),
        h('div', { class: 'tiny muted', text: timeAgo(c.created) })))));
    const input = h('input', { class: 'input', placeholder: 'Write a comment…' });
    const send = async () => {
      const v = input.value.trim();
      if (!v) return;
      input.value = '';
      try {
        const { comment } = await api.addComment({ subject_type: 'feature', subject_id: id, body: v });
        state.comments = [...state.comments, comment];
        store.emit('change');
        close(); openFeatureSheet(id);
      } catch (e) { toast(e.message, { type: 'bad' }); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    body.append(h('div', { class: 'col', style: { gap: '8px' } },
      h('h4', { text: `Comments (${comments.length})`, style: { fontSize: '.86rem' } }),
      commentBox.length ? commentBox : h('p', { class: 'small muted', text: 'No comments yet.' }),
      h('div', { class: 'row', style: { gap: '8px' } }, input, h('button', { class: 'btn primary', text: 'Send', onclick: send }))));

    if (activity.length) {
      body.append(h('div', { class: 'col', style: { gap: '4px' } },
        h('h4', { text: 'History', style: { fontSize: '.86rem' } }),
        activity.map((a) => h('div', { class: 'tiny muted', text: `${a.actor_name} · ${a.verb.replace('.', ' ')} · ${timeAgo(a.created)}` }))));
    }

    body.append(h('div', { class: 'row', style: { gap: '8px', borderTop: '1px solid var(--line-2)', paddingTop: '12px' } },
      h('button', {
        class: 'btn', html: iconHtml('sparkle', 15), text: 'Lift & move',
        onclick: () => { dnd.lift({ kind: 'features', ids: [id], placementIds: store.placementsOf(id).map((p) => p.id), label: feature.title }); close(); },
      }),
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'btn danger', html: iconHtml('trash', 15), text: 'Delete',
        onclick: async () => {
          if (!await confirmDialog('Delete feature?', `“${feature.title}” will be removed from the project and every workspace.`)) return;
          await store.deleteFeatures([id]);
          close();
          toast('Feature deleted', { type: 'ok' });
        },
      })));
    return body;
  });
}

/* ----------------------------------------------------- workspace modal ---- */

export function openWorkspaceModal({ workspace = null, onCreated } = {}) {
  let icon = workspace?.icon || '🚀';
  let color = workspace?.color || COLORS[0];
  const name = h('input', { class: 'input', placeholder: 'e.g. MVP features', value: workspace?.name || '' });
  const purpose = h('input', { class: 'input', placeholder: 'What is this workspace for?', value: workspace?.purpose || '' });
  const wip = h('input', { class: 'input', type: 'number', min: '0', max: '99', value: workspace?.wip_limit ?? '', placeholder: 'e.g. 6' });
  const iconRow = h('div', { class: 'chiprow', style: { flexWrap: 'wrap' } }, ICON_CHOICES.map((i) => h('button', {
    class: `chip${i === icon ? ' active' : ''}`, text: i, 'aria-label': `Icon ${i}`, 'aria-pressed': String(i === icon),
    onclick: (e) => { icon = i; [...iconRow.children].forEach((c) => c.classList.toggle('active', c === e.currentTarget)); },
  })));
  const colorRow = h('div', { class: 'chiprow' }, COLORS.map((c) => h('button', {
    class: `chip${c === color ? ' active' : ''}`, style: { background: c, borderColor: c, width: '34px', height: '34px', padding: 0 },
    'aria-label': `Colour ${c}`, onclick: (e) => { color = c; [...colorRow.children].forEach((x) => x.classList.toggle('active', x === e.currentTarget)); },
  })));

  modal(workspace ? 'Workspace settings' : 'New workspace', () => h('div', {},
    h('label', { class: 'field' }, h('span', { text: 'Name' }), name),
    h('label', { class: 'field' }, h('span', { text: 'Purpose (optional)' }), purpose),
    h('label', { class: 'field' }, h('span', { text: 'Icon' }), iconRow),
    h('label', { class: 'field' }, h('span', { text: 'Colour' }), colorRow),
    h('label', { class: 'field' }, h('span', { text: 'Work-in-progress limit (optional)' }), wip),
    h('p', { class: 'tiny muted', text: 'Tip: WIP limits warn you when a column holds more work than the team can finish.' }),
  ), {
    footer: ({ close }) => [
      workspace ? h('button', {
        class: 'btn danger', text: 'Delete workspace',
        onclick: async () => {
          if (!await confirmDialog('Delete workspace?', 'Cards stay in the backlog — only the board is removed.')) return;
          await store.deleteWorkspace(workspace.id);
          close(); toast('Workspace deleted', { type: 'ok' });
        },
      }) : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost', text: 'Cancel', onclick: close }),
      h('button', {
        class: 'btn primary', text: workspace ? 'Save workspace' : 'Create workspace',
        onclick: async (e) => {
          if (!name.value.trim()) return toast('Give the workspace a name', { type: 'bad' });
          e.currentTarget.disabled = true;
          try {
            const payload = {
              name: name.value.trim(), purpose: purpose.value.trim(), icon, color,
              wip_limit: wip.value === '' ? null : Number(wip.value),
            };
            if (workspace) {
              const { workspace: w } = await api.updateWorkspace(workspace.id, payload);
              store.state.workspaces = store.state.workspaces.map((x) => (x.id === w.id ? w : x));
            } else {
              await store.createWorkspace(payload);
            }
            store.emit('change');
            toast(workspace ? 'Workspace updated' : `Workspace “${payload.name}” created`, { type: 'ok' });
            close();
            onCreated?.();
          } catch (err) { toast(err.message, { type: 'bad' }); e.currentTarget.disabled = false; }
        },
      }),
    ].filter(Boolean),
  });
}

/* ---------------------------------------------------------- move modal ---- */

export function openMoveModal(featureIds, { after } = {}) {
  if (!featureIds.length) return;
  const wsSel = h('select', { class: 'input' }, state.workspaces.map((w) => h('option', { value: w.id }, `${w.icon} ${w.name}`)));
  const stageSel = h('select', { class: 'input' });
  const paintStages = () => {
    stageSel.innerHTML = '';
    for (const s of store.stagesOf(store.workspaceById(wsSel.value))) stageSel.append(h('option', { value: s.id }, s.label));
  };
  wsSel.value = state.activeWorkspace && state.workspaces.some((w) => w.id === state.activeWorkspace)
    ? state.activeWorkspace
    : state.workspaces[0]?.id || '';
  wsSel.addEventListener('change', paintStages);
  paintStages();

  modal(`Add ${featureIds.length} feature${featureIds.length > 1 ? 's' : ''} to a workspace`, () => h('div', {},
    h('label', { class: 'field' }, h('span', { text: 'Workspace' }), wsSel),
    h('label', { class: 'field' }, h('span', { text: 'Column / stage' }), stageSel),
    h('p', { class: 'small muted', text: 'Tip: you can also drag features straight from the backlog onto a workspace in the sidebar — or onto a board column.' }),
  ), {
    footer: ({ close }) => [
      h('button', { class: 'btn ghost', text: 'Cancel', onclick: close }),
      h('button', {
        class: 'btn primary', text: 'Add to workspace',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          await store.placeFeatures(featureIds, wsSel.value, stageSel.value);
          store.clearSelection();
          state.activeWorkspace = wsSel.value;
          close();
          after?.();
          store.emit('change');
        },
      }),
    ],
  });
}

/* ----------------------------------------------------------- plan modal ---- */

export function openPlanModal(workspaceId) {
  const sections = state.sections;
  const chosen = new Set();
  let sourceFilter = new Set(['missing']);
  let priorities = new Set();
  let limit = 20;
  const previewBox = h('div', { class: 'col', style: { gap: '6px', maxHeight: '220px', overflow: 'auto' } });
  const summary = h('p', { class: 'small muted', text: 'Pick the rules, then preview what would move in.' });

  const computeRules = () => ({
    sections: [...chosen], source_statuses: [...sourceFilter], priorities: [...priorities], limit,
  });

  const runPreview = async () => {
    previewBox.innerHTML = '';
    summary.textContent = 'Previewing…';
    try {
      const res = await api.plan({ workspace_id: workspaceId, rules: computeRules(), mode: 'preview' });
      summary.textContent = `${res.matched} features match — the top ${res.chosen.length} are suggested (highest priority first).`;
      res.chosen.forEach((c, i) => previewBox.append(h('div', { class: 'row', style: { gap: '8px' } },
        h('span', { class: 'tiny mono muted', text: `${i + 1}` }),
        h('span', { class: 'small grow', text: c.title }),
        h('span', { class: 'pill tag', text: c.code }))));
      if (!res.chosen.length) previewBox.append(h('p', { class: 'small muted', text: 'Nothing matches those rules yet.' }));
    } catch (e) { summary.textContent = e.message; }
  };

  modal('Auto-plan a workspace', ({ close }) => {
    const body = h('div', {});
    body.append(summary);
    body.append(h('label', { class: 'field' }, h('span', { text: 'From sections (leave empty for all)' }),
      h('div', { class: 'chiprow', style: { flexWrap: 'wrap' } }, sections.map((s) => h('button', {
        class: 'chip tiny',
        onclick: (e) => { if (chosen.has(s.index)) chosen.delete(s.index); else chosen.add(s.index); e.target.classList.toggle('active'); runPreview(); },
      }, `${s.index}. ${s.name} (${s.total})`)))));
    body.append(h('label', { class: 'field' }, h('span', { text: 'Source status' }),
      h('div', { class: 'chiprow' }, ['missing', 'partial', 'shipped'].map((s) => h('button', {
        class: `chip tiny${sourceFilter.has(s) ? ' active' : ''}`,
        onclick: (e) => { sourceFilter.has(s) ? sourceFilter.delete(s) : sourceFilter.add(s); e.target.classList.toggle('active'); runPreview(); },
      }, SOURCE_LABEL[s])))));
    body.append(h('label', { class: 'field' }, h('span', { text: 'Priorities (any)' }),
      h('div', { class: 'chiprow' }, ['critical', 'high', 'medium', 'low'].map((p) => h('button', {
        class: 'chip tiny',
        onclick: (e) => { priorities.has(p) ? priorities.delete(p) : priorities.add(p); e.target.classList.toggle('active'); runPreview(); },
      }, p)))));
    body.append(h('label', { class: 'field' }, h('span', { text: 'How many to add' }),
      h('input', { class: 'input', type: 'number', min: '1', max: '200', value: String(limit), onchange: (e) => { limit = Number(e.target.value) || 20; runPreview(); } })));
    body.append(h('h4', { text: 'Preview', style: { fontSize: '.86rem', marginTop: '10px' } }), previewBox);
    runPreview();
    return body;
  }, {
    footer: ({ close }) => [
      h('button', { class: 'btn ghost', text: 'Cancel', onclick: close }),
      h('button', {
        class: 'btn primary', html: iconHtml('sparkle', 16), text: 'Add these to the workspace',
        onclick: async (e) => {
          e.target.disabled = true;
          try {
            const res = await api.plan({ workspace_id: workspaceId, rules: computeRules(), mode: 'add' });
            await store.load(state.project.id);
            store.state.activeWorkspace = workspaceId;
            toast(`Added ${res.placed} features to the workspace`, { type: 'ok' });
            confetti(14);
            close();
            store.emit('change');
          } catch (err) { toast(err.message, { type: 'bad' }); e.target.disabled = false; }
        },
      }),
    ],
  });
}

/* --------------------------------------------------------- import modal ---- */

export function openImportModal() {
  let mode = 'merge';
  let text = '';
  let parsed = null;
  modal('Import features from a document', ({ close }) => {
    const body = h('div', {});
    const zone = h('div', { class: 'dropzone' },
      h('div', { style: { fontSize: '1.6rem' }, text: '📄' }),
      h('p', { class: 'bold', style: { margin: '6px 0 2px' }, text: 'Drop the feature document here' }),
      h('p', { class: 'small muted', style: { margin: 0 }, text: 'FEATURE_AUDIT.html · .md · .txt — or paste the text below' }),
    );
    const fileInput = h('input', { type: 'file', accept: '.html,.htm,.md,.txt', style: { display: 'none' } });
    const preview = h('div', { class: 'col', style: { gap: '6px' } });
    const ta = h('textarea', { class: 'input', rows: 5, placeholder: 'Paste the feature list here…', oninput: (e) => { text = e.target.value; } });

    const runParse = async () => {
      parsed = null;
      preview.innerHTML = '';
      if (!text.trim()) return;
      try {
        const res = await api.plan({ workspace_id: state.workspaces[0]?.id, rules: {}, mode: 'preview' }).catch(() => null);
        void res;
        // parse preview happens server-side on import; show a lightweight client hint
        const sections = (text.match(/^##\s*\d+\./gm) || []).length;
        preview.append(h('p', { class: 'small muted', text: sections ? `Found ${sections} numbered sections in the document.` : 'Ready to import — the server will parse headings, ✓/◐/✗ markers and · lists.' }));
      } catch { /* ignore */ }
    };

    const readFile = (file) => {
      const reader = new FileReader();
      reader.onload = () => { text = String(reader.result || ''); ta.value = text.slice(0, 4000); runParse(); };
      reader.readAsText(file);
    };

    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); const f = e.dataTransfer.files?.[0]; if (f) readFile(f); });
    fileInput.addEventListener('change', () => fileInput.files?.[0] && readFile(fileInput.files[0]));

    body.append(zone, fileInput,
      h('div', { class: 'row', style: { gap: '8px', margin: '14px 0 8px' } },
        h('button', { class: 'btn sm', html: iconHtml('refresh', 15), text: 'Load docs/FEATURE_AUDIT.md', onclick: async () => { text = ''; const res = await api.importDoc({ source: 'audit', mode: 'merge' }); toast(`Imported ${res.added} features (${res.skipped} already there)`, { type: 'ok' }); await store.load(state.project.id); close(); store.emit('change'); } }),
        h('span', { class: 'spacer' }),
        h('span', { class: 'chip', text: mode === 'merge' ? 'Merge (keep what exists)' : 'Replace all' , onclick: (e) => { mode = mode === 'merge' ? 'replace' : 'merge'; e.target.textContent = mode === 'merge' ? 'Merge (keep what exists)' : 'Replace all'; } })),
      h('label', { class: 'field' }, h('span', { text: 'Or paste text' }), ta),
      preview);
    return body;
  }, {
    footer: ({ close }) => [
      h('button', { class: 'btn ghost', text: 'Cancel', onclick: close }),
      h('button', {
        class: 'btn primary', html: iconHtml('upload', 16), text: 'Import',
        onclick: async (e) => {
          if (!text.trim()) return toast('Drop a file or paste text first', { type: 'bad' });
          e.target.disabled = true;
          try {
            const res = await api.importDoc({ source: 'text', text, mode });
            toast(`Imported ${res.added} features${res.skipped ? ` · ${res.skipped} duplicates skipped` : ''}`, { type: 'ok' });
            await store.load(state.project.id);
            close();
            store.emit('change');
          } catch (err) { toast(err.message, { type: 'bad' }); e.target.disabled = false; }
        },
      }),
    ],
  });
}

/* ------------------------------------------------------------- palette ---- */

export function openPalette() {
  const input = h('input', { placeholder: 'Search features, jump to a workspace, run a command…', 'aria-label': 'Command palette' });
  const list = h('div', { class: 'palette-list' });
  const box = h('div', { class: 'palette', role: 'dialog', 'aria-label': 'Command palette' }, input, list);
  const scrim = h('div', { class: 'scrim show' });
  let items = [];
  let active = 0;

  const actions = [
    { kind: 'action', label: 'New workspace', run: () => openWorkspaceModal({}) },
    { kind: 'action', label: 'Import features from a document', run: () => openImportModal() },
    { kind: 'action', label: 'Auto-plan a workspace', run: () => openPlanModal(state.activeWorkspace || state.workspaces[0]?.id) },
    { kind: 'action', label: 'Open backlog', run: () => { location.hash = '#/backlog'; } },
    { kind: 'action', label: 'Open board', run: () => { location.hash = '#/board'; } },
    { kind: 'action', label: 'Export features as CSV', run: () => window.open(api.exportUrl('csv'), '_blank') },
    { kind: 'action', label: 'Keyboard shortcuts', run: () => openHelp() },
  ];

  const render = () => {
    list.innerHTML = '';
    items.forEach((it, i) => list.append(h('button', {
      class: `p-item${i === active ? ' active' : ''}`,
      onclick: () => { close(); it.run(); },
      onmouseenter: () => { active = i; render(); },
    },
    it.kind === 'feature' ? h('span', { class: 'code mono', text: it.code || '' }) : icon(it.kind === 'workspace' ? 'board' : 'sparkle', 17),
    h('span', { class: 'grow', text: it.label, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }),
    h('span', { class: 'kind', text: it.kind }))));
  };

  const search = async () => {
    const q = input.value.trim();
    items = [];
    if (!q) items = actions.slice(0, 6).map((a) => ({ ...a, kind: 'action' }));
    else {
      items = actions.filter((a) => a.label.toLowerCase().includes(q.toLowerCase())).map((a) => ({ ...a, kind: 'action' }));
      try {
        const res = await api.search(q);
        items = items.concat(res.features.map((f) => ({ kind: 'feature', label: f.title, code: f.code, run: () => { location.hash = '#/backlog'; openFeatureSheet(f.id); } })));
        items = items.concat(res.workspaces.map((w) => ({ kind: 'workspace', label: `Open ${w.name}`, run: () => { state.activeWorkspace = w.id; location.hash = `#/board/${w.id}`; } })));
      } catch { /* offline */ }
    }
    active = 0;
    render();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); render(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
    if (e.key === 'Enter' && items[active]) { e.preventDefault(); const it = items[active]; close(); it.run(); }
  };
  const close = () => { input.removeEventListener('keydown', onKey); box.remove(); scrim.remove(); };
  input.addEventListener('input', search);
  input.addEventListener('keydown', onKey);
  scrim.addEventListener('click', close);
  document.getElementById('layer').append(scrim, box);
  setTimeout(() => input.focus(), 30);
  search();
}

/* ---------------------------------------------------------------- help ---- */

export function openHelp() {
  const rows = [
    ['⌘K / Ctrl+K', 'Search everything'],
    ['N', 'New workspace'],
    ['B', 'Backlog'],
    ['M', 'Board'],
    ['Space (on a card)', 'Lift the card'],
    ['← → ↑ ↓', 'Move a lifted card between columns / positions'],
    ['Enter', 'Drop the lifted card'],
    ['Esc', 'Cancel a drag or close a dialog'],
    ['Click + shift-click', 'Select several features, then drag them together'],
    ['⌘Z / Ctrl+Z', 'Undo the last change'],
  ];
  modal('Keyboard & gestures', () => h('div', {},
    h('p', { class: 'small muted', text: 'Everything works with mouse, touch and keyboard. On touch, hold a card (or grab the ⠿ handle) to drag it.' }),
    h('table', { class: 'table' }, rows.map(([k, v]) => h('tr', {}, h('td', { class: 'mono bold', style: { whiteSpace: 'nowrap' }, text: k }), h('td', { text: v }))))));
}

/* ------------------------------------------------------------- account ---- */

export function openAccountSheet({ onSignOut } = {}) {
  sheet('Account', () => h('div', { class: 'col', style: { gap: '14px' } },
    h('div', { class: 'row', style: { gap: '12px' } },
      avatar(state.me, 'lg'),
      h('div', {}, h('div', { class: 'bold', text: state.me?.name || 'Guest' }), h('div', { class: 'small muted', text: state.me?.email || '' }))),
    h('div', { class: 'card pad' },
      h('div', { class: 'row', style: { gap: '8px' } }, icon('database', 18), h('div', {},
        h('div', { class: 'bold small', text: 'Database' }),
        h('div', { class: 'tiny muted', text: state.database?.label || 'unknown' })),
        h('span', { class: 'spacer' }),
        h('span', { class: `pill ${state.database?.mode === 'memory' ? 'missing' : 'shipped'}`, text: state.database?.mode || '?' }))),
    h('div', { class: 'col', style: { gap: '8px' } },
      h('a', { class: 'btn ghost', href: api.exportUrl('json'), target: '_blank' }, icon('download', 16), 'Export project (JSON)'),
      h('a', { class: 'btn ghost', href: api.exportUrl('csv'), target: '_blank' }, icon('download', 16), 'Export features (CSV)'),
      h('a', { class: 'btn ghost', href: '/', target: '_blank' }, icon('external', 16), 'Open NearBuyGoods app')),
    h('button', { class: 'btn danger', text: 'Sign out', onclick: () => { onSignOut?.(); } })));
}

/* -------------------------------------------------------------- invite ---- */

export function openInviteModal() {
  const email = h('input', { class: 'input', placeholder: 'teammate@email.com' });
  const role = h('select', { class: 'input' },
    h('option', { value: 'editor' }, 'Editor — can plan and move cards'),
    h('option', { value: 'viewer' }, 'Viewer — read only'));
  modal('Invite a teammate', () => h('div', {},
    h('label', { class: 'field' }, h('span', { text: 'Email (optional — the link is what matters)' }), email),
    h('label', { class: 'field' }, h('span', { text: 'Role' }), role),
    h('p', { class: 'small muted', text: 'The invite link lets one person join this project. It expires in 14 days.' }),
  ), {
    footer: ({ close }) => [
      h('button', { class: 'btn ghost', text: 'Close', onclick: close }),
      h('button', {
        class: 'btn primary', text: 'Create invite link',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            const { invite } = await api.invite({ email: email.value, role: role.value });
            const url = `${location.origin}/tracker#/join/${invite.token}`;
            let copied = false;
            try { await navigator.clipboard.writeText(url); copied = true; } catch { copied = false; }
            if (copied) toast('Invite link copied to clipboard', { type: 'ok' });
            else toast(`Invite link: ${url}`, { ms: 12000 });
            close();
          } catch (err) { toast(err.message, { type: 'bad' }); e.currentTarget.disabled = false; }
        },
      }),
    ],
  });
}

export { sparkline, avatar, initials };
