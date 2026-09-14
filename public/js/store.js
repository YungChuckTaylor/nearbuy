// Global app state: session, prefs, location, meta + tiny event bus.
import { api, getToken, setToken } from './api.js';

export const DEFAULT_LOC = { lat: 6.5244, lng: 3.3792, label: 'Lagos, NG' };

export const state = {
  user: null,
  meta: null,
  loc: { ...DEFAULT_LOC },
  radius: 10,
  unread: 0,
  booted: false,
};

const listeners = {};
export const on = (ev, fn) => (listeners[ev] = listeners[ev] || []).push(fn);
export const emit = (ev, data) => (listeners[ev] || []).forEach((fn) => fn(data));

export function applyPrefs() {
  const p = state.user?.prefs || {};
  document.documentElement.style.setProperty('--font-scale', p.font_scale || 1);
  document.documentElement.classList.toggle('hc', !!p.high_contrast);
  document.body.classList.toggle('reduce-motion', !!p.reduce_motion);
  if (p.lat != null) state.loc = { lat: p.lat, lng: p.lng, label: p.loc_label || 'Lagos, NG' };
  state.radius = p.radius_km ?? 10;
}

export async function loadMeta() {
  try { state.meta = await api.get('/meta', { auth: false, cache: true }); } catch { state.meta = null; }
  return state.meta;
}

export async function loadSession() {
  if (!getToken()) { state.user = null; return null; }
  try {
    const { user } = await api.get('/auth/me', { cache: true });
    state.user = user;
  } catch {
    setToken(null);
    state.user = null;
  }
  applyPrefs();
  emit('auth', state.user);
  return state.user;
}

export async function savePrefs(patch, name) {
  if (!state.user) { // guest: keep locally
    const local = JSON.parse(localStorage.getItem('nbg_guest_prefs') || '{}');
    Object.assign(local, patch);
    localStorage.setItem('nbg_guest_prefs', JSON.stringify(local));
    state.user = { prefs: local, name: 'Guest', role: 'guest', stats: {}, badges: [], points: 0 };
    applyPrefs();
    emit('prefs', state.user.prefs);
    return;
  }
  Object.assign(state.user.prefs, patch);
  if (name) state.user.name = name;
  applyPrefs();
  emit('prefs', state.user.prefs);
  try { await api.put('/auth/prefs', { prefs: patch, name }); } catch { /* offline */ }
}

export function setLocation(loc, persist = true) {
  state.loc = loc;
  emit('loc', loc);
  if (persist) savePrefs({ lat: loc.lat, lng: loc.lng, loc_label: loc.label });
}

export function useGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation unsupported'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: +pos.coords.latitude.toFixed(4), lng: +pos.coords.longitude.toFixed(4), label: 'Current location' }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

export async function refreshUnread() {
  if (!state.user || !getToken()) { state.unread = 0; emit('unread', 0); return 0; }
  try {
    const { notifications } = await api.get('/notifications');
    state.unread = notifications.filter((n) => !n.read).length;
  } catch { state.unread = 0; }
  emit('unread', state.unread);
  return state.unread;
}

export const money = (n, currency) => {
  const c = currency || state.user?.prefs?.currency || state.meta?.currency || 'NGN';
  const sym = { NGN: '₦', USD: '$', GHS: 'GH₵', KES: 'KSh', GBP: '£' }[c] || `${c} `;
  return `${sym}${Number(n).toLocaleString('en-NG')}`;
};
