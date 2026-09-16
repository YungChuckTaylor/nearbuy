// NearBuyGoods app shell: hash router, top bar, bottom nav, PWA boot.
import { h, toast, ic } from './ui.js';
import { icons } from './icons.js';
import { api } from './api.js';
import { state, loadMeta, loadSession, refreshUnread, on } from './store.js';
import { renderOnboarding } from './pages/onboarding.js';
import { renderAuth } from './pages/auth.js';
import { renderHome } from './pages/home.js';
import { renderSearch } from './pages/search.js';
import { renderUpload } from './pages/upload.js';
import { renderProduct } from './pages/product.js';
import { renderStore } from './pages/storepage.js';
import { renderSaved } from './pages/saved.js';
import { renderAlerts } from './pages/alerts.js';
import { renderProfile } from './pages/profile.js';
import { renderBusiness } from './pages/business.js';
import { renderAdmin } from './pages/admin.js';
import { renderPremium } from './pages/premium.js';
import { locationSheet } from './location.js';

const ROUTES = [
  ['#/home', () => renderHome(nav)],
  ['#/search', (p) => renderSearch(p, nav)],
  ['#/upload', (p) => renderUpload(p, nav)],
  ['#/product/:id', (p, m) => renderProduct(m.id, nav)],
  ['#/store/:id', (p, m) => renderStore(m.id, nav)],
  ['#/saved', (p) => renderSaved(nav, p)],
  ['#/premium', (p) => renderPremium(p, nav)],
  ['#/alerts', () => renderAlerts(nav)],
  ['#/profile', () => renderProfile(nav)],
  ['#/business', () => renderBusiness(nav)],
  ['#/admin', () => renderAdmin(nav)],
  ['#/auth', () => renderAuth(() => nav(state.user?.role === 'store_owner' ? '#/business' : '#/home'))],
];

const NAV_ITEMS = [
  ['#/home', 'home', 'Home'],
  ['#/saved', 'bookmark', 'Saved'],
  ['#/upload', 'camera', 'Find'],
  ['#/alerts', 'bell', 'Alerts'],
  ['#/profile', 'user', 'Profile'],
];

let view, bottomNav, topLoc, bellDot, desktopNav;

export function nav(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}
export const rerender = () => route();

function matchRoute(hash) {
  const [path, queryStr] = hash.slice(1).split('?');
  const params = new URLSearchParams(queryStr || '');
  for (const [pattern, fn] of ROUTES) {
    const patPath = pattern.slice(1);
    const keys = [];
    const rx = new RegExp('^' + patPath.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    const m = rx.exec(path);
    if (m) {
      const match = {};
      keys.forEach((k, i) => (match[k] = decodeURIComponent(m[i + 1])));
      return { fn, params, match };
    }
  }
  return null;
}

function route() {
  const hash = location.hash || '#/home';
  const r = matchRoute(hash);
  if (!r) { nav('#/home'); return; }
  view.innerHTML = '';
  window.scrollTo({ top: 0 });
  view.append(r.fn(r.params, r.match));
  paintNav(hash.split('?')[0]);
  document.title = `NearBuyGoods · ${hash.split('?')[0].slice(2) || 'home'}`;
}

function paintNav(path) {
  [...bottomNav.children].forEach((b) => b.classList.toggle('active', b.dataset.hash === path));
  [...desktopNav.children].forEach((b) => b.classList.toggle('active', b.dataset.hash === path));
}

function buildShell() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  topLoc = h('button', { class: 'locchip', onclick: () => locationSheet(() => rerender()), 'aria-label': 'Change location' }, ic('pin', 15), h('span', { text: state.loc.label }));
  bellDot = h('span', { class: 'dot', style: { display: 'none' } });
  desktopNav = h('nav', { class: 'desktopnav', 'aria-label': 'Primary' }, NAV_ITEMS.map(([hash, , label]) => h('button', { 'data-hash': hash, onclick: () => nav(hash) }, label)));
  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'brand', onclick: () => nav('#/home'), 'aria-label': 'NearBuyGoods home' }, h('span', { html: icons.logo, style: { display: 'inline-flex', width: '26px', height: '26px' } }), 'NearBuyGoods'),
    desktopNav,
    h('span', { class: 'spacer' }),
    topLoc,
    h('button', { class: 'iconbtn', onclick: () => nav('#/alerts'), 'aria-label': 'Alerts' }, ic('bell', 22), bellDot));
  view = h('main', { class: 'view', id: 'view' });
  bottomNav = h('nav', { class: 'bottomnav', 'aria-label': 'Primary' }, NAV_ITEMS.map(([hash, iconName, label]) => {
    if (hash === '#/upload') {
      return h('button', { class: 'bnav bnav-fab', 'data-hash': hash, onclick: () => nav(hash), 'aria-label': 'Find an item' },
        h('span', { class: 'fab' }, ic('camera', 26)), h('span', { text: label }));
    }
    const b = h('button', { class: 'bnav', 'data-hash': hash, onclick: () => nav(hash) }, ic(iconName, 23), h('span', { text: label }));
    if (hash === '#/alerts') b.append(h('span', { class: 'pill', style: { display: 'none' } }));
    return b;
  }));
  app.append(topbar, view, bottomNav);
  app.hidden = false;
}

function paintUnread(n) {
  const pill = bottomNav?.querySelector('.bnav:nth-child(4) .pill');
  if (pill) { pill.style.display = n ? '' : 'none'; pill.textContent = n > 9 ? '9+' : n; }
  if (bellDot) bellDot.style.display = n ? '' : 'none';
}

async function boot() {
  await loadMeta();
  await loadSession();
  hideSplash(); // must clear before onboarding: splash (z-99) covers the tour (z-70)
  if (!localStorage.getItem('nbg_onboarded')) {
    const ob = await renderOnboarding(() => {
      document.querySelector('.onboard')?.remove();
      startApp();
    });
    document.body.append(ob);
    return;
  }
  startApp();
}

function hideSplash() {
  const splash = document.getElementById('splash');
  if (splash) { splash.classList.add('done'); setTimeout(() => splash.remove(), 400); }
}

function startApp() {
  buildShell();
  route();
  refreshUnread();
  window.addEventListener('hashchange', route);
  on('unread', paintUnread);
  on('loc', (l) => { topLoc.querySelector('span').textContent = l.label; });
  on('auth', () => { });
  // periodic alert refresh (stand-in for push while web is foregrounded)
  setInterval(() => refreshUnread(), 45e3);
  // PWA install prompt
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; setTimeout(() => toast('Tip: install NearBuyGoods from your browser menu for the app experience'), 4000); });
  window.addEventListener('appinstalled', () => toast('Installed! NearBuyGoods is on your home screen.', 'ok'));
  window.nbgInstall = async () => { if (deferred) { deferred.prompt(); deferred = null; } };
  // PWA service worker — skipped inside the native Android wrapper (window.NBGBridge):
  // the APK serves its own bundled assets and a WebView SW cache would go stale after app updates.
  if ('serviceWorker' in navigator && !window.NBGBridge) {
    navigator.serviceWorker.register('/sw.js').catch(() => { });
  }
  // hide splash
  hideSplash();
}

boot();
