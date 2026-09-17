"""Dashboard API.

Everything the CLI can do, over HTTP, plus a UI that renders the parameter
schema in `web/schema.py` so new config fields show up without touching the
front end.

Safety model
------------
* The process starts in the mode given by FXBOT_MODE (paper by default).
* Endpoints that move money (close a position, run a live cycle) refuse to act
  while the process is in paper mode. Switching to live is an explicit,
  separate call: POST /api/mode {"mode": "live"}.
* Set FXBOT_WEB_TOKEN to require `Authorization: Bearer <token>` on every
  /api/* call. Without it the UI shows a loud warning banner.
"""

from __future__ import annotations

import logging
import math
import os
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..config import Config, load_config
from ..state import make_store

LOG_RING: deque = deque(maxlen=300)


class RingHandler(logging.Handler):
    def __init__(self, sink):
        super().__init__(level=logging.INFO)
        self.sink = sink
        self.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s",
                                            datefmt="%H:%M:%S"))
        logging.Formatter.converter = time.gmtime

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.sink.append(self.format(record))
        except Exception:  # pragma: no cover
            pass


# --------------------------------------------------------------- config paths
def get_path(obj: Any, dotted: str) -> Any:
    cur = obj
    for part in dotted.split("."):
        cur = getattr(cur, part)
    return cur


def set_path(obj: Any, dotted: str, value: Any) -> None:
    parts = dotted.split(".")
    cur = obj
    for part in parts[:-1]:
        cur = getattr(cur, part)
    setattr(cur, parts[-1], value)


def _cfg_to_flat(cfg: Config) -> Dict[str, Any]:
    from ..web.schema import FIELDS

    return {f["key"]: get_path(cfg, f["key"]) for f in FIELDS}


