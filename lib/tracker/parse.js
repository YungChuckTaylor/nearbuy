/**
 * NearBuyGoods Project Tracker — feature-document parser.
 *
 * Turns the NearBuyGoods feature audit (docs/FEATURE_AUDIT.md) — or the
 * original uploaded feature list, in HTML or Markdown — into structured,
 * importable rows:
 *
 *   { project: {...}, sections: [{ index, name, title, counts, items: [...] }] }
 *
 * Recognised shapes (both formats, any mix):
 *   ## 3. Store Discovery & Matching — ✓18 ◐11 ✗17
 *   - ✓ GPS detection · map view with pins · list view with distance
 *   - ◐ Deal-of-the-day (deals sorted by expiry, no curation)
 *   <h2>3. Store Discovery & Matching</h2><ul><li>✓ GPS detection</li></ul>
 *   | GPS detection | ✓ | notes |          (markdown/HTML tables)
 *
 * Status glyphs: ✓ shipped · ◐ partial · ✗ missing   (· and • separate items)
 * Zero dependencies — plain string work, safe to run on Vercel.
 */

const STATUS_GLYPH = { '✓': 'shipped', '✔': 'shipped', '☑': 'shipped', '◐': 'partial', '◑': 'partial', '◒': 'partial', '✗': 'missing', '✘': 'missing', '✕': 'missing', '×': 'missing' };
const GLYPHS = Object.keys(STATUS_GLYPH).join('');
const ITEM_SEP = /\s*[·•‧∙]\s*|\s+[|]\s+/; // middle dots / bullets used inside one audit line

/* ------------------------------------------------------------ utilities ---- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', check: '✓', times: '✗', middot: '·', radic: '√' };
export function decodeEntities(s = '') {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** Flatten HTML to markdown-ish text so one parser handles both inputs. */
export function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (m, lvl, inner) => `\n\n${lvl <= 2 ? '## ' : '### '}${inner}\n`);
  s = s.replace(/<li[^>]*>/gi, '\n- ');
  s = s.replace(/<\/li>/gi, '');
  s = s.replace(/<t[dh][^>]*>/gi, ' | ');
  s = s.replace(/<\/tr>/gi, '\n');
  s = s.replace(/<\/(p|div|section|article|ul|ol|table|h[1-6])>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

const clean = (s = '') => String(s).replace(/\s+/g, ' ').replace(/^[\s\-–—*•·:]+|[\s.:]+$/g, '').trim();
const titleCaseFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Pull a leading status glyph (and optional count) off a string. */
function takeStatus(s) {
  const t = String(s);
  const m = t.match(new RegExp(`^\\s*([${GLYPHS}])(?:\\s*(\\d+))?\\s*`));
  if (!m) return { status: null, text: t, count: null };
  return { status: STATUS_GLYPH[m[1]], text: t.slice(m[0].length), count: m[2] ? Number(m[2]) : null };
}

/** "— ✓18 ◐11 ✗17 — all left out by design" → counts + trailing note. */
function parseSectionHeader(raw) {
  let s = clean(raw);
  const counts = { shipped: 0, partial: 0, missing: 0 };
  // split the "✓18 ◐11 ✗17" tally off the heading
  const tally = s.match(new RegExp(`[—–-]?\\s*((?:[${GLYPHS}]\\s*\\d+\\s*)+)`));
  if (tally) {
    for (const m of tally[1].matchAll(new RegExp(`([${GLYPHS}])\\s*(\\d+)`, 'g'))) counts[STATUS_GLYPH[m[1]]] += Number(m[2]);
    s = s.replace(tally[0], ' ').trim();
  }
  // the tally may have lost its glyph ("✓5 ◐5 18") — drop a trailing lone number
  s = s.replace(/\s+\d{1,3}\s*$/, '').trim();
  let note = '';
  const dash = s.match(/[—–]\s*(.+)$/);
  if (dash) { note = clean(dash[1]); s = s.replace(/[—–]\s*.+$/, '').trim(); }
  // "3. Store Discovery & Matching" → index + name
  const num = s.match(/^(\d+)\s*[.)]\s*(.*)$/);
  const index = num ? Number(num[1]) : null;
  const name = clean(num ? num[2] : s);
  return { index, name, title: num ? `${index}. ${name}` : name, counts, note };
}

function makeFeature(section, text, status) {
  const t = clean(text);
  if (!t || t.length < 2) return null;
  if (/^(total|note|legend|reading the numbers)\b/i.test(t)) return null;
  if (t.length > 400) return null;
  const parenthetical = t.match(/\(([^)]{4,})\)\s*$/);
  return {
    section: section.name,
    section_index: section.index,
    area: section.name,
    detail: t,
    title: titleCaseFirst(parenthetical ? clean(t.replace(parenthetical[0], '')) || t : t),
    source_status: status, // shipped | partial | missing | null (from the source document)
    tags: ['audit'],
  };
}

/* --------------------------------------------------------------- parse ---- */

