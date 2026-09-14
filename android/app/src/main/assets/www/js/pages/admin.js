// Admin: platform stats, moderation queue, feature flags, health.
import { h, emptyState, skeletonRows, timeAgo, toast } from '../ui.js';
import { api, getToken } from '../api.js';
import { state } from '../store.js';

export function renderAdmin(nav) {
  const root = h('div', { style: { maxWidth: '720px', margin: '0 auto' } });
  if (!getToken() || state.user?.role !== 'admin') {
    root.append(emptyState('🛡️', 'Admins only', 'Log in with the admin demo account to view platform operations.', h('button', { class: 'btn primary', onclick: () => nav('#/auth') }, 'Log in as admin')));
    return root;
  }
  root.append(h('h1', { class: 'h1', text: 'Admin & moderation' }));
  const kpis = h('div', { class: 'kpi-grid' });
  const searchBox = h('div', { class: 'card' });
  const flagBox = h('div');
  const flagsBox2 = h('div', { class: 'card' });
  const health = h('div', { class: 'card' });
  root.append(kpis, h('div', { class: 'section-gap' }), health,
    h('div', { class: 'h2' }, 'Top searches'), searchBox,
    h('div', { class: 'h2' }, 'Moderation queue'), flagBox,
    h('div', { class: 'h2' }, 'Feature flags'), flagsBox2);

  (async () => {
    kpis.append(skeletonRows(2));
    const s = await api.get('/admin/stats');
    kpis.innerHTML = '';
    const kpi = (l, v) => h('div', { class: 'kpi' }, h('div', { class: 'v', text: v }), h('div', { class: 'l', text: l }));
    kpis.append(kpi('Users', s.counts.users), kpi('Stores', s.counts.stores), kpi('Products', s.counts.products), kpi('Listings', s.counts.offers), kpi('Reservations', s.counts.reservations), kpi('Reviews', s.counts.reviews), kpi('Open flags', s.counts.open_flags), kpi('Uptime', `${s.health.uptime_s}s`));
    health.innerHTML = '';
    health.append(h('div', { class: 'bold small', style: { marginBottom: '6px' }, text: 'Infrastructure health' }),
      h('p', { class: 'small muted', style: { margin: 0 }, text: `Node ${s.health.node} · RSS ${s.health.mem_mb} MB · uptime ${s.health.uptime_s}s · JSON store with debounced writes (Postgres+PostGIS migration path documented).` }));
    searchBox.innerHTML = '';
    searchBox.append(s.top_searches.map((t) => h('div', { class: 'listrow' }, h('span', { class: 'grow bold small', text: t.q }), h('span', { class: 'badge navy', text: `${t.count} searches` }))));
    const { flags } = await api.get('/admin/flags');
    flagBox.innerHTML = '';
    const open = flags.filter((f) => f.status === 'open');
    if (!open.length) flagBox.append(h('p', { class: 'muted small', text: 'Queue clear 🎉' }));
    open.forEach((f) => flagBox.append(h('div', { class: 'card', style: { padding: '12px 14px' } },
      h('div', { class: 'row spread' }, h('span', { class: 'bold small', text: `${f.type} · ${f.target}` }), h('span', { class: 'badge warn', text: f.status })),
      h('p', { class: 'small muted', style: { margin: '6px 0 8px' }, text: f.reason }),
      h('div', { class: 'row', style: { gap: '8px' } },
        h('button', { class: 'btn sm primary', onclick: async () => { await api.post(`/admin/flags/${f.id}/resolve`, { status: 'resolved' }); toast('Flag resolved', 'ok'); nav('#/admin'); } }, 'Resolve'),
        h('button', { class: 'btn sm outline', onclick: async () => { await api.post(`/admin/flags/${f.id}/resolve`, { status: 'dismissed' }); toast('Dismissed'); nav('#/admin'); } }, 'Dismiss')))));
    flagsBox2.innerHTML = '';
    Object.entries(s.feature_flags).forEach(([k, v]) => {
      const sw = h('button', { class: `switch ${v ? 'on' : ''}`, role: 'switch', 'aria-label': k });
      sw.addEventListener('click', async () => {
        const nv = !sw.classList.contains('on');
        sw.classList.toggle('on', nv);
        await api.put('/admin/flags/admin', { flags: { [k]: nv } });
        toast(`${k} ${nv ? 'enabled' : 'disabled'}`, 'ok');
      });
      flagsBox2.append(h('div', { class: 'listrow' }, h('span', { class: 'grow bold small', text: k.replace(/_/g, ' ') }), sw));
    });
  })();
  return root;
}
