"""Vercel serverless entrypoint: ONE trading cycle per invocation.

Deploy this directory (with the `fxbot/` package next to it) to Vercel and point
a cron at /api/cron. Each invocation:

  * connects to Deriv over WebSocket
  * fetches the latest closed candles for every symbol
  * evaluates the rule + model
  * places at most one trade per symbol, with SL/TP attached server-side
  * exits

Nothing is kept in memory and the local filesystem is throwaway, so state lives
in Upstash Redis / Vercel KV (FXBOT_STATE_URL + FXBOT_STATE_TOKEN).

Limits to know about before you choose this over a $5 container:
  * Hobby plan: cron jobs run AT MOST ONCE PER DAY -> useless for trading.
    Pro ($20/mo) allows per-minute schedules; external schedulers (cron-job.org,
    Upstash QStash, GitHub Actions) can hit this URL from any plan.
  * Cold starts: the handler imports pandas + scikit-learn. Expect 5-15s on a
    cold lambda and make sure maxDuration (vercel.json) covers it.
  * Timing: a cron firing "every 15 minutes" is approximate. This bot trades on
    closed M15 bars, so being 30-60s late is fine; being 10 minutes late is not.
"""

import json
import os
import sys
from pathlib import Path

# Vercel puts this file at <root>/api/cron.py; the package may sit at the root
# or one level down depending on how you deployed it. Handle both.
_HERE = Path(__file__).resolve().parent
for candidate in (_HERE, _HERE.parent, _HERE.parent / "fxbot"):
    if (candidate / "fxbot" / "cli.py").exists():
        sys.path.insert(0, str(candidate))
        break

from http.server import BaseHTTPRequestHandler  # noqa: E402


def _authorised(headers) -> bool:
    secret = os.environ.get("CRON_SECRET")
    if not secret:
        return True  # no secret configured: rely on Vercel's cron auth
    return headers.get("Authorization") == f"Bearer {secret}"


def run_cycle() -> dict:
    import asyncio

    from fxbot.config import load_config
    from fxbot.engine import run_cycle as _cycle
    from fxbot.model import MetaModel
    from fxbot.state import make_store

    cfg = load_config(os.environ.get("FXBOT_CONFIG", "fxbot/config.json"))
    store = make_store(cfg)
    model = None
    if cfg.model.enabled and Path(cfg.model.model_path).exists():
        try:
            model = MetaModel.load(cfg.model.model_path)
        except Exception as exc:  # noqa: BLE001
            model = None
            store.note("model_load_error", str(exc))
    dry_run = os.environ.get("FXBOT_MODE", "paper").lower() != "live"
    return asyncio.run(_cycle(cfg, store=store, model=model, dry_run=dry_run))


class handler(BaseHTTPRequestHandler):
    def _respond(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802 - Vercel's Python runtime API
        if not _authorised(self.headers):
            self._respond(401, {"error": "unauthorized"})
            return
        try:
            self._respond(200, {"ok": True, "summary": run_cycle()})
        except Exception as exc:  # noqa: BLE001 - surface it in the cron logs
            self._respond(500, {"ok": False, "error": f"{type(exc).__name__}: {exc}"})

    def log_message(self, *args):
        pass  # access logs are noise for a cron endpoint
