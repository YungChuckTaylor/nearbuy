// Store profile: live open/closed, inventory, deals, reviews, contact & directions.
import { h, toast, stars, stockBadge, openBadge, timeAgo, share, emptyState } from '../ui.js';
import { ic } from '../ui.js';
import { api } from '../api.js';
import { state, money } from '../store.js';
import { reviewSheet } from './product.js';

export function renderStore(id, nav) {
  const root = h('div', { style: { maxWidth: '640px', margin: '0 auto' } });
  root.append(h('div', { class: 'skeleton', style: { height: '150px', marginBottom: '10px' } }));

  (async () => {
    const [{ store, deals }, { inventory }, { reviews }] = await Promise.all([
      api.get(`/stores/${id}?lat=${state.loc.lat}&lng=${state.loc.lng}`, { cache: true }),
      api.get(`/stores/${id}/inventory`, { cache: true }),
      api.get(`/stores/${id}/reviews`, { cache: true }),
    ]);
    api.post('/events', { type: 'store_view', store_id: id }).catch(() => { });
    root.innerHTML = '';

    const cover = h('div', {
      class: 'card', style: { padding: '0', overflow: 'hidden' },
    },
      h('div', { style: { background: 'linear-gradient(135deg,#232c5c,#2e3a75)', color: '#fff', padding: '20px 16px', display: 'flex', gap: '14px', alignItems: 'center' } },
        h('span', { style: { fontSize: '2.4rem' }, text: store.emoji }),
        h('span', { class: 'col grow' },
          h('span', { class: 'bold', style: { fontSize: '1.2rem', letterSpacing: '-.01em' }, text: `${store.name} ${store.verified ? '✓' : ''}` }),
          h('span', { class: 'small', style: { opacity: '.85' }, text: `${store.address}, ${store.area}` }),
          h('span', { class: 'row', style: { gap: '8px', marginTop: '8px' } },
            openBadge(store.open_now, store.hours_label),
            h('span', { class: 'badge teal', text: `${store.distance_km} km` }),
            reviews.length ? h('span', { class: 'badge orange', text: `${ratingAvg(reviews)}★ (${reviews.length})` }) : null))),
      h('div', { class: 'row', style: { padding: '10px 12px', gap: '8px' } },
        h('a', { class: 'btn ghost sm grow', href: `tel:${store.phone.replace(/\s/g, '')}`, style: { textDecoration: 'none' } }, '📞 Call'),
        h('a', { class: 'btn ghost sm grow', href: mapsUrl(store), target: '_blank', rel: 'noopener', style: { textDecoration: 'none' } }, '🧭 Directions'),
        h('button', { class: 'btn ghost sm grow', onclick: () => share({ title: store.name, text: `${store.name} on NearBuyGoods — ${store.address}`, url: location.href }) }, '🔗 Share'),
        store.delivery ? h('span', { class: 'badge ok', text: 'Delivery' }) : null,
        store.pickup ? h('span', { class: 'badge navy', text: 'Pickup' }) : null));

    const dealsBox = deals.length ? h('div', {}, deals.map((d) => h('button', { class: 'dealcard', style: { width: '100%', textAlign: 'left', marginBottom: '8px' } },
      h('div', { class: 'pct', text: `-${d.pct}%` }), h('h4', { text: d.title }),
      h('p', { text: `Ends ${new Date(d.ends_at).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })}` })))) : null;

    const invBox = h('div', {}, inventory.length ? inventory.map((o) => h('button', { class: 'offer', onclick: () => nav(`#/product/${o.product.id}`) },
      h('span', { class: 'emoji-tile sm', text: o.product.emoji || '📦' }),
      h('span', { class: 'col grow' },
        h('span', { class: 'bold small', text: o.product.name }),
        h('span', { class: 'tiny muted', text: `${o.product.brand} · updated ${timeAgo(o.updated_at)}` }),
        h('span', { class: 'badges', style: { marginTop: '4px' } }, stockBadge(o.stock_label))),
      h('span', { class: 'price', text: money(o.price) }))) : emptyState('📦', 'No listings yet', 'This store has not published inventory.'));

    const reviewsBox = h('div', {},
      reviews.length ? reviews.map((r) => h('div', { class: 'card', style: { padding: '12px 14px' } },
        h('div', { class: 'row spread' }, h('span', { class: 'bold small', text: r.user_name }), stars(r.rating)),
        h('p', { class: 'small', style: { margin: '6px 0 4px' }, text: r.text }),
        r.responses?.map((resp) => h('div', { class: 'small', style: { background: 'var(--navy-soft)', borderRadius: '10px', padding: '8px 10px', marginTop: '6px' } }, h('b', { text: `${resp.name}: ` }), resp.text)) || null,
        h('div', { class: 'row spread', style: { marginTop: '6px' } },
          h('span', { class: 'tiny muted', text: timeAgo(r.created) }),
          h('button', { class: 'tiny bold', style: { color: 'var(--navy-2)' }, onclick: async (e) => { const { helpful } = await api.post(`/reviews/${r.id}/helpful`, {}); e.currentTarget.textContent = `👍 Helpful (${helpful})`; } }, `👍 Helpful (${r.helpful})`))))
        : h('p', { class: 'muted small', text: 'No reviews yet.' }),
      h('button', { class: 'btn ghost block', style: { marginTop: '10px' }, onclick: () => reviewSheet(null, id, () => nav(location.hash)) }, 'Rate this store'));

    const about = h('div', { class: 'card' },
      h('p', { class: 'small', text: store.desc }),
      h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', marginTop: '8px' } }, (store.tags || []).map((t) => h('span', { class: 'badge navy', text: t }))),
      h('div', { class: 'listrow' }, h('span', { class: 'ic' }, ic('clock', 18)), h('span', { class: 'col grow small', html: hoursHtml(store.hours) })),
      h('div', { class: 'listrow' }, h('span', { class: 'ic teal' }, ic('wallet', 18)), h('span', { class: 'col grow small bold', text: `Payments: ${(store.payments || []).join(', ')}` })),
      h('div', { class: 'listrow' }, h('span', { class: 'ic orange' }, ic('shield', 18)), h('span', { class: 'col grow small bold', text: store.wheelchair ? 'Wheelchair accessible' : 'Accessibility info not provided' })));

    const tabs = h('div', { class: 'seg', style: { width: '100%', margin: '14px 0 12px' } });
    const pane = h('div');
    const panes = { Products: invBox, Reviews: reviewsBox, About: about };
    Object.keys(panes).forEach((k, i) => {
      const b = h('button', { class: i === 0 ? 'active' : '', onclick: () => { [...tabs.children].forEach((c) => c.classList.remove('active')); b.classList.add('active'); pane.innerHTML = ''; pane.append(panes[k]); } }, `${k}${k === 'Products' ? ` (${inventory.length})` : ''}`);
      tabs.append(b);
    });
    pane.append(panes.Products);

    root.append(cover, dealsBox ? h('div', { class: 'h2' }, 'Active deals') : null, dealsBox, tabs, pane);
  })().catch((e) => { root.innerHTML = ''; root.append(emptyState('🏪', 'Store unavailable', e.message)); });
  return root;
}

const ratingAvg = (rs) => (Math.round((rs.reduce((a, r) => a + r.rating, 0) / rs.length) * 10) / 10);
const mapsUrl = (s) => `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`;
function hoursHtml(hours) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date().getDay();
  return days.map((d, i) => `<div style="display:flex;justify-content:space-between;${i === today ? 'font-weight:800;color:var(--navy)' : ''}"><span>${d}${i === today ? ' · today' : ''}</span><span>${hours[i] ? `${hours[i][0]}–${hours[i][1]}` : 'Closed'}</span></div>`).join('');
}
