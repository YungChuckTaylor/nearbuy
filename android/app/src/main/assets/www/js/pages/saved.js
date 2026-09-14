// Saved items & watchlist, collections, my reservations (with prepaid badges).
import { h, toast, emptyState, skeletonRows, sheet, timeAgo } from '../ui.js';
import { ic } from '../ui.js';
import { api, getToken } from '../api.js';
import { money } from '../store.js';
import { verifyPendingPay } from './premium.js';

export function renderSaved(nav, params) {
  const root = h('div', { style: { maxWidth: '640px', margin: '0 auto' } });
  if (!getToken()) {
    root.append(emptyState('🔖', 'Save items to watch prices', 'Log in to sync your watchlist across web and mobile.', h('button', { class: 'btn primary', onclick: () => nav('#/auth') }, 'Log in')));
    return root;
  }
  root.append(h('h1', { class: 'h1', text: 'Saved & watching' }));
  const colChips = h('div', { class: 'chiprow' });
  const savedBox = h('div');
  const resBox = h('div');
  root.append(colChips, h('div', { class: 'section-gap' }), h('div', { class: 'h2', text: 'Watchlist' }), savedBox, h('div', { class: 'h2', text: 'My reservations' }), resBox);

  let activeCol = null; // null = All
  let items = [];
  let collections = [];

  const paintChips = () => {
    colChips.innerHTML = '';
    colChips.append(h('button', { class: `chip ${activeCol === null ? 'active' : ''}`, onclick: () => { activeCol = null; paintChips(); paintItems(); } }, `All (${items.length})`));
    collections.forEach((c) => colChips.append(h('button', {
      class: `chip ${activeCol === c.id ? 'active' : ''}`, onclick: () => { activeCol = c.id; paintChips(); paintItems(); },
    }, `📁 ${c.name} (${items.filter((i) => i.saved.collection_id === c.id).length})`,
    h('button', { 'aria-label': 'Delete collection', style: { display: 'inline-flex', color: 'inherit', opacity: '.7' }, onclick: async (e) => { e.stopPropagation(); await api.del(`/collections/${c.id}`); toast('Collection deleted — items moved to All'); load(); } }, ic('x', 12)))));
    colChips.append(h('button', { class: 'chip', onclick: newCollection }, ic('plus', 14), 'New'));
  };
  const paintItems = () => {
    savedBox.innerHTML = '';
    const shown = items.filter((i) => (activeCol === null ? true : i.saved.collection_id === activeCol));
    if (!shown.length) savedBox.append(emptyState('👀', activeCol ? 'Collection is empty' : 'Nothing saved yet', 'Tap the bookmark on any product to watch its price and stock.'));
    shown.forEach((it) => {
      if (!it.product) return;
      const delta = it.price_delta;
      savedBox.append(h('div', { class: 'offer' },
        h('button', { class: 'emoji-tile sm', onclick: () => nav(`#/product/${it.product.id}`) }, it.product.emoji || '📦'),
        h('button', { class: 'col grow', style: { textAlign: 'left' }, onclick: () => nav(`#/product/${it.product.id}`) },
          h('span', { class: 'bold small', text: it.product.name }),
          h('span', { class: 'tiny muted', text: it.best_offer ? `${it.best_offer.store.name} · ${money(it.best_offer.price)}` : 'No offers in radius' }),
          h('span', { class: 'badges', style: { marginTop: '4px' } },
            delta == null ? null : delta < 0 ? h('span', { class: 'badge ok', text: `▼ ${money(-delta)} since save` }) : delta > 0 ? h('span', { class: 'badge warn', text: `▲ ${money(delta)} since save` }) : h('span', { class: 'badge navy', text: 'price unchanged' }),
            it.saved.collection_id ? h('span', { class: 'badge teal', text: `📁 ${collections.find((c) => c.id === it.saved.collection_id)?.name || ''}` }) : null)),
        h('span', { class: 'col', style: { alignItems: 'flex-end', gap: '8px' } },
          h('button', {
            class: `switch ${it.saved.watch ? 'on' : ''}`, role: 'switch', 'aria-label': 'Watch price', onclick: async (e) => {
              e.stopPropagation();
              await api.post('/saved', { product_id: it.product.id, watch: !it.saved.watch });
              e.currentTarget.classList.toggle('on');
              toast(it.saved.watch ? 'Watching stopped' : 'Watching price & stock', 'ok');
            },
          }),
          h('span', { class: 'row', style: { gap: '2px' } },
            h('button', { class: 'iconbtn', style: { width: '34px', height: '34px', color: 'var(--navy)' }, 'aria-label': 'Move to collection', onclick: (e) => { e.stopPropagation(); moveSheet(it); } }, ic('box', 16)),
            h('button', { class: 'iconbtn', style: { width: '34px', height: '34px', color: 'var(--bad)' }, 'aria-label': 'Remove', onclick: async () => { await api.del(`/saved/${it.product.id}`); toast('Removed'); load(); } }, ic('trash', 16))))));
    });
  };

  function newCollection() {
    sheet('New collection', ({ close }) => {
      const name = h('input', { class: 'input', placeholder: 'e.g. Holiday gifts, Kitchen renovation' });
      return h('div', {}, name, h('button', {
        class: 'btn primary block', style: { marginTop: '10px' }, onclick: async () => {
          if (!name.value.trim()) return toast('Give the collection a name', 'bad');
          await api.post('/collections', { name: name.value.trim() });
          close(); toast('Collection created', 'ok'); load();
        },
      }, 'Create'));
    });
  }
  function moveSheet(it) {
    sheet('Move to collection', ({ close }) => {
      const opt = (id, label) => h('button', {
        class: 'listrow', onclick: async () => { await api.post('/saved', { product_id: it.product.id, watch: it.saved.watch, collection_id: id }); close(); toast('Moved', 'ok'); load(); },
      }, h('span', { class: 'ic' }, ic(id ? 'box' : 'grid', 18)), h('span', { class: 'grow bold small', text: label }), it.saved.collection_id === id ? ic('check', 18) : null);
      return h('div', {}, opt(null, 'All items (no collection)'), ...collections.map((c) => opt(c.id, c.name)),
        h('button', { class: 'btn ghost block', style: { marginTop: '8px' }, onclick: () => { close(); newCollection(); } }, '+ New collection'));
    });
  }

  async function load() {
    savedBox.innerHTML = ''; resBox.innerHTML = ''; colChips.innerHTML = '';
    savedBox.append(skeletonRows(2));
    await verifyPendingPay(params);
    const res = await api.get('/saved', { cache: true });
    items = res.items; collections = res.collections || [];
    paintChips(); paintItems();

    resBox.append(skeletonRows(1));
    const { reservations } = await api.get('/reservations', { cache: true });
    resBox.innerHTML = '';
    if (!reservations.length) resBox.append(h('p', { class: 'muted small', text: 'No reservations yet. Reserve from any product page for pickup in store.' }));
    reservations.forEach((r) => resBox.append(h('div', { class: 'card', style: { padding: '12px 14px' } },
      h('div', { class: 'row spread' },
        h('span', { class: 'bold', text: `${r.emoji || '📦'} ${r.product} × ${r.qty}` }),
        h('span', { class: 'row', style: { gap: '6px' } },
          r.paid ? h('span', { class: 'badge teal', text: 'Prepaid ✓' }) : null,
          h('span', { class: `badge ${r.status === 'ready' ? 'ok' : r.status === 'cancelled' ? 'bad' : r.status === 'completed' ? 'navy' : 'warn'}`, text: r.status }))),
      h('div', { class: 'row spread', style: { marginTop: '6px' } },
        h('span', { class: 'tiny muted', text: `${r.store} · ${timeAgo(r.created)}` }),
        h('span', { class: 'tiny bold', style: { fontFamily: 'monospace' }, text: r.code })))));
  }
  load().catch((e) => { savedBox.innerHTML = ''; savedBox.append(emptyState('📡', 'Unavailable', e.message)); });
  return root;
}
