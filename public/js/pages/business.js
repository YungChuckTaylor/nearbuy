// Store owner dashboard: KPIs, inventory CRUD, deals, reservation queue.
import { h, toast, sheet, emptyState, skeletonRows, timeAgo } from '../ui.js';
import { ic } from '../ui.js';
import { api, getToken } from '../api.js';
import { state, money, refreshUnread } from '../store.js';
import { sparkline } from '../charts.js';

export function renderBusiness(nav) {
  const root = h('div', { style: { maxWidth: '720px', margin: '0 auto' } });
  if (!getToken() || !['store_owner', 'admin'].includes(state.user?.role)) {
    root.append(emptyState('🏪', 'For store owners', 'List inventory, post deals and manage reservations. Log in with the owner demo account to explore.', h('button', { class: 'btn primary', onclick: () => nav('#/auth') }, 'Log in as owner')));
    return root;
  }
  root.append(h('h1', { class: 'h1', text: 'Business dashboard' }));
  const storeChips = h('div', { class: 'chiprow' });
  const kpis = h('div', { class: 'kpi-grid' });
  const sparks = h('div', { class: 'card' });
  const invBox = h('div');
  const dealsBox = h('div');
  const resBox = h('div');
  root.append(storeChips, kpis, h('div', { class: 'section-gap' }), sparks,
    h('div', { class: 'h2' }, 'Inventory', h('button', { class: 'link', onclick: () => addItem() }, '+ Add item')), invBox,
    h('div', { class: 'h2' }, 'Deals & promotions', h('button', { class: 'link', onclick: () => addDeal() }, '+ New deal')), dealsBox,
    h('div', { class: 'h2' }, 'Reservation queue'), resBox);

  let myStores = [];
  let activeStore = null;

  (async () => {
    const { stores } = await api.get('/business/stores');
    myStores = stores;
    if (!stores.length) { root.append(emptyState('🏪', 'No stores yet', 'Register your first store to start listing inventory.')); return; }
    activeStore = stores[0].id;
    storeChips.append(...stores.map((s) => h('button', {
      class: `chip ${s.id === activeStore ? 'active' : ''}`, onclick: (e) => { activeStore = s.id; [...storeChips.children].forEach((c) => c.classList.remove('active')); e.currentTarget.classList.add('active'); loadAll(); },
    }, `${s.emoji} ${s.name}`)));
    loadAll();
  })();

  async function loadAll() {
    kpis.innerHTML = ''; sparks.innerHTML = ''; invBox.innerHTML = ''; dealsBox.innerHTML = ''; resBox.innerHTML = '';
    kpis.append(skeletonRows(2)); invBox.append(skeletonRows(3));
    const a = await api.get(`/business/analytics?store_id=${activeStore}`);
    kpis.innerHTML = '';
    const kpi = (label, val) => h('div', { class: 'kpi' }, h('div', { class: 'v', text: val }), h('div', { class: 'l', text: label }));
    kpis.append(kpi('Listing views', a.kpis.views.toLocaleString()), kpi('Search matches', a.kpis.matches.toLocaleString()), kpi('Clicks', a.kpis.clicks.toLocaleString()), kpi('Reservations', a.kpis.reservations), kpi('Attributed revenue', money(a.kpis.revenue)), kpi('Conversion', `${a.kpis.views ? Math.round((a.kpis.clicks / a.kpis.views) * 100) : 0}%`));
    sparks.append(h('div', { class: 'bold small', style: { marginBottom: '10px' }, text: 'Last 7 days' }),
      h('div', { class: 'row', style: { gap: '18px', flexWrap: 'wrap' } },
        sparkBlock('Views', a.spark.views, '#232c5c'), sparkBlock('Matches', a.spark.matches, '#2fbcc7'), sparkBlock('Clicks', a.spark.clicks, '#e87b29')));

    const { inventory } = await api.get(`/business/inventory?store_id=${activeStore}`);
    invBox.innerHTML = '';
    if (!inventory.length) invBox.append(emptyState('📦', 'No listings', 'Add your first product to appear in nearby searches.'));
    inventory.forEach((o) => invBox.append(invRow(o)));

    const { deals } = await api.get(`/deals?lat=${state.loc.lat}&lng=${state.loc.lng}&radius_km=1000`);
    const mine = deals.filter((d) => d.store_id === activeStore);
    dealsBox.innerHTML = '';
    if (!mine.length) dealsBox.append(h('p', { class: 'muted small', text: 'No active deals. Post one to notify shoppers in radius.' }));
    mine.forEach((d) => dealsBox.append(h('div', { class: 'card', style: { padding: '12px 14px' } },
      h('div', { class: 'row spread' }, h('span', { class: 'bold small', text: `${d.title}` }), h('span', { class: 'badge orange', text: `-${d.pct}%` })),
      h('span', { class: 'tiny muted', text: `Ends ${new Date(d.ends_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })} · shoppers in radius notified` }))));

    const { reservations } = await api.get('/reservations');
    const mineRes = reservations.filter((r) => r.store_id === activeStore);
    resBox.innerHTML = '';
    if (!mineRes.length) resBox.append(h('p', { class: 'muted small', text: 'No reservation requests right now.' }));
    mineRes.forEach((r) => resBox.append(h('div', { class: 'card', style: { padding: '12px 14px' } },
      h('div', { class: 'row spread' },
        h('span', { class: 'bold small', text: `${r.emoji || '📦'} ${r.product} × ${r.qty}` }),
        h('span', { class: `badge ${r.status === 'ready' ? 'ok' : r.status === 'cancelled' ? 'bad' : r.status === 'paid' ? 'teal' : 'warn'}`, text: r.paid ? `${r.status} · prepaid` : r.status })),
      h('div', { class: 'tiny muted', style: { margin: '4px 0 8px' }, text: `${r.customer} · ${r.code} · ${timeAgo(r.created)}` }),
      h('div', { class: 'row', style: { gap: '8px' } },
        r.status === 'pending' ? h('button', { class: 'btn sm primary', onclick: () => setStatus(r.id, 'ready') }, 'Mark ready') : null,
        r.status === 'ready' ? h('button', { class: 'btn sm ghost', onclick: () => setStatus(r.id, 'completed') }, 'Complete pickup') : null,
        ['pending', 'ready'].includes(r.status) ? h('button', { class: 'btn sm danger', onclick: () => setStatus(r.id, 'cancelled') }, 'Cancel') : null))));
  }

  const sparkBlock = (label, values, color) => {
    const box = h('div', { class: 'col' }, h('span', { class: 'tiny bold muted', text: `${label} · ${values[values.length - 1]} today` }));
    const s = h('div'); box.append(s); sparkline(s, values, { color });
    return box;
  };

  async function setStatus(id, status) {
    await api.post(`/reservations/${id}/status`, { status });
    await refreshUnread();
    toast(`Reservation ${status}`, 'ok');
    loadAll();
  }

  function invRow(o) {
    const price = h('input', { class: 'input', style: { minWidth: '0', width: '110px', minHeight: '40px' }, type: 'number', value: o.price, 'aria-label': 'Price' });
    const stock = h('input', { class: 'input', style: { minWidth: '0', width: '74px', minHeight: '40px' }, type: 'number', value: o.stock, 'aria-label': 'Stock' });
    const save = h('button', {
      class: 'btn sm ghost', onclick: async () => {
        await api.put(`/business/inventory/${o.id}`, { price: Number(price.value), stock: Number(stock.value) });
        toast('Listing updated — watchers notified if price dropped or stock returned', 'ok');
        loadAll();
      },
    }, 'Save');
    return h('div', { class: 'offer', style: { flexWrap: 'wrap' } },
      h('span', { class: 'emoji-tile sm', text: o.product.emoji || '📦' }),
      h('span', { class: 'col grow' },
        h('span', { class: 'bold small', text: o.product.name }),
        h('span', { class: 'tiny muted', text: `${o.views} views · ${o.clicks} clicks · updated ${timeAgo(o.updated_at)}` })),
      h('span', { class: 'row', style: { gap: '6px' } },
        h('span', { class: 'col', style: { gap: '2px' } }, h('span', { class: 'tiny muted', text: 'Price ₦' }), price),
        h('span', { class: 'col', style: { gap: '2px' } }, h('span', { class: 'tiny muted', text: 'Stock' }), stock),
        save));
  }

  function addItem() {
    sheet('Add inventory', ({ close }) => {
      const name = h('input', { class: 'input', placeholder: 'Product name (e.g. Wireless Earbuds Pro)' });
      const brand = h('input', { class: 'input', placeholder: 'Brand' });
      const cat = h('select', { class: 'input' }, (state.meta?.categories || []).map((c) => h('option', { value: c.id, text: c.name })));
      const price = h('input', { class: 'input', type: 'number', placeholder: 'Price (NGN)' });
      const stock = h('input', { class: 'input', type: 'number', placeholder: 'Stock quantity', value: '10' });
      const tags = h('input', { class: 'input', placeholder: 'Tags, comma separated (earbuds, bluetooth)' });
      return h('div', {},
        h('label', { class: 'field' }, h('span', { text: 'Name' }), name),
        h('label', { class: 'field' }, h('span', { text: 'Brand' }), brand),
        h('label', { class: 'field' }, h('span', { text: 'Category' }), cat),
        h('div', { class: 'row', style: { gap: '10px' } },
          h('label', { class: 'field grow' }, h('span', { text: 'Price' }), price),
          h('label', { class: 'field grow' }, h('span', { text: 'Stock' }), stock)),
        h('label', { class: 'field' }, h('span', { text: 'Tags' }), tags),
        h('button', {
          class: 'btn primary block', onclick: async () => {
            if (!name.value || !price.value) return toast('Name and price are required', 'bad');
            await api.post('/business/inventory', { store_id: activeStore, name: name.value, brand: brand.value, category: cat.value, price: Number(price.value), stock: Number(stock.value), tags: tags.value });
            close(); toast('Listing live — searchable nearby now', 'ok'); loadAll();
          },
        }, 'Publish listing'));
    });
  }

  function addDeal() {
    sheet('Post a deal', ({ close }) => {
      const title = h('input', { class: 'input', placeholder: 'Deal title (Weekend flash sale…)' });
      const pct = h('input', { class: 'input', type: 'number', value: '10', placeholder: 'Discount %' });
      const days = h('input', { class: 'input', type: 'number', value: '3', placeholder: 'Days active' });
      return h('div', {},
        h('label', { class: 'field' }, h('span', { text: 'Title' }), title),
        h('div', { class: 'row', style: { gap: '10px' } },
          h('label', { class: 'field grow' }, h('span', { text: 'Discount %' }), pct),
          h('label', { class: 'field grow' }, h('span', { text: 'Days' }), days)),
        h('p', { class: 'tiny muted', text: 'Shoppers inside their saved radius get a push/in-app alert instantly.' }),
        h('button', {
          class: 'btn primary block', onclick: async () => {
            await api.post('/business/deals', { store_id: activeStore, title: title.value || 'Special offer', pct: Number(pct.value) || 5, days: Number(days.value) || 3 });
            close(); toast('Deal published & shoppers notified', 'ok'); loadAll();
          },
        }, 'Publish deal'));
    });
  }
  return root;
}
