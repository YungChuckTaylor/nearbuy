# Hosting NearBuyGoods on Vercel (free) — your app's permanent home

## The one-paragraph picture

Until now the NearBuyGoods server only existed **on your computer**, so your
phone could only reach it over your home Wi‑Fi. That's the confusion. Vercel
fixes it: it runs the same code in the cloud and gives you **one public
`https://…vercel.app` address** that serves *both* the website and the API.
You type that address into the Android app once (first-run dialog, or
Profile → App server address) and the app works from anywhere — mobile data,
any Wi‑Fi, any country. The browser version lives at the same address.

```
   Android app ──┐
                 ├──►  https://nearbuygoods-xyz.vercel.app
   any browser ──┘        │  website (static, from public/)
                          │  API /api/* (serverless function = your server.js)
                          └──► Vercel KV (free) — your database, survives restarts
```

Vercel is *serverless*: there is no always-on process and no disk, which is why
the repo now includes a tiny adapter (you don't touch it, it just works):

- `api/handler.js` — runs your existing `server.js` request handler as a function
- `vercel.json` — sends `/api/*`, `/pay/*`, `/webhooks/*` to that function and
  serves everything else straight from `public/`
- storage mode — on Vercel the whole database is kept as one compressed blob in
  **Vercel KV** (free store), so accounts, saves, reservations and receipts
  survive cold starts and redeploys. Without KV attached the site still works
  but resets to demo data whenever it idles — attach KV (step 3).

Everything local stays exactly as before: `node server.js` → localhost:3000.

---

## Step 1 — put the code on GitHub (≈4 min)

Vercel deploys from a GitHub repo. On your computer, in the `nearbuygoods`
folder (Git for Windows or any terminal):

```bash
git init
git add .
git commit -m "NearBuyGoods v1.1 + Android app + Vercel adapter"
```

Then on github.com: **New repository** (name `nearbuygoods`, private is fine),
and push:

```bash
git remote add origin https://github.com/<your-username>/nearbuygoods.git
git branch -M main
git push -u origin main
```

(No GitHub? `npx vercel` from the folder uploads directly — same result, but
GitHub gives you automatic redeploys on every push, which you'll want.)

## Step 2 — import into Vercel (≈2 min)

1. vercel.com → **Add New… → Project** → pick the `nearbuygoods` repo → **Import**.
2. Settings on the import screen: **Framework Preset: Other**. Leave Root
   Directory at the repo root (that's where `vercel.json` is). Node version
   default (20/22) is fine.
3. **Deploy.** First build takes ~30 s. You immediately get
   `https://nearbuygoods-<your-name>.vercel.app` — the site and API are live,
   in *reset-on-idle* mode until step 3.
4. Sanity check in a browser: the home page loads, and
   `https://…vercel.app/api/v1/meta` shows JSON.

## Step 3 — attach the free KV store so data persists (≈2 min)

1. In your Vercel project: **Storage → Create Database → KV (Upstash) →
   Create**, then **Connect** it to this project.
2. That automatically adds the `KV_REST_API_URL` / `KV_REST_API_TOKEN`
   environment variables (check Settings → Environment Variables).
3. **Deployments → Redeploy** (no git push needed).
   From now on accounts you create, saved items, collections, reservations and
   receipts survive forever (free tier: ~10 000 DB commands/day — far above
   demo/small-business traffic).

## Step 4 — set the secret key (≈1 min)

Settings → Environment Variables → add:

- `NBG_SECRET` = a long random string. Generate one:
  - Windows PowerShell: `-join(((48..57)+(65..90)+(97..122)) | Get-Random -Count 48 | ForEach-Object {[char]$_})`
  - macOS/Linux: `openssl rand -hex 32`
- Redeploy once more. (Without it the app falls back to a development secret —
  fine for tinkering, not for launch.)

Optional, same screen: `PAYSTACK_SECRET_KEY` (test key) to switch payments
from the built-in simulator to real Paystack test mode.

## Step 5 — connect your phone (≈1 min)

1. Open the NearBuyGoods Android app (the APK from `android/`).
2. First-run dialog — or **Profile → App server address** — enter your Vercel
   URL exactly, e.g. `https://nearbuygoods-<your-name>.vercel.app` → **Connect**.
3. Done. Log in (`shopper@nearbuygoods.app` / `demo1234`), search, scan,
   reserve. Works on mobile data with your computer switched off. 🎉

The browser/PWA version is the same URL — on your phone's browser menu choose
"Add to home screen" for the installable web twin.

## Good to know

- **Cold starts**: after ~15 min of nobody using it, the first tap takes
  1–2 s while Vercel wakes a function; everything after is instant.
- **Cost**: $0 on Vercel Hobby + $0 KV free tier for this traffic level.
- **Your data**: the KV blob holds whatever the app stores (demo market + your
  accounts). View/delete it any time in Vercel → Storage → KV → browser. Don't
  load real customer data until you've done the production hardening in
  `docs/ANDROID.md` §5 and set a real `NBG_SECRET`.
- **Custom domain** (e.g. `shop.nearbuygoods.app`): Project → Settings →
  Domains → add; then use *that* URL in the phone app. HTTPS is automatic.
- **Updates**: `git push` → Vercel redeploys automatically. The Android app
  needs no update — it talks to the URL, not to a build.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Website loads but every screen says offline / `/api/v1/meta` 404s | Deployment → **Functions** tab must list `api/handler.js`; if missing, check `vercel.json` committed at repo root, redeploy |
| Data resets to demo after idle | KV not connected (step 3): Settings → Env vars must show `KV_REST_API_*`, then Redeploy |
| Logged in, then "unauthorized" after a while | Same as above (ephemeral mode reseeded the users) — attach KV |
| `[kv] save failed` in Function logs | KV quota reached or store disconnected — open Storage → KV and reconnect |
| Phone app can't connect | URL must start `https://` with no trailing `/`; test the same URL in the phone *browser* first — if browser works, the app will |
| Slow first tap after idle | Normal cold start (see above) |

## And what about Hostgator now?

Nothing changed there (`docs/DEPLOY.md` still valid): Hostgator shared hosting
remains a good home for the *static shell* (Route B) or a full Node app if your
cPanel has "Setup Node.js App" (Route A). Vercel is simply the zero-cost,
zero-server-admin route that hosts **everything** in one URL — which is what
makes the phone app "just work" from anywhere.
