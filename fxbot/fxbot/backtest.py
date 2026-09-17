"""Barrier walk-forward backtester with real Deriv multiplier costs.

Design rules:
  * signal on bar t close -> fill at bar t+1 open (no same-bar fills)
  * if a bar spans both the stop and the target, assume the STOP filled first
  * costs: commission on notional + half-spread/slippage on entry and exit
  * one position per symbol at a time, plus a cooldown between entries

If your strategy's expectancy here is positive but you used different fill
assumptions in training, the number is fiction. Keep them identical -- the
triple-barrier labeller and this simulator use the same barrier maths.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

import numpy as np
import pandas as pd

from .config import CostConfig, RiskConfig
from .risk import commission_for, stake_for_risk, stop_distance_pct

BPS = 1e-4


@dataclass
class BacktestResult:
    trades: pd.DataFrame
    equity: pd.Series
    metrics: Dict[str, float] = field(default_factory=dict)

    def summary(self) -> str:
        m = self.metrics
        if not m:
            return "no trades"
        return (
            f"trades={int(m['n_trades']):<5} win_rate={m['win_rate']:.3f}  "
            f"expectancy={m['expectancy_r']:+.4f}R  PF={m['profit_factor']:.2f}\n"
            f"total_return={m['total_return_pct']:+.2f}%  max_dd={m['max_drawdown_pct']:.2f}%  "
            f"sharpe={m['sharpe']:.2f}\n"
            f"avg_hold={m['avg_hold_bars']:.1f} bars  "
            f"cost={m['cost_pct_of_risk']:.1f}% of risk/trade  "
            f"(commission {m['commission_pct_of_risk']:.1f}%)"
        )


def adverse_price(price: float, side: int, bps: float) -> float:
    """Move the price against you by `bps` basis points."""
    return price * (1.0 + side * bps * BPS)


def run_backtest(frame: pd.DataFrame, sides: pd.Series, *,
                 stop_loss_k: float = 1.0, take_profit_k: float = 2.0,
                 max_holding_bars: int = 36, cooldown_bars: int = 6,
                 costs: Optional[CostConfig] = None,
                 risk: Optional[RiskConfig] = None,
                 equity0: float = 10_000.0,
                 granularity: int = 300,
                 proba: Optional[pd.Series] = None,
                 threshold: float = 0.5,
                 max_trades: Optional[int] = None) -> BacktestResult:
    """Simulate the rules on one symbol's feature frame."""
    costs = costs or CostConfig()
    risk = risk or RiskConfig()

    close_arr = frame["close"].to_numpy()
    open_arr = frame["open"].to_numpy()
    high_arr = frame["high"].to_numpy()
    low_arr = frame["low"].to_numpy()
    vol_arr = frame["vol"].to_numpy() if "vol" in frame else np.full(len(frame), np.nan)
    index = frame.index

    sides = sides.reindex(index).fillna(0.0)
    if proba is not None:
        proba = proba.reindex(index).fillna(0.0)
        sides = sides.where(proba >= threshold, 0.0)

    equity = float(equity0)
    equity_marks: List[tuple] = []       # (exit bar position, equity after that trade)
    trades: List[dict] = []
    last_exit_i = -10**9

    side_vals = sides.to_numpy()
    for i in range(len(index) - 1):
        side = side_vals[i]
        if side == 0 or not np.isfinite(side):
            continue
        if i - last_exit_i <= cooldown_bars:
            continue
        j_entry = i + 1
        if j_entry >= len(index):
            break
        vol = vol_arr[i]
        if not np.isfinite(vol) or vol <= 0:
            continue

        side = float(side)
        stop_pct = stop_distance_pct(vol, stop_loss_k)
        tp_pct = stop_pct * (take_profit_k / stop_loss_k if stop_loss_k else 2.0)
        stake = stake_for_risk(equity, risk.risk_per_trade_pct, stop_pct, risk.multiplier, risk)
        if stake < risk.min_stake:
            continue
        risk_money = stake * risk.multiplier * stop_pct

        entry_raw = open_arr[j_entry]
        entry = adverse_price(entry_raw, int(side), costs.spread_bps / 2 + costs.slippage_bps)
        if side > 0:
            stop_price = entry * (1.0 - stop_pct)
            tp_price = entry * (1.0 + tp_pct)
        else:
            stop_price = entry * (1.0 + stop_pct)
            tp_price = entry * (1.0 - tp_pct)

        exit_i = min(j_entry + max_holding_bars, len(index) - 1)
        outcome, exit_price = "timeout", close_arr[exit_i]
        for j in range(j_entry, exit_i + 1):
            hit_stop = (low_arr[j] <= stop_price) if side > 0 else (high_arr[j] >= stop_price)
            hit_tp = (high_arr[j] >= tp_price) if side > 0 else (low_arr[j] <= tp_price)
            if hit_stop:
                # stop first when both are in the same bar: the pessimistic fill
                outcome = "stop"
                exit_price = adverse_price(stop_price, int(side), costs.slippage_bps)
                exit_i = j
                break
            if hit_tp:
                outcome = "tp"
                exit_price = tp_price
                exit_i = j
                break
        if outcome == "timeout":
            exit_price = adverse_price(close_arr[exit_i], int(side), costs.spread_bps / 2)

        move = (exit_price / entry - 1.0) * side
        gross_money = stake * risk.multiplier * move
        n_commissions = 2 if costs.commission_on_exit else 1
        commission = commission_for(stake, risk.multiplier, costs.commission_rate) * n_commissions
        pnl = gross_money - commission
        equity += pnl

        trades.append({
            "entry_time": index[j_entry],
            "exit_time": index[exit_i],
            "side": int(side),
            "entry": entry,
            "exit": exit_price,
            "stake": stake,
            "notional": stake * risk.multiplier,
            "stop_pct": stop_pct,
            "outcome": outcome,
            "bars": exit_i - j_entry,
            "pnl_money": pnl,
            "commission": commission,
            "gross_money": gross_money,
            "r": pnl / risk_money if risk_money else 0.0,
            "equity": equity,
        })
        equity_marks.append((exit_i, equity))
        last_exit_i = exit_i
        if max_trades and len(trades) >= max_trades:
            break

    # Equity is flat between trade exits (no mark-to-market on open trades).
    equity_path = np.full(len(index), np.nan)
    equity_path[0] = equity0
    for exit_i, eq in equity_marks:
        equity_path[min(exit_i, len(index) - 1):] = eq
    equity_series = pd.Series(equity_path, index=index).ffill().fillna(equity0)

    trades_df = pd.DataFrame(trades)
    if not trades_df.empty:
        trades_df = trades_df.set_index("entry_time")
    return BacktestResult(trades_df, equity_series, compute_metrics(trades_df, equity_series, granularity))