export function parseFeatureDoc(input, { defaultProject = {} } = {}) {
  const raw = String(input || '');
  const text = /<(h[1-6]|ul|ol|li|p|div|table)\b/i.test(raw) ? htmlToText(raw) : raw.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');

  const sections = [];
  let current = null;
  let docTitle = '';

  const pushSection = () => { if (current && (current.items.length || current.name)) sections.push(current); };

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    // headings: "## 3. Store Discovery — ✓18 ◐11 ✗17" or "### 7. Advanced Search"
    const head = t.match(/^#{1,4}\s*(.+)$/);
    if (head) {
      const h = clean(head[1]);
      const numbered = /^(\d+)\s*[.)]\s*\S/.test(h);
      const looksLikeSection = numbered || /^section\s+\d+/i.test(h);
      if (looksLikeSection) {
        pushSection();
        const meta = parseSectionHeader(h.replace(/^section\s+/i, ''));
        current = { ...meta, items: [], raw: h };
      } else if (!current) {
        docTitle = docTitle || h; // "# NearBuyGoods — Feature Audit…"
      } else {
        // Prose heading (addenda, "Reading the numbers", …) — close the section so
        // trailing paragraphs don't get swallowed as features.
        pushSection();
        current = null;
      }
      continue;
    }
    // bare numbered section without a hash (plain-text pastes)
    if (/^\d{1,2}\s*[.)]\s+\S/.test(t) && !t.startsWith('-') && t.length < 90 && !t.includes(' · ')) {
      pushSection();
      current = { ...parseSectionHeader(t), items: [], raw: t };
      continue;
    }
    if (!current) continue;

    // table rows: | Feature | ✓ | note |
    if (t.startsWith('|')) {
      const cells = t.split('|').map((c) => clean(c)).filter((c, i, a) => !(i === 0 && !c) && !(i === a.length - 1 && !c));
      if (!cells.length || /^-+$/.test(cells[0].replace(/[:\s-]/g, ''))) continue;
      const statusCell = cells.map((c) => takeStatus(c)).find((c) => c.status);
      const label = clean(cells[0]);
      if (!label || /^(feature|item|bullet|name)$/i.test(label)) continue;
      const f = makeFeature(current, label, statusCell?.status || null);
      if (f) current.items.push(f);
      continue;
    }

    // bullets / numbered items / plain lines
    const bullet = t.match(/^(?:[-*+]|\d+[.)])\s*(.+)$/);
    // Un-bulleted prose is a paragraph, not a feature (unless it is a status line).
    if (!bullet && !new RegExp(`^[${GLYPHS}]`).test(t) && t.length > 110) continue;
    const body = bullet ? bullet[1] : t;
    const head2 = takeStatus(body);
    const status = head2.status;
    const payload = head2.text;
    // A bullet can carry several items separated by '·'
    const parts = payload.split(ITEM_SEP);
    for (const p of parts) {
      const inner = takeStatus(p);
      const f = makeFeature(current, inner.text, inner.status || status);
      if (f) current.items.push(f);
    }
  }
  pushSection();

  // A few audit sections state counts but list no bullets (e.g. AR Features,
  // Future/Stretch). Keep them visible as one umbrella feature per section.
  for (const s of sections) {
    if (s.items.length) continue;
    const n = (s.counts.shipped || 0) + (s.counts.partial || 0) + (s.counts.missing || 0);
    if (!s.index || !n) continue;
    const f = makeFeature(s, `${s.name} — all ${n} planned items${s.note ? ` (${s.note.replace(/^all\s+/i, '')})` : ''}`, 'missing');
    if (f) s.items.push({ ...f, title: `${s.name} — ${n} planned items`, umbrella: true });
  }

  // Drop sections that produced nothing (prose headings, addenda).
  const kept = sections.filter((s) => s.items.length >= 1);
  const totals = {
    features: kept.reduce((a, s) => a + s.items.length, 0),
    shipped: kept.reduce((a, s) => a + s.items.filter((i) => i.source_status === 'shipped').length, 0),
    partial: kept.reduce((a, s) => a + s.items.filter((i) => i.source_status === 'partial').length, 0),
    missing: kept.reduce((a, s) => a + s.items.filter((i) => i.source_status === 'missing').length, 0),
  };
  return {
    project: {
      name: defaultProject.name || clean(docTitle.replace(/^NearBuyGoods\s*[—–-]\s*/i, '')) || 'NearBuyGoods',
      key: defaultProject.key || 'NBG',
      description: defaultProject.description || (docTitle ? `${docTitle} — imported ${new Date().toISOString().slice(0, 10)}` : 'Imported feature list'),
    },
    sections: kept.map((s) => ({ index: s.index, name: s.name, title: s.title, counts: s.counts, note: s.note || '', items: s.items })),
    totals,
  };
}

/** Parse and flatten straight into import rows for the tracker store. */
export function parseToImportRows(input, opts) {
  const parsed = parseFeatureDoc(input, opts);
  let n = 0;
  const rows = [];
  for (const s of parsed.sections) {
    for (const item of s.items) {
      n += 1;
      rows.push({ ...item, code: `${s.index ?? 0}.${String(n).padStart(3, '0')}`, section_title: s.title, position: n });
    }
  }
  return { ...parsed, rows };
}
