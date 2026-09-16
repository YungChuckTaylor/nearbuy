// Home: search entry, camera CTA, categories, nearby deals, trending, popular offers.
import { h, toast, skeletonRows } from '../ui.js';
import { ic } from '../ui.js';
import { api } from '../api.js';
import { state, money, on } from '../store.js';

export function renderHome(nav) {
  const root = h('div');
  const greet = h('div', {});
  const searchbar = h('div', { class: 'searchbar', role: 'search' },
    ic('search', 20),
    h('input', { placeholder: 'Search items, brands, stores…', 'aria-label': 'Search', onkeydown: (e) => { if (e.key === 'Enter') nav(`#/search?q=${encodeURIComponent(e.target.value)}`); } }),
    h('button', { class: 'sbtn', 'aria-label': 'Voice search', onclick: () => nav('#/upload?mode=voice') }, ic('mic', 20)),
    h('button', { class: 'sbtn cam', 'aria-label': 'Search by camera', onclick: () => nav('#/upload?mode=camera') }, ic('camera', 20)));

  const cta = h('button', {
    class: 'card', style: { width: '100%', textAlign: 'left', display: 'flex', gap: '14px', alignItems: 'center', background: 'linear-gradient(135deg,#232c5c,#2e3a75)', color: '#fff', border: '0', marginTop: '12px' },
    onclick: () => nav('#/upload'),
  },
    h('span', { style: { display: 'inline-flex', width: '52px', height: '52px', borderRadius: '16px', background: 'rgba(255,255,255,.14)', placeItems: 'center', flex: 'none' }, }, ic('camera', 26)),
    h('span', { class: 'col grow' },
      h('span', { class: 'bold', style: { fontSize: '1.05rem' }, text: 'Snap it. Find it nearby.' }),
      h('span', { class: 'small', style: { opacity: '.8' }, text: 'Photo • barcode • voice • URL — AI identifies it and matches local stock.' })),
    ic('arrowR', 20));

  const cats = h('div', { class: 'catgrid' });
  const deals = h('div', { class: 'hscroll' });
  const trend = h('div', { class: 'chiprow' });
  const popular = h('div');

  root.append(
    greet,
    searchbar,
    cta,
    h('div', { class: 'h2', style: { marginTop: '20px' }, text: 'Categories' }), cats,
    h('div', { class: 'h2' }, 'Deals near you', h('button', { class: 'link', onclick: () => nav('#/search?deals=1') }, 'See all')), deals,
    h('div', { class: 'h2' }, 'Trending searches'), trend,
    h('div', { class: 'h2' }, 'Popular near you'), popular);

  (async () => {
    const first = state.user?.name?.split(' ')[0] || 'there';
    greet.append(h('div', { class: 'h1', text: `Hey ${first} 👋` }),
      h('p', { class: 'muted small', style: { margin: '-6px 0 14px' }, text: `Showing stores within ${state.radius} km of ${state.loc.label}.` }));

    const meta = state.meta || await api.get('/meta', { auth: false, cache: true });
    cats.append(...(meta?.categories || []).map((c) =>
      h('button', { class: 'cat', onclick: () => nav(`#/search?cat=${c.id}`) }, h('span', { class: 'ic', text: c.emoji }), c.name.split(' ')[0])));

    deals.append(skeletonRows(1));
    try {
      const { deals: dl } = await api.get(`/deals?lat=${state.loc.lat}&lng=${state.loc.lng}&radius_km=${state.radius}`, { cache: true });
      deals.innerHTML = '';
      if (!dl.length) deals.append(h('p', { class: 'muted small', text: 'No active deals in your radius right now.' }));
      dl.forEach((d) => deals.append(h('button', { class: 'dealcard', style: { textAlign: 'left' }, onclick: () => nav(`#/store/${d.store.id}`) },
        h('div', { class: 'pct', text: `-${d.pct}%` }),
        h('h4', { text: d.store.name }), h('p', { text: d.title }),
        h('p', { style: { marginTop: '8px', fontWeight: '700', fontSize: '.75rem', color: '#ffd9b8' }, text: `${d.store.distance_km} km away · ends ${new Date(d.ends_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}` }))));
    } catch { deals.innerHTML = ''; deals.append(h('p', { class: 'muted small', text: 'Deals unavailable offline.' })); }

    try {
      const { trending } = await api.get('/trending', { cache: true });
      trend.append(...trending.slice(0, 6).map((t) => h('button', { class: 'chip', onclick: () => nav(`#/search?q=${encodeURIComponent(t.q)}`) }, ic('search', 14), `${t.q} · ${t.count}`)));
    } catch { /* offline */ }

    popular.append(skeletonRows(3));
    try {
      const { results } = await api.post('/search', { lat: state.loc.lat, lng: state.loc.lng, radius_km: state.radius, sort: 'relevance', page: 1 });
      popular.innerHTML = '';
      results.slice(0, 6).forEach((r) => popular.append(offerRow(r, nav)));
    } catch (e) { popular.innerHTML = ''; popular.append(h('p', { class: 'muted small', text: e.message })); }
  })();
  return root;
}

export function offerRow(r, nav, { onTap } = {}) {
  return h('button', {
    class: 'offer', onclick: () => { onTap?.(); nav(`#/product/${r.product.id}`); },
  },
    h('span', { class: 'emoji-tile sm', text: r.product.emoji || '📦' }),
    h('span', { class: 'col grow' },
      h('span', { class: 'bold', style: { fontSize: '.93rem' }, text: r.product.name }),
      h('span', { class: 'tiny muted' }, `${r.store.name} · ${r.store.distance_km} km · ${r.store.open_now ? 'Open' : 'Closed'}`),
      h('span', { class: 'badges', style: { marginTop: '4px' } },
        r.badges.includes('best_deal') ? h('span', { class: 'badge ok', text: 'Best deal' }) : null,
        r.badges.includes('closest') ? h('span', { class: 'badge teal', text: 'Closest' }) : null,
        r.badges.includes('on_deal') ? h('span', { class: 'badge orange', text: 'On deal' }) : null,
        r.stock_label === 'out_of_stock' ? h('span', { class: 'badge bad', text: 'Out of stock' }) : r.stock_label === 'low_stock' ? h('span', { class: 'badge warn', text: 'Low stock' }) : null)),
    h('span', { class: 'col', style: { alignItems: 'flex-end' } },
      h('span', { class: 'price', text: money(r.price) }),
      ic('chevR', 16)));
}
