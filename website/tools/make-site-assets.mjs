// Landing-page raster assets, generated with zero dependencies from the same
// mark drawing used for the PWA icons (tools/make-icons.js).
//
//   node website/tools/make-site-assets.mjs
//
// Emits into website/assets/img/:
//   favicon-32.png, favicon-192.png, apple-touch-icon.png  (rounded navy tile + white pin)
//   og-image.png                                           (1200×630 social card)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG, paintMark, NAVY, NAVY_2, WHITE, TEAL, ORANGE, PINK, PURPLE } from '../../tools/make-icons.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'assets', 'img');
fs.mkdirSync(OUT, { recursive: true });

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function canvas(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  const px = (x, y, c, a = 1) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = ((y | 0) * w + (x | 0)) * 4;
    for (let k = 0; k < 3; k++) buf[i + k] = Math.round(c[k] * a + buf[i + k] * (1 - a));
    buf[i + 3] = Math.round(255 * a + buf[i + 3] * (1 - a));
  };
  const shape = (test, c, a = 1) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (test(x + 0.5, y + 0.5)) px(x, y, c, a);
  };
  const roundRect = (x0, y0, ww, hh, r, c, a = 1) => shape((x, y) => {
    const cx = Math.min(Math.max(x, x0 + r), x0 + ww - r);
    const cy = Math.min(Math.max(y, y0 + r), y0 + hh - r);
    return x >= x0 && x <= x0 + ww && y >= y0 && y <= y0 + hh && Math.hypot(x - cx, y - cy) <= r;
  }, c, a);
  const circle = (cx, cy, r, c, a = 1) => shape((x, y) => Math.hypot(x - cx, y - cy) <= r, c, a);
  return { buf, px, shape, roundRect, circle, w, h };
}

/* ---------------- app icon tiles (favicon / touch icon) ---------------- */
for (const [size, name] of [[32, 'favicon-32.png'], [180, 'apple-touch-icon.png'], [192, 'favicon-192.png']]) {
  const c = canvas(size, size);
  const s = size / 512;
  const r = size * 0.22;
  c.shape((x, y) => {
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    return Math.hypot(x - cx, y - cy) <= r;
  }, NAVY);
  paintMark(c.px, s, 0, 0, { pin: WHITE, face: WHITE, faceRadius: 132 });
  fs.writeFileSync(path.join(OUT, name), encodePNG(size, size, c.buf));
  console.log('wrote', name);
}

/* ---------------- social card ---------------- */
{
  const W = 1200, H = 630;
  const c = canvas(W, H);
  // navy gradient + brand glows
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = (x / W) * 0.45 + (y / H) * 0.55;
    c.px(x, y, mix(NAVY, NAVY_2, t));
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d1 = Math.hypot(x - 1130, y - 40) / 430;
    const d2 = Math.hypot(x - 60, y - 640) / 480;
    const d3 = Math.hypot(x - 700, y - 320) / 520;
    const g1 = Math.max(0, 1 - d1) ** 2 * 0.5;
    const g2 = Math.max(0, 1 - d2) ** 2 * 0.42;
    const g3 = Math.max(0, 1 - d3) ** 2 * 0.22;
    c.px(x, y, ORANGE, g1);
    c.px(x, y, TEAL, g2);
    c.px(x, y, NAVY_2, g3);
  }

  // faint "map" dot grid, like the discovery map inside the app
  for (let y = 40; y < H; y += 44) for (let x = 40; x < W; x += 44) {
    const cross = (x + y) % 132 < 44;
    c.circle(x, y, cross ? 4.5 : 2.5, WHITE, cross ? 0.14 : 0.07);
  }

  // product panels: two app cards + a floating orange CTA pill
  const panel = (x, y, w, h, a = 1) => c.roundRect(x, y, w, h, 26, WHITE, a);
  // left card — offer comparison
  panel(742, 372, 372, 210, 0.97);
  c.roundRect(772, 402, 64, 64, 18, mix(NAVY, WHITE, 0.92), 1);
  c.roundRect(852, 408, 150, 16, 8, mix(NAVY, WHITE, 0.72), 1);
  c.roundRect(852, 436, 96, 12, 6, mix(NAVY, WHITE, 0.86), 1);
  c.roundRect(772, 486, 316, 1, 0, mix(NAVY, WHITE, 0.9), 1);
  c.roundRect(772, 500, 120, 14, 7, mix(NAVY, WHITE, 0.78), 1);
  c.roundRect(940, 496, 148, 22, 11, ORANGE, 0.9);
  c.roundRect(772, 534, 200, 12, 6, mix(NAVY, WHITE, 0.86), 1);
  // right card — price history
  panel(1046, 168, 128, 176, 0.14);
  panel(714, 120, 300, 220, 0.97);
  c.roundRect(744, 148, 130, 14, 7, mix(NAVY, WHITE, 0.7), 1);
  c.roundRect(744, 172, 84, 11, 5, mix(NAVY, WHITE, 0.86), 1);
  // tiny price chart
  const pts = [[750, 300], [790, 274], [830, 288], [870, 246], [910, 258], [950, 216], [990, 200]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    for (let t = 0; t <= 1; t += 0.01) {
      const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      c.circle(x, y, 4, ORANGE, 0.95);
    }
  }
  for (const [x, y] of pts) c.circle(x, y, 6.5, ORANGE);
  c.roundRect(744, 316, 240, 1, 0, mix(NAVY, WHITE, 0.85), 1);

  // camera pill (the app's signature action)
  c.roundRect(742, 606, 372, 0, 0, ORANGE, 0);
  c.roundRect(986, 596, 0, 0, 0, ORANGE, 0);
  c.roundRect(88, 470, 336, 92, 30, ORANGE, 1);
  c.roundRect(112, 498, 36, 36, 12, WHITE, 0.92);
  c.roundRect(166, 506, 172, 16, 8, WHITE, 0.95);
  c.roundRect(166, 532, 116, 12, 6, WHITE, 0.7);

  // the mark, large, on a soft tile
  c.roundRect(70, 70, 400, 400, 96, WHITE, 0.07);
  paintMark(c.px, 400 / 512, 70, 52, { pin: WHITE, face: WHITE, faceRadius: 140 });

  // orange baseline
  c.roundRect(0, H - 14, W, 14, 0, ORANGE, 0.95);

  fs.writeFileSync(path.join(OUT, 'og-image.png'), encodePNG(W, H, c.buf));
  console.log('wrote og-image.png');
}
