// Generates PWA icons (PNG) with zero dependencies: draws the NearBuyGoods pin
// mark (white pin, teal hand, orange + pink bags) on the brand navy background.
//
// The drawing primitives are exported so other tools can composite the same
// artwork — see website/tools/make-site-assets.mjs, which builds the landing
// page's favicons and social card from this exact mark.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'assets');

// ---------- tiny PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- brand palette ----------
export const NAVY = [35, 44, 92];
export const NAVY_2 = [46, 58, 117];
export const WHITE = [255, 255, 255];
export const TEAL = [47, 188, 199];
export const ORANGE = [232, 123, 41];
export const PINK = [229, 106, 140];
export const PURPLE = [124, 107, 200];

/**
 * Paint the NearBuyGoods mark — authored on a 512-unit grid — through a pixel
 * setter, so callers can composite it onto any canvas at any size.
 * @param {(x:number,y:number,c:number[],a?:number)=>void} px
 * @param {number} s   scale: 1 unit of the 512 grid = s pixels
 * @param {number} ox  x offset of the grid origin, in pixels
 * @param {number} oy  y offset of the grid origin, in pixels
 * @param {{pin?:number[],face?:number[],faceRadius?:number,clip?:(x:number,y:number)=>boolean}} opts
 */
export function paintMark(px, s, ox = 0, oy = 0, { pin = WHITE, face = WHITE, faceRadius = 142, clip = null } = {}) {
  const X = (v) => ox + v * s;
  const Y = (v) => oy + v * s;
  const put = (x, y, c) => { if (!clip || clip(x, y)) px(x, y, c); };
  const dist = (x, y, cx, cy) => Math.hypot(x - cx, y - cy);
  const ccx = X(256), ccy = Y(226), r = 148 * s;
  const tip = Y(452);
  const inTri = (x, y) => y > ccy + 60 * s && y < tip && Math.abs(x - ccx) < (tip - y) * 0.62;

  // pin body: disc + tapered point
  for (let y = Math.floor(ccy - r - 2); y <= Math.ceil(tip) + 2; y++) {
    for (let x = Math.floor(ccx - r - 2); x <= Math.ceil(ccx + r + 2); x++) {
      if (dist(x, y, ccx, ccy) <= r || inTri(x, y)) put(x, y, pin);
    }
  }

  // inner face (smaller radius leaves a coloured ring around the artwork)
  const k = faceRadius / 142;
  const fr = faceRadius * s;
  for (let y = Math.floor(ccy - fr); y <= Math.ceil(ccy + fr); y++) {
    for (let x = Math.floor(ccx - fr); x <= Math.ceil(ccx + fr); x++) {
      if (dist(x, y, ccx, ccy) <= fr) put(x, y, face);
    }
  }

  // artwork, scaled about the pin centre
  const ax = (v) => ccx + (v - 256) * s * k;
  const ay = (v) => ccy + (v - 226) * s * k;
  const inside = (x, y) => dist(x, y, ccx, ccy) <= fr - 5 * s;
  const box = (x0, y0, w, h, c) => {
    for (let y = Math.floor(ay(y0)); y < ay(y0 + h); y++)
      for (let x = Math.floor(ax(x0)); x < ax(x0 + w); x++) if (inside(x, y)) put(x, y, c);
  };

  // bag handles (purple arcs, upper halves only — the bags hide the rest)
  for (let y = 0; y < 1; y++) {
    const y0 = Math.floor(ay(156)), y1 = Math.ceil(ay(208));
    for (let yy = y0; yy <= y1; yy++) {
      for (let x = Math.floor(ax(160)); x <= Math.ceil(ax(340)); x++) {
        if (!inside(x, yy)) continue;
        const d1 = Math.abs(dist(x, yy, ax(240), ay(196)) - 34 * s * k);
        const d2 = Math.abs(dist(x, yy, ax(292), ay(202)) - 28 * s * k);
        if ((d1 < 6 * s * k && yy < ay(200)) || (d2 < 5 * s * k && yy < ay(206))) put(x, yy, PURPLE);
      }
    }
  }
  // bags
  box(204, 186, 66, 84, ORANGE);
  box(266, 196, 56, 74, PINK);
  // hand: palm bar + thumb + heel
  box(176, 268, 150, 26, TEAL);
  for (let y = Math.floor(ay(230)); y <= Math.ceil(ay(300)); y++) {
    for (let x = Math.floor(ax(160)); x <= Math.ceil(ax(340)); x++) {
      if (!inside(x, y)) continue;
      if (dist(x, y, ax(322), ay(262)) <= 16 * s * k) put(x, y, TEAL);
      if (dist(x, y, ax(182), ay(262)) <= 14 * s * k) put(x, y, TEAL);
    }
  }
}

/** Full icon tile: navy background + white pin mark. `radius` (0–1) rounds the corners. */
export function draw(size, { radius = 0, faceRadius = 142 } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size / 512;
  const rr = (radius * size) / 2;
  const inTile = (x, y) => {
    if (!radius) return true;
    const cx = Math.min(Math.max(x, rr), size - rr);
    const cy = Math.min(Math.max(y, rr), size - rr);
    return Math.hypot(x - cx, y - cy) <= rr;
  };
  const px = (x, y, c, a = 1) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    if (!inTile(x + 0.5, y + 0.5)) return;
    for (let k = 0; k < 3; k++) buf[i + k] = Math.round(c[k] * a + buf[i + k] * (1 - a));
    buf[i + 3] = 255;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) px(x, y, NAVY);
  paintMark(px, s, 0, 0, { faceRadius });
  return buf;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const size of [512, 192, 180]) {
    const name = size === 180 ? 'icon-180.png' : `icon-${size}.png`;
    fs.writeFileSync(path.join(OUT, name), encodePNG(size, size, draw(size)));
    console.log('wrote', name);
  }
}
