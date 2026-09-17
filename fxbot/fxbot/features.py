"""Causal feature engineering.

Every feature here is computed from information available at or before the bar's
close. There is no `.shift(-1)`, no centered rolling window, and no forward
fill. If you add a feature, add it to `FEATURE_COLUMNS` and to the leakage test
in `tests/test_features.py`.
"""

from __future__ import annotations

from typing import List

import numpy as np
import pandas as pd

FEATURE_COLUMNS: List[str] = [
    "ret_1", "ret_3", "ret_6", "ret_12", "ret_48",
    "vol", "vol_ratio",
    "atr_pct",
    "rsi_14",
    "zscore_48",
    "mom_5", "mom_15", "mom_60",
    "range_pos_20",
    "body_ratio",
    "dist_donchian_hi", "dist_donchian_lo",
    "ema_spread_atr",
    "hour_sin", "hour_cos",
    "dow_sin", "dow_cos",
    "in_asia", "in_london", "in_ny", "in_overlap",
    "bars_since_hi", "bars_since_lo",
]


def ewma_vol(returns: pd.Series, halflife: int = 20) -> pd.Series:
    """EWMA volatility of bar returns (in price-fraction terms)."""
    return returns.ewm(halflife=halflife, min_periods=max(5, halflife // 2)).std()


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100 - (100 / (1 + rs))
    return out.fillna(50.0)


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - prev_close).abs(),
        (df["low"] - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr


def session_flags(index: pd.DatetimeIndex) -> pd.DataFrame:
    """Rough FX session map in UTC (ignores DST, which shifts these by an hour)."""
    hour = index.hour + index.minute / 60.0

    def between(h, a, b):
        return ((h >= a) & (h < b)).astype(float)

    return pd.DataFrame({
        "in_asia": between(hour, 0, 7),
        "in_london": between(hour, 7, 12),
        "in_ny": between(hour, 12, 17),
        "in_overlap": between(hour, 12, 16),
    }, index=index)


def compute_features(df: pd.DataFrame, lookback: int = 48, atr_period: int = 14,
                     ema_fast: int = 12, ema_slow: int = 48,
                     vol_halflife: int = 20) -> pd.DataFrame:
    """Return a frame with OHLC + helper columns + FEATURE_COLUMNS (NaNs at the head)."""
    out = df.copy()
    close = out["close"]
    ret = np.log(close).diff()

    out["ret_1"] = ret
    for k in (3, 6, 12, 48):
        out[f"ret_{k}"] = np.log(close).diff(k)

    vol = ewma_vol(ret, halflife=vol_halflife)
    out["vol"] = vol
    out["vol_ratio"] = vol / vol.rolling(200, min_periods=50).mean()

    atr = true_range(out).ewm(alpha=1 / atr_period, min_periods=atr_period).mean()
    out["atr_pct"] = atr / close

    out["rsi_14"] = rsi(close, 14)

    sma48 = close.rolling(lookback, min_periods=lookback).mean()
    sd48 = close.rolling(lookback, min_periods=lookback).std()
    out["zscore_48"] = (close - sma48) / sd48.replace(0.0, np.nan)

    for k in (5, 15, 60):
        out[f"mom_{k}"] = close / close.shift(k) - 1.0

    hi20 = out["high"].rolling(20, min_periods=20).max()
    lo20 = out["low"].rolling(20, min_periods=20).min()
    out["range_pos_20"] = (close - lo20) / (hi20 - lo20).replace(0.0, np.nan)

    rng = (out["high"] - out["low"]).replace(0.0, np.nan)
    out["body_ratio"] = (out["close"] - out["open"]) / rng

    don_hi = out["high"].rolling(lookback, min_periods=lookback).max().shift(1)
    don_lo = out["low"].rolling(lookback, min_periods=lookback).min().shift(1)
    atr_safe = atr.replace(0.0, np.nan)
    out["dist_donchian_hi"] = (close - don_hi) / atr_safe
    out["dist_donchian_lo"] = (don_lo - close) / atr_safe

    ema_f = close.ewm(span=ema_fast, min_periods=ema_fast).mean()
    ema_s = close.ewm(span=ema_slow, min_periods=ema_slow).mean()
    out["ema_spread_atr"] = (ema_f - ema_s) / atr_safe
    out["ema_fast"] = ema_f
    out["ema_slow"] = ema_s

    hour = out.index.hour + out.index.minute / 60.0
    out["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
    out["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)
    dow = out.index.dayofweek
    out["dow_sin"] = np.sin(2 * np.pi * dow / 7.0)
    out["dow_cos"] = np.cos(2 * np.pi * dow / 7.0)

    out = out.join(session_flags(out.index))

    # how long ago the rolling extremum was set
    roll_hi = out["high"].rolling(lookback, min_periods=lookback).max()
    roll_lo = out["low"].rolling(lookback, min_periods=lookback).min()
    is_hi = (out["high"] >= roll_hi).astype(float)
    is_lo = (out["low"] <= roll_lo).astype(float)
    out["bars_since_hi"] = _bars_since(is_hi, lookback)
    out["bars_since_lo"] = _bars_since(is_lo, lookback)

    out["atr"] = atr
    out["vol_ewma"] = vol
    return out


def _bars_since(flag: pd.Series, cap: int) -> pd.Series:
    """Number of bars since `flag` was last 1, capped at `cap`."""
    out = np.zeros(len(flag), dtype=float)
    last = -1
    for i, v in enumerate(flag.to_numpy()):
        if v > 0:
            last = i
        out[i] = cap if last < 0 else min(cap, i - last)
    return pd.Series(out, index=flag.index)


def feature_matrix(frame: pd.DataFrame) -> pd.DataFrame:
    """Select + clean the model input matrix (drops warm-up rows)."""
    X = frame[FEATURE_COLUMNS].astype(float)
    return X.replace([np.inf, -np.inf], np.nan)


def warmup_bars(lookback: int = 48) -> int:
    """Rows to drop at the head because of rolling windows (200-bar vol_ratio)."""
    return max(200, lookback * 2)
