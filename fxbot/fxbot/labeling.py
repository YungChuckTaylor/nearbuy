"""Triple-barrier labelling + leakage-safe cross-validation splits.

The label is what the *trade* does, not what the *price* does next: every event
gets a take-profit barrier, a stop-loss barrier and a time stop, all scaled by
the bar's volatility. That keeps the training target aligned with the backtester
(see backtest.py, which walks the same barriers).

Reference: Lopez de Prado, Advances in Financial Machine Learning, ch. 3 & 7.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from .features import ewma_vol


@dataclass
class BarrierSpec:
    take_profit_k: float = 2.0     # in units of EWMA bar volatility
    stop_loss_k: float = 1.0
    max_holding_bars: int = 36
    vol_halflife: int = 20
    min_vol: float = 1e-6


def barrier_levels(price: float, vol: float, spec: BarrierSpec) -> Tuple[float, float]:
    """(take_profit_price, stop_loss_price) for a long; mirrored by the caller for shorts."""
    tp = price * (1.0 + spec.take_profit_k * vol)
    sl = price * (1.0 - spec.stop_loss_k * vol)
    return tp, sl


def volatility_estimate(df: pd.DataFrame, spec: Optional[BarrierSpec] = None) -> pd.Series:
    """EWMA bar volatility, falling back to a true-range proxy at the head of the sample."""
    spec = spec or BarrierSpec()
    vol = ewma_vol(np.log(df["close"]).diff(), halflife=spec.vol_halflife)
    fallback = ((df["high"] - df["low"]) / df["close"]).rolling(20, min_periods=1).mean() / 2.0
    return vol.fillna(fallback).fillna(spec.min_vol).clip(lower=spec.min_vol)


def triple_barrier_labels(df: pd.DataFrame, sides: pd.Series,
                          spec: Optional[BarrierSpec] = None,
                          vol: Optional[pd.Series] = None) -> pd.DataFrame:
    """Label each event in `sides` (index aligned to `df`).

    `sides` holds +1 (long) / -1 (short). Rows with 0/NaN are skipped.

    Returns a DataFrame indexed like `sides` with:
      label : +1 take-profit hit, -1 stop-loss hit, 0 time stop
      t1    : timestamp of the resolving bar (for purging)
      gross : signed fractional price move at exit, excluding costs
      bars  : bars held
    """
    spec = spec or BarrierSpec()
    close = df["close"].to_numpy()
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    index = df.index
    pos = {ts: i for i, ts in enumerate(index)}

    vol_series = volatility_estimate(df, spec) if vol is None else pd.Series(vol).reindex(index).ffill()

    records = []
    for ts, side in sides.items():
        side = float(side)
        if not np.isfinite(side) or side == 0 or ts not in pos:
            continue
        i0 = pos[ts]
        entry = close[i0]
        vol = float(vol_series.loc[ts])
        if not np.isfinite(vol) or vol <= 0:
            continue
        up_move = spec.take_profit_k * vol
        down_move = spec.stop_loss_k * vol
        if side > 0:
            tp = entry * (1.0 + up_move)
            sl = entry * (1.0 - down_move)
        else:
            tp = entry * (1.0 - up_move)
            sl = entry * (1.0 + down_move)

        label, exit_i = 0, min(i0 + spec.max_holding_bars, len(close) - 1)
        for j in range(i0 + 1, min(i0 + spec.max_holding_bars, len(close) - 1) + 1):
            hit_tp = (high[j] >= tp) if side > 0 else (low[j] <= tp)
            hit_sl = (low[j] <= sl) if side > 0 else (high[j] >= sl)
            if hit_sl and hit_tp:
                # Conservative: assume the stop filled first when a bar spans both.
                label, exit_i = -1, j
                break
            if hit_sl:
                label, exit_i = -1, j
                break
            if hit_tp:
                label, exit_i = 1, j
                break
        exit_price = tp if label == 1 else sl if label == -1 else close[exit_i]
        records.append({
            "ts": ts,
            "side": side,
            "label": label,
            "t1": index[exit_i],
            "gross": (exit_price / entry - 1.0) * side,
            "bars": exit_i - i0,
        })

    out = pd.DataFrame.from_records(records, columns=["ts", "side", "label", "t1", "gross", "bars"])
    if out.empty:
        return out.set_index("ts")
    return out.set_index("ts").sort_index()


def meta_labels(labels: pd.DataFrame, train_threshold: float = 0.5) -> pd.Series:
    """Binary target for the meta-model: 1 = take the trade, 0 = skip it."""
    return (labels["label"] > 0).astype(int)


def sample_weights(labels: pd.DataFrame) -> pd.Series:
    """Sequential-style de-weighting: overlapping events share weight.

    Full sequential bootstrap is O(n^2); this uses a cheap concurrency-based
    approximation that solves the same problem (highly overlapping events in
    calm regimes shouldn't dominate the loss).
    """
    if labels.empty:
        return pd.Series(dtype=float)
    concurrency = _concurrency(labels)
    weights = 1.0 / concurrency.clip(lower=1.0)
    return weights / weights.mean()


def _concurrency(labels: pd.DataFrame) -> pd.Series:
    starts = labels.index.to_numpy()
    ends = labels["t1"].to_numpy()
    n = len(starts)
    counts = np.ones(n, dtype=float)
    for i in range(n):
        overlap = ((starts >= starts[i]) & (starts <= ends[i])).sum()
        counts[i] = max(overlap, 1)
    return pd.Series(counts, index=labels.index)


def walk_forward_splits(times: pd.Series, t1: Optional[pd.Series] = None,
                        n_splits: int = 5, embargo_frac: float = 0.01,
                        min_train_frac: float = 0.25) -> List[Tuple[np.ndarray, np.ndarray]]:
    """Anchored walk-forward splits with purging + embargo, in POSITIONAL terms.

    `times` is the event (bar-close) timestamp per row, sorted; `t1` is the
    timestamp at which that row's label resolves. Fold k trains on every row
    before the cut (minus an embargo tail) and tests on [cut, next_cut).

    Purging: any training row whose label resolves at or after the first test
    timestamp is dropped -- otherwise the training set would contain the answer.
    Positional output keeps this usable with a MultiIndex (symbol, ts) frame.

    This is stricter than textbook purged k-fold: it never trains on the future.
    """
    times = pd.Series(times).reset_index(drop=True)
    n = len(times)
    if n < 100:
        return []
    embargo = max(1, int(n * embargo_frac))
    first_cut = int(n * min_train_frac)
    cuts = np.linspace(first_cut, n, n_splits + 1).astype(int)
    t1_vals = pd.Series(t1).reset_index(drop=True) if t1 is not None else None
    splits: List[Tuple[np.ndarray, np.ndarray]] = []
    for k in range(n_splits):
        test_start, test_end = int(cuts[k]), int(cuts[k + 1])
        if test_end - test_start < 5:
            continue
        train_pos = np.arange(0, max(0, test_start - embargo))
        if t1_vals is not None:
            test_start_ts = times.iloc[test_start]
            resolved = t1_vals.iloc[train_pos].fillna(test_start_ts + pd.Timedelta(seconds=1))
            train_pos = train_pos[(resolved < test_start_ts).to_numpy()]
        if len(train_pos) < 50:
            continue
        splits.append((train_pos, np.arange(test_start, test_end)))
    return splits


def summarize_labels(labels: pd.DataFrame) -> dict:
    if labels.empty:
        return {"n": 0}
    return {
        "n": int(len(labels)),
        "tp_rate": float((labels["label"] > 0).mean()),
        "sl_rate": float((labels["label"] < 0).mean()),
        "timeout_rate": float((labels["label"] == 0).mean()),
        "mean_bars": float(labels["bars"].mean()),
        "mean_gross": float(labels["gross"].mean()),
    }
