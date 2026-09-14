// Notification center.
import { h, emptyState, skeletonRows, timeAgo, toast } from '../ui.js';
import { api, getToken } from '../api.js';
import { refreshUnread } from '../store.js';

const EMOJI = { price_drop: '📉', back_in_stock: '📦', deal: '🏷️', reservation: '🧾', review: '⭐', badge: '🏅', welcome: '🎉' };

export function renderAlerts(nav) {
  const root = h('div', { style: { maxWidth: '640px', margin: '0 auto' } });
  if (!getToken()) {
    root.append(emptyState('🔔', 'Alerts live here', 'Price drops, restocks, deals near you and reservation updates.', h('button', { class: 'btn primary', onclick: () => nav('#/auth') }, 'Log in')));
    return root;
  }
  const head = h('div', { class: 'row spread' }, h('h1', { class: 'h1', style: { margin: 0 }, text: 'Alerts' }),
    h('button', { class: 'btn ghost sm', onclick: async () => { await api.post('/notifications/read-all'); refreshUnread(); nav('#/alerts'); } }, 'Mark all read'));
  const box = h('div', { style: { marginTop: '14px' } });
  root.append(head, box);
  (async () => {
    box.append(skeletonRows(3));
    const { notifications } = await api.get('/notifications', { cache: true });
    box.innerHTML = '';
    if (!notifications.length) box.append(emptyState('🔕', 'All quiet', 'Watch an item or follow a store to start receiving alerts.'));
    notifications.forEach((n) => box.append(h('button', {
      class: `notif ${n.read ? '' : 'unread'}`, onclick: async () => {
        if (!n.read) { await api.post(`/notifications/${n.id}/read`).catch(() => { }); refreshUnread(); }
        if (n.data?.route) nav(n.data.route);
      },
    },
      h('span', { class: 'nic', text: EMOJI[n.type] || '🔔' }),
      h('span', { class: 'col grow' },
        h('span', { class: 'bold small', text: n.title }),
        h('span', { class: 'small muted', text: n.body }),
        h('span', { class: 'tiny muted', style: { marginTop: '4px' }, text: timeAgo(n.created) })),
      n.read ? null : h('span', { class: 'udot' }))));
  })().catch((e) => { box.innerHTML = ''; box.append(emptyState('📡', 'Unavailable', e.message)); });
  return root;
}
