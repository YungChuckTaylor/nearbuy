"""Economic-calendar blackout filter.

Why this exists
---------------
Scheduled macro releases (NFP, CPI, FOMC, ECB, BOE...) break two assumptions
that a short-term system depends on:

1. **Liquidity.** Tier-1 providers pull top-of-book depth before a release.
   Retail spreads on majors go from <1 pip to 5-30 pips for seconds to minutes.
   Your stop is not hit at the price on the candle -- it is hit several pips
   worse, so realised losses exceed the backtest's assumption.
2. **Continuity.** Macro surprises produce genuine *jumps*, not walks. Price
   gaps through levels, so a stop that was 12 pips away fills wherever the
   book reopens. Ederington & Lee (1993, Journal of Finance) found the bulk of
   the adjustment happens within the first minute, with volatility elevated
   ~15 minutes and slightly elevated for hours; Chaboud et al. showed the
   largest FX jumps cluster around scheduled announcements.

The filter therefore does not try to *trade* the news. It refuses to open
positions inside a window around scheduled events, and can optionally close
existing positions before the biggest ones. In other words it protects the
*validity of the backtest* as much as the account: the backtester assumes you
can exit near your stop, and around news you cannot.

Design
------
Three calendar sources, tried in order, all optional:

1. `FileCalendar` - a JSON list of events you maintain (or paste from any
   calendar). Default path `data/fxbot/news.json`.
2. `FinnhubFeed` - free API key, `https://finnhub.io/api/v1/calendar/economic`.
3. `RecurringRules` - deterministic approximations for events with fixed rules
   (US NFP is the first Friday of the month at 8:30 New York time). Approximate
   rules are flagged `approx=True` and can be disabled.

Everything degrades to "no events" (i.e. no filtering) rather than crashing.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import pandas as pd

log = logging.getLogger(__name__)

# impact: 3 = high (NFP, CPI, FOMC, rate decisions), 2 = medium (PMI, retail
# sales, jobless claims, minor central bank), 1 = low
HIGH, MEDIUM, LOW = 3, 2, 1

KNOWN_QUOTES = {"XAU": "gold", "XAG": "silver", "XPT": "platinum", "XPD": "palladium"}


@dataclass
class NewsEvent:
    time: datetime          # UTC
    currency: str           # "USD", "EUR", ...
    name: str
    impact: int = HIGH
    approx: bool = False    # rule-of-thumb date, not a confirmed schedule

    def to_dict(self) -> dict:
        return {"time": self.time.isoformat(), "currency": self.currency,
                "name": self.name, "impact": self.impact, "approx": self.approx}

    @classmethod
    def from_dict(cls, raw: dict) -> "NewsEvent":
        ts = raw.get("time") or raw.get("datetime") or raw.get("date")
        return cls(
            time=_parse_time(ts),
            currency=(raw.get("currency") or raw.get("country") or "").upper()[:3],
            name=raw.get("name") or raw.get("event") or "event",
            impact=int(raw.get("impact", HIGH)),
            approx=bool(raw.get("approx", False)),
        )


def _parse_time(value) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    text = str(value).strip().replace("Z", "")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        try:
            dt = datetime.strptime(text, "%Y-%m-%d %H:%M")
        except ValueError:
            dt = datetime.strptime(text[:10], "%Y-%m-%d")
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# --------------------------------------------------------------------- symbols
def symbol_currencies(symbol: str) -> Tuple[str, ...]:
    """frxEURUSD -> ('EUR', 'USD'); R_50 -> ('SYN',) for synthetics."""
    code = symbol[3:] if symbol.lower().startswith("frx") else symbol
    code = code.upper()
    if len(code) == 6 and code.isalpha():
        return (code[:3], code[3:])
    return (code,)


# ------------------------------------------------------------------- providers
class FileCalendar:
    """Events from a JSON file: a list of {time, currency, name, impact}."""

    def __init__(self, path: str | Path = "data/fxbot/news.json"):
        self.path = Path(path)

    def events(self) -> List[NewsEvent]:
        if not self.path.exists():
            return []
        try:
            raw = json.loads(self.path.read_text())
        except Exception as exc:  # noqa: BLE001
            log.warning("could not read news calendar %s: %s", self.path, exc)
            return []
        rows = raw.get("events", raw) if isinstance(raw, dict) else raw
        out = []
        for item in rows or []:
            try:
                out.append(NewsEvent.from_dict(item))
            except Exception as exc:  # noqa: BLE001
                log.warning("skipping bad calendar row %r: %s", item, exc)
        return out


class FinnhubFeed:
    """https://finnhub.io/api/v1/calendar/economic  (free key, 60 calls/min).

    Finnhub returns local exchange times; `utc_offset_hours` lets you correct
    it. The response's `impact` is a small integer or the words high/medium/low
    depending on the plan, so parsing is defensive.
    """

    URL = "https://finnhub.io/api/v1/calendar/economic"

    def __init__(self, token: str = "", utc_offset_hours: float = 0.0, timeout: float = 10.0):
        self.token = token
        self.utc_offset_hours = utc_offset_hours
        self.timeout = timeout

    def events(self) -> List[NewsEvent]:
        if not self.token:
            return []
        req = urllib.request.Request(f"{self.URL}?token={self.token}")
        req.add_header("Accept", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                payload = json.loads(resp.read().decode())
        except (urllib.error.HTTPError, OSError, ValueError) as exc:
            log.warning("finnhub economic calendar unavailable: %s", exc)
            return []
        rows = payload.get("economicCalendar", []) if isinstance(payload, dict) else []
        out = []
        for row in rows:
            try:
                ts = _parse_time(f"{row.get('date', '')} {row.get('time', '00:00')}")
                ts = ts - timedelta(hours=self.utc_offset_hours)
                raw_impact = row.get("impact")
                if raw_impact is None or raw_impact == "":
                    impact = MEDIUM
                elif isinstance(raw_impact, str) and not raw_impact.strip().lstrip("-").isdigit():
                    impact = {"high": HIGH, "medium": MEDIUM, "low": LOW}.get(
                        raw_impact.strip().lower(), MEDIUM)
                else:
                    impact = int(raw_impact)
                out.append(NewsEvent(time=ts, currency=str(row.get("country", "")).upper()[:3],
                                     name=str(row.get("event", "event")), impact=impact))
            except Exception as exc:  # noqa: BLE001
                log.debug("skipping finnhub row: %s", exc)
        return out


def us_eastern_is_dst(dt: datetime) -> bool:
    """US DST: 2nd Sunday in March 02:00 -> 1st Sunday in November 02:00."""
    year = dt.year
    march = pd.Timestamp(year=year, month=3, day=1, tz="UTC")
    start = march + pd.offsets.Week(weekday=6, n=1) + pd.Timedelta(hours=7)   # 02:00 EST = 07:00 UTC
    nov = pd.Timestamp(year=year, month=11, day=1, tz="UTC")
    end = nov + pd.offsets.Week(weekday=6) + pd.Timedelta(hours=6)            # 02:00 EDT = 06:00 UTC
    return start.to_pydatetime() <= dt <= end.to_pydatetime()


class RecurringRules:
    """Approximate schedules for events with deterministic rules.

    NFP is exact: first Friday of the month, 8:30 New York time. CPI is *not*
    (the BLS schedule shifts), so it is marked approx and can be turned off.
    """

    def __init__(self, months_ahead: int = 6, include_approx: bool = True):
        self.months_ahead = months_ahead
        self.include_approx = include_approx

    def events(self, now: Optional[datetime] = None) -> List[NewsEvent]:
        now = now or datetime.now(timezone.utc)
        out: List[NewsEvent] = []
        for m in range(0, self.months_ahead + 1):
            year, month = now.year, now.month + m
            year += (month - 1) // 12
            month = (month - 1) % 12 + 1
            out.append(self._nfp(year, month))
            if self.include_approx:
                out.append(self._cpi(year, month))
        return [e for e in out if e is not None]

    @staticmethod
    def _at_new_york(year: int, month: int, day: int, hour: int, minute: int) -> datetime:
        naive = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
        offset = 4 if us_eastern_is_dst(naive) else 5     # EDT = UTC-4, EST = UTC-5
        return naive + timedelta(hours=offset)

    @classmethod
    def _nfp(cls, year: int, month: int) -> NewsEvent:
        """US Employment Situation: first Friday, 8:30 New York time."""
        day = pd.Timestamp(year=year, month=month, day=1)
        first_friday = day + pd.offsets.Week(weekday=4)
        ts = cls._at_new_york(year, month, first_friday.day, 8, 30)
        return NewsEvent(ts, "USD", "US Non-Farm Payrolls", HIGH)

    @classmethod
    def _cpi(cls, year: int, month: int) -> NewsEvent:
        """US CPI: usually the second or third Wednesday, 8:30 New York time.

        Marked approximate -- treat it as 'some Wednesday mid-month' and verify
        against the published BLS calendar before relying on it.
        """
        day = pd.Timestamp(year=year, month=month, day=1)
        wednesdays = pd.date_range(day, day + pd.offsets.MonthEnd(0), freq="W-WED")
        if len(wednesdays) < 2:
            return None  # type: ignore[return-value]
        target = wednesdays[1] if len(wednesdays) > 2 else wednesdays[0]
        ts = cls._at_new_york(year, month, target.day, 8, 30)
        return NewsEvent(ts, "USD", "US CPI (approx)", HIGH, approx=True)


# --------------------------------------------------------------------- filter
@dataclass
class NewsConfig:
    enabled: bool = True
    min_impact: int = MEDIUM          # block events at or above this impact
    minutes_before_high: int = 30
    minutes_after_high: int = 30
    minutes_before_medium: int = 10
    minutes_after_medium: int = 10
    minutes_before_low: int = 0
    minutes_after_low: int = 0
    # close open positions ahead of HIGH-impact events (they would otherwise be
    # carried into the release by the max-holding timer)
    close_before_high: bool = True
    close_lead_minutes: int = 15
    # only block symbols whose currencies the event touches (USD news does not
    # block EURGBP)
    currency_scope: bool = True
    calendar_path: str = "data/fxbot/news.json"
    feed: str = "auto"                # auto | file | finnhub | rules | none
    finnhub_token: str = ""
    finnhub_utc_offset_hours: float = 0.0
    include_approx_rules: bool = True

    def window(self, impact: int) -> Tuple[int, int]:
        if impact >= HIGH:
            return self.minutes_before_high, self.minutes_after_high
        if impact == MEDIUM:
            return self.minutes_before_medium, self.minutes_after_medium
        return self.minutes_before_low, self.minutes_after_low


class NewsFilter:
    """Answers two questions: may I open, and should I close, right now?"""

    def __init__(self, cfg: NewsConfig, events: Optional[Sequence[NewsEvent]] = None):
        self.cfg = cfg
        self._events: List[NewsEvent] = list(events) if events is not None else []
        self._loaded = events is not None
        self.last_error: Optional[str] = None

    # ---------------------------------------------------------------- loading
    def events(self, force: bool = False) -> List[NewsEvent]:
        if self._loaded and not force:
            return self._events
        self._events = self._load()
        self._loaded = True
        return self._events

    def _load(self) -> List[NewsEvent]:
        """Never raises: a broken calendar degrades to 'no events'."""
        try:
            return self._load_unsafe()
        except Exception as exc:  # noqa: BLE001
            self.last_error = str(exc)
            log.warning("news calendar load failed: %s", exc)
            return []

    def _load_unsafe(self) -> List[NewsEvent]:
        feed = (self.cfg.feed or "auto").lower()
        self.last_error = None
        if feed == "none":
            return []
        file_events = []
        if feed in ("auto", "file"):
            file_events = FileCalendar(self.cfg.calendar_path).events()
        if feed == "file":
            return file_events
        if feed == "rules":
            return RecurringRules(include_approx=self.cfg.include_approx_rules).events()
        if feed == "finnhub":
            return FinnhubFeed(self.cfg.finnhub_token,
                               self.cfg.finnhub_utc_offset_hours).events()
        # auto: a hand-maintained file wins, then the remote feed, then the rules
        if file_events:
            return file_events
        remote = FinnhubFeed(self.cfg.finnhub_token, self.cfg.finnhub_utc_offset_hours).events()
        if remote:
            return remote
        return RecurringRules(include_approx=self.cfg.include_approx_rules).events()

    def refresh(self) -> int:
        self._events = self._load()
        self._loaded = True
        return len(self._events)

    # ---------------------------------------------------------------- queries
    def active_events(self, ts: Optional[datetime] = None, symbol: Optional[str] = None) -> List[NewsEvent]:
        """Events whose blackout window currently contains `ts`."""
        if not self.cfg.enabled:
            return []
        ts = ts or datetime.now(timezone.utc)
        out = []
        for ev in self.events():
            if ev.impact < self.cfg.min_impact:
                continue
            if symbol and self.cfg.currency_scope and ev.currency and \
                    ev.currency not in symbol_currencies(symbol):
                continue
            before, after = self.cfg.window(ev.impact)
            if before == 0 and after == 0:
                continue
            if ev.time - timedelta(minutes=before) <= ts <= ev.time + timedelta(minutes=after):
                out.append(ev)
        return out

    def is_blocked(self, ts: Optional[datetime] = None, symbol: Optional[str] = None) -> Tuple[bool, str]:
        events = self.active_events(ts, symbol)
        if not events:
            return False, ""
        ev = max(events, key=lambda e: e.impact)
        return True, f"news blackout: {ev.name} ({ev.currency}, impact {ev.impact})"

    def should_close(self, ts: Optional[datetime] = None, symbol: Optional[str] = None) -> Tuple[bool, str]:
        """True when a HIGH-impact event is close enough to warrant flattening."""
        if not self.cfg.enabled or not self.cfg.close_before_high:
            return False, ""
        ts = ts or datetime.now(timezone.utc)
        for ev in self.events():
            if ev.impact < HIGH:
                continue
            if symbol and self.cfg.currency_scope and ev.currency and \
                    ev.currency not in symbol_currencies(symbol):
                continue
            delta = (ev.time - ts).total_seconds() / 60.0
            if 0 <= delta <= self.cfg.close_lead_minutes:
                return True, f"{ev.name} in {delta:.0f} min"
        return False, ""

    def upcoming(self, limit: int = 10, now: Optional[datetime] = None,
                 symbol: Optional[str] = None) -> List[dict]:
        now = now or datetime.now(timezone.utc)
        rows = []
        for ev in self.events():
            if ev.impact < self.cfg.min_impact:
                continue
            if symbol and self.cfg.currency_scope and ev.currency and \
                    ev.currency not in symbol_currencies(symbol):
                continue
            if ev.time < now - timedelta(hours=6):
                continue
            before, after = self.cfg.window(ev.impact)
            rows.append({
                **ev.to_dict(),
                "in_minutes": round((ev.time - now).total_seconds() / 60.0, 1),
                "blackout_start": (ev.time - timedelta(minutes=before)).isoformat(),
                "blackout_end": (ev.time + timedelta(minutes=after)).isoformat(),
            })
        rows.sort(key=lambda r: r["time"])
        return rows[:limit]

    # ------------------------------------------------------- vectorised mask
    def blocked_mask(self, index: pd.DatetimeIndex, symbol: str) -> pd.Series:
        """Boolean mask over a bar index: True = this bar is inside a blackout.

        Used so backtests and live trading apply the *same* filter.
        """
        blocked = pd.Series(False, index=index)
        if not self.cfg.enabled:
            return blocked
        for ev in self.events():
            if ev.impact < self.cfg.min_impact:
                continue
            if self.cfg.currency_scope and ev.currency and ev.currency not in symbol_currencies(symbol):
                continue
            before, after = self.cfg.window(ev.impact)
            if before == 0 and after == 0:
                continue
            start = ev.time - timedelta(minutes=before)
            end = ev.time + timedelta(minutes=after)
            blocked |= (index >= start) & (index <= end)
        return blocked


def default_filter(cfg: Optional[NewsConfig] = None) -> NewsFilter:
    return NewsFilter(cfg or NewsConfig())
