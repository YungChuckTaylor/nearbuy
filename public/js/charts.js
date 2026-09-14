// Tiny SVG chart helpers (price history sparkline / line chart).
import { h } from './ui.js';

export function lineChart(container, series, { height = 150, color = '#e87b29', format = (v) => String(v), title = '' } = {}) {
  container.innerHTML = '';
  if (!series?.length) { container.append(h('p', { class: 'muted small', text: 'No history yet.' })); return; }
  const W = 640, H = height, padL = 8, padR = 8, padT = 18, padB = 22;
  const vals = series.map((s) => s.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => padL + (i / (series.length - 1 || 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - min) / span) * (H - padT - padB);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.width = '100%';
  const mk = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v2] of Object.entries(attrs)) e.setAttribute(k, v2); svg.append(e); return e; };
  // gridlines
  for (let i = 0; i <= 2; i++) mk('line', { x1: padL, x2: W - padR, y1: padT + (i / 2) * (H - padT - padB), y2: padT + (i / 2) * (H - padT - padB), stroke: '#eef0f6', 'stroke-width': 1.5 });
  const pts = series.map((s, i) => `${x(i)},${y(s.v)}`).join(' ');
  mk('path', { d: `M${x(0)},${y(series[0].v)} ${series.map((s, i) => `L${x(i)},${y(s.v)}`).join(' ')} L${x(series.length - 1)},${H - padB} L${x(0)},${H - padB} Z`, fill: color, opacity: .10 });
  mk('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  series.forEach((s, i) => mk('circle', { cx: x(i), cy: y(s.v), r: i === series.length - 1 ? 5.5 : 3, fill: i === series.length - 1 ? color : '#fff', stroke: color, 'stroke-width': 2.5 }));
  // labels
  const tMax = mk('text', { x: x(series.length - 1), y: y(max) - 8, 'text-anchor': 'end', 'font-size': 12, 'font-weight': 800, fill: '#68718a' });
  tMax.textContent = format(max);
  const tLast = mk('text', { x: x(series.length - 1), y: y(series[series.length - 1].v) - 10, 'text-anchor': 'end', 'font-size': 13, 'font-weight': 900, fill: color });
  tLast.textContent = format(series[series.length - 1].v);
  const t0 = mk('text', { x: padL, y: H - 6, 'font-size': 11, fill: '#98a0b5' }); t0.textContent = series[0].label || '';
  const t1 = mk('text', { x: W - padR, y: H - 6, 'text-anchor': 'end', 'font-size': 11, fill: '#98a0b5' }); t1.textContent = series[series.length - 1].label || '';
  const wrap = h('div', {});
  if (title) wrap.append(h('div', { class: 'tiny bold muted', style: { marginBottom: '4px' }, text: title }));
  wrap.append(svg);
  container.append(wrap);
}

export function sparkline(container, values, { color = '#2fbcc7', width = 120, height = 36 } = {}) {
  container.innerHTML = '';
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 4 - ((v - min) / span) * (height - 8)}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width); svg.setAttribute('height', height);
  const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  pl.setAttribute('points', pts); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', color); pl.setAttribute('stroke-width', 2.5); pl.setAttribute('stroke-linecap', 'round');
  svg.append(pl);
  container.append(svg);
}
