# Deploying NearBuyGoods — step by step

> **Fastest free route (recommended):** Vercel hosts the *whole* app — website +
> API + persistent database — at one `https://…vercel.app` URL, and the Android
> app points straight at it. Guide: **[`docs/VERCEL.md`](VERCEL.md)**.
> The Hostgator routes below remain valid alternatives (single-host shared
> hosting, or shell-here/API-there splits).

# Deploying NearBuyGoods to Hostgator (cPanel) — step by step

## 0. Know which shape your Hostgator plan supports

The app = **static PWA (`public/`)** + **Node.js API (`server.js`, zero npm deps)**.
Hostgator *shared* hosting serves static/PHP out of the box; Node only runs if your
cPanel includes **"Setup Node.js App"** (CloudLinux/Passenger). In cPanel's search box
type `node`:

- **You see "Setup Node.js App"** → Route A (everything on Hostgator, one host).
- **You don't** → Route B (shell on Hostgator, API on a free Node host) or Route C
  (Hostgator VPS / any VPS: plain `node server.js` behind nginx/Apache proxy).

Routes B/C need no code changes beyond one config line (B). CORS on `/api` is already
`Access-Control-Allow-Origin: *`, and auth is bearer-JWT (no cookies), so a split
origin works cleanly.

---

## Upload mechanics (common to all routes)

1. **Zip correctly, locally:**
   - Route A: zip the *whole* `nearbuygoods` folder **excluding `node_modules/`**
     (jsdom was dev-only) and `data/` (it reseeds itself).
   - Route B: zip only the **contents of `public/`**.
2. **cPanel → File Manager** → navigate to target dir → **Upload** → pick the zip →
   right-click → **Extract**. (Alternatives: FTP via FileZilla with your cPanel
   credentials on port 21, or cPanel → Git Version Control if the repo is on GitHub.)
3. Target directories:
   - Main domain: `public_html/`
   - Subdomain (recommended, e.g. `shop.yourdomain.com`): create it in cPanel →
     Domains → it gets its own folder like `public_html/shop/` … or a sibling dir.
4. Keep Node app code **outside `public_html`** when possible (e.g. `~/nbg/`) so
   `server.js`, `seed/`, `data/` are never web-reachable. Only `public/` belongs in
   the web root (Route B) or is mapped by Passenger (Route A).

---

## Route A — cPanel "Setup Node.js App" (single host)

1. Upload+extract the full folder to `~/nbg` (home directory, not public_html).
2. cPanel → **Setup Node.js App** → **Create Application**:
   - Node.js version: **18 / 20 / 22** (whatever ≥18 is offered)
   - Application mode: **Production**
   - Application root: `nbg`
   - Application URL: your domain or subdomain
   - Application startup file: `server.js`
3. Create → **Start** (Passenger assigns `PORT` automatically; `server.js` honours it
   and binds 0.0.0.0).
4. Optional env vars in the same screen: `PAYSTACK_SECRET_KEY`, `NBG_SECRET`
   (JWT signing — set a long random string in production).
5. Permissions: `data/` must be writable (File Manager → right-click → Change
   Permissions → 775). The JSON store + VAPID keys live there.
6. Visit the URL. If Passenger shows a startup error, cPanel → the app's log link
   (or `~/logs/`) shows the Node stderr.

Notes: `server.js` also serves `public/` itself in this route, so `.htaccess` is
unused; hash-routing means no rewrite rules are needed anywhere.

---

## Route B — static shell on Hostgator + Node API elsewhere

When shared cPanel has no Node selector, host the two halves separately:

1. **API first** (free tier fine): Render / Railway / Fly.io / any VPS.
   - Render: New → Web Service → repo or zip upload → Build command: *(leave empty)*
     → Start command: `node server.js` → add env `NBG_SECRET`, optional
     `PAYSTACK_SECRET_KEY`. You get `https://nbg-api.onrender.com`.
2. **Shell on Hostgator:** upload the contents of `public/` into `public_html/`
   (or subdomain folder). The bundled `.htaccess` handles caching + fallback.
3. **Point the shell at the API:** edit `public_html/js/config.js`:
   ```js
   window.NBG_CONFIG = { API_BASE: 'https://nbg-api.onrender.com' };
   ```
4. Force HTTPS on the shell (cPanel → SSL/TLS Status → AutoSSL / Let's Encrypt) —
   camera, GPS and Web Push require a secure context.
5. Paystack test checkout still works: `checkout_url` is built absolute against the
   API host, and the return deep-link uses the page origin.

Trade-offs vs Route A: two deployments to update; API free tiers sleep after idle
(first request slow). Data (users, saves) lives on the API host's disk/volume.

---

## Route C — Hostgator VPS / any VPS

```bash
# as root or sudo
apt install nodejs npm || true        # or nvm for Node 20
mkdir -p /srv/nbg && cd /srv/nbg      # unzip upload here
NBG_SECRET=$(openssl rand -hex 32) node server.js   # test
# then keep it alive: systemd unit or pm2
npm i -g pm2 && pm2 start server.js --name nbg && pm2 save
# Apache reverse proxy (or nginx): ProxyPass / http://127.0.0.1:3000/
```
Put it behind HTTPS (certbot) and proxy the domain to port 3000.

---

## Post-deploy checklist

- [ ] `https://yourdomain/` shows onboarding slides (not a blank splash)
- [ ] Log in with `shopper@nearbuygoods.app / demo1234`, search "rice"
- [ ] Browser console: no CSP/mixed-content errors
- [ ] PWA: install prompt appears (HTTPS + manifest + SW)
- [ ] Push: Profile → enable push (HTTPS only)
- [ ] Payments: `#/premium` shows **Paystack TEST mode** badge until keys are set
- [ ] `https://yourdomain/api/docs` lists 46 endpoints (Route A/C only; on Route B
      use `https://<api-host>/api/docs`)

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Blank page, broken logo | Opened `index.html` as a file, or assets uploaded with wrong paths — check `public_html/js/app.js` returns 200 |
| 404 on `/api/...` (Route A) | Passenger app not started, or Application URL mapped to a subfolder — restart app in Node.js App screen |
| `data/db.json` not saving | `data/` permissions — chmod 775, owner = your cPanel user |
| Push/camera denied on phone | Not HTTPS, or LAN-IP http — enable AutoSSL / use tunnel |
| CORS error (Route B) | `config.js` API_BASE typo (no trailing slash) |
| 500 after login with custom `NBG_SECRET` change | Old tokens invalid — log in again |
