"""Crash-safe state, with a serverless-friendly backend.

A long-lived worker can keep state in a JSON file. A serverless function cannot:
the filesystem is ephemeral and each invocation may be a fresh container. So
there are two backends behind one interface:

    json   - atomic file on disk (Railway / Render / Fly / a VPS / your laptop)
    redis  - Upstash (or Vercel KV) REST endpoint: GET/SET one JSON blob

Set FXBOT_STATE_URL + FXBOT_STATE_TOKEN to switch to the REST backend.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

MAX_TRADES_LOGGED = 500


def _utc_day(ts: Optional[datetime] = None) -> str:
    ts = ts or datetime.now(timezone.utc)
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%d")


@dataclass
class State:
    day: str = field(default_factory=_utc_day)
    day_pnl: float = 0.0
    open_positions: Dict[str, dict] = field(default_factory=dict)   # contract_id -> position dict
    trades: List[dict] = field(default_factory=list)                # most recent last
    last_bar_ts: Dict[str, str] = field(default_factory=dict)
    last_cycle: Optional[str] = None
    cycles: int = 0
    kill_switch: Optional[str] = None                               # None = running
    notes: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "day": self.day,
            "day_pnl": self.day_pnl,
            "open_positions": self.open_positions,
            "trades": self.trades[-MAX_TRADES_LOGGED:],
            "last_bar_ts": self.last_bar_ts,
            "last_cycle": self.last_cycle,
            "cycles": self.cycles,
            "kill_switch": self.kill_switch,
            "notes": self.notes,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), default=str)

    @classmethod
    def from_dict(cls, raw: dict) -> "State":
        return cls(
            day=raw.get("day", _utc_day()),
            day_pnl=float(raw.get("day_pnl", 0.0)),
            open_positions=raw.get("open_positions", {}) or {},
            trades=raw.get("trades", []) or [],
            last_bar_ts=raw.get("last_bar_ts", {}) or {},
            last_cycle=raw.get("last_cycle"),
            cycles=int(raw.get("cycles", 0)),
            kill_switch=raw.get("kill_switch"),
            notes=raw.get("notes", {}) or {},
        )


class StateStore:
    """Interface + shared mutation logic. Subclasses implement load/save."""

    def __init__(self) -> None:
        self.state = State()
        self._hydrated = False

    # ------------------------------------------------------------ subclasses
    def load(self) -> State:                      # pragma: no cover - overridden
        return State()

    def save(self) -> None:                       # pragma: no cover - overridden
        raise NotImplementedError

    # ---------------------------------------------------------------- helpers
    def ensure_loaded(self) -> State:
        if not self._hydrated:
            self.state = self.load()
            self._hydrated = True
        return self.state

    def roll_day_if_needed(self) -> bool:
        self.ensure_loaded()
        today = _utc_day()
        if self.state.day != today:
            log.info("new UTC day (%s -> %s); resetting daily P&L", self.state.day, today)
            self.state.day = today
            self.state.day_pnl = 0.0
            self.save()
            return True
        return False

    def record_open(self, contract_id: str, position: dict) -> None:
        self.ensure_loaded()
        self.state.open_positions[str(contract_id)] = position
        self.save()

    def record_close(self, contract_id: str, pnl: float, exit_info: dict) -> None:
        self.ensure_loaded()
        pos = self.state.open_positions.pop(str(contract_id), {})
        trade = {**pos, **exit_info, "contract_id": str(contract_id), "pnl": pnl,
                 "closed_at": datetime.now(timezone.utc).isoformat()}
        self.state.trades.append(trade)
        self.state.day_pnl += float(pnl)
        if len(self.state.trades) > MAX_TRADES_LOGGED:
            self.state.trades = self.state.trades[-MAX_TRADES_LOGGED:]
        log.info("closed %s pnl=%.2f (day pnl %.2f)", contract_id, pnl, self.state.day_pnl)
        self.save()

    def mark_cycle(self) -> None:
        self.ensure_loaded()
        self.state.cycles += 1
        self.state.last_cycle = datetime.now(timezone.utc).isoformat()
        self.save()

    def set_last_bar(self, symbol: str, ts) -> None:
        self.ensure_loaded()
        self.state.last_bar_ts[symbol] = str(ts)

    def note(self, key: str, value: Any) -> None:
        self.ensure_loaded()
        self.state.notes[key] = value

    def set_kill_switch(self, reason: Optional[str]) -> None:
        self.ensure_loaded()
        self.state.kill_switch = reason
        self.save()

    # ------------------------------------------------------------- reporting
    def stats(self, equity: Optional[float] = None) -> Dict[str, Any]:
        self.ensure_loaded()
        closed = self.state.trades
        wins = [t for t in closed if float(t.get("pnl", 0)) > 0]
        out = {
            "day": self.state.day,
            "day_pnl": round(self.state.day_pnl, 2),
            "kill_switch": self.state.kill_switch,
            "open_positions": len(self.state.open_positions),
            "closed_trades": len(closed),
            "win_rate": round(len(wins) / len(closed), 3) if closed else None,
            "realised_pnl": round(sum(float(t.get("pnl", 0)) for t in closed), 2),
            "cycles": self.state.cycles,
        }
        if equity:
            out["day_pnl_pct"] = round(100 * self.state.day_pnl / equity, 3)
        return out


class JsonStateStore(StateStore):
    def __init__(self, path: str | Path = "data/fxbot/state.json"):
        super().__init__()
        self.path = Path(path)
        self.state = self.load()
        self._hydrated = True

    def load(self) -> State:
        if self.path.exists():
            try:
                return State.from_dict(json.loads(self.path.read_text()))
            except Exception as exc:  # noqa: BLE001
                log.warning("could not read state (%s); starting fresh", exc)
        return State()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = self.state.to_json()
        fd, tmp = tempfile.mkstemp(dir=str(self.path.parent), suffix=".tmp")
        with os.fdopen(fd, "w") as fh:
            fh.write(data)
        os.replace(tmp, self.path)  # atomic: a crash mid-write never corrupts state


class RestStateStore(StateStore):
    """Upstash Redis / Vercel KV REST backend (one JSON blob under one key).

    Endpoint shape:  GET  {url}/get/{key}          -> {"result": "<json>"}
                     POST {url}/set/{key}          body: <json>
    Auth:            Authorization: Bearer <token>
    """

    def __init__(self, url: str, token: str, key: str = "fxbot:state", timeout: float = 8.0):
        super().__init__()
        self.url = url.rstrip("/")
        self.token = token
        self.key = key
        self.timeout = timeout
        self.state = self.load()
        self._hydrated = True

    def _request(self, path: str, data: Optional[bytes] = None) -> Optional[str]:
        req = urllib.request.Request(f"{self.url}/{path}", data=data, method="POST" if data else "GET")
        req.add_header("Authorization", f"Bearer {self.token}")
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                payload = json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            log.warning("state store HTTP error %s for %s", exc.code, path)
            return None
        except Exception as exc:  # noqa: BLE001 - never let state kill a trading cycle
            log.warning("state store error (%s) for %s", exc, path)
            return None
        result = payload.get("result")
        return result if isinstance(result, str) else None

    def load(self) -> State:
        raw = self._request(f"get/{self.key}")
        if not raw:
            log.warning("no remote state found (first run?) -- starting fresh")
            return State()
        try:
            return State.from_dict(json.loads(raw))
        except Exception as exc:  # noqa: BLE001
            log.warning("remote state unreadable (%s); starting fresh", exc)
            return State()

    def save(self) -> None:
        self._request(f"set/{self.key}", data=self.state.to_json().encode())


def make_store(cfg) -> StateStore:
    url = os.environ.get("FXBOT_STATE_URL") or getattr(cfg, "state_url", "")
    token = os.environ.get("FXBOT_STATE_TOKEN") or getattr(cfg, "state_token", "")
    if url and token:
        log.info("using REST state store (%s)", url)
        return RestStateStore(url, token, key=os.environ.get("FXBOT_STATE_KEY", "fxbot:state"))
    return JsonStateStore(cfg.state_path)
