// Profile: identity, gamification, location & radius, notifications, accessibility,
// currency, privacy (GDPR export), role shortcuts, auth.
import { h, toast, sheet, confirmDialog } from '../ui.js';
import { ic } from '../ui.js';
import { api, getToken, setToken } from '../api.js';
import { state, savePrefs, setLocation, useGPS, DEFAULT_LOC, loadSession, refreshUnread } from '../store.js';
import { enablePush, disablePush, pushSupported, currentSubscription } from '../push.js';
import { locationSheet } from '../location.js';

export function renderProfile(nav) {
  const root = h('div', { style: { maxWidth: '560px', margin: '0 auto' } });
  const p = state.user?.prefs || JSON.parse(localStorage.getItem('nbg_guest_prefs') || '{}');
  const logged = !!getToken();

  const avatar = h('div', {
    style: { width: '58px', height: '58px', borderRadius: '20px', background: 'linear-gradient(135deg,var(--orange),var(--pink))', color: '#fff', display: 'grid', placeItems: 'center', fontSize: '1.4rem', fontWeight: 800, flex: 'none' },
    text: (state.user?.name || 'Guest').split(' ').map((w) => w[0]).slice(0, 2).join(''),
  });
  const head = h('div', { class: 'card row' }, avatar,
    h('span', { class: 'col grow' },
      h('span', { class: 'bold', style: { fontSize: '1.1rem' }, text: state.user?.name || 'Guest shopper' }),
      h('span', { class: 'small muted', text: logged ? state.user.email : 'Browsing as guest — log in to sync' }),
      h('span', { class: 'badges', style: { marginTop: '6px' } },
        h('span', { class: 'badge orange', text: `${state.user?.points ?? 0} pts` }),
        h('span', { class: 'badge navy', text: state.user?.role === 'store_owner' ? 'Store owner' : state.user?.role === 'admin' ? 'Admin' : 'Shopper' }))),
    logged ? h('button', { class: 'iconbtn', style: { color: 'var(--muted)' }, 'aria-label': 'Log out', onclick: async () => { if (await confirmDialog('Log out?', 'Your session on this device will end.')) { setToken(null); state.user = null; location.hash = '#/home'; location.reload(); } } }, ic('logout', 20)) : h('button', { class: 'btn sm primary', onclick: () => nav('#/auth') }, 'Log in'));

  const badges = h('div', { class: 'chiprow' }, (state.user?.badges || []).length ? (state.user.badges || []).map((b) => h('span', { class: 'chip', text: `🏅 ${b.replace(/_/g, ' ')}` })) : [h('span', { class: 'muted small', text: 'Earn badges by searching, saving, reviewing and reserving.' })]);

  // location card
  const radiusVal = h('span', { class: 'badge navy', text: `${p.radius_km ?? 10} km` });
  const radius = h('input', { class: 'range', type: 'range', min: 1, max: 50, value: p.radius_km ?? 10, 'aria-label': 'Search radius', oninput: (e) => { radiusVal.textContent = `${e.target.value} km`; } , onchange: (e) => savePrefs({ radius_km: Number(e.target.value) }) });
  const locRow = h('div', { class: 'listrow' },
    h('span', { class: 'ic teal' }, ic('pin', 18)),
    h('span', { class: 'col grow' }, h('span', { class: 'bold small', text: state.loc.label }), h('span', { class: 'tiny muted', text: `${state.loc.lat}, ${state.loc.lng}` })),
    h('button', { class: 'btn ghost sm', onclick: () => locationSheet(() => nav('#/profile')) }, 'Edit'),
    h('button', { class: 'btn ghost sm', onclick: async () => { try { const l = await useGPS(); setLocation(l); toast('Location updated from GPS', 'ok'); nav('#/profile'); } catch { toast('GPS unavailable — search or pin coordinates instead.', 'bad'); } } }, 'GPS'));
  const units = h('div', { class: 'seg' },
    h('button', { class: (p.units || 'km') === 'km' ? 'active' : '', onclick: () => { savePrefs({ units: 'km' }); nav('#/profile'); } }, 'km'),
    h('button', { class: p.units === 'mi' ? 'active' : '', onclick: () => { savePrefs({ units: 'mi' }); nav('#/profile'); } }, 'miles'));

  const pushRow = () => {
    const sw = h('button', { class: `switch ${p.notify_push ? 'on' : ''}`, role: 'switch', 'aria-label': 'Push notifications' });
    const status = h('span', { class: 'tiny muted', text: 'Checking device subscription…' });
    (async () => {
      if (!pushSupported()) { status.textContent = 'Not supported in this browser (needs HTTPS + Push API)'; sw.style.opacity = '.5'; return; }
      const sub = await currentSubscription().catch(() => null);
      status.textContent = sub ? 'Device subscribed — alerts arrive with the app closed' : 'Off — alerts only while the app is open';
      sw.classList.toggle('on', !!sub);
    })();
    sw.addEventListener('click', async () => {
      const turningOn = !sw.classList.contains('on');
      if (turningOn) {
        try {
          await enablePush();
          sw.classList.add('on');
          status.textContent = 'Device subscribed — alerts arrive with the app closed';
          savePrefs({ notify_push: true });
          toast('Push enabled — price drops, deals & reservations will land as system notifications', 'ok');
        } catch (e) { toast(e.message, 'bad'); }
      } else {
        await disablePush();
        sw.classList.remove('on');
        status.textContent = 'Off — alerts only while the app is open';
        savePrefs({ notify_push: false });
      }
    });
    return h('div', { class: 'listrow' }, h('span', { class: 'col grow' }, h('span', { class: 'bold small', text: 'Push notifications (app closed)' }), status), sw);
  };
  const notifSwitch = (label, key) => {
    const sw = h('button', { class: `switch ${p[key] ? 'on' : ''}`, role: 'switch', 'aria-checked': String(!!p[key]), 'aria-label': label });
    sw.addEventListener('click', async () => {
      const v = !p[key];
      if (key === 'notify_push' && v && 'Notification' in window && Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { toast('Browser notifications blocked — in-app alerts still work.', 'bad'); }
      }
      savePrefs({ [key]: v });
      sw.classList.toggle('on', v); sw.setAttribute('aria-checked', String(v));
    });
    return h('div', { class: 'listrow' }, h('span', { class: 'grow bold small', text: label }), sw);
  };

  const fontSeg = h('div', { class: 'seg' }, [[0.9, 'A-'], [1, 'A'], [1.15, 'A+']].map(([v, l]) =>
    h('button', { class: (p.font_scale || 1) === v ? 'active' : '', onclick: () => { savePrefs({ font_scale: v }); nav('#/profile'); } }, l)));
  const hc = h('button', { class: `switch ${p.high_contrast ? 'on' : ''}`, role: 'switch', 'aria-label': 'High contrast' });
  hc.addEventListener('click', () => { savePrefs({ high_contrast: !p.high_contrast }); hc.classList.toggle('on'); });
  const rm = h('button', { class: `switch ${p.reduce_motion ? 'on' : ''}`, role: 'switch', 'aria-label': 'Reduce motion' });
  rm.addEventListener('click', () => { savePrefs({ reduce_motion: !p.reduce_motion }); rm.classList.toggle('on'); });

  const currency = h('select', { class: 'input', onchange: (e) => savePrefs({ currency: e.target.value }) },
    ['NGN', 'USD', 'GHS', 'KES', 'GBP'].map((c) => h('option', { value: c, text: c, selected: (p.currency || 'NGN') === c })));

  const row = (iconName, label, fn, cls = '') => h('button', { class: 'listrow', onclick: fn },
    h('span', { class: `ic ${cls}` }, ic(iconName, 18)),
    h('span', { class: 'grow bold small', text: label }),
    h('span', { class: 'chev' }, ic('chevR', 16)));

  root.append(head,
    h('div', { class: 'h2' }, 'Achievements'), badges,
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'bold small', style: { marginBottom: '8px' }, text: '📍 Location & radius' }),
      locRow,
      h('div', { class: 'listrow' }, h('span', { class: 'ic' }, ic('map', 18)), h('span', { class: 'col grow' }, h('span', { class: 'bold small', text: 'Search radius' }), radius), radiusVal),
      h('div', { class: 'listrow' }, h('span', { class: 'ic' }, ic('settings', 18)), h('span', { class: 'grow bold small', text: 'Units' }), units)),
    h('div', { class: 'card' },
      h('div', { class: 'bold small', style: { marginBottom: '4px' }, text: '🔔 Notifications' }),
      pushRow(),
      notifSwitch('Deal alerts near me', 'notify_deals'),
      notifSwitch('Back-in-stock & price drops', 'notify_stock'),
      notifSwitch('Email digest (weekly)', 'notify_email')),
    h('div', { class: 'card' },
      h('div', { class: 'bold small', style: { marginBottom: '4px' }, text: '♿ Accessibility' }),
      h('div', { class: 'listrow' }, h('span', { class: 'grow bold small', text: 'Font size' }), fontSeg),
      h('div', { class: 'listrow' }, h('span', { class: 'grow bold small', text: 'High contrast mode' }), hc),
      h('div', { class: 'listrow' }, h('span', { class: 'grow bold small', text: 'Reduce motion' }), rm)),
    h('div', { class: 'card' },
      h('div', { class: 'bold small', style: { marginBottom: '4px' }, text: '💱 Preferences' }),
      h('div', { class: 'listrow' }, h('span', { class: 'grow bold small', text: 'Currency' }), currency)),
    h('div', { class: 'card' },
      h('div', { class: 'bold small', style: { marginBottom: '4px' }, text: '🧰 Account & platform' }),
      state.user?.role === 'store_owner' || state.user?.role === 'admin' ? row('store', 'Business dashboard', () => nav('#/business'), 'orange') : null,
      state.user?.role === 'admin' ? row('shield', 'Admin & moderation', () => nav('#/admin'), 'teal') : null,
      row('wallet', 'Premium & payments (Paystack)', () => nav('#/premium'), 'orange'),
      row('box', 'My data (GDPR export)', async () => {
        const data = { user: state.user, saved: logged ? await api.get('/saved').catch(() => ({})) : {}, reservations: logged ? await api.get('/reservations').catch(() => ({})) : {} };
        const json = JSON.stringify(data, null, 2);
        if (window.NBGBridge?.saveText) { window.NBGBridge.saveText('nearbuygoods-my-data.json', json); toast('Export saved to Downloads/NearBuyGoods', 'ok'); return; }
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = h('a', { href: url, download: 'nearbuygoods-my-data.json' }); a.click();
        toast('Export downloaded', 'ok');
      }),
      window.NBGBridge ? row('settings', 'App server address', () => window.NBGBridge.changeServer(), 'teal') : null,
      row('link', 'API docs (mobile foundation)', () => { const u = ((window.NBG_CONFIG || {}).API_BASE || '') + '/api/docs'; if (window.NBGBridge) location.href = u; else window.open(u, '_blank'); }),
      row('alert', 'Delete account & data', async () => {
        if (await confirmDialog('Delete account?', 'This removes your profile, saves and history on this demo instance.', { danger: true, confirmLabel: 'Delete' })) {
          setToken(null); localStorage.clear(); location.reload();
        }
      }, ''),
      h('p', { class: 'tiny muted', style: { margin: '10px 0 0' }, text: window.NBGBridge ? 'NearBuyGoods Android v1.1.0 · this app ships the same PWA + REST API as the web (docs/ANDROID.md).' : 'NearBuyGoods web v1.0 · PWA installable · same REST API powers the future iOS/Android apps (docs/ARCHITECTURE.md).' })));
  return root;
}
