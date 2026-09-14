// Core feature: item upload & AI recognition wizard.
// Steps: source → preview & signals → analyzing → refine → results.
import { h, toast, sheet, btn } from '../ui.js';
import { ic } from '../ui.js';
import { api } from '../api.js';
import { state, money } from '../store.js';
import { pickFile, downscale, extractColors, detectBarcode, cameraCapture, sourcePicker } from '../recognize.js';

export function renderUpload(params, nav) {
  const root = h('div', { style: { maxWidth: '560px', margin: '0 auto' } });
  const state_ = { blob: null, colors: [], barcode: null, text: '', filename: '', category: '', brand: '', condition: 'any', maxPrice: null, exact: true };

  const title = h('h1', { class: 'h1', text: 'Find an item' });
  const sub = h('p', { class: 'muted small', style: { margin: '-6px 0 16px' }, text: 'Photo, barcode, voice or text — we identify it and match stock at stores near you.' });
  const body = h('div');
  root.append(title, sub, body);

  const start = (mode) => {
    if (mode === 'camera') return cameraCapture().then((b) => b && gotImage(b, 'camera.jpg'));
    if (mode === 'file') return pickFile('image/*').then((f) => f && gotImage(f, f.name));
    if (mode === 'barcode') return pickFile('image/*').then(async (f) => {
      if (!f) return;
      const b = await downscale(f, 1200, 0.9);
      const code = await detectBarcode(b);
      if (code) { state_.barcode = code; toast(`Barcode detected: ${code}`, 'ok'); analyze(); }
      else { toast('No barcode found in that image — try a closer, well-lit shot.', 'bad'); gotImage(b, f.name); }
    });
    if (mode === 'url') return sheet('Paste product URL', ({ close }) => {
      const inp = h('input', { class: 'input', placeholder: 'https://shop.example.com/product…', inputmode: 'url' });
      return h('div', {}, inp, h('button', {
        class: 'btn primary block', style: { marginTop: '10px' }, onclick: () => {
          const u = inp.value.trim();
          if (!u) return;
          state_.text = u.split('/').pop().replace(/[-_+.]/g, ' ').replace(/%20/g, ' ');
          state_.filename = state_.text;
          close(); analyze();
        },
      }, 'Identify from URL'));
    });
    if (mode === 'voice') {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { toast('Voice input needs Chrome/Edge or the native app. Type instead:', 'bad'); return start('text'); }
      const rec = new SR();
      rec.lang = 'en-NG';
      toast('Listening… say what you want to find');
      rec.onresult = (e) => { state_.text = e.results[0][0].transcript; toast(`Heard: "${state_.text}"`); analyze(); };
      rec.onerror = () => { toast('Could not hear you — try typing instead.', 'bad'); start('text'); };
      rec.start();
      return;
    }
    if (mode === 'text') return sheet('Describe the item', ({ close }) => {
      const inp = h('textarea', { class: 'input', rows: 3, placeholder: 'e.g. black wireless earbuds with charging case, or #nike #sneakers #red' });
      return h('div', {}, inp, h('button', {
        class: 'btn primary block', style: { marginTop: '10px' }, onclick: () => { state_.text = inp.value; state_.filename = inp.value; close(); analyze(); },
      }, 'Identify'));
    });
  };

  const pickerUI = () => {
    body.innerHTML = '';
    const card = (iconName, t, s, mode, cls = '') => h('button', { class: 'listrow', onclick: () => start(mode) },
      h('span', { class: `ic ${cls}` }, ic(iconName, 20)),
      h('span', { class: 'col grow' }, h('span', { class: 'bold', text: t }), h('span', { class: 'small muted', text: s })),
      h('span', { class: 'chev' }, ic('chevR', 18)));
    body.append(h('div', { class: 'card' },
      card('camera', 'Take a photo', 'Point your camera at the item', 'camera', 'orange'),
      card('image', 'Upload from library', 'JPG/PNG, up to 10 images', 'file'),
      card('barcode', 'Scan barcode / QR', 'EAN · UPC · ISBN · QR', 'barcode', 'teal'),
      card('link', 'Paste product URL', 'Identify from any webshop', 'url'),
      card('mic', 'Voice description', 'Say it out loud', 'voice', 'orange'),
      card('edit', 'Type a description', 'Free text or #tags', 'text')));
    body.append(h('p', { class: 'tiny muted', style: { marginTop: '12px' }, text: 'Recognition runs on extracted signals (colors, tokens, barcode) matched against the live catalog. Production swaps in Google Vision Product Search / Clarifai — see docs/RESEARCH.md §2.' }));
  };

  async function gotImage(fileOrBlob, filename) {
    state_.filename = filename;
    const blob = await downscale(fileOrBlob);
    state_.blob = blob;
    body.innerHTML = '';
    const url = URL.createObjectURL(blob);
    const img = h('img', { src: url, alt: 'Selected item', style: { width: '100%', maxHeight: '300px', objectFit: 'cover', borderRadius: '16px', border: '1px solid var(--line)' } });
    const status = h('p', { class: 'small muted', text: 'Extracting on-device signals…' });
    body.append(h('div', { class: 'card' }, img, status,
      h('div', { class: 'row', style: { gap: '10px', marginTop: '12px' } },
        h('button', { class: 'btn outline grow', onclick: pickerUI }, 'Choose again'),
        h('button', { class: 'btn primary grow', onclick: analyze }, 'Identify item'))));
    try {
      state_.colors = await extractColors(blob);
      const code = await detectBarcode(blob);
      if (code) { state_.barcode = code; status.textContent = `Signals ready: ${state_.colors.length} colors + barcode ${code}`; }
      else status.textContent = `Signals ready: dominant colors ${state_.colors.join(', ')}`;
    } catch { status.textContent = 'Signals ready.'; }
  }

  function analyze() {
    body.innerHTML = '';
    body.append(h('div', { class: 'card', style: { textAlign: 'center', padding: '26px' } },
      h('div', { style: { fontSize: '2.2rem', marginBottom: '8px' }, text: '🤖' }),
      h('div', { class: 'bold', text: 'Analyzing item…' }),
      h('p', { class: 'small muted', style: { margin: '6px 0 14px' }, text: 'Matching colors, labels and shapes against the product graph' }),
      h('div', { class: 'progress' }, h('i'))));
    api.post('/recognize', {
      signals: { filename: state_.filename, text: state_.text, colors: state_.colors, barcode: state_.barcode, category: state_.category, brand: state_.brand },
      lat: state.loc.lat, lng: state.loc.lng,
    }).then((res) => refine(res)).catch((e) => { body.innerHTML = ''; body.append(h('p', { class: 'badge bad', text: e.message })); pickerUI(); });
  }

  function refine(res) {
    body.innerHTML = '';
    if (!res.candidates.length) {
      body.append(h('div', { class: 'card' },
        h('div', { class: 'bold', text: 'No confident match yet' }),
        h('p', { class: 'small muted', text: 'Add a hint below — category, brand or a few words — and we will re-run recognition.' }),
        hintForm(() => analyze())));
      return;
    }
    const top = res.candidates[0];
    const candList = h('div', {}, res.candidates.map((c, i) => h('button', {
      class: 'offer', style: { opacity: i === 0 ? '1' : '.85' },
      onclick: () => nav(`#/product/${c.product.id}`),
    },
      h('span', { class: 'emoji-tile sm', text: c.product.emoji || '📦' }),
      h('span', { class: 'col grow' },
        h('span', { class: 'bold small', text: c.product.name }),
        h('span', { class: 'tiny muted', text: `${c.product.brand} · matched: ${c.matched_on.join(', ') || 'visual similarity'}` }),
        h('span', { class: 'confidence', style: { marginTop: '6px' } },
          h('span', { class: 'bar' }, h('i', { style: { width: `${Math.round(c.confidence * 100)}%` } })),
          h('span', { class: 'tiny bold', text: `${Math.round(c.confidence * 100)}%` }))),
      h('span', { class: 'col', style: { alignItems: 'flex-end' } }, c.from_price ? h('span', { class: 'price small', text: money(c.from_price) }) : null, ic('chevR', 16)))));

    body.append(
      h('div', { class: 'card' },
        h('div', { class: 'row spread', style: { marginBottom: '8px' } },
          h('span', { class: 'bold', text: 'Is this your item?' }),
          h('span', { class: 'badge teal', text: `confidence ${Math.round(top.confidence * 100)}%` })),
        candList),
      h('div', { class: 'card' },
        h('div', { class: 'bold', style: { marginBottom: '10px' }, text: 'Refine your search' }),
        hintForm(() => analyze(), res),
        h('div', { class: 'row', style: { gap: '10px', marginTop: '6px' } },
          h('button', { class: 'btn primary grow', onclick: () => nav(`#/search?ids=${res.candidates.map((c) => c.product.id).join(',')}`) }, 'See offers nearby'),
          h('button', { class: 'btn outline grow', onclick: pickerUI }, 'Start over'))));
  }

  function hintForm(onSubmit, res) {
    const cat = h('select', { class: 'input' }, h('option', { value: '', text: 'Any category' }), ...(state.meta?.categories || []).map((c) => h('option', { value: c.id, text: c.name, selected: c.id === (res?.attributes?.category_guess || state_.category) })));
    const brand = h('input', { class: 'input', placeholder: 'Brand (optional)', value: state_.brand });
    const words = h('input', { class: 'input', placeholder: 'Add words: model, color, size…', value: state_.text });
    const exact = h('button', { class: `switch ${state_.exact ? 'on' : ''}`, role: 'switch', 'aria-label': 'Exact match only' });
    exact.addEventListener('click', () => { state_.exact = !state_.exact; exact.classList.toggle('on', state_.exact); });
    cat.addEventListener('change', () => (state_.category = cat.value));
    return h('div', {},
      h('label', { class: 'field' }, h('span', { text: 'Category' }), cat),
      h('label', { class: 'field' }, h('span', { text: 'Brand' }), brand),
      h('label', { class: 'field' }, h('span', { text: 'More details' }), words),
      h('div', { class: 'row spread' }, h('span', { class: 'small bold', text: 'Exact match only (vs. similar items)' }), exact),
      h('button', { class: 'btn ghost block', style: { marginTop: '12px' }, onclick: () => { state_.brand = brand.value; state_.text = words.value; onSubmit(); } }, 'Re-run recognition'));
  }

  const mode = params.get('mode');
  if (mode) start(mode); else pickerUI();
  return root;
}
