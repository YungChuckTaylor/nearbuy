/* Deployment config.
 * API_BASE = ''            → same-origin API (node server.js serving /public itself)
 * API_BASE = 'https://…'   → split deploy: static shell on shared hosting (Hostgator
 *                            cPanel public_html) + Node API hosted elsewhere (Render,
 *                            Railway, VPS…). CORS is already open on /api.
 * Edit the hardcoded line below after uploading when using a split deploy.
 *
 * Resolution order (first non-empty wins):
 *   1. ?api=…  URL param    — injected by the native Android wrapper (the server
 *      address you enter on first run / Profile → "App server address").
 *   2. localStorage 'nbg_api_base' — persisted copy of that param.
 *   3. window.NBG_CONFIG.API_BASE hardcoded below. */
window.NBG_CONFIG = window.NBG_CONFIG || {};
(function () {
  const C = window.NBG_CONFIG;
  if (typeof C.API_BASE !== 'string') C.API_BASE = '';
  let base = C.API_BASE;
  try {
    const param = (new URLSearchParams(location.search).get('api') || '').trim();
    const saved = localStorage.getItem('nbg_api_base') || '';
    base = param || saved || C.API_BASE;
    if (param && param !== saved) localStorage.setItem('nbg_api_base', param);
  } catch (e) { /* private mode etc. — fall back to hardcoded value */ }
  C.API_BASE = String(base || '').replace(/\/+$/, '');
})();
