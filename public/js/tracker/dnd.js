/**
 * Pointer-based drag & drop engine for the tracker.
 *
 * Why hand-rolled: HTML5 drag events don't fire on touch, the CSP forbids
 * third-party libraries, and the product needs *multi-select* drags plus
 * cross-workspace drops. This engine uses Pointer Events, so mouse, touch and
 * pen all work, renders its own ghost + insertion line, auto-scrolls the
 * board, and exposes a keyboard fallback (Space to lift, arrows to move,
 * Enter to drop) for accessibility.
 *
 *   const dnd = createDnd({ onError });
 *   dnd.draggable(cardEl, () => ({ kind: 'features', ids: [f.id], label: f.title }));
 *   dnd.zone(colBodyEl, { key: `stage:${wsId}:${stage}`, axis: 'y', onDrop });
 */
import { toast } from './ui.js';

const noDragSelector = 'button, a, input, select, textarea, [data-no-drag]';

export function createDnd({ ghostClass = 'ghost-card' } = {}) {
  const drags = new WeakMap();  // element -> payload factory
  const zones = new WeakMap();  // element -> zone config

  let state = null;   // active drag
  let kb = null;      // keyboard drag

  const zoneList = () => [...document.querySelectorAll('[data-dnd-zone]')].map((el) => ({ el, cfg: zones.get(el) })).filter((z) => z.cfg);

  /* ------------------------------------------------------------ zones ---- */

  let lastHover = null;

  function zone(el, cfg) {
    zones.set(el, { axis: 'y', ...cfg });
    el.dataset.dndZone = cfg.key || 'zone';
    const enter = (e) => {
      lastHover = { el, at: Date.now(), x: e?.clientX, y: e?.clientY };
      if (state || kb) setZoneHover(el);
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerover', enter);
  }

  /** Nearest zone ancestor of the last hovered element (browsers, no hit-test API). */
  const hoveredZone = () => {
    if (!lastHover || Date.now() - lastHover.at > 800) return null;
    const zel = lastHover.el.closest?.('[data-dnd-zone]') || lastHover.el;
    const cfg = zones.get(zel);
    return cfg ? { el: zel, cfg } : null;
  };

  function draggable(el, payloadFactory, { handle = null } = {}) {
    drags.set(el, payloadFactory);
    el.dataset.dndDrag = '1';
    el.addEventListener('pointerdown', (e) => onPointerDown(e, el, handle));
    el.addEventListener('keydown', (e) => onKeyDown(e, el));
    return el;
  }

  /** Programmatic lift (used by the "Move to…" buttons). */
  function lift(payload, { el = document.activeElement } = {}) {
    const ghost = makeGhost(`${payload.label || 'item'}${payload.ids?.length > 1 ? ` +${payload.ids.length - 1}` : ''}`, payload.ids?.length || 1);
    kb = { payload, el, zoneEl: null, index: 0, ghost };
    ghost.style.left = '50%'; ghost.style.top = '12%'; ghost.style.transform = 'translateX(-50%)';
    document.body.append(ghost);
    document.body.classList.add('dragging', 'dragging-feature');
    const first = zoneList().find((z) => !z.cfg.accept || z.cfg.accept(payload));
    if (first) setZoneHover(first.el, 0);
    toast(`Lifted “${payload.label}” — arrows to move, Enter to drop, Esc to cancel`);
    return kb;
  }

  /* --------------------------------------------------- pointer dragging ---- */

  let pending = null;

  function onPointerDown(e, el, handle) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest(noDragSelector)) return;
    const payload = drags.get(el);
    if (!payload) return;
    const isTouch = e.pointerType !== 'mouse';
    const fromHandle = handle ? !!e.target.closest(handle) : false;
    if (isTouch && !fromHandle) {
      // Touch: hold briefly (or grab the handle) so vertical scrolling still works.
      pending = { e, el, longPress: setTimeout(() => { if (pending?.e === e) start(e, el, payload); }, 260), touch: true, moved: false };
    } else {
      pending = { e, el, startX: e.clientX, startY: e.clientY };
    }
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('pointerleave', onPendingLeave);
  }

  function onPendingLeave() { /* keep the pending gesture; pointer is captured globally */ }

  function onPointerMove(e) {
    if (pending && !state) {
      if (pending.touch) pending.moved = true;
      else if (Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY) > 6) start(e, pending.el, drags.get(pending.el));
      if (!state) return;
    }
    if (!state) return;
    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
    autoscroll(e);
    const found = hitTest(e.clientX, e.clientY);
    if (found) setZoneHover(found.el, found.index);
    else if (lastHover?.el?.isConnected === false) lastHover = null;
  }

  function start(e, el, payload) {
    clearTimeout(pending?.longPress);
    const p = typeof payload === 'function' ? payload() : payload;
    if (!p) return;
    window.removeEventListener('pointerleave', onPendingLeave);
    const count = p.ids?.length || 1;
    const ghost = makeGhost(p.label || 'item', count);
    const rect = el.getBoundingClientRect();
    state = { payload: p, el, ghost, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top, zoneEl: null, index: 0, startX: e.clientX, startY: e.clientY };
    el.classList.add('dragging');
    document.body.classList.add('dragging', 'dragging-feature');
    document.body.append(ghost);
    moveGhost(e.clientX, e.clientY);
    for (const { el: zel } of zoneList()) if (!zones.get(zel).accept || zones.get(zel).accept(p)) zel.classList.add('zone-ready');
  }

  function makeGhost(label, count) {
    const g = document.createElement('div');
    g.className = ghostClass;
    g.innerHTML = `<div class="ttl"></div>`;
    g.querySelector('.ttl').textContent = String(label).slice(0, 90);
    if (count > 1) { const b = document.createElement('span'); b.className = 'count'; b.textContent = `${count}`; g.append(b); }
    return g;
  }

  function moveGhost(x, y) {
    if (!state) return;
    const g = state.ghost;
    g.style.left = `${x - state.offsetX}px`;
    g.style.top = `${y - state.offsetY}px`;
  }

  function clearHover() {
    for (const el of document.querySelectorAll('.drop-target')) el.classList.remove('drop-target');
    for (const el of document.querySelectorAll('.drop-line')) el.remove();
    for (const el of document.querySelectorAll('.ws-item.drop-target, .ws-tab.drop-target')) el.classList.remove('drop-target');
  }

  function dropLinePosition(zoneEl, axis, index) {
    const children = [...zoneEl.querySelectorAll('[data-dnd-item]')];
    const line = document.createElement('div');
    line.className = 'drop-line';
    if (!children.length) { zoneEl.append(line); return; }
    const ref = children[Math.min(index, children.length - 1)];
    if (axis === 'x') { line.style.width = '3px'; line.style.height = 'auto'; line.style.alignSelf = 'stretch'; ref.parentElement.insertBefore(line, index >= children.length ? null : ref); }
    else if (index >= children.length) ref.parentElement.append(line);
    else ref.parentElement.insertBefore(line, ref);
  }

  function setZoneHover(el, index = null) {
    const cfg = zones.get(el);
    if (!cfg) return;
    const current = state || kb;
    if (!current || (cfg.accept && !cfg.accept(current.payload))) return;
    clearHover();
    el.classList.add('drop-target');
    const idx = index == null ? (cfg.axis === 'x' ? indexAtX(el, lastX) : indexAtY(el, lastY)) : index;
    dropLinePosition(el, cfg.axis, idx);
    if (state) { state.zoneEl = el; state.index = idx; }
    if (kb) { kb.zoneEl = el; kb.index = idx; }
  }

  let lastX = 0; let lastY = 0;

  function midpoints(el, axis) {
    return [...el.querySelectorAll('[data-dnd-item]')].map((child) => {
      const r = child.getBoundingClientRect();
      return axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2;
    });
  }

  const indexAtY = (el, y) => { const mids = midpoints(el, 'y'); return mids.findIndex((m) => y < m) === -1 ? mids.length : mids.findIndex((m) => y < m); };
  const indexAtX = (el, x) => { const mids = midpoints(el, 'x'); return mids.findIndex((m) => x < m) === -1 ? mids.length : mids.findIndex((m) => x < m); };

  function hitTest(x, y) {
    lastX = x; lastY = y;
    const payload = state?.payload || kb?.payload;
    const usable = (zel) => {
      const cfg = zones.get(zel);
      return cfg && (!cfg.accept || cfg.accept(payload)) ? { el: zel, cfg } : null;
    };
    // Preferred path: real hit testing (browsers, including touch).
    if (typeof document.elementsFromPoint === 'function') {
      for (const el of document.elementsFromPoint(x, y)) {
        const zel = el.closest?.('[data-dnd-zone]');
        const hit = zel && usable(zel);
        if (hit) return { el: hit.el, index: hit.cfg.axis === 'x' ? indexAtX(hit.el, x) : indexAtY(hit.el, y) };
      }
    } else if (typeof document.elementFromPoint === 'function') {
      const zel = document.elementFromPoint(x, y)?.closest?.('[data-dnd-zone]');
      const hit = zel && usable(zel);
      if (hit) return { el: hit.el, index: hit.cfg.axis === 'x' ? indexAtX(hit.el, x) : indexAtY(hit.el, y) };
    }
    // Fallback: the zone the pointer last entered (also covers headless runs).
    const hover = hoveredZone();
    if (hover && usable(hover.el)) return { el: hover.el, index: hover.cfg.axis === 'x' ? indexAtX(hover.el, x) : indexAtY(hover.el, y) };
    return null;
  }

  /* auto-scroll: the column under the pointer and the board horizontally */
  let scrollRaf = null;
  function autoscroll(e) {
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    const step = () => {
      scrollRaf = null;
      const scrollers = [];
      const under = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(e.clientX, e.clientY) : null;
      const col = e.target?.closest?.('.col-body') || under?.closest?.('.col-body');
      if (col) scrollers.push([col, 'y']);
      const board = document.querySelector('.board');
      if (board && board.scrollWidth > board.clientWidth) scrollers.push([board, 'x']);
      const main = document.querySelector('.main');
      if (main) scrollers.push([main, 'y']);
      for (const [el, axis] of scrollers) {
        const r = el.getBoundingClientRect();
        const speed = 16;
        if (axis === 'y') {
          if (e.clientY - r.top < 70) el.scrollTop -= speed;
          else if (r.bottom - e.clientY < 70) el.scrollTop += speed;
        } else {
          if (e.clientX - r.left < 70) el.scrollLeft -= speed;
          else if (r.right - e.clientX < 70) el.scrollLeft += speed;
        }
      }
    };
    if (e.clientX !== undefined) scrollRaf = requestAnimationFrame(step);
  }

  function endDrag(cancelled = false) {
    const current = state || kb;
    if (!current) return;
    const { payload, zoneEl, index, ghost } = current;
    ghost?.remove();
    document.body.classList.remove('dragging', 'dragging-feature');
    for (const el of document.querySelectorAll('.dragging')) el.classList.remove('dragging');
    for (const el of document.querySelectorAll('.zone-ready')) el.classList.remove('zone-ready');
    clearHover();
    state = null; kb = null;
    pending = null;
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    if (cancelled) return;
    if (!zoneEl) return;
    const cfg = zones.get(zoneEl);
    try { cfg?.onDrop?.(payload, { index, zone: zoneEl, key: zoneEl.dataset.dndZone }); } catch (err) { console.error('[dnd] drop failed', err); }
  }

  function onPointerUp() {
    clearTimeout(pending?.longPress);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    if (state) endDrag(false);
    else pending = null;
  }

  /* ------------------------------------------------- keyboard dragging ---- */

  function onKeyDown(e, el) {
    if (e.key !== ' ' && e.key !== 'Spacebar') {
      if (kb && (e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === 'Escape')) return handleKbKeys(e);
      return;
    }
    if (e.target.closest(noDragSelector)) return;
    e.preventDefault();
    const payload = drags.get(el)?.();
    if (payload) lift(payload, { el });
  }

  function handleKbKeys(e) {
    const zs = zoneList().filter((z) => !z.cfg.accept || z.cfg.accept(kb.payload));
    if (!zs.length) return;
    e.preventDefault();
    const idx = Math.max(0, zs.findIndex((z) => z.el === kb.zoneEl));
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' && e.altKey) { const n = zs[(idx + 1) % zs.length]; setZoneHover(n.el, 0); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' && e.altKey) { const n = zs[(idx - 1 + zs.length) % zs.length]; setZoneHover(n.el, 0); return; }
    if (e.key === 'ArrowDown') { setZoneHover(kb.zoneEl || zs[0].el, Math.min(kb.index + 1, (kb.zoneEl || zs[0].el).querySelectorAll('[data-dnd-item]').length)); return; }
    if (e.key === 'ArrowUp') { setZoneHover(kb.zoneEl || zs[0].el, Math.max(0, kb.index - 1)); return; }
    if (e.key === 'Enter') { endDrag(false); return; }
    if (e.key === 'Escape') endDrag(true);
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (state || kb)) { e.preventDefault(); endDrag(true); } });

  return { draggable, zone, lift, endDrag, get active() { return !!(state || kb); } };
}

/** Shared instance — every view registers its zones on this one engine. */
export const dnd = createDnd();
