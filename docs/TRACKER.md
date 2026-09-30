# NearBuyGoods Project Tracker

**Your feature audit, turned into a live, database-driven planning board.**
Create a workspace called *MVP features*, then fill it by dragging features in —
from the backlog, from another workspace, or in bulk with a selection.

```
   /tracker          ← the board lives here (same deploy as the PWA + API)
        │
        ├── Backlog ......... all 389 rows parsed from the feature document,
        │                     filterable / searchable / multi-selectable
        ├── Board ........... one board per workspace (MVP features, your own…)
        │                     drag cards between columns, tab to another board
        ├── Auto-plan ....... rule-based bulk add ("every missing §1–§3 feature")
        ├── Import .......... re-import the doc (HTML/Markdown paste or drop)
        └── Database ........ Neon Postgres · Vercel KV · local file — auto-detected
```

---

## 1. Open it

| Where | How |
|---|---|
| Local | `node server.js` → **http://localhost:3000/tracker** |
| Vercel | `https://<your-app>.vercel.app/tracker` |
| Main app | Profile → **Project tracker** opens it in a new tab |

First visit offers three doors:

- **Try the demo** — one tap creates a guest session on the shared project
  (no signup). Enabled when demo mode is on (local dev + Vercel previews).
- **Sign in** — `pm@nearbuygoods.app` / `demo1234` in demo mode.
- **Create account** — your own private project; the feature document is
  imported automatically so you start with the full backlog.

---

## 2. The core loop (what to try first)

1. **Backlog** → type in the search box, or pick a section (`3. Store Discovery`).
2. **Select three features** (checkboxes) → the black bulk bar appears →
   **Add to workspace…** → choose *MVP features* + *Up next* → **Add**.
3. Or just **drag**: grab the ⠿ handle of a row and drop it on **MVP features**
   in the sidebar. On a phone, press and hold the row first (or use the handle).
4. **Board** → drag a card from *Backlog* to *In progress*. Dragging into
   **Done** marks the feature **Shipped** (and throws confetti).
5. **⌘K** (Ctrl+K) → search every feature, jump to a workspace, or run a command.
6. Select several cards on the board and drag them together — they move as a group.

Everything is written to the database immediately and every other viewer sees it
(live stream when the server is long-running, 15-second polling on Vercel).

---

## 3. Workspaces

A workspace is a board (or a list) that you fill with features. Every project
starts with three:

| Workspace | Purpose |
|---|---|
| 🚀 **MVP features** | the smallest set that proves the core loop |
| 🧭 **Next release** | committed for the release after MVP |
| 🧊 **Ideas / icebox** | parked ideas, revisit at planning |

Create as many as you want (**N** or the **New workspace** button). Each board
has five columns — *Backlog · Up next · In progress · Review · Done* — and an
optional **WIP limit** that warns when a column is overloaded.

**Four ways to add a feature to a workspace**

| Gesture | Where |
|---|---|
| Drag a row from the backlog | onto a sidebar workspace, a board tab, or a column |
| Drag a card | between columns, or onto another workspace tab (moves it) |
| Select + **Add to workspace…** | bulk bar (multi-select) |
| **Add features** / **+** on a column | picker with search, adds many at once |

**Auto-plan** scopes a workspace from rules: sections, audit state
(✓ built / ◐ partial / ✗ to build), priority and a cap. It previews what would
move in before you commit.

Removing: drag a card onto **Backlog** in the sidebar, open the card and
**Remove from workspace**, or **Clear this board** on the board footer.

---

## 4. Keyboard, mouse and touch

| Input | Action |
|---|---|
| `⌘K` / `Ctrl+K` | command palette (search + actions) |
| `Space` on a focused card | lift it, then `←` `→` columns, `↑` `↓` position, `Enter` drop, `Esc` cancel |
| `⌘Z` / `Ctrl+Z` | undo the last change |
| `N` `B` `M` `I` | new workspace · backlog · board · import |
| `?` | shortcut sheet |
| Drag | mouse anywhere on a card; touch: long-press or the ⠿ handle |
| Shift-click | extend a selection (then drag the group) |

---

## 5. Where the data lives (Vercel-friendly)

The tracker picks its storage automatically — no code changes between
environments:

