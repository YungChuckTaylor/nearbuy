/* Guard: if the shell is opened straight from the filesystem (file://), explain
   how to run the app instead of showing a blank splash. Classic script so it
   executes even where ES modules are blocked. */
(function () {
  if (location.protocol !== 'file:') return;
  function paint() {
    var s = document.getElementById('splash');
    if (!s) return;
    s.style.display = 'block';
    s.style.padding = '24px';
    s.innerHTML =
      '<div style="max-width:420px;margin:12vh auto;background:#fff;border:1px solid #e5e8f2;border-radius:18px;padding:22px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2433;box-shadow:0 10px 40px rgba(0,0,0,.12)">' +
      '<h1 style="font-size:1.25rem;margin:0 0 8px">NearBuyGoods needs its server running</h1>' +
      '<p style="margin:0 0 12px;font-size:.92rem;color:#68718a">You opened <b>index.html</b> directly from disk. This page is only the app shell — the logic and data live in the zero-dependency Node service that ships with it.</p>' +
      '<pre style="background:#232c5c;color:#ffd9b8;border-radius:12px;padding:12px 14px;font-size:.85rem;overflow:auto">cd nearbuygoods\nnode server.js</pre>' +
      '<p style="margin:0 0 6px;font-size:.92rem">Then open <b>http://localhost:3000</b> in this browser.</p>' +
      '<p style="margin:0;font-size:.8rem;color:#68718a">From another device on your network: http://&lt;this-computer’s-LAN-IP&gt;:3000 — or use an HTTPS tunnel (e.g. <code>cloudflared tunnel --url http://localhost:3000</code>) so camera, GPS and push work on phones.</p>' +
      '</div>';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
  else paint();
})();
