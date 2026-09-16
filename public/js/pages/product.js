// Product detail: cross-store price comparison, price history, reserve, watch, reviews.
import { h, toast, sheet, stars, stockBadge, openBadge, timeAgo, emptyState, share } from '../ui.js';
import { ic } from '../ui.js';
import { api, getToken } from '../api.js';
import { state, money, refreshUnread } from '../store.js';
import { lineChart } from '../charts.js';
import { openCheckout } from './premium.js';

export function renderProduct(id, nav) {
  const root = h('div', { style: { maxWidth: '640px', margin: '0 auto' } });
  root.append(h('div', { class: 'skeleton', style: { height: '120px', marginBottom: '10px' } }), h('div', { class: 'skeleton', style: { height: '200px' } }));

  (async () => {
    const [{ product, offers, reviews, similar }, hist] = await Promise.all([
      api.get(`/products/${id}`, { cache: true }),
      api.get(`/products/${id}/history`, { cache: true }).catch(() => ({ history: [] })),
    ]);
    api.post('/events', { type: 'product_view', product_id: id, store_id: offers[0]?.store.id }).catch(() => { });
    root.innerHTML = '';

    let saved = await (getToken() ? api.get('/saved').then((r) => r.items.some((i) => i.saved.product_id === id)).catch(() => false) : false);

    const best = offers.find((o) => o.stock_label !== 'out_of_stock');
    const worst = offers.length ? offers[offers.length - 1] : null;
    const saving = best && worst ? worst.price - best.price : 0;

    const header = h('div', { class: 'card' },
      h('div', { class: 'row', style: { alignItems: 'flex-start' } },
        h('span', { class: 'emoji-tile lg', text: product.emoji || '📦' }),
        h('span', { class: 'col grow' },
          h('span', { class: 'badge navy', style: { alignSelf: 'flex-start', marginBottom: '6px' }, text: product.category }),
          h('h1', { style: { margin: '0 0 2px', fontSize: '1.25rem', letterSpacing: '-.02em' }, text: product.name }),
          h('span', { class: 'muted small', text: `${product.brand}${product.barcode ? ` · ${product.barcode}` : ''}` }),
          h('span', { class: 'small muted', style: { marginTop: '6px' }, text: product.desc || '' })),
        h('span', { class: 'col', style: { gap: '8px' } },
          h('button', { class: 'iconbtn', style: { background: 'var(--navy-soft)', color: saved ? 'var(--orange)' : 'var(--navy)' }, 'aria-label': 'Save & watch price', onclick: async (e) => {
            if (!getToken()) return nav('#/auth');
            const btn = e.currentTarget; // currentTarget is null after an await — capture before
            if (saved) { await api.del(`/saved/${id}`); toast('Removed from saved'); btn.style.color = 'var(--navy)'; }
            else { await api.post('/saved', { product_id: id, watch: true }); toast('Saved — we will alert you on price drops & restocks', 'ok'); btn.style.color = 'var(--orange)'; }
            saved = !saved;
          } }, ic('bookmark', 20)),
          h('button', { class: 'iconbtn', style: { background: 'var(--navy-soft)', color: 'var(--navy)' }, 'aria-label': 'Share', onclick: () => share({ title: product.name, text: `${product.name} from ${money(best?.price || 0)} near you`, url: location.href }) }, ic('share', 20)))));

    if (best) header.append(h('div', { class: 'row spread', style: { marginTop: '14px', padding: '12px 14px', borderRadius: '14px', background: 'var(--ok-soft)' } },
      h('span', { class: 'col' }, h('span', { class: 'tiny bold', style: { color: 'var(--ok)' }, text: 'BEST PRICE NEARBY' }), h('span', { style: { fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-.02em' }, text: money(best.price) })),
      saving > 0 ? h('span', { class: 'badge ok', text: `Save ${money(saving)} vs priciest` }) : null));

    const offerList = h('div', {}, offers.map((o) => h('div', { class: 'offer' },
      h('button', { class: 'emoji-tile sm', style: { fontSize: '1.2rem' }, onclick: () => nav(`#/store/${o.store.id}`), 'aria-label': o.store.name }, o.store.emoji),
      h('button', { class: 'col grow', style: { textAlign: 'left' }, onclick: () => nav(`#/store/${o.store.id}`) },
        h('span', { class: 'bold small', text: `${o.store.name} ${o.store.verified ? '✓' : ''}` }),
        h('span', { class: 'tiny muted', text: `${o.store.distance_km} km · ${o.store.area} · ${o.store.hours_label}` }),
        h('span', { class: 'badges', style: { marginTop: '4px' } }, stockBadge(o.stock_label), openBadge(o.store.open_now, o.store.open_now ? 'Open' : 'Closed'), o.badges.includes('best_deal') ? h('span', { class: 'badge ok', text: 'Best deal' }) : null)),
      h('span', { class: 'col', style: { alignItems: 'flex-end', gap: '6px' } },
        h('span', { class: 'price', text: money(o.price) }),
        h('button', {
          class: 'btn sm primary', disabled: o.stock_label === 'out_of_stock', onclick: () => reserve(o),
        }, 'Reserve')))));

    const chartBox = h('div');
    const series = buildSeries(hist.history);
    if (series.length > 1) lineChart(chartBox, series, { format: (v) => money(v), title: 'Lowest price nearby — last 8 weeks' });

    const reviewsBox = h('div', {},
      reviews.length ? reviews.map((r) => h('div', { class: 'card', style: { padding: '12px 14px' } },
        h('div', { class: 'row spread' }, h('span', { class: 'bold small', text: r.user_name }), stars(r.rating)),
        h('p', { class: 'small', style: { margin: '6px 0 4px' }, text: r.text }),
        h('span', { class: 'tiny muted', text: timeAgo(r.created) }))) : h('p', { class: 'muted small', text: 'No reviews yet — be the first after your visit.' }),
      h('button', { class: 'btn ghost block', style: { marginTop: '10px' }, onclick: () => reviewSheet(id, null) }, 'Write a review'));

    root.append(header,
      h('div', { class: 'h2' }, `Available at ${offers.length} store${offers.length === 1 ? '' : 's'}`, h('span', { class: 'link', text: `within ${state.radius} km` })),
      offerList,
      series.length > 1 ? h('div', { class: 'card', style: { marginTop: '12px' } }, chartBox) : null,
      h('div', { class: 'h2' }, 'Reviews'), reviewsBox,
      similar.length ? h('div', { class: 'h2' }, 'Similar items') : null,
      similar.length ? h('div', { class: 'chiprow' }, similar.map((s) => h('button', { class: 'chip', onclick: () => nav(`#/product/${s.id}`) }, `${s.emoji || '📦'} ${s.name}`))) : null);

    function reserve(o) {
      if (!getToken()) return nav('#/auth');
      let qty = 1;
      let payNow = false;
      sheet(`Reserve at ${o.store.name}`, ({ close }) => {
        const val = h('span', { class: 'val', text: '1' });
        const total = h('span', { class: 'bold', text: money(o.price) });
        const step = (d) => { qty = Math.min(o.stock, Math.max(1, qty + d)); val.textContent = qty; total.textContent = money(o.price * qty); };
        const paySeg = h('div', { class: 'seg', style: { width: '100%', marginBottom: '12px' } },
          h('button', { class: 'active', onclick: (e) => { payNow = false; [...e.currentTarget.parentElement.children].forEach((c) => c.classList.remove('active')); e.currentTarget.classList.add('active'); } }, 'Pay at pickup'),
          h('button', { onclick: (e) => { payNow = true; [...e.currentTarget.parentElement.children].forEach((c) => c.classList.remove('active')); e.currentTarget.classList.add('active'); } }, 'Pay now · Paystack'));
        return h('div', {},
          h('div', { class: 'row spread', style: { marginBottom: '14px' } },
            h('span', { class: 'small muted', text: 'Quantity' }),
            h('span', { class: 'stepper' }, h('button', { onclick: () => step(-1), 'aria-label': 'Decrease' }, '−'), val, h('button', { onclick: () => step(1), 'aria-label': 'Increase' }, '+'))),
          paySeg,
          h('div', { class: 'row spread', style: { marginBottom: '14px' } }, h('span', { class: 'small muted', text: payNow ? 'Total (pay online)' : 'Pay at pickup' }), total),
          h('p', { class: 'tiny muted', text: 'Buy online, pick up in store (BOPIS). The store holds your item for 24h. "Pay now" uses Paystack hosted checkout (test mode until live keys are configured).' }),
          h('button', {
            class: 'btn primary block', onclick: async () => {
              try {
                const { reservation } = await api.post('/reservations', { store_id: o.store.id, product_id: id, qty });
                await refreshUnread();
                if (payNow) {
                  const init = await api.post('/payments/initialize', { type: 'reservation', reservation_id: reservation.id });
                  close();
                  openCheckout(init);
                  sheet('Reservation created 🧾', () => h('div', { style: { textAlign: 'center', padding: '8px 0' } },
                    h('div', { style: { fontSize: '2rem', fontWeight: 900, letterSpacing: '.04em', color: 'var(--navy)' }, text: reservation.code }),
                    h('p', { class: 'small muted', text: `Complete payment in the checkout tab. Your receipt appears under Premium & payments.` }),
                    h('button', { class: 'btn block', onclick: () => nav('#/premium') }, 'View payments')));
                  return;
                }
                close();
                sheet('Reservation confirmed 🎉', () => h('div', { style: { textAlign: 'center', padding: '8px 0' } },
                  h('div', { style: { fontSize: '2rem', fontWeight: 900, letterSpacing: '.04em', color: 'var(--ok)' }, text: reservation.code }),
                  h('p', { class: 'small muted', text: `Show this code at ${o.store.name}. Status updates arrive in Alerts.` }),
                  h('button', { class: 'btn block', onclick: () => nav('#/saved') }, 'Track my reservations')));
              } catch (e) { toast(e.message, 'bad'); }
            },
          }, 'Confirm reservation'));
      });
    }
  })().catch((e) => { root.innerHTML = ''; root.append(emptyState('😕', 'Product unavailable', e.message)); });

  return root;
}

function buildSeries(history) {
  if (!history?.length) return [];
  const base = history[0].points;
  return base.map((pt, i) => ({
    v: Math.min(...history.map((hh) => hh.points[i]?.price ?? pt.price)),
    label: new Date(pt.t).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }),
  }));
}

export function reviewSheet(productId, storeId, onDone) {
  if (!getToken()) return toast('Log in to write reviews', 'bad');
  let rating = 4;
  sheet('Write a review', ({ close }) => {
    const starRow = h('div', { class: 'row', style: { gap: '6px', margin: '4px 0 14px' } }, [1, 2, 3, 4, 5].map((n) =>
      h('button', { style: { fontSize: '1.6rem', color: n <= rating ? '#f2a71b' : '#d9dde8' }, 'aria-label': `${n} stars`, onclick: (e) => { rating = n; [...e.currentTarget.parentElement.children].forEach((b, i) => (b.style.color = i < rating ? '#f2a71b' : '#d9dde8')); } }, '★')));
    const text = h('textarea', { class: 'input', rows: 3, placeholder: 'What was your experience? Price accuracy, stock, service…' });
    return h('div', {}, starRow, text, h('button', {
      class: 'btn primary block', style: { marginTop: '10px' }, onclick: async () => {
        try {
          if (storeId) await api.post(`/stores/${storeId}/reviews`, { rating, text: text.value, product_id: productId });
          else await api.post(`/products/${productId}/reviews`, { rating, text: text.value, store_id: storeId });
          toast('Review published — +20 points', 'ok');
          close(); onDone?.();
        } catch (e) { toast(e.message, 'bad'); }
      },
    }, 'Publish review'));
  });
}