| # | Driver | Attached when | What it creates |
|---|---|---|---|
| 1 | **Neon Postgres** (Vercel Marketplace) | `DATABASE_URL` (also accepts `POSTGRES_URL`, `NEON_DATABASE_URL`, `TRACKER_DATABASE_URL`) | real SQL tables `nb_trk_accounts`, `nb_trk_projects`, `nb_trk_workspaces`, `nb_trk_features`, `nb_trk_placements`, `nb_trk_comments`, `nb_trk_activity`, `nb_trk_invites`, `nb_trk_members` (created + indexed on first request) |
| 2 | **Vercel KV / Upstash** | `KV_REST_API_URL` + `KV_REST_API_TOKEN` | one gzip'd JSON document at `nbg:tracker:v1` |
| 3 | **Local file** | `node server.js` | `.data/tracker.json` (git-ignored) |
| — | **In-memory** | Vercel with nothing attached | works, but resets on every cold start (the UI shows a ⚠️) |

Neon is reached over its **HTTP SQL endpoint** (`POST https://<host>/sql`) with
plain `fetch` — the repo stays dependency-free, and it works from serverless
functions without connection pooling. Writes are batched: a 389-feature import is
~4 multi-row statements, a 40-card drag is a handful of round trips, and moving a
whole column into **Done** is one `UPDATE` (the KV/file drivers coalesce a
request into a single write and write eagerly, never on a timer).

### Attach a database on Vercel

```
Vercel dashboard → your project → Storage (or Marketplace)
  → Neon (Postgres)          ← recommended: real SQL, free tier
  → or KV / Upstash Redis    ← simplest: one JSON document
→ Connect to project  (DATABASE_URL / KV_* env vars appear automatically)
→ Redeploy
```

Then open `/tracker` → **Team & data** to confirm the driver, or
`GET /api/tracker/health`:

```json
{ "ok": true, "database": { "mode": "neon", "label": "Neon Postgres (…)" },
  "counts": { "projects": 1, "workspaces": 4, "features": 389 } }
```

Optional env vars:

| Variable | Effect |
|---|---|
| `NBG_TRACKER_SECRET` | signs tracker sessions (falls back to `NBG_SECRET`) |
| `NBG_DEMO_MODE=0` | disables one-tap guest sessions in production |
| `TRACKER_DATABASE_URL` | tracker-only Postgres, if you don't want to share `DATABASE_URL` |
| `TRACKER_SQL_ENDPOINT` | point the SQL driver at an explicit HTTP endpoint instead of `https://<host>/sql` — e.g. Neon's local proxy or a self-hosted Postgres-over-HTTP proxy. Useful for CI: `TRACKER_SQL_ENDPOINT=http://127.0.0.1:3113` |

---

## 6. Importing your own feature document

**Import** (or `I`) accepts:

- a **drag-and-dropped file** — `.html`, `.md`, `.txt`
- a **paste** of the document text
- the bundled `docs/FEATURE_AUDIT.md` (**Load docs/FEATURE_AUDIT.md**)

The parser understands markdown headings and HTML (`<h2>`, `<ul><li>`), the
✓ / ◐ / ✗ status glyphs, `·`-separated item lists and audit tables. Rows are
keyed by `section + title`, so **Merge** (default) only adds what is new and
skips duplicates; **Replace** rebuilds the feature list from scratch.

Importing a new document is the fastest way to re-baseline the tracker after a
feature audit refresh.

---

## 7. API reference

Everything the UI does is a REST call under `/api/tracker` (Bearer tracker token
from `/auth/login`, `/auth/register` or `/auth/guest`). `GET /api/docs` lists
them with the rest of the platform API.

