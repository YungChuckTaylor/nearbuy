// Tracker UI primitives — DOM helper, icons, toasts, modals, sheets, confetti.
import { icons as appIcons } from '../icons.js';

export const ICONS = {
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.7"/><circle cx="12" cy="17" r=".8" fill="currentColor"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor"/><circle cx="15" cy="6" r="1.4" fill="currentColor"/><circle cx="9" cy="12" r="1.4" fill="currentColor"/><circle cx="15" cy="12" r="1.4" fill="currentColor"/><circle cx="9" cy="18" r="1.4" fill="currentColor"/><circle cx="15" cy="18" r="1.4" fill="currentColor"/>',
  board: '<rect x="3" y="4" width="6" height="16" rx="1.6"/><rect x="10" y="4" width="6" height="10" rx="1.6"/><rect x="17" y="4" width="4" height="13" rx="1.6"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  activity: '<path d="M3 12h4l2.5-6 4 12L16 12h5"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16.5 5.6a3.2 3.2 0 0 1 0 6.3M17 20a6.4 6.4 0 0 0-1.6-4.3"/>',
  upload: '<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/>',
  sparkle: '<path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9 12 3.5Z"/><path d="M19 4.5v3M17.5 6h3"/>',
  trash: '<path d="M4 7h16M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7"/><path d="M6.5 7l.8 12.2a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/>',
  link: '<path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
  download: '<path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5"/><path d="M4 17v1.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V17"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  comment: '<path d="M20 15.5A2.5 2.5 0 0 1 17.5 18H8l-4 3V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5Z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4.5V10h-5.5"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  flag: '<path d="M5 21V4.5"/><path d="M5 5h11l-1.6 3.5L16 12H5"/>',
  pencil: '<path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13l2.5 8v5.5A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5V13Z"/>',
  arrow_right: '<path d="M5 12h14m0 0-5.5-5.5M19 12l-5.5 5.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3.5 13 8.5 4.7L20.5 13"/>',
};

const svg = (name, size = 20) => {
  const src = ICONS[name] || appIcons?.[name] || '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${src}</svg>`;
};

/** h('div', {class, onclick, html, text, style}, ...children) — same as the app's helper. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const icon = (name, size = 20) => h('span', { class: 'ic', style: { display: 'inline-flex' }, html: svg(name, size) });
export const iconHtml = svg;

export const layer = () => document.getElementById('layer');
export const toasts = () => document.getElementById('toasts');

export function toast(message, { type = '', undo = null, ms = 3600, spinner = false } = {}) {
  const el = h('div', { class: `toast ${type}` });
  if (spinner) el.append(h('span', { class: 'spin' }));
  else el.append(icon(type === 'bad' ? 'x' : type === 'ok' ? 'check' : 'sparkle', 18));
  el.append(h('span', { text: message }));
  if (undo) el.append(h('button', { text: 'Undo', onclick: () => { undo(); el.remove(); } }));
  toasts().append(el);
  const ttl = undo ? Math.max(ms, 7000) : ms;
  setTimeout(() => { el.style.transition = 'opacity .25s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 260); }, ttl);
  return { close: () => el.remove() };
}

const onEsc = (fn) => {
  const handler = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fn(); } };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
};

/** Centered modal. `build({close})` returns the body element. */
export function modal(title, build, { wide = false, footer = null, onClose } = {}) {
  const scrim = h('div', { class: 'scrim' });
  const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => { scrim.classList.remove('show'); box.classList.remove('show'); setTimeout(() => { scrim.remove(); box.remove(); }, 180); off(); onClose?.(); };
  const off = onEsc(close);
  scrim.addEventListener('click', close);
  const body = h('div', { class: 'modal-body' });
  box.append(h('div', { class: 'modal-head' }, h('h3', { text: title }), h('span', { class: 'spacer' }),
    h('button', { class: 'icon-btn', 'aria-label': 'Close', html: svg('x', 20), onclick: close })));
  const content = build({ close });
  if (content) body.append(content);
  box.append(body);
  if (footer) box.append(h('div', { class: 'modal-foot' }, typeof footer === 'function' ? footer({ close }) : footer));
  layer().append(scrim, box);
  requestAnimationFrame(() => { scrim.classList.add('show'); box.classList.add('show'); });
  setTimeout(() => box.querySelector('input, textarea, select, button')?.focus(), 60);
  return { close, box };
}

/** Right-hand detail panel (feature details, workspace settings). */
export function sheet(title, build, { onClose } = {}) {
  const scrim = h('div', { class: 'scrim' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => { scrim.classList.remove('show'); panel.classList.remove('show'); setTimeout(() => { scrim.remove(); panel.remove(); }, 220); off(); onClose?.(); };
  const off = onEsc(close);
  scrim.addEventListener('click', close);
  const body = h('div', { class: 'sheet-body' });
  panel.append(h('div', { class: 'modal-head' }, h('h3', { text: title }), h('span', { class: 'spacer' }),
    h('button', { class: 'icon-btn', 'aria-label': 'Close', html: svg('x', 20), onclick: close })), body);
  const content = build({ close, panel });
  if (content) body.append(content);
  layer().append(scrim, panel);
  requestAnimationFrame(() => { scrim.classList.add('show'); panel.classList.add('show'); });
  return { close, panel };
}

export function confirmDialog(title, message, { confirmLabel = 'Confirm', danger = true } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const { close } = modal(title, () => h('p', { class: 'muted', style: { margin: 0 }, text: message }), {
      footer: ({ close: c }) => [
        h('button', { class: 'btn ghost', text: 'Cancel', onclick: () => { answered = true; c(); resolve(false); } }),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, text: confirmLabel, onclick: () => { answered = true; c(); resolve(true); } }),
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
    void close;
  });
}

export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
export const avatar = (person, size = '') => h('span', { class: `av ${size}`, style: { background: person?.color || '#5c6ac4' }, text: initials(person?.name || person), title: person?.name || '' });

export const timeAgo = (iso) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function confetti(n = 26) {
  const colors = ['#e87b29', '#2fbcc7', '#7c5cff', '#e56a8c', '#0a7d5c'];
  for (let i = 0; i < n; i += 1) {
    const p = h('i', { class: 'confetti' });
    p.style.left = `${Math.random() * 100}vw`;
    p.style.top = '-16px';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.25}s`;
    p.style.animationDuration = `${1.1 + Math.random() * 0.7}s`;
    document.body.append(p);
    setTimeout(() => p.remove(), 2400);
  }
}

/** Small sparkline / bar chart used by the overview (self-contained SVG). */
export function sparkline(values, { width = 260, height = 46, color = '#2fbcc7', fill = true } = {}) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 5 - (v / max) * (height - 12)).toFixed(1)}`);
  return h('div', { html: `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none">
    ${fill ? `<path d="M0,${height} L${pts.join(' L')} L${width},${height} Z" fill="${color}" opacity=".12"/>` : ''}
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>` });
}

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
