// Search results: list ⇄ map, full filter sheet (brand, price min/max, stock,
// open-now, delivery, rating), sorting, pagination, history + incognito mode.
import { h, toast, sheet, skeletonRows, emptyState, debounce, timeAgo } from '../ui.js';
import { ic } from '../ui.js';
import { api, getToken } from '../api.js';
import { state, money } from '../store.js';
import { offerRow } from './home.js';
import { renderMap } from '../map.js';

const SORTS = [['relevance', 'Best value'], ['distance', 'Nearest'], ['price_asc', 'Price ↑'], ['price_desc', 'Price ↓'], ['rating', 'Top rated']];

export function renderSearch(params, nav) {
  let q = params.get('q') || '';
  const cat = params.get('cat') || '';
  const dealsOnly = params.get('deals') === '1';
  const ids = params.get('ids') ? params.get('ids').split(',') : null;

  const filters = { category: cat, brand: '', min_price: null, max_price: null, in_stock: false, open_now: false, min_rating: 0, delivery: false };
  let incognito = false;
  let sort = 'relevance';
  let view = 'list';
  let page = 1;
  let last = null;

  const root = h('div');
  const filterBtn = h('button', { class: 'sbtn', 'aria-label': 'Filters', onclick: openFilters, style: { position: 'relative' } }, ic('filter', 20));
  const fBadge = h('span', { class: 'pill', style: { position: 'absolute', top: '2px', right: '2px', minWidth: '16px', height: '16px', padding: '0 4px', borderRadius: '8px', background: 'var(--orange)', color: '#fff', fontSize: '.6rem', display: 'none', placeItems: 'center', fontWeight: 800 } });
  filterBtn.append(fBadge);
  const bar = h('div', { class: 'searchbar' },
    ic('search', 20),
    h('input', { value: q, placeholder: 'Search items, brands…', 'aria-label': 'Search query', oninput: debounce((e) => { q = e.target.value; page = 1; run(); }, 350), onkeydown: (e) => { if (e.key === 'Enter') { q = e.target.value; page = 1; run(); } } }),
    filterBtn,
    h('button', { class: 'sbtn cam', 'aria-label': 'Camera search', onclick: () => nav('#/upload?mode=camera') }, ic('camera', 20)));

  const sortRow = h('div', { class: 'chiprow' }, SORTS.map(([id, label]) =>
    h('button', { class: `chip ${id === sort ? 'active' : ''}`, onclick: (e) => { sort = id; [...e.currentTarget.parentElement.children].forEach((c) => c.classList.remove('active')); e.currentTarget.classList.add('active'); page = 1; run(); } }, label)));

  const seg = h('div', { class: 'seg' },
    h('button', { class: 'active', onclick: (e) => setView('list', e) }, 'List'),
    h('button', { onclick: (e) => setView('map', e) }, 'Map'));
  const topRow = h('div', { class: 'row spread', style: { margin: '12px 0 10px' } }, h('div', { class: 'grow' }, sortRow), seg);

  const stale = h('div', { class: 'badge warn', style: { display: 'none', marginBottom: '10px' }, text: 'Offline — showing cached results' });
  const historyBox = h('div');
  const list = h('div', { 'aria-live': 'polite' });
  const mapBox = h('div', { style: { display: 'none' } });
  const more = h('button', { class: 'btn outline block', style: { display: 'none', marginTop: '10px' }, onclick: () => { page++; run(true); } }, 'Load more');
  root.append(bar, topRow, stale, historyBox, list, mapBox, more);

  const activeFilterCount = () => [filters.brand, filters.min_price != null, filters.max_price != null, filters.in_stock, filters.open_now, filters.delivery, filters.min_rating > 0, filters.category].filter(Boolean).length;
  const paintFilterBadge = () => {
    const n = activeFilterCount();
    fBadge.style.display = n ? 'grid' : 'none';
    fBadge.textContent = n;
  };
  paintFilterBadge();

  function setView(v, e) {
    view = v;
    [...seg.children].forEach((b) => b.classList.remove('active'));
    e.currentTarget.classList.add('active');
    list.style.display = v === 'list' ? '' : 'none';
    more.style.display = 'none';
    mapBox.style.display = v === 'map' ? '' : 'none';
    if (v === 'map' && last) paintMap();
  }
  function paintMap() {
    renderMap(mapBox, {
      user: state.loc, radius_km: state.radius,
      pins: last.results.map((r) => ({ lat: r.store.lat, lng: r.store.lng, label: r.store.name, price: money(r.price), id: r.product.id })),
      onSelect: (p) => nav(`#/product/${p.id}`),
    });
  }

  function openFilters() {
    sheet('Filters', ({ close }) => {
      const mkSwitch = (label, key) => {
        const sw = h('button', { class: `switch ${filters[key] ? 'on' : ''}`, role: 'switch', 'aria-checked': String(!!filters[key]), 'aria-label': label });
        sw.addEventListener('click', () => { filters[key] = !filters[key]; sw.classList.toggle('on', filters[key]); sw.setAttribute('aria-checked', String(filters[key])); });
        return h('div', { class: 'listrow' }, h('span', { class: 'grow bold small', text: label }), sw);
      };
      const brand = h('input', { class: 'input', placeholder: 'e.g. Nike, Golden Penny, Tefal', value: filters.brand || '' });
      const minPrice = h('input', { class: 'input', type: 'number', min: 0, placeholder: 'No minimum', value: filters.min_price ?? '' });
      const maxPrice = h('input', { class: 'range', type: 'range', min: 0, max: 500000, step: 500, value: filters.max_price || 0, 'aria-label': 'Maximum price' });
      const maxLabel = h('span', { class: 'badge navy', text: filters.max_price ? money(filters.max_price) : 'Any price' });
      maxPrice.addEventListener('input', () => { filters.max_price = Number(maxPrice.value) || null; maxLabel.textContent = filters.max_price ? money(filters.max_price) : 'Any price'; });
      const rating = h('select', { class: 'input' }, [0, 3, 4, 4.5].map((r) => h('option', { value: r, text: r ? `${r}★ & up` : 'Any rating', selected: filters.min_rating === r })));
      rating.addEventListener('change', () => (filters.min_rating = Number(rating.value)));
      return h('div', {},
        h('label', { class: 'field' }, h('span', { text: 'Brand' }), brand),
        h('div', { class: 'row', style: { gap: '10px' } },
          h('label', { class: 'field grow' }, h('span', { text: 'Min price (₦)' }), minPrice),
          h('label', { class: 'field grow' }, h('span', { text: 'Max price' }), maxLabel, maxPrice)),
        mkSwitch('In stock only', 'in_stock'),
        mkSwitch('Open now', 'open_now'),
        mkSwitch('Delivery available', 'delivery'),
        h('label', { class: 'field', style: { marginTop: '10px' } }, h('span', { text: 'Minimum store rating' }), rating),
        h('div', { class: 'row', style: { gap: '10px', marginTop: '8px' } },
          h('button', {
            class: 'btn outline grow', onclick: () => {
              Object.assign(filters, { category: '', brand: '', min_price: null, max_price: null, in_stock: false, open_now: false, min_rating: 0, delivery: false });
              close(); page = 1; paintFilterBadge(); run();
            },
          }, 'Reset'),
          h('button', {
            class: 'btn primary grow', onclick: () => {
              filters.brand = brand.value.trim();
              filters.min_price = minPrice.value === '' ? null : Number(minPrice.value);
              filters.min_rating = Number(rating.value);
              close(); page = 1; paintFilterBadge(); run();
            },
          }, 'Apply filters')));
    });
  }

  async function renderHistory() {
    historyBox.innerHTML = '';
    if (q || ids || cat || !getToken()) return;
    let hist = [];
    try { hist = (await api.get('/history')).history; } catch { return; }
    const inc = h('button', { class: `switch ${incognito ? 'on' : ''}`, role: 'switch', 'aria-label': 'Incognito searches' });
    inc.addEventListener('click', () => { incognito = !incognito; inc.classList.toggle('on', incognito); toast(incognito ? 'Incognito on — searches will not be saved' : 'Incognito off'); });
    const card = h('div', { class: 'card', style: { marginBottom: '12px', padding: '12px 14px' } },
      h('div', { class: 'row spread', style: { marginBottom: '8px' } },
        h('span', { class: 'bold small', text: '🕘 Recent searches' }),
        h('span', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'tiny muted', text: 'Incognito' }), inc)),
      h('div', { class: 'chiprow' },
        hist.length ? hist.slice(0, 10).map((x) => h('span', { class: 'chip', style: { gap: '8px' } },
          h('button', { onclick: () => { q = x.q; bar.querySelector('input').value = q; page = 1; run(); } }, `${x.q}`),
          h('button', { 'aria-label': 'Remove', style: { display: 'inline-flex', color: 'var(--muted)' }, onclick: async (e) => { e.stopPropagation(); await api.del(`/history/${x.id}`); renderHistory(); } }, ic('x', 12)))) : [h('span', { class: 'muted small', text: 'Your searches will appear here for one-tap re-runs.' })]),
      hist.length ? h('button', { class: 'tiny bold', style: { color: 'var(--bad)', marginTop: '8px' }, onclick: async () => { await api.del('/history'); renderHistory(); } }, 'Clear search history') : null);
    historyBox.append(card);
  }

  async function run(append = false) {
    if (!append) { list.innerHTML = ''; list.append(skeletonRows(4)); }
    renderHistory();
    try {
      const res = await api.post('/search', {
        q, lat: state.loc.lat, lng: state.loc.lng, radius_km: state.radius, page, incognito,
        product_ids: ids || undefined,
        filters: { ...filters, category: filters.category || undefined, brand: filters.brand || undefined },
        sort,
      }, { cache: true });
      last = res;
      stale.style.display = res.__stale ? '' : 'none';
      if (!append) list.innerHTML = '';
      if (!res.results.length && !append) {
        list.append(emptyState('🔎', 'No matches in your radius', 'Try widening your radius in Profile → Location, or remove some filters.',
          h('button', { class: 'btn ghost sm', onclick: () => { Object.assign(filters, { category: '', brand: '', in_stock: false, open_now: false, delivery: false, max_price: null, min_price: null, min_rating: 0 }); page = 1; paintFilterBadge(); run(); } }, 'Clear filters')));
        more.style.display = 'none';
        return;
      }
      res.results.forEach((r) => list.append(offerRow(r, nav, { onTap: () => api.post('/events', { type: 'offer_click', offer_id: r.offer_id, store_id: r.store.id }).catch(() => { }) })));
      more.style.display = view === 'list' && page < res.pages ? '' : 'none';
      if (view === 'map') paintMap();
    } catch (e) {
      if (!append) list.innerHTML = '';
      list.append(emptyState('📡', 'Could not reach the service', e.message));
    }
  }
  run();
  return root;
}