def compute_metrics(trades: pd.DataFrame, equity: pd.Series, granularity: int = 300) -> Dict[str, float]:
    if trades.empty:
        return {"n_trades": 0}
    r = trades["r"].astype(float)
    pnl = trades["pnl_money"].astype(float)
    wins, losses = pnl[pnl > 0], pnl[pnl < 0]
    gross_win = float(wins.sum())
    gross_loss = float(-losses.sum())

    equity = equity.dropna()
    dd = (equity / equity.cummax() - 1.0)
    max_dd = float(-dd.min() * 100.0) if len(dd) else 0.0
    daily = equity.resample("1D").last().dropna().pct_change().dropna()
    if len(daily) > 2 and daily.std() > 0:
        sharpe = float(daily.mean() / daily.std() * np.sqrt(252))
    else:
        sharpe = 0.0

    n = len(trades)
    return {
        "n_trades": int(n),
        "win_rate": float((pnl > 0).mean()),
        "tp_rate": float((trades["outcome"] == "tp").mean()),
        "stop_rate": float((trades["outcome"] == "stop").mean()),
        "timeout_rate": float((trades["outcome"] == "timeout").mean()),
        "expectancy_r": float(r.mean()),
        "std_r": float(r.std(ddof=1)) if n > 1 else 0.0,
        "t_stat": float(r.mean() / (r.std(ddof=1) / np.sqrt(n))) if n > 1 and r.std(ddof=1) > 0 else 0.0,
        "profit_factor": gross_win / gross_loss if gross_loss > 0 else float("inf"),
        "total_return_pct": float(equity.iloc[-1] / equity.iloc[0] * 100 - 100),
        "max_drawdown_pct": max_dd,
        "sharpe": sharpe,
        "avg_hold_bars": float(trades["bars"].mean()),
        "total_pnl": float(pnl.sum()),
        "total_commission": float(trades["commission"].sum()),
        # commission as % of the money risked: the single most important cost number
        "commission_pct_of_risk": float(_commission_over_risk(trades) * 100),
        "cost_pct_of_risk": float(_commission_over_risk(trades) * 100),
    }


def _commission_over_risk(trades: pd.DataFrame) -> float:
    """Mean commission expressed as a fraction of the money risked on the trade."""
    risk_money = trades["notional"] * trades["stop_pct"]
    risk_money = risk_money.replace(0, np.nan)
    return float((trades["commission"] / risk_money).mean())


def walk_forward_report(frame: pd.DataFrame, side_fn, *, n_splits: int = 5, **kwargs) -> pd.DataFrame:
    """Run `run_backtest` on consecutive time slices (out-of-sample sanity).

    `side_fn(frame_slice) -> pd.Series` so callers can re-fit a model per fold.
    """
    index = frame.index
    cuts = np.linspace(0, len(index), n_splits + 1).astype(int)
    rows = []
    for k in range(n_splits):
        sl = frame.iloc[cuts[k]: cuts[k + 1]]
        if len(sl) < 100:
            continue
        res = run_backtest(sl, side_fn(sl), **kwargs)
        if not res.metrics:
            continue
        m = dict(res.metrics)
        m["fold"] = k
        m["start"] = sl.index[0]
        m["end"] = sl.index[-1]
        rows.append(m)
    return pd.DataFrame(rows)
