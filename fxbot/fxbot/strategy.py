"""Primary (rule-based) signals -- the part you can explain to a human.

The ML model (model.py) never decides direction here; it only decides whether
to take a setup this rule produced. That separation keeps the sample large, the
behaviour interpretable, and the debugging possible.

All signals are evaluated on the CLOSE of bar t and executed at the OPEN of bar
t+1 (see backtest.run_backtest). Nothing looks past bar t.
"""

from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

from .config import StrategyConfig

STRATEGIES = ("donchian_breakout", "ema_pullback", "rsi_reversal")


def in_session(index: pd.DatetimeIndex, cfg: StrategyConfig) -> pd.Series:
    """Tradeable-window mask: weekday, inside the session, not late Friday."""
    hour = index.hour + index.minute / 60.0
    mask = (
        (index.dayofweek < 5)
        & (hour >= cfg.session_start_hour)
        & (hour < cfg.session_end_hour)
        & ~((index.dayofweek == 4) & (hour >= cfg.avoid_friday_after_hour))
    )
    return pd.Series(mask, index=index)


def vol_filter(frame: pd.DataFrame, lo: float = 0.55, hi: float = 2.5) -> pd.Series:
    """Skip dead markets (costs eat you) and panic markets (stops slip)."""
    vr = frame.get("vol_ratio")
    if vr is None:
        return pd.Series(True, index=frame.index)
    return (vr > lo) & (vr < hi)


def donchian_breakout(frame: pd.DataFrame, cfg: StrategyConfig) -> pd.Series:
    """Breakout of the last `lookback` bars, with the trend, in a live-enough market."""
    hi = frame["high"].rolling(cfg.lookback, min_periods=cfg.lookback).max().shift(1)
    lo = frame["low"].rolling(cfg.lookback, min_periods=cfg.lookback).min().shift(1)
    close = frame["close"]
    trend_up = frame["ema_fast"] > frame["ema_slow"]
    trend_dn = frame["ema_fast"] < frame["ema_slow"]

    long = (close > hi) & trend_up
    short = (close < lo) & trend_dn
    sides = pd.Series(0.0, index=frame.index)
    sides[long] = 1.0
    sides[short] = -1.0
    return sides


def ema_pullback(frame: pd.DataFrame, cfg: StrategyConfig) -> pd.Series:
    """Buy pullbacks to the fast EMA in an uptrend (and mirror for shorts)."""
    close, low, high = frame["close"], frame["low"], frame["high"]
    fast, slow = frame["ema_fast"], frame["ema_slow"]
    touched_fast_below = (low <= fast).rolling(3, min_periods=1).max().astype(bool)
    touched_fast_above = (high >= fast).rolling(3, min_periods=1).max().astype(bool)

    long = (fast > slow) & (close > slow) & touched_fast_below & (close > fast) & (close > close.shift(1))
    short = (fast < slow) & (close < slow) & touched_fast_above & (close < fast) & (close < close.shift(1))
    sides = pd.Series(0.0, index=frame.index)
    sides[long] = 1.0
    sides[short] = -1.0
    return sides


def rsi_reversal(frame: pd.DataFrame, cfg: StrategyConfig) -> pd.Series:
    """Fade extremes, but only against the edges of the recent range."""
    rsi = frame["rsi_14"]
    hi = frame["high"].rolling(cfg.lookback, min_periods=cfg.lookback).max().shift(1)
    lo = frame["low"].rolling(cfg.lookback, min_periods=cfg.lookback).min().shift(1)
    close = frame["close"]
    long = (rsi < cfg.rsi_lower) & (close <= lo.rolling(6, min_periods=1).min() * 1.0005)
    short = (rsi > cfg.rsi_upper) & (close >= hi.rolling(6, min_periods=1).max() * 0.9995)
    sides = pd.Series(0.0, index=frame.index)
    sides[long] = 1.0
    sides[short] = -1.0
    return sides


def primary_signals(frame: pd.DataFrame, cfg: StrategyConfig,
                    name: Optional[str] = None,
                    news_mask: Optional[pd.Series] = None) -> pd.Series:
    """Return a +1/-1/0 side per bar, after session + volatility + news filters."""
    name = name or cfg.name
    if name == "donchian_breakout":
        raw = donchian_breakout(frame, cfg)
    elif name == "ema_pullback":
        raw = ema_pullback(frame, cfg)
    elif name == "rsi_reversal":
        raw = rsi_reversal(frame, cfg)
    else:
        raise ValueError(f"unknown strategy {name!r}; choose from {STRATEGIES}")

    ok = in_session(frame.index, cfg) & vol_filter(frame)
    if news_mask is not None:
        ok = ok & ~news_mask.reindex(frame.index).fillna(False).astype(bool)
    return raw.where(ok, 0.0).astype(float)


def enforce_cooldown(sides: pd.Series, cooldown_bars: int) -> pd.Series:
    """At most one entry per `cooldown_bars` (also the de-facto re-entry guard)."""
    if cooldown_bars <= 0:
        return sides
    out = sides.copy()
    last = -10**9
    values = out.to_numpy(copy=True)
    for i, v in enumerate(values):
        if v != 0:
            if i - last < cooldown_bars:
                values[i] = 0.0
            else:
                last = i
    return pd.Series(values, index=sides.index)


def signal_at(frame: pd.DataFrame, cfg: StrategyConfig, name: Optional[str] = None,
              model=None, threshold: float = 0.5,
              news_mask: Optional[pd.Series] = None) -> Optional[dict]:
    """Evaluate the LATEST closed bar and return a decision dict (or None).

    This is what the live engine calls. It never touches a bar that is still
    forming -- the caller must pass a frame whose last row is a completed bar.
    """
    sides = enforce_cooldown(primary_signals(frame, cfg, name, news_mask=news_mask),
                             cfg.cooldown_bars)
    if sides.empty or float(sides.iloc[-1]) == 0.0:
        return None
    ts = sides.index[-1]
    side = float(sides.iloc[-1])
    decision = {
        "ts": ts,
        "side": side,
        "strategy": name or cfg.name,
        "price": float(frame["close"].iloc[-1]),
        "vol": float(frame["vol"].iloc[-1]),
        "atr": float(frame.get("atr", pd.Series(np.nan, index=frame.index)).iloc[-1]),
        "proba": None,
        "accepted": True,
        "reason": "signal",
    }
    if model is not None:
        from .features import feature_matrix  # local import to avoid a cycle

        X = feature_matrix(frame.iloc[[-1]])
        p = float(model.predict_proba(X)[0])
        decision["proba"] = p
        decision["accepted"] = p >= threshold
        decision["reason"] = f"p(win)={p:.3f} vs threshold {threshold:.2f}"
    return decision
