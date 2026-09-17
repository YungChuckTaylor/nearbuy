"""Historical candles -> pandas DataFrame, with on-disk caching and a synthetic
generator so the whole pipeline can be exercised offline."""

from __future__ import annotations

import gzip
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List, Optional

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

OHLC_COLUMNS = ["open", "high", "low", "close"]


def candles_to_df(candles: Iterable[dict]) -> pd.DataFrame:
    """Convert Deriv `ticks_history` (style=candles) output to a UTC-indexed frame.

    Deriv returns one extra (still-forming) candle when end='latest'; the caller
    should drop it with :func:`drop_incomplete`.
    """
    rows = []
    for c in candles:
        rows.append({
            "epoch": int(c["epoch"]),
            "open": float(c["open"]),
            "high": float(c["high"]),
            "low": float(c["low"]),
            "close": float(c["close"]),
        })
    df = pd.DataFrame(rows, columns=["epoch"] + OHLC_COLUMNS)
    if df.empty:
        return pd.DataFrame(columns=OHLC_COLUMNS, index=pd.DatetimeIndex([], name="time", tz="UTC"))
    df = df.drop_duplicates(subset="epoch").sort_values("epoch")
    df.index = pd.to_datetime(df["epoch"], unit="s", utc=True)
    df.index.name = "time"
    return df[OHLC_COLUMNS]


def drop_incomplete(df: pd.DataFrame, granularity: int, now_epoch: Optional[int] = None) -> pd.DataFrame:
    """Drop the currently-forming bar so backtests never peek at a partial candle."""
    if df.empty:
        return df
    now_epoch = now_epoch if now_epoch is not None else int(datetime.now(timezone.utc).timestamp())
    last_epochs = df.index.astype("int64") // 10**9
    return df[last_epochs + granularity <= now_epoch]


def resample(df: pd.DataFrame, granularity_seconds: int) -> pd.DataFrame:
    """Upsample M1 -> M5 etc. Only aggregate (never invent bars)."""
    rule = f"{granularity_seconds}s"
    out = df.resample(rule).agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
    return out


async def fetch_history(client, symbol: str, granularity: int = 300, bars: int = 5000,
                        page_size: int = 5000) -> pd.DataFrame:
    """Pull `bars` candles, paging backwards in time (Deriv caps count at 5000)."""
    frames: List[pd.DataFrame] = []
    remaining = bars
    end: Optional[int] = None
    while remaining > 0:
        take = min(page_size, remaining)
        resp = await client.candles(symbol, granularity=granularity, count=take, end=end)
        candles = resp.get("candles") or resp.get("history", {}).get("candles") or []
        if not candles:
            break
        frame = candles_to_df(candles)
        frames.append(frame)
        remaining -= len(frame)
        if len(frame) < take:
            break
        oldest = int(frame.index[0].timestamp())
        end = oldest  # page further back
    if not frames:
        return pd.DataFrame(columns=OHLC_COLUMNS, index=pd.DatetimeIndex([], name="time", tz="UTC"))
    df = pd.concat(frames).sort_index()
    df = df[~df.index.duplicated(keep="last")]
    return df.iloc[-bars:]


# --------------------------------------------------------------------- cache
@dataclass
class Cache:
    directory: Path

    def path_for(self, symbol: str, granularity: int) -> Path:
        self.directory.mkdir(parents=True, exist_ok=True)
        return self.directory / f"{symbol}_{granularity}.csv.gz"

    def load(self, symbol: str, granularity: int) -> Optional[pd.DataFrame]:
        path = self.path_for(symbol, granularity)
        if not path.exists():
            return None
        df = pd.read_csv(path, index_col=0, parse_dates=True)
        if df.index.tzinfo is None:
            df.index = df.index.tz_localize("UTC")
        return df

    def save(self, df: pd.DataFrame, symbol: str, granularity: int) -> Path:
        path = self.path_for(symbol, granularity)
        with gzip.open(path, "wt", newline="") as fh:
            df.to_csv(fh)
        return path


def synthetic_ohlc(n: int = 20000, seed: int = 7, start: str = "2023-01-01",
                   freq: str = "5min", vol: float = 0.00035, drift: float = 0.0,
                   regime_every: int = 4000) -> pd.DataFrame:
    """Deterministic fake market for tests and offline demos.

    A GBM with volatility regimes: no real edge should be findable in it, which
    makes it a good sanity check -- a strategy that "works" here is a bug.
    """
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start=start, periods=n, freq=freq, tz="UTC")
    # piecewise-constant vol regimes
    n_blocks = max(1, n // regime_every)
    block_vols = rng.uniform(0.5, 2.0, size=n_blocks + 1) * vol
    vol_path = np.repeat(block_vols, regime_every)[:n]
    shocks = rng.standard_normal(n) * vol_path
    log_ret = drift + shocks
    close = 1.10 * np.exp(np.cumsum(log_ret))
    # build a plausible bar from close-to-close plus intrabar noise
    open_ = np.concatenate([[close[0]], close[:-1]])
    wick = np.abs(rng.standard_normal(n)) * vol_path * close
    high = np.maximum(open_, close) + wick
    low = np.minimum(open_, close) - wick
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close}, index=idx)


def load_json(path: str | Path) -> dict:
    return json.loads(Path(path).read_text())
