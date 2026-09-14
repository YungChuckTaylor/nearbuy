// Premium & payments: subscription tiers, Paystack test-mode checkout, receipts.
import { h, toast, skeletonRows, timeAgo, emptyState } from '../ui.js';
import { ic } from '../ui.js';
import { api, getToken } from '../api.js';
import { state, money, refreshUnread } from '../store.js';

export async function verifyPendingPay(params) {
  const ref = params?.get?.('pay') || localStorage.getItem('nbg_pending_pay');
  if (!ref) return null;
  try {
    const { payment } = await api.get(`/payments/verify/${encodeURIComponent(ref)}`);
    localStorage.removeItem('nbg_pending_pay');
    if (payment.status === 'success') toast(`Payment confirmed — ${payment.label} ✓`, 'ok');
    else if (payment.status === 'failed') toast('Payment failed — no charge made.', 'bad');
    return payment;
  } catch { return null; }
}

export function openCheckout(initRes) {
  localStorage.setItem('nbg_pending_pay', initRes.payment.ref);
  const win = window.open(initRes.checkout_url, '_blank');
  if (!win) location.href = initRes.checkout_url;
  toast(initRes.simulated ? 'Opening Paystack TEST checkout…' : 'Opening Paystack checkout…');
}

export function renderPremium(params, nav) {
  const root = h('div', { style: { maxWidth: '640px', margin: '0 auto' } });
  if (!getToken()) {
    root.append(emptyState('💳', 'Premium & payments', 'Log in to subscribe or view receipts.', h('button', { class: 'btn primary', onclick: () => nav('#/auth') }, 'Log in')));
    return root;
  }
  root.append(h('h1', { class: 'h1', text: 'Premium & payments' }));
  const planBox = h('div');
  const modeBadge = h('span');
  const tiers = h('div', { class: 'kpi-grid', style: { gridTemplateColumns: '1fr' } });
  const payBox = h('div');
  root.append(planBox, h('div', { class: 'row', style: { gap: '8px', margin: '6px 0 10px' } }, h('span', { class: 'bold small', text: 'Gateway:' }), modeBadge), tiers,
    h('div', { class: 'h2' }, 'Receipts & payment history'), payBox);

  (async () => {
    await verifyPendingPay(params);
    const [{ plans, mode }, { payments }] = await Promise.all([api.get('/payments/plans', { auth: false }), api.get('/payments')]);
    modeBadge.innerHTML = '';
    modeBadge.append(h('span', { class: `badge ${mode === 'live' ? 'ok' : 'warn'}`, text: mode === 'live' ? 'Paystack LIVE' : 'Paystack TEST mode' }));
    planBox.innerHTML = '';
    const plan = state.user?.plan;
    planBox.append(plan
      ? h('div', { class: 'card row', style: { background: 'linear-gradient(135deg,var(--orange-soft),#fff)' } },
        h('span', { style: { fontSize: '1.6rem' }, text: '⭐' }),
        h('span', { class: 'col grow' },
          h('span', { class: 'bold', text: `${plans.find((p) => p.id === plan.id)?.name || plan.id} active` }),
          h('span', { class: 'tiny muted', text: `Renews ${new Date(plan.renews).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}` })))
      : h('div', { class: 'card', style: { padding: '12px 14px' } }, h('span', { class: 'small muted', text: 'You are on the Free tier. Upgrade for unlimited searches, priority alerts and an ad-free experience.' })));

    tiers.append(skeletonRows(2));
    tiers.innerHTML = '';
    plans.forEach((p) => {
      tiers.append(h('div', { class: 'card' },
        h('div', { class: 'row spread' },
          h('span', { class: 'col' },
            h('span', { class: 'bold', style: { fontSize: '1.05rem' }, text: p.name }),
            h('span', { style: { fontSize: '1.3rem', fontWeight: 800, letterSpacing: '-.02em' }, text: `${money(p.amount / 100)}${' '}/ ${p.per}` })),
          h('button', {
            class: 'btn primary sm', disabled: plan?.id === p.id, onclick: async (e) => {
              e.currentTarget.disabled = true;
              try {
                const init = await api.post('/payments/initialize', { type: 'subscription', plan_id: p.id });
                openCheckout(init);
                pollOnce(nav);
              } catch (err) { toast(err.message, 'bad'); e.currentTarget.disabled = false; }
            },
          }, plan?.id === p.id ? 'Current plan' : 'Subscribe')),
        h('ul', { style: { margin: '10px 0 0', padding: '0 0 0 4px', listStyle: 'none' } },
          p.perks.map((perk) => h('li', { class: 'small', style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '3px 0' } }, ic('check', 14), perk)))));
    });

    payBox.innerHTML = '';
    if (!payments.length) payBox.append(h('p', { class: 'muted small', text: 'No payments yet. Reservation prepayments and subscriptions appear here as digital receipts.' }));
    payments.forEach((p) => payBox.append(h('div', { class: 'card', style: { padding: '12px 14px' } },
      h('div', { class: 'row spread' },
        h('span', { class: 'bold small', text: p.label }),
        h('span', { class: `badge ${p.status === 'success' ? 'ok' : p.status === 'failed' ? 'bad' : 'warn'}`, text: p.status })),
      h('div', { class: 'row spread', style: { marginTop: '6px' } },
        h('span', { class: 'tiny muted', text: `${p.ref} · ${timeAgo(p.created)} · ${p.provider}` }),
        h('span', { class: 'bold small', text: money(p.amount / 100) })))));
    await refreshUnread();
  })().catch((e) => { root.append(h('p', { class: 'badge bad', text: e.message })); });

  return root;
}

// poll verify a few times so the page flips state when the checkout tab completes
function pollOnce(nav) {
  let n = 0;
  const t = setInterval(async () => {
    n++;
    const ref = localStorage.getItem('nbg_pending_pay');
    if (!ref || n > 24) { clearInterval(t); return; }
    const p = await verifyPendingPay(new URLSearchParams(`pay=${ref}`));
    if (p && (p.status === 'success' || p.status === 'failed')) { clearInterval(t); nav('#/premium'); }
  }, 4000);
}
