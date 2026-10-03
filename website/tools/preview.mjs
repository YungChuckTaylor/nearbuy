// Standalone preview server for the landing page — handy while designing,
// because `node server.js` serves the site under /website while this one puts
// it at the root.
//
//   node website/tools/preview.mjs      →  http://localhost:8080
//
// (The real deployment serves the page at /website from server.js; this is only
// a convenience shim and is never used in production.)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  p = p.replace(/^\/website/, '');            // mirror the deployed prefix
  if (p === '' || p === '/') p = '/index.html';
  const full = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found: ' + p); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => console.log(`landing preview → http://0.0.0.0:${PORT}`));
