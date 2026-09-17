"""End-to-end research pipeline: features -> labels -> purged walk-forward -> OOS trades.

Everything here is offline: give it cached candles and it will tell you, per
fold, whether the model's filter adds anything over taking every setup.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .backtest import compute_metrics, run_backtest
from .config import Config
from .features import compute_features, feature_matrix, warmup_bars
from .labeling import BarrierSpec, meta_labels, sample_weights, triple_barrier_labels
from .model import MetaModel, classification_report
from .strategy import enforce_cooldown, primary_signals

log = logging.getLogger(__name__)


@dataclass
class Dataset:
    X: pd.DataFrame                # pooled features, MultiIndex (symbol, ts)
    y: pd.Series                   # 1 = take the trade
    w: pd.Series                   # sample weights
    times: pd.Series               # bar timestamp per row (same order as X)
    t1: pd.Series                  # label resolution time per row
    frames: Dict[str, pd.DataFrame]
    sides: Dict[str, pd.Series]
    labels: pd.DataFrame


def build_dataset(cfg: Config, frames: Dict[str, pd.DataFrame]) -> Dataset:
    """Features + triple-barrier labels for every symbol, pooled for training."""
    spec = BarrierSpec(
        take_profit_k=cfg.strategy.take_profit_k,
        stop_loss_k=cfg.strategy.stop_loss_k,
        max_holding_bars=cfg.strategy.max_holding_bars,
    )
    Xs, ys, ws, t1s, times = [], [], [], [], []
    out_frames: Dict[str, pd.DataFrame] = {}
    out_sides: Dict[str, pd.Series] = {}
    all_labels = []

    for symbol, df in frames.items():
        feats = compute_features(
            df,
            lookback=cfg.strategy.lookback,
            atr_period=cfg.strategy.atr_period,
            ema_fast=cfg.strategy.ema_fast,
            ema_slow=cfg.strategy.ema_slow,
        )
        feats = feats.iloc[warmup_bars(cfg.strategy.lookback):]
        if feats.empty:
            continue
        sides = enforce_cooldown(primary_signals(feats, cfg.strategy), cfg.strategy.cooldown_bars)
        sides = sides[sides != 0]
        if sides.empty:
            log.warning("%s: no primary signals in this sample", symbol)
            continue
        labels = triple_barrier_labels(feats, sides, spec)
        if labels.empty:
            continue
        X = feature_matrix(feats).loc[labels.index]
        X.index = pd.MultiIndex.from_product([[symbol], labels.index], names=["symbol", "ts"])
        y = meta_labels(labels, cfg.model.train_threshold)
        y.index = X.index
        w = sample_weights(labels)
        w.index = X.index
        t1 = pd.Series(labels["t1"].to_numpy(), index=X.index)
        times_ = pd.Series(labels.index.to_numpy(), index=X.index)

        Xs.append(X)
        ys.append(y)
        ws.append(w)
        t1s.append(t1)
        times.append(times_)
        out_frames[symbol] = feats
        out_sides[symbol] = sides.reindex(feats.index).fillna(0.0)
        lab = labels.copy()
        lab["symbol"] = symbol
        all_labels.append(lab)

    if not Xs:
        return Dataset(pd.DataFrame(), pd.Series(dtype=int), pd.Series(dtype=float),
                       pd.Series(dtype="datetime64[ns, UTC]"), pd.Series(dtype="datetime64[ns, UTC]"),
                       {}, {}, pd.DataFrame())

    X = pd.concat(Xs)
    y = pd.concat(ys)
    w = pd.concat(ws)
    t1 = pd.concat(t1s)
    times_ = pd.concat(times)
    order = times_.sort_values().index
    X, y, w, t1, times_ = X.loc[order], y.loc[order], w.loc[order], t1.loc[order], times_.loc[order]
    labels_df = pd.concat(all_labels) if all_labels else pd.DataFrame()
    return Dataset(X, y, w, times_, t1, out_frames, out_sides, labels_df)


def walk_forward_evaluate(cfg: Config, ds: Dataset) -> Tuple[pd.DataFrame, pd.Series, Optional[MetaModel]]:
    """Purged walk-forward CV. Returns (fold report, out-of-sample probabilities, final model)."""
    from .labeling import walk_forward_splits

    splits = walk_forward_splits(ds.times, ds.t1, n_splits=5, embargo_frac=0.01)
    oos = pd.Series(np.nan, index=ds.X.index, dtype=float)
    rows = []
    for fold, (train_pos, test_pos) in enumerate(splits):
        X_tr, y_tr = ds.X.iloc[train_pos], ds.y.iloc[train_pos]
        X_te, y_te = ds.X.iloc[test_pos], ds.y.iloc[test_pos]
        w_tr = ds.w.iloc[train_pos]
        model = MetaModel.new(cfg.model)
        model.fit(X_tr, y_tr, w_tr)
        proba = model.predict_proba(X_te)
        oos.iloc[test_pos] = proba
        rep = classification_report(y_te, proba, cfg.model.threshold)
        rep.update({"fold": fold, "n_train": len(X_tr), "n_test": len(X_te),
                    "train_start": ds.times.iloc[train_pos].min(),
                    "test_start": ds.times.iloc[test_pos].min(),
                    "test_end": ds.times.iloc[test_pos].max()})
        rows.append(rep)
        log.info("fold %s: %s", fold, rep)

    report = pd.DataFrame(rows)
    final: Optional[MetaModel] = None
    if not ds.X.empty:
        final = MetaModel.new(cfg.model).fit(ds.X, ds.y, ds.w)
    return report, oos, final


def oos_backtest(cfg: Config, ds: Dataset, oos_proba: Optional[pd.Series],
                 equity0: float = 10_000.0) -> Dict[str, object]:
    """Run the backtester on the out-of-sample probabilities, per symbol."""
    results: Dict[str, object] = {}
    all_trades = []
    for symbol, frame in ds.frames.items():
        proba = None
        if oos_proba is not None:
            try:
                proba = oos_proba.loc[symbol]
                proba.index = pd.DatetimeIndex(proba.index)
            except KeyError:
                proba = None
        res = run_backtest(
            frame,
            ds.sides[symbol],
            stop_loss_k=cfg.strategy.stop_loss_k,
            take_profit_k=cfg.strategy.take_profit_k,
            max_holding_bars=cfg.strategy.max_holding_bars,
            cooldown_bars=cfg.strategy.cooldown_bars,
            costs=cfg.costs,
            risk=cfg.risk,
            equity0=equity0,
            granularity=cfg.data.granularity,
            proba=proba,
            threshold=cfg.model.threshold,
        )
        results[symbol] = res
        if not res.trades.empty:
            t = res.trades.copy()
            t["symbol"] = symbol
            all_trades.append(t)

    if all_trades:
        trades = pd.concat(all_trades).sort_values("exit_time")
        equity = pd.Series(equity0 + trades["pnl_money"].cumsum().to_numpy(),
                           index=pd.DatetimeIndex(trades["exit_time"]))
        results["_combined"] = compute_metrics(trades, equity, cfg.data.granularity)
        results["_trades"] = trades
    return results


def compare_filter(cfg: Config, ds: Dataset, oos_proba: Optional[pd.Series],
                   equity0: float = 10_000.0) -> pd.DataFrame:
    """The question that matters: does the ML filter beat taking every setup?"""
    rows = []
    variants = {"take_all": None}
    if oos_proba is not None:
        variants[f"model>={cfg.model.threshold}"] = oos_proba
    for name, proba in variants.items():
        res = oos_backtest(cfg, ds, proba, equity0=equity0)
        combined = res.get("_combined")
        if not combined:
            rows.append({"variant": name, "n_trades": 0})
            continue
        rows.append({
            "variant": name,
            "n_trades": combined["n_trades"],
            "win_rate": combined["win_rate"],
            "expectancy_r": combined["expectancy_r"],
            "t_stat": combined["t_stat"],
            "profit_factor": combined["profit_factor"],
            "total_return_pct": combined["total_return_pct"],
            "max_drawdown_pct": combined["max_drawdown_pct"],
            "sharpe": combined["sharpe"],
            "commission_pct_of_risk": combined["commission_pct_of_risk"],
        })
    return pd.DataFrame(rows)


def load_frames(cfg: Config, symbols: Optional[List[str]] = None) -> Dict[str, pd.DataFrame]:
    from pathlib import Path

    from .data import Cache

    cache = Cache(Path(cfg.data.cache_dir))
    frames = {}
    for symbol in (symbols or cfg.data.symbols):
        df = cache.load(symbol, cfg.data.granularity)
        if df is None or df.empty:
            log.warning("no cached data for %s (run `fetch-data` first)", symbol)
            continue
        frames[symbol] = df
    return frames
