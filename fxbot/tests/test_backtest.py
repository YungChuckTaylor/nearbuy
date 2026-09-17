import numpy as np
import pandas as pd
import pytest

from fxbot.backtest import run_backtest
from fxbot.config import CostConfig, RiskConfig, StrategyConfig
from fxbot.data import synthetic_ohlc
from fxbot.features import compute_features
from fxbot.strategy import enforce_cooldown, primary_signals


def prepared(n=4000, seed=5):
    df = synthetic_ohlc(n=n, seed=seed)
    feats = compute_features(df)
    sides = enforce_cooldown(primary_signals(feats, StrategyConfig()), StrategyConfig().cooldown_bars)
    return feats, sides


def test_trades_are_generated_and_reported():
    feats, sides = prepared()
    res = run_backtest(feats, sides, costs=CostConfig(), risk=RiskConfig(), granularity=300)
    assert res.metrics.get("n_trades", 0) > 10
    assert 0.0 <= res.metrics["win_rate"] <= 1.0
    assert set(res.trades["outcome"]) <= {"tp", "stop", "timeout"}


def test_costs_make_things_worse():
    """Zero-cost vs realistic-cost: the gap is the broker's take."""
    feats, sides = prepared()
    free = run_backtest(feats, sides, costs=CostConfig(commission_rate=0.0, spread_bps=0.0,
                                                       slippage_bps=0.0), risk=RiskConfig())
    real = run_backtest(feats, sides, costs=CostConfig(), risk=RiskConfig())
    assert real.metrics["total_pnl"] < free.metrics["total_pnl"]
    assert real.metrics["commission_pct_of_risk"] > 0


def test_on_random_walk_edge_is_not_miraculous():
    """A random-walk market plus these rules must not produce a fat positive edge."""
    feats, sides = prepared(n=6000, seed=99)
    res = run_backtest(feats, sides, costs=CostConfig(), risk=RiskConfig(), granularity=300)
    # With costs on, expectancy in R should not be dramatically positive.
    assert res.metrics["expectancy_r"] < 0.25, "suspicious edge on synthetic noise -- check for leakage"


def test_tight_stop_is_more_expensive_per_unit_of_risk():
    feats, sides = prepared()
    tight = run_backtest(feats, sides, stop_loss_k=0.5, take_profit_k=1.0,
                         costs=CostConfig(), risk=RiskConfig())
    wide = run_backtest(feats, sides, stop_loss_k=4.0, take_profit_k=8.0,
                        costs=CostConfig(), risk=RiskConfig())
    assert tight.metrics["commission_pct_of_risk"] > wide.metrics["commission_pct_of_risk"] * 2


def _trend_frame(start: float, end: float, n: int = 120, vol: float = 0.002):
    """A clean trending frame with an EXPLICIT volatility column.

    run_backtest sizes barriers off frame["vol"], so pinning it makes the
    take-profit / stop-loss levels exact and the test deterministic.
    """
    idx = pd.date_range("2024-01-03 08:00", periods=n, freq="5min", tz="UTC")  # Tuesday, in session
    closes = np.linspace(start, end, n)
    df = pd.DataFrame({"open": closes, "high": closes + 0.00002,
                       "low": closes - 0.00002, "close": closes}, index=idx)
    feats = compute_features(df)
    feats["vol"] = vol           # 20 pips of "bar volatility": barrier SL = 2%, TP = 4%
    sides = pd.Series(0.0, index=idx)
    sides.iloc[20] = 1.0
    return feats, sides


def test_deterministic_winning_trade():
    """A clean rally: the long must hit the take profit and make money."""
    feats, sides = _trend_frame(1.10, 1.12)
    res = run_backtest(feats, sides, stop_loss_k=1.0, take_profit_k=2.0,
                       max_holding_bars=60, cooldown_bars=0,
                       costs=CostConfig(), risk=RiskConfig(),
                       equity0=100_000, granularity=300)
    assert res.metrics["n_trades"] == 1
    assert res.trades["outcome"].iloc[0] == "tp"
    assert res.trades["pnl_money"].iloc[0] > 0
    assert res.trades["r"].iloc[0] > 1.0          # ~2R before costs


def test_stops_are_bookable_when_price_goes_against():
    """A clean slide: the long must be stopped out for about the planned risk."""
    feats, sides = _trend_frame(1.12, 1.10)
    res = run_backtest(feats, sides, stop_loss_k=1.0, take_profit_k=2.0,
                       max_holding_bars=60, cooldown_bars=0,
                       costs=CostConfig(), risk=RiskConfig(),
                       equity0=100_000, granularity=300)
    assert res.trades["outcome"].iloc[0] == "stop"
    assert res.trades["pnl_money"].iloc[0] < 0
    r = res.trades["r"].iloc[0]
    assert -2.0 < r < -1.0        # -1R by design, the rest is commission + slippage


def test_cost_vanishes_with_a_wide_stop():
    """Same trade, wider stop: commission as a share of risk collapses."""
    feats, sides = _trend_frame(1.12, 1.10, vol=0.002)
    tight = run_backtest(feats, sides, stop_loss_k=0.25, take_profit_k=0.5,
                         max_holding_bars=60, cooldown_bars=0,
                         costs=CostConfig(), risk=RiskConfig(),
                         equity0=100_000, granularity=300)
    wide = run_backtest(feats, sides, stop_loss_k=2.0, take_profit_k=4.0,
                        max_holding_bars=60, cooldown_bars=0,
                        costs=CostConfig(), risk=RiskConfig(),
                        equity0=100_000, granularity=300)
    assert wide.metrics["commission_pct_of_risk"] < tight.metrics["commission_pct_of_risk"] / 4