| Method & path | What it does |
|---|---|
| `GET /health`, `GET /meta` | storage driver, counts, statuses/priorities/stages |
| `POST /auth/guest` · `/auth/login` · `/auth/register` · `GET /auth/me` | sessions |
| `GET /bootstrap?project=` | one round trip: me, projects, workspaces, features, placements, sections, activity, comments, viewers |
| `POST /projects` · `PATCH /projects/:id` · `GET /projects` | projects |
| `GET /workspaces` · `POST /workspaces` · `PATCH /workspaces/:id` · `DELETE /workspaces/:id` · `GET /workspaces/:id/cards` | boards |
| `GET /features?q=&section=&status=&priority=&source_status=` · `POST /features` · `PATCH /features/:id` · `DELETE /features/:id` | features |
| `POST /features/bulk` `{ids, patch}` / `{ids, action:'place'|'delete'}` | multi-select operations |
| `POST /placements` `{workspace_id, feature_ids, stage, index}` | **drag in** |
| `POST /placements/move` `{moves:[{id, stage, position, workspace_id}]}` | **drag around / between boards** |
| `POST /placements/remove` | take a card off a board |
| `POST /plan` `{workspace_id, rules, mode:'preview'|'add'}` | auto-plan |
| `POST /import` `{source:'audit'|'text', text, mode:'merge'|'replace'}` | (re)import the document |
| `GET /stats` · `GET /search?q=` · `GET /activity` · `GET/POST /comments` | dashboard, palette, feed, discussion |
| `GET /events?project=` | Server-Sent Events stream (board changes + presence); serverless falls back to polling |
| `GET /export?format=json\|csv` · `POST /invites` · `POST /invites/:token/accept` | exports and teammates |

Examples:

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/tracker/auth/guest -H 'content-type: application/json' -d '{}' | jq -r .token)

# create a workspace
WS=$(curl -s -X POST localhost:3000/api/tracker/workspaces -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"MVP features","icon":"🚀","wip_limit":6}' | jq -r .workspace.id)

# drag two features into it (stage: backlog|next|doing|review|done)
curl -s -X POST localhost:3000/api/tracker/placements -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"workspace_id\":\"$WS\",\"feature_ids\":[\"<id1>\",\"<id2>\"],\"stage\":\"next\"}"

# move a card to Done (also marks the feature Shipped)
curl -s -X POST localhost:3000/api/tracker/placements/move -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"moves":[{"id":"<placement-id>","stage":"done","position":1}]}'
```

---

## 8. How it is built

```
public/tracker.html          shell (gate + topbar + sidebar + canvas)
public/css/tracker.css       tracker design system (reuses the brand tokens)
public/js/tracker/
  api.js                     /api/tracker client (token in localStorage)
  dnd.js                     pointer-based drag & drop engine (mouse/touch/keyboard)
  ui.js                      h(), icons, toasts, modals, sheets, confetti, sparkline
  state.js                   optimistic store, undo stack, live sync (SSE/polling)
  components.js              cards, feature sheet, workspace/plan/import/palette modals
  views/*.js                 overview · backlog · board · activity · team
lib/tracker/
  parse.js                   feature-document parser (Markdown + HTML)
  schema.js                  table definitions, statuses, starter workspaces
  db.js                      Neon / KV / file drivers behind one row API
  store.js                   domain logic (projects, drag-drop placements, stats, seed)
  routes.js                  REST + SSE endpoints
```

Notable behaviours:

- **Optimistic writes** — the UI moves instantly, the API call follows; a failed
  write rolls back with a toast. Each mutation lands on an undo stack (`⌘Z`).
- **Stage → status sync** — columns named `doing`/`review`/`done` update the
  feature's status, and `done` logs a completion (this is what feeds the burn-up).
- **Live presence** — the topbar avatars and the activity feed come from the SSE
  stream; when a deployment can't hold a stream open (Vercel), the client polls
  every 15 s instead and says so in the sidebar footer.
- **Zero dependencies** — same as the rest of the repo: no npm packages, no CDN
  (the CSP is `default-src 'self'`), no build step.

---

## 9. Local testing without a database

```bash
node server.js                 # file storage in .data/tracker.json
rm -rf .data                   # reset the tracker (reseeds on next request)

# exercise the Vercel KV path locally with the bundled stub
node tools/kv-stub.mjs 3110 &
KV_REST_API_URL=http://127.0.0.1:3110 KV_REST_API_TOKEN=stub node server.js

# exercise the Postgres path against any Postgres-over-HTTP endpoint
DATABASE_URL=postgresql://user:pw@localhost:5432/neondb \
TRACKER_SQL_ENDPOINT=http://127.0.0.1:3113 node server.js
```

The migrations are idempotent (`CREATE TABLE/INDEX IF NOT EXISTS`) and run on the
first request, in one batched statement — a cold serverless function creates all
nine tables in a single round trip.

Headless UI checks (jsdom + `vm.SourceTextModule`) live outside the repo so it
stays dependency-free; they drive the real page: sign-in, search, multi-select,
pointer drag & drop, keyboard drag, workspace creation and the command palette.