def _jsonable(value: Any) -> Any:
    """JSON-safe: NaN/inf become null (they appear in metrics with no losses)."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def create_app(config_path: Optional[str] = None, cfg: Optional[Config] = None) -> "FastAPI":
    try:
        from fastapi import Body, FastAPI, HTTPException, Request
        from fastapi.responses import JSONResponse
        from fastapi.staticfiles import StaticFiles
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "The dashboard needs FastAPI. Install it with:\n"
            "    pip install -r requirements-web.txt"
        ) from exc

    from .. import __version__
    from ..news import NewsFilter
    from ..risk import RiskManager, cost_as_pct_of_risk
    from ..web.jobs import JobManager, sanitize
    from ..web.schema import FIELDS, GROUPS, validate_changes

    app_state: Dict[str, Any] = {
        "config_path": config_path or os.environ.get("FXBOT_CONFIG", "fxbot/config.json"),
        "cfg": cfg or load_config(config_path or os.environ.get("FXBOT_CONFIG", "fxbot/config.json")),
        "jobs": JobManager(),
        "mode": os.environ.get("FXBOT_MODE", "paper").lower(),
        "started": datetime.now(timezone.utc),
    }
    app_state["store"] = make_store(app_state["cfg"])

    token = os.environ.get("FXBOT_WEB_TOKEN", "")
    auth_required = bool(token)

    root_logger = logging.getLogger("fxbot")
    if not any(isinstance(h, RingHandler) for h in root_logger.handlers):
        root_logger.addHandler(RingHandler(LOG_RING))
    root_logger.setLevel(logging.INFO)

    app = FastAPI(title="fxbot dashboard", version=__version__)

    def _cfg() -> Config:
        return app_state["cfg"]

    def _store():
        return app_state["store"]

    def _reload_store() -> None:
        app_state["store"] = make_store(_cfg())

    def _live_enabled() -> bool:
        return app_state["mode"] == "live"

    def _require_live() -> None:
        if not _live_enabled():
            raise HTTPException(409, "server is in paper mode; POST /api/mode {'mode':'live'} first")

    # ------------------------------------------------------------- auth
    @app.middleware("http")
    async def _auth(request: Request, call_next):
        if auth_required and request.url.path.startswith("/api/"):
            header = request.headers.get("Authorization", "")
            if header != f"Bearer {token}":
                return JSONResponse({"error": "unauthorized"}, status_code=401)
        return await call_next(request)

    # ------------------------------------------------------------- meta
    @app.get("/api/health")
    def health():
        cfg = _cfg()
        return {
            "ok": True,
            "version": __version__,
            "mode": app_state["mode"],
            "auth_required": auth_required,
            "has_deriv_token": bool(cfg.deriv.token),
            "started": app_state["started"].isoformat(),
            "uptime_s": round((datetime.now(timezone.utc) - app_state["started"]).total_seconds()),
            "symbols": cfg.data.symbols,
            "granularity": cfg.data.granularity,
            "config_path": app_state["config_path"],
        }

    @app.get("/api/schema")
    def schema():
        cfg = _cfg()
        return {"groups": GROUPS, "fields": FIELDS, "values": _jsonable(_cfg_to_flat(cfg))}

    # ----------------------------------------------------------- config io
    @app.get("/api/config")
    def get_config():
        return _jsonable(_cfg().to_dict())

    @app.put("/api/config")
    def put_config(payload: dict = Body(...)):
        changes = payload.get("changes") or payload
        clean, warnings = validate_changes(changes)
        cfg = _cfg()
        for key, value in clean.items():
            set_path(cfg, key, value)
        try:
            cfg.save(app_state["config_path"])
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"could not write config: {exc}") from exc
        if any(k.startswith(("state",)) for k in clean):
            _reload_store()
        root_logger.info("config updated: %s", ", ".join(f"{k}={v}" for k, v in clean.items()))
        return {"ok": True, "saved": len(clean), "warnings": warnings,
                "values": _jsonable(_cfg_to_flat(cfg))}

    @app.post("/api/config/reset")
    def reset_config():
        """Restore shipped defaults in place (keeps the live config object identity)."""
        from dataclasses import fields

        cfg = _cfg()
        defaults = Config().with_env_overrides()
        for f in fields(cfg):
            current, default = getattr(cfg, f.name), getattr(defaults, f.name)
            if hasattr(current, "__dataclass_fields__"):
                for sf in fields(current):
                    setattr(current, sf.name, getattr(default, sf.name))
            else:
                setattr(cfg, f.name, default)
        cfg.save(app_state["config_path"])
        _reload_store()
        root_logger.warning("config reset to defaults")
        return {"ok": True, "values": _jsonable(_cfg_to_flat(cfg))}

    # ------------------------------------------------------------ insights
    @app.get("/api/insights")
    def insights():
        """Derived numbers that tell you whether the config is survivable."""
        cfg = _cfg()
        vol = 0.0004 * (cfg.data.granularity / 900) ** 0.5      # rough FX bar vol by timeframe
        stop_pct = vol * cfg.strategy.stop_loss_k
        rr = cfg.strategy.take_profit_k / cfg.strategy.stop_loss_k if cfg.strategy.stop_loss_k else 0
        cost = cost_as_pct_of_risk(stop_pct, cfg.costs.commission_rate, cfg.costs.commission_on_exit)
        rows = []
        for k in (0.5, 1, 2, 3, 4, 6, 8, 12):
            sp = vol * k
            c = cost_as_pct_of_risk(sp, cfg.costs.commission_rate, cfg.costs.commission_on_exit)
            rows.append({"stop_k": k, "stop_pips": round(sp / 0.0001, 1),
                         "cost_pct_of_risk": round(c * 100, 1),
                         "break_even_win_rate": round((1 + c) / (rr + 1) * 100, 1)})
        return {
            "assumed_bar_vol": vol,
            "current_stop_pct": stop_pct,
            "current_stop_pips": round(stop_pct / 0.0001, 1),
            "rr": round(rr, 2),
            "cost_pct_of_risk": round(cost * 100, 1),
            "break_even_win_rate": round((1 + cost) / (rr + 1) * 100, 1),
            "table": rows,
            "verdict": ("impossible: commission exceeds the risk budget" if cost > 1 else
                        "expensive: needs a high hit rate" if cost > 0.4 else
                        "survivable cost profile"),
        }

    # -------------------------------------------------------------- status
    @app.get("/api/status")
    def status():
        cfg, store = _cfg(), _store()
        store.roll_day_if_needed()
        out: Dict[str, Any] = {
            "mode": app_state["mode"],
            "state": _jsonable(store.stats()),
            "last_cycle": store.state.last_cycle,
            "paper_equity": store.state.notes.get("paper_equity", 10000),
            "balance": None,
            "positions": [],
            "error": None,
        }
        if cfg.deriv.token:
            try:
                import asyncio

                from ..broker import DerivBroker
                from ..deriv import connect_with_retry

                async def _probe():
                    client = await connect_with_retry(cfg.deriv, authorize=True)
                    broker = DerivBroker(client, cfg.deriv, cfg.costs)
                    try:
                        return await broker.balance(), await broker.open_positions()
                    finally:
                        await client.close()

                balance, positions = asyncio.run(_probe())
                out["balance"] = balance
                out["positions"] = _jsonable(positions)
                out["state"] = _jsonable(store.stats(equity=balance))
            except Exception as exc:  # noqa: BLE001
                out["error"] = f"{type(exc).__name__}: {exc}"
        return out

    @app.get("/api/trades")
    def trades(limit: int = 100):
        store = _store()
        rows = store.state.trades[-limit:]
        return {"trades": _jsonable(rows)}

    @app.get("/api/equity")
    def equity():
        """Equity curve reconstructed from closed trades in the state store."""
        store = _store()
        base = float(store.state.notes.get("paper_equity", 10000))
        rows = sorted(store.state.trades, key=lambda t: t.get("closed_at", ""))
        points, eq = [], base
        for t in rows:
            eq += float(t.get("pnl", 0) or 0)
            points.append({"t": t.get("closed_at"), "equity": round(eq, 2),
                           "symbol": t.get("symbol"), "pnl": float(t.get("pnl", 0) or 0)})
        peak, dd = base, 0.0
        for p in points:
            peak = max(peak, p["equity"])
            dd = min(dd, p["equity"] / peak - 1.0)
        return {"start_equity": base, "points": points,
                "max_drawdown_pct": round(-dd * 100, 2) if points else 0.0}

    # ------------------------------------------------------------ controls
    @app.post("/api/mode")
    def set_mode(payload: dict = Body(...)):
        mode = str(payload.get("mode", "")).lower()
        if mode not in ("paper", "live"):
            raise HTTPException(400, "mode must be 'paper' or 'live'")
        if mode == "live" and not _cfg().deriv.token:
            raise HTTPException(400, "DERIV_API_TOKEN is not set; live mode is unavailable")
        app_state["mode"] = mode
        root_logger.warning("mode switched to %s", mode)
        return {"ok": True, "mode": mode}

    @app.post("/api/control/kill")
    def kill(payload: dict = Body(default={})):
        RiskManager(_cfg().risk, store=_store()).engage_kill_switch(
            str(payload.get("reason", "dashboard")))
        return {"ok": True, "kill_switch": "engaged"}

    @app.post("/api/control/resume")
    def resume():
        RiskManager(_cfg().risk, store=_store()).release_kill_switch()
        return {"ok": True, "kill_switch": "released"}

    @app.post("/api/control/cycle")
    def run_cycle_now(payload: dict = Body(default={})):
        """Run one cycle immediately. Paper mode unless /api/mode says live."""
        from ..engine import run_cycle as _cycle
        import asyncio

        dry = not _live_enabled() or bool(payload.get("dry_run", False))
        try:
            summary = asyncio.run(_cycle(_cfg(), store=_store(), model=_load_model(), dry_run=dry))
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"{type(exc).__name__}: {exc}") from exc
        return {"ok": True, "dry_run": dry, "summary": _jsonable(summary)}

    @app.post("/api/control/close-all")
    def close_all():
        _require_live()
        import asyncio

        from ..broker import DerivBroker
        from ..deriv import connect_with_retry

        async def _close():
            client = await connect_with_retry(_cfg().deriv, authorize=True)
            try:
                return await DerivBroker(client, _cfg().deriv, _cfg().costs).close_all()
            finally:
                await client.close()

        try:
            results = asyncio.run(_close())
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"{type(exc).__name__}: {exc}") from exc
        return {"ok": True, "closed": _jsonable(results)}

    @app.post("/api/positions/{contract_id}/close")
    def close_position(contract_id: int):
        _require_live()
        import asyncio

        from ..broker import DerivBroker
        from ..deriv import connect_with_retry

        async def _close():
            client = await connect_with_retry(_cfg().deriv, authorize=True)
            try:
                return await DerivBroker(client, _cfg().deriv, _cfg().costs).close(int(contract_id))
            finally:
                await client.close()

        try:
            return {"ok": True, "result": _jsonable(asyncio.run(_close()))}
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"{type(exc).__name__}: {exc}") from exc

    # ------------------------------------------------------------- signals
    @app.get("/api/signals")
    def signals(offline: bool = False):
        from ..engine import prepare_frame
        from ..strategy import signal_at

        import asyncio

        model = _load_model()

        async def _scan():
            from ..deriv import connect_with_retry
            from ..mock import FakeDerivClient

            if offline:
                client = FakeDerivClient(symbols=_cfg().data.symbols,
                                         granularity=_cfg().data.granularity)
                await client.connect()
            else:
                client = await connect_with_retry(_cfg().deriv, authorize=bool(_cfg().deriv.token))
            out = []
            try:
                news = NewsFilter(_cfg().news)
                news.refresh()
                for symbol in _cfg().data.symbols:
                    try:
                        frame = await prepare_frame(client, symbol, _cfg(), news=news)
                        if frame.empty:
                            out.append({"symbol": symbol, "error": "insufficient data"})
                            continue
                        decision = signal_at(frame, _cfg().strategy, model=model,
                                             threshold=_cfg().model.threshold,
                                             news_mask=frame.get("news_blocked"))
                        blocked, why = news.is_blocked(symbol=symbol)
                        out.append({
                            "symbol": symbol,
                            "bar": frame.index[-1].isoformat(),
                            "close": round(float(frame["close"].iloc[-1]), 5),
                            "vol": float(frame["vol"].iloc[-1]),
                            "news_blocked": blocked,
                            "news_reason": why,
                            "decision": (_jsonable(decision) if decision else None),
                        })
                    except Exception as exc:  # noqa: BLE001
                        out.append({"symbol": symbol, "error": f"{type(exc).__name__}: {exc}"})
            finally:
                await client.close()
            return out

        try:
            return {"signals": asyncio.run(_scan()), "offline": offline}
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"{type(exc).__name__}: {exc}") from exc

    # ---------------------------------------------------------------- news
    @app.get("/api/news")
    def news(limit: int = 12):
        from ..news import NewsFilter

        nf = NewsFilter(_cfg().news)
        nf.refresh()
        now = datetime.now(timezone.utc)
        per_symbol = {}
        for symbol in _cfg().data.symbols:
            blocked, why = nf.is_blocked(now, symbol)
            close_it, close_why = nf.should_close(now, symbol)
            per_symbol[symbol] = {"blocked": blocked, "reason": why,
                                  "should_close": close_it, "close_reason": close_why}
        return {"events": nf.upcoming(limit=limit), "now": now.isoformat(),
                "symbols": per_symbol, "error": nf.last_error,
                "count": len(nf.events())}

    @app.post("/api/news/add")
    def news_add(payload: dict = Body(...)):
        from ..news import FileCalendar, NewsEvent

        event = NewsEvent.from_dict(payload)
        path = Path(_cfg().news.calendar_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        calendar = FileCalendar(path)
        events = [e for e in calendar.events() if not (e.time == event.time and e.name == event.name)]
        events.append(event)
        events.sort(key=lambda e: e.time)
        path.write_text(__import__("json").dumps(
            {"events": [e.to_dict() for e in events]}, indent=2))
        return {"ok": True, "event": event.to_dict(), "total": len(events)}

    @app.post("/api/news/refresh")
    def news_refresh():
        from ..news import NewsFilter

        nf = NewsFilter(_cfg().news)
        count = nf.refresh()
        return {"ok": True, "count": count, "error": nf.last_error}

    # ---------------------------------------------------------------- jobs
    def _job_backtest(logs: List[str]) -> dict:
        """Rules vs model filter, with the model scored OUT-OF-SAMPLE.

        Scoring a model on its own training bars is the classic way to fool
        yourself: in-sample it will happily report a 90%+ win rate on pure
        noise. The walk-forward folds keep the comparison honest.
        """
        from ..pipeline import load_frames, run_full_backtest

        cfg = _cfg()
        frames = load_frames(cfg)
        if not frames:
            return {"error": "no cached data - run fetch-data first"}
        result = run_full_backtest(cfg, frames)
        for row in result["rows"]:
            if not row.get("n_trades"):
                logs.append(f"{row['symbol']:<12} {row['variant']:<32} no trades")
                continue
            logs.append(f"{row['symbol']:<12} {row['variant']:<32} "
                        f"trades={int(row['n_trades']):<5} win={row['win_rate']:.3f} "
                        f"exp={row['expectancy_r']:+.3f}R t={row['t_stat']:.2f}")
        if result.get("verdict"):
            logs.append(f"VERDICT: {result['verdict']}")
        return result

    def _job_train(logs: List[str]) -> dict:
        from ..pipeline import build_dataset, compare_filter, walk_forward_evaluate

        cfg = _cfg()
        from ..pipeline import load_frames

        frames = load_frames(cfg)
        if not frames:
            return {"error": "no cached data - run fetch-data first"}
        ds = build_dataset(cfg, frames)
        if ds.X.empty:
            return {"error": "no labelled events"}
        logs.append(f"dataset: {len(ds.X)} events, {ds.X.shape[1]} features, "
                    f"positive rate {ds.y.mean():.3f}")
        report, oos, model = walk_forward_evaluate(cfg, ds)
        comparison = compare_filter(cfg, ds, oos)
        logs.append(comparison.to_string(index=False))
        verdict = ""
        if not comparison.empty:
            best = comparison.sort_values("expectancy_r", ascending=False).iloc[0]
            n, t = float(best["n_trades"]), float(best.get("t_stat") or 0)
            verdict = (f"only {int(n)} trades - not enough evidence" if n < 100 else
                       f"t-stat {t:.2f}: indistinguishable from luck - do not fund it" if t < 2 else
                       f"expectancy {best['expectancy_r']:+.4f}R, t-stat {t:.2f}: paper trade it next")
        if model is not None:
            model.save(cfg.model.model_path)
        return {
            "folds": report.to_dict(orient="records") if not report.empty else [],
            "comparison": comparison.to_dict(orient="records") if not comparison.empty else [],
            "verdict": verdict,
            "n_events": int(len(ds.X)),
            "positive_rate": float(ds.y.mean()),
        }

    def _job_fetch(logs: List[str]) -> dict:
        import asyncio

        from ..data import Cache, drop_incomplete, fetch_history
        from ..deriv import connect_with_retry

        cfg = _cfg()
        cache = Cache(Path(cfg.data.cache_dir))

        async def _go():
            client = await connect_with_retry(cfg.deriv, authorize=bool(cfg.deriv.token))
            out = []
            try:
                server_time = await client.server_time()
                for symbol in cfg.data.symbols:
                    df = await fetch_history(client, symbol, cfg.data.granularity, cfg.data.history_bars)
                    df = drop_incomplete(df, cfg.data.granularity, server_time)
                    cache.save(df, symbol, cfg.data.granularity)
                    out.append({"symbol": symbol, "bars": len(df),
                                "from": str(df.index[0]), "to": str(df.index[-1])})
                    logs.append(f"{symbol}: {len(df)} bars")
            finally:
                await client.close()
            return out

        return {"symbols": asyncio.run(_go())}

    JOB_FNS = {"backtest": _job_backtest, "train": _job_train, "fetch-data": _job_fetch}

    @app.post("/api/jobs/{kind}")
    def start_job(kind: str):
        if kind not in JOB_FNS:
            raise HTTPException(404, f"unknown job {kind}")
        job = app_state["jobs"].submit(kind, JOB_FNS[kind])
        return {"ok": True, "job": job.to_dict()}

    @app.get("/api/jobs")
    def list_jobs():
        return {"jobs": app_state["jobs"].list(), "running": app_state["jobs"].running}

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        job = app_state["jobs"].get(job_id)
        if not job:
            raise HTTPException(404, "job not found")
        return job.to_dict()

    # ---------------------------------------------------------------- logs
    @app.get("/api/logs")
    def logs(limit: int = 100):
        return {"lines": list(LOG_RING)[-limit:]}

    def _load_model():
        if not _cfg().model.enabled:
            return None
        path = Path(_cfg().model.model_path)
        if not path.exists():
            return None
        try:
            from ..model import MetaModel

            return MetaModel.load(path)
        except Exception as exc:  # noqa: BLE001
            root_logger.warning("could not load model: %s", exc)
            return None

    # --------------------------------------------------------------- static
    static_dir = Path(__file__).parent / "static"
    if static_dir.exists():
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="ui")

    return app


def serve(host: str = "0.0.0.0", port: int = 8000, config_path: Optional[str] = None,
          reload: bool = False) -> None:  # pragma: no cover - manual entrypoint
    import uvicorn

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    logging.Formatter.converter = time.gmtime
    token = os.environ.get("FXBOT_WEB_TOKEN")
    print(f"fxbot dashboard -> http://{host}:{port}")
    print(f"mode: {os.environ.get('FXBOT_MODE', 'paper')}   "
          f"auth: {'Bearer token required' if token else 'OPEN - set FXBOT_WEB_TOKEN to lock it'}")
    uvicorn.run(create_app(config_path), host=host, port=port, reload=reload)
