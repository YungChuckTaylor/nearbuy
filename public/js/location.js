// Manual location entry: geocoded search (server proxy → Nominatim, offline
// gazetteer fallback), GPS, recent locations, and raw lat/lng entry.
import { h, sheet, toast, debounce } from './ui.js';
import { ic } from './ui.js';
import { api } from './api.js';
import { state, setLocation, useGPS, savePrefs } from './store.js';

export function locationSheet(onDone) {
  sheet('Set your location', ({ close }) => {
    const results = h('div');
    const input = h('input', { class: 'input', placeholder: 'Search city, area or address… e.g. Lekki Phase 1', inputmode: 'search', 'aria-label': 'Location search' });
    const recents = h('div', { class: 'chiprow' });
    const lat = h('input', { class: 'input', placeholder: 'Latitude e.g. 6.4398', inputmode: 'decimal' });
    const lng = h('input', { class: 'input', placeholder: 'Longitude e.g. 3.4219', inputmode: 'decimal' });

    const paintRecents = () => {
      recents.innerHTML = '';
      const recent = state.user?.prefs?.recent_locations || [];
      recent.forEach((r) => recents.append(h('button', { class: 'chip', onclick: () => pick(r, close) }, ic('clock', 14), r.label)));
    };
    const pick = (loc, closeFn) => {
      const recent = state.user?.prefs?.recent_locations || [];
      savePrefs({ recent_locations: [loc, ...recent.filter((x) => x.label !== loc.label)].slice(0, 5) });
      setLocation(loc);
      toast(`Location set to ${loc.label}`, 'ok');
      closeFn?.();
      onDone?.();
    };
    const search = debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) { results.innerHTML = ''; return; }
      results.innerHTML = '';
      results.append(h('div', { class: 'skeleton', style: { height: '44px' } }));
      try {
        const { results: rs, source } = await api.get(`/geo/geocode?q=${encodeURIComponent(q)}`, { auth: false, cache: true });
          results.innerHTML = '';
        if (!rs.length) results.append(h('p', { class: 'muted small', text: 'No match. Try a nearby area name, or enter coordinates below.' }));
        rs.forEach((r) => results.append(h('button', { class: 'listrow', onclick: () => pick({ lat: r.lat, lng: r.lng, label: r.label }, close) },
          h('span', { class: 'ic teal' }, ic('pin', 18)),
          h('span', { class: 'col grow' }, h('span', { class: 'bold small', text: r.label }), h('span', { class: 'tiny muted', text: `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}` })))));
        if (source === 'offline') results.append(h('p', { class: 'tiny muted', style: { marginTop: '6px' }, text: 'Offline gazetteer results (serviced cities).' }));
      } catch (e) { results.innerHTML = ''; results.append(h('p', { class: 'small', style: { color: 'var(--bad)' }, text: e.message })); }
    }, 350);
    input.addEventListener('input', search);

    paintRecents();
    return h('div', {},
      h('label', { class: 'field' }, h('span', { text: 'Current' }), h('div', { class: 'badge navy', style: { marginBottom: '8px' }, text: `${state.loc.label} · ${state.loc.lat}, ${state.loc.lng}` })),
      input,
      recents,
      results,
      h('div', { class: 'row', style: { gap: '10px', marginTop: '12px' } },
        h('button', {
          class: 'btn ghost grow', onclick: async () => {
            try { pick(await useGPS(), close); } catch { toast('GPS unavailable — search or type coordinates instead.', 'bad'); }
          },
        }, 'Use GPS'),
        h('button', {
          class: 'btn outline grow', onclick: () => {
            const a = Number(lat.value), b = Number(lng.value);
            if (isNaN(a) || isNaN(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return toast('Enter valid coordinates', 'bad');
            pick({ lat: a, lng: b, label: `Pinned ${a.toFixed(3)}, ${b.toFixed(3)}` }, close);
          },
        }, 'Set coordinates')),
      h('div', { class: 'row', style: { gap: '10px', marginTop: '10px' } }, lat, lng),
      h('p', { class: 'tiny muted', style: { marginTop: '10px' }, text: 'Stores, deals and alerts re-center instantly around your new point.' }));
  });
}
