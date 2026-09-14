// DOM helpers, toasts, bottom sheets, dialogs.
import { icons } from './icons.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
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
export const ic = (name, size = 20) => {
  const s = document.createElement('span');
  s.style.display = 'inline-flex';
  s.innerHTML = icons[name] || '';
  const svg = s.firstElementChild;
  if (svg) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
  return s;
};
export const btn = (label, onClick, cls = 'btn', iconName = null) => {
  const b = h('button', { class: cls, onclick: onClick });
  if (iconName) b.append(ic(iconName, 18));
  b.append(document.createTextNode(label));
  return b;
};

export function toast(msg, type = '') {
  let wrap = document.querySelector('.toastwrap');
  if (!wrap) { wrap = h('div', { class: 'toastwrap', role: 'status', 'aria-live': 'polite' }); document.body.append(wrap); }
  const t = h('div', { class: `toast ${type}` }, ic(type === 'bad' ? 'alert' : type === 'ok' ? 'check' : 'spark', 18), msg);
  wrap.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, 3200);
}

export function sheet(title, build, opts = {}) {
  const scrim = h('div', { class: 'scrim' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  panel.append(h('div', { class: 'grab' }));
  if (title) panel.append(h('h3', { text: title }));
  const close = () => {
    scrim.classList.remove('show'); panel.classList.remove('show');
    setTimeout(() => { scrim.remove(); panel.remove(); }, 260);
    opts.onClose?.();
  };
  scrim.addEventListener('click', close);
  const ctx = { close, panel };
  const content = build(ctx);
  if (content) panel.append(content);
  document.body.append(scrim, panel);
  requestAnimationFrame(() => { scrim.classList.add('show'); panel.classList.add('show'); });
  return ctx;
}

export function confirmDialog(title, message, { danger = false, confirmLabel = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet(title, ({ close }) => {
      const wrap = h('div', {},
        h('p', { class: 'muted', style: { margin: '0 0 18px' }, text: message }),
        h('div', { class: 'row', style: { gap: '10px' } },
          h('button', { class: 'btn outline grow', onclick: () => { done = true; close(); resolve(false); } }, 'Cancel'),
          h('button', { class: `btn grow ${danger ? 'danger' : 'primary'}`, onclick: () => { done = true; close(); resolve(true); } }, confirmLabel)));
      return wrap;
    }, { onClose: () => { if (!done) resolve(false); } });
    void s;
  });
}

export const stars = (rating) => {
  const full = Math.round(rating);
  return h('span', { class: 'stars', 'aria-label': `${rating} out of 5 stars` },
    '★'.repeat(full) + `<span class="off">${'★'.repeat(Math.max(0, 5 - full))}</span>`);
};

export const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
};

export const emptyState = (emoji, title, sub, action) =>
  h('div', { class: 'empty' }, h('div', { class: 'ic', text: emoji }), h('h4', { text: title }), h('p', { class: 'small', text: sub }), action || null);

export const skeletonRows = (n = 4) => h('div', {}, Array.from({ length: n }, () => h('div', { class: 'skeleton', style: { height: '72px', marginBottom: '8px' } })));

export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export async function share(data) {
  if (navigator.share) { try { await navigator.share(data); return true; } catch { return false; } }
  try { await navigator.clipboard.writeText(data.url || data.text || ''); toast('Link copied to clipboard', 'ok'); return true; } catch { return false; }
}

export const stockBadge = (label) =>
  label === 'in_stock' ? h('span', { class: 'badge ok', text: 'In stock' })
    : label === 'low_stock' ? h('span', { class: 'badge warn', text: 'Low stock' })
      : h('span', { class: 'badge bad', text: 'Out of stock' });

export const openBadge = (open, label) => h('span', { class: `badge ${open ? 'ok' : 'bad'}`, text: label });
