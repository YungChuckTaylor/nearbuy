// First-run onboarding: 3 brand slides → permission priming → demo/guest entry.
import { h, btn, toast } from '../ui.js';
import { useGPS, setLocation, DEFAULT_LOC } from '../store.js';

const SLIDES = [
  {
    title: 'Upload any item.',
    body: 'Snap a photo, scan a barcode or describe it — NearBuyGoods identifies it in seconds with on-device signals plus server-side vision.',
    art: `<svg viewBox="0 0 200 200"><rect x="55" y="30" width="90" height="120" rx="16" fill="#2e3a75"/><rect x="65" y="44" width="70" height="86" rx="8" fill="#f6f7fb"/><circle cx="100" cy="142" r="6" fill="#2fbcc7"/><rect x="76" y="58" width="34" height="40" rx="6" fill="#e87b29"/><rect x="98" y="66" width="26" height="32" rx="6" fill="#e56a8c"/><path d="M84 58a8 8 0 0 1 16 0" stroke="#7c6bc8" stroke-width="4" fill="none"/><path d="M40 70h8M40 90h8M40 110h8M152 70h8M152 90h8M152 110h8" stroke="#2fbcc7" stroke-width="4" stroke-linecap="round"/></svg>`,
  },
  {
    title: 'Find it near you.',
    body: 'Live inventory and prices from verified stores inside your radius — map, list, distance and open-now status at a glance.',
    art: `<svg viewBox="0 0 200 200"><path d="M100 178s52-46 52-84a52 52 0 1 0-104 0c0 38 52 84 52 84z" fill="#fff"/><circle cx="100" cy="92" r="34" fill="#eef0fa"/><path d="M78 104h44v8H78z" fill="#2fbcc7"/><rect x="86" y="80" width="20" height="24" fill="#e87b29"/><rect x="104" y="86" width="16" height="18" fill="#e56a8c"/><circle cx="42" cy="52" r="10" fill="#2fbcc7" opacity=".5"/><circle cx="162" cy="120" r="14" fill="#2fbcc7" opacity=".3"/></svg>`,
  },
  {
    title: 'Compare. Save. Buy.',
    body: 'Side-by-side prices, price-drop alerts, reservations for pickup and deals from stores around you — all in one place.',
    art: `<svg viewBox="0 0 200 200"><rect x="30" y="50" width="140" height="34" rx="12" fill="#fff"/><rect x="30" y="94" width="104" height="34" rx="12" fill="#2fbcc7"/><rect x="30" y="138" width="122" height="34" rx="12" fill="#e87b29"/><circle cx="156" cy="111" r="14" fill="#fff"/><path d="m150 111 4 4 8-8" stroke="#0a7d5c" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg>`,
  },
];

export async function renderOnboarding(done) {
  const root = h('div', { class: 'onboard' });
  let idx = 0;
  const art = h('div', { class: 'art' });
  const title = h('h2');
  const body = h('p');
  const dots = h('div', { class: 'dots' }, SLIDES.map(() => h('i')));
  const next = h('button', { class: 'btn primary block' });

  const paint = () => {
    const s = SLIDES[idx];
    art.innerHTML = s.art;
    title.textContent = s.title;
    body.textContent = s.body;
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === idx));
    next.textContent = idx === SLIDES.length - 1 ? 'Get started' : 'Next';
  };
  const finish = async () => {
    localStorage.setItem('nbg_onboarded', '1');
    try {
      const loc = await useGPS();
      setLocation(loc);
      toast('Location set — showing stores near you', 'ok');
    } catch {
      setLocation({ ...DEFAULT_LOC });
    }
    done();
  };
  next.addEventListener('click', () => {
    if (idx < SLIDES.length - 1) { idx++; paint(); }
    else finish();
  });
  root.append(
    h('button', { class: 'skip', onclick: () => { localStorage.setItem('nbg_onboarded', '1'); done(); } }, 'Skip'),
    art, title, body, dots, next);
  paint();
  return root;
}
