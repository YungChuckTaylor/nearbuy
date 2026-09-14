// Generates PWA icons (PNG) with zero dependencies: draws the NearBuyGoods pin
// mark (white pin, teal hand, orange + pink bags) on the brand navy background.
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
function encodePNG(w, h, rgba) {
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
const NAVY = [35, 44, 92];
const WHITE = [255, 255, 255];
const TEAL = [47, 188, 199];
const ORANGE = [232, 123, 41];
const PINK = [229, 106, 140];
const PURPLE = [124, 107, 200];

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const px = (x, y, c, a = 1) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // simple source-over blend
    for (let k = 0; k < 3; k++) buf[i + k] = Math.round(c[k] * a + buf[i + k] * (1 - a));
    buf[i + 3] = 255;
  };
  const s = size / 512;
  const dist = (x, y, cx, cy) => Math.hypot(x - cx, y - cy);
  // background
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) px(x, y, NAVY);
  // pin = circle + triangle, white
  const ccx = 256 * s, ccy = 226 * s, r = 148 * s;
  const inTri = (x, y) => y > ccy + 60 * s && y < 452 * s && Math.abs(x - ccx) < (452 * s - y) * 0.62;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (dist(x, y, ccx, ccy) <= r || inTri(x, y)) px(x, y, WHITE);
    }
  }
  // inner art (clipped to pin circle)
  const inside = (x, y) => dist(x, y, ccx, ccy) <= r - 6 * s;
  const rect = (x0, y0, w, h, c, rad = 10) => {
    for (let y = Math.floor(y0 * s); y < (y0 + h) * s; y++)
      for (let x = Math.floor(x0 * s); x < (x0 + w) * s; x++) {
        if (!inside(x, y)) continue;
        px(x, y, c);
      }
  };
  // bag handles (purple arcs)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!inside(x, y)) continue;
    const d1 = Math.abs(dist(x, y, 240 * s, 196 * s) - 34 * s);
    const d2 = Math.abs(dist(x, y, 292 * s, 202 * s) - 28 * s);
    if ((d1 < 6 * s && y < 200 * s) || (d2 < 5 * s && y < 206 * s)) px(x, y, PURPLE);
  }
  // bags
  rect(204, 186, 66, 84, ORANGE);
  rect(266, 196, 56, 74, PINK);
  // hand (teal): palm bar + thumb
  rect(176, 268, 150, 26, TEAL, 0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!inside(x, y)) continue;
    if (dist(x, y, 322 * s, 262 * s) <= 16 * s) px(x, y, TEAL);
    if (dist(x, y, 182 * s, 262 * s) <= 14 * s) px(x, y, TEAL);
  }
  return buf;
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [512, 192, 180]) {
  const name = size === 180 ? 'icon-180.png' : `icon-${size}.png`;
  fs.writeFileSync(path.join(OUT, name), encodePNG(size, size, draw(size)));
  console.log('wrote', name);
}
