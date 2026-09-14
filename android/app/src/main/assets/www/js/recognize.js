// Client-side capture + signal extraction for the recognition pipeline.
// Real CNN inference is pluggable server-side (see docs/RESEARCH.md); the client
// extracts genuine signals: dominant colors (canvas quantization), filename
// tokens, optional BarcodeDetector decoding, and user hints.
import { h, sheet, toast, btn } from './ui.js';
import { ic } from './ui.js';

export function pickFile(accept = 'image/*') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => resolve(input.files?.[0] || null));
    document.body.append(input);
    input.click();
    setTimeout(() => input.remove(), 60e3);
  });
}

export async function downscale(blob, max = 720, quality = 0.72) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b || blob), 'image/jpeg', quality));
  } finally { URL.revokeObjectURL(url); }
}

export async function extractColors(blob, topN = 4) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 32, 32);
    const { data } = ctx.getImageData(0, 0, 32, 32);
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 120) continue;
      const key = (data[i] >> 5) << 10 | (data[i + 1] >> 5) << 5 | (data[i + 2] >> 5);
      const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2];
      buckets.set(key, e);
    }
    const sorted = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, topN);
    return sorted.map((e) => '#' + [e.r, e.g, e.b].map((v) => Math.round(v / e.n).toString(16).padStart(2, '0')).join(''));
  } finally { URL.revokeObjectURL(url); }
}

export async function detectBarcode(blob) {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const url = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] });
    const codes = await det.detect(img);
    URL.revokeObjectURL(url);
    return codes?.[0]?.rawValue || null;
  } catch { return null; }
}

// Live camera capture inside a bottom sheet (rear camera preferred).
export function cameraCapture() {
  return new Promise((resolve) => {
    let stream = null;
    const ctx = sheet('Point at the item', ({ close }) => {
      const video = h('video', { autoplay: true, playsinline: true, muted: true });
      const view = h('div', { class: 'camview' }, video, h('div', { class: 'frame' }), h('div', { class: 'scanline' }));
      const status = h('p', { class: 'small muted', style: { margin: '10px 0' }, text: 'Requesting camera…' });
      const actions = h('div', { class: 'row', style: { gap: '10px', marginTop: '6px' } },
        h('button', { class: 'btn outline grow', onclick: () => { close(); resolve(null); } }, 'Cancel'),
        h('button', { class: 'btn primary grow', id: 'snap', disabled: true, onclick: async () => {
          const c = document.createElement('canvas');
          c.width = video.videoWidth; c.height = video.videoHeight;
          c.getContext('2d').drawImage(video, 0, 0);
          const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
          close(); resolve(blob);
        } }, 'Capture'));
      const wrap = h('div', {}, view, status, actions);
      (async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          video.srcObject = stream;
          status.textContent = 'Frame the product inside the guide, then tap Capture.';
          actions.querySelector('#snap').disabled = false;
        } catch (e) {
          status.textContent = 'Camera unavailable here (permissions or browser). Use "Upload photo" instead — the native app gets full camera access.';
          view.remove();
        }
      })();
      return wrap;
    }, { onClose: () => { stream?.getTracks().forEach((t) => t.stop()); } });
    void ctx;
  });
}

export function sourcePicker(onPick) {
  return sheet('Add an item', ({ close }) => {
    const row = (iconName, title, sub, fn) => h('button', { class: 'listrow', onclick: () => { close(); fn(); } },
      h('span', { class: `ic ${iconName === 'camera' ? 'orange' : ''}` }, ic(iconName, 20)),
      h('span', { class: 'col grow' }, h('span', { class: 'bold', text: title }), h('span', { class: 'small muted', text: sub })),
      h('span', { class: 'chev' }, ic('chevR', 18)));
    return h('div', {},
      row('camera', 'Take a photo', 'Use the camera to identify any item', () => onPick('camera')),
      row('image', 'Upload photo', 'From your library — up to 10 images', () => onPick('file')),
      row('barcode', 'Scan barcode / QR', 'EAN, UPC, ISBN, QR codes', () => onPick('barcode')),
      row('link', 'Paste product URL', 'Identify from another website', () => onPick('url')),
      row('mic', 'Describe by voice', 'Speak what you are looking for', () => onPick('voice')),
      row('edit', 'Type a description', 'Free text or #tags', () => onPick('text')));
  });
}
