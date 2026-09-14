// Dependency-free schematic map (SVG): works offline, in webview & native shell.
// Projects lat/lng equirectangularly into a stylized city grid with pins.
import { h } from './ui.js';

const W = 720, H = 520;

export function renderMap(container, { pins = [], user = null, radius_km = 10, onSelect } = {}) {
  container.innerHTML = '';
  const pts = [...pins.map((p) => ({ lat: p.lat, lng: p.lng })), ...(user ? [{ lat: user.lat, lng: user.lng }] : [])];
  if (!pts.length) pts.push({ lat: 6.5244, lng: 3.3792 });
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  const pad = 0.012;
  const minLa = Math.min(...lats) - pad, maxLa = Math.max(...lats) + pad;
  const minLo = Math.min(...lngs) - pad, maxLo = Math.max(...lngs) + pad;
  const x = (lng) => ((lng - minLo) / (maxLo - minLo || 1)) * (W - 120) + 60;
  const y = (lat) => H - (((lat - minLa) / (maxLa - minLa || 1)) * (H - 140) + 80);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Map of nearby stores');
  const add = (el, attrs) => { for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); svg.append(el); return el; };
  const el = (tag) => document.createElementNS('http://www.w3.org/2000/svg', tag);

  add(el('rect'), { x: 0, y: 0, width: W, height: H, fill: '#e9eef5' });
  // stylized street grid (deterministic)
  for (let i = 1; i < 7; i++) {
    add(el('line'), { x1: 0, y1: (H / 7) * i, x2: W, y2: (H / 7) * i - 26, stroke: '#ffffff', 'stroke-width': i % 3 === 0 ? 10 : 5, opacity: .9 });
    add(el('line'), { x1: (W / 7) * i, y1: 0, x2: (W / 7) * i + 20, y2: H, stroke: '#ffffff', 'stroke-width': i % 3 === 0 ? 10 : 5, opacity: .9 });
  }
  add(el('path'), { d: `M0 ${H - 60} Q ${W * .4} ${H - 130}, ${W} ${H - 40} L ${W} ${H} L 0 ${H} Z`, fill: '#cfe3ef', opacity: .8 }); // lagoon
  // parks
  add(el('circle'), { cx: W * .22, cy: H * .3, r: 46, fill: '#dcead9' });
  add(el('circle'), { cx: W * .78, cy: H * .62, r: 38, fill: '#dcead9' });

  // radius ring around user
  if (user) {
    const kmPerPxx = (maxLo - minLo) * 111.32 * Math.cos((user.lat * Math.PI) / 180) / (W - 120);
    const kmPerPxy = (maxLa - minLa) * 110.6 / (H - 140);
    const rx = radius_km / kmPerPxx, ry = radius_km / kmPerPxy;
    add(el('ellipse'), { cx: x(user.lng), cy: y(user.lat), rx: Math.min(rx, W), ry: Math.min(ry, H), fill: 'rgba(47,188,199,.10)', stroke: '#2fbcc7', 'stroke-width': 2, 'stroke-dasharray': '6 6' });
    const ug = el('g');
    const c1 = add(el('circle'), { cx: x(user.lng), cy: y(user.lat), r: 16, fill: 'rgba(47,188,199,.35)' });
    const anim = el('animate'); anim.setAttribute('attributeName', 'r'); anim.setAttribute('values', '10;22;10'); anim.setAttribute('dur', '2.4s'); anim.setAttribute('repeatCount', 'indefinite'); c1.append(anim);
    add(el('circle'), { cx: x(user.lng), cy: y(user.lat), r: 8, fill: '#2fbcc7', stroke: '#fff', 'stroke-width': 3 });
    void ug;
  }

  // pins
  pins.forEach((p, idx) => {
    const px = x(p.lng), py = y(p.lat);
    const g = el('g');
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `${p.label || 'Store'}${p.price ? ', ' + p.price : ''}`);
    g.style.cursor = 'pointer';
    const drop = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    drop.setAttribute('d', 'M0 0C-16 -22 -26 -30 -26 -44a26 26 0 1 1 52 0C26 -30 16 -22 0 0z');
    drop.setAttribute('fill', p.active ? '#e87b29' : '#232c5c');
    drop.setAttribute('stroke', '#ffffff');
    drop.setAttribute('stroke-width', '3');
    drop.setAttribute('transform', `translate(${px},${py})`);
    g.append(drop);
    const dot = el('circle');
    dot.setAttribute('cx', px); dot.setAttribute('cy', py - 44); dot.setAttribute('r', 6); dot.setAttribute('fill', '#fff');
    g.append(dot);
    if (p.price) {
      const label = el('g');
      const tw = String(p.price).length * 8.4 + 18;
      const r = el('rect');
      r.setAttribute('x', px - tw / 2); r.setAttribute('y', py - 84); r.setAttribute('width', tw); r.setAttribute('height', 24);
      r.setAttribute('rx', 12); r.setAttribute('fill', p.active ? '#e87b29' : '#ffffff'); r.setAttribute('stroke', '#e5e8f2');
      label.append(r);
      const t = el('text');
      t.setAttribute('x', px); t.setAttribute('y', py - 67); t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', '13'); t.setAttribute('font-weight', '800');
      t.setAttribute('fill', p.active ? '#fff' : '#232c5c');
      t.textContent = p.price;
      label.append(t);
      g.append(label);
    }
    const fire = () => onSelect?.(p, idx);
    g.addEventListener('click', fire);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); } });
    svg.append(g);
  });

  const wrap = h('div', { class: 'map-wrap' });
  wrap.append(svg);
  wrap.append(h('div', { class: 'map-legend', text: `${pins.length} store${pins.length === 1 ? '' : 's'} · ${radius_km} km radius` }));
  container.append(wrap);
}
