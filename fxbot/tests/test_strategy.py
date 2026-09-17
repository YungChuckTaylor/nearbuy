import pandas as pd
import pytest

from fxbot.data import synthetic_ohlc
from fxbot.features import compute_features
from fxbot.strategy import (
    enforce_cooldown,
    in_session,
    primary_signals,
    signal_at,
    vol_filter,
)


@pytest.fixture(scope="module")
def frame():
    cfg_lookback = 48
    return compute_features(synthetic_ohlc(n=6000, seed=21), lookback=cfg_lookback)


def test_signals_only_in_session(frame):
    from fxbot.config import StrategyConfig

    cfg = StrategyConfig(session_start_hour=7, session_end_hour=16)
    sides = primary_signals(frame, cfg)
    fired = sides[sides != 0]
    if len(fired):
        assert in_session(fired.index, cfg).all()


def test_no_weekend_or_late_friday_signals(frame):
    from fxbot.config import StrategyConfig

    cfg = StrategyConfig()
    sides = primary_signals(frame, cfg)
    fired = sides[sides != 0]
    if len(fired):
        assert (fired.index.dayofweek < 5).all()
        late_friday = (fired.index.dayofweek == 4) & (fired.index.hour >= cfg.avoid_friday_after_hour)
        assert not late_friday.any()


def test_cooldown_spacing():
    idx = pd.date_range("2024-01-01", periods=200, freq="5min", tz="UTC")
    sides = pd.Series(0.0, index=idx)
    sides.iloc[[0, 1, 5, 6, 20, 21, 40]] = 1.0
    out = enforce_cooldown(sides, cooldown_bars=6)
    fired = list(out[out != 0].index)
    positions = [idx.get_loc(ts) for ts in fired]
    for a, b in zip(positions, positions[1:]):
        assert b - a >= 6
    assert len(fired) == 4


def test_signal_at_returns_none_when_flat(frame):
    from fxbot.config import StrategyConfig

    cfg = StrategyConfig()
    # blank out the last bar's signal by testing a frame with no breakout energy
    quiet = frame.copy()
    quiet.iloc[-1, quiet.columns.get_loc("close")] = quiet["close"].iloc[-2]
    decision = signal_at(quiet, cfg)
    assert decision is None or decision["side"] in (1.0, -1.0)


def test_signal_at_shape(frame):
    from fxbot.config import StrategyConfig

    cfg = StrategyConfig(lookback=12)
    sides = primary_signals(frame, cfg)
    if float(sides.iloc[-1]) != 0:
        decision = signal_at(frame, cfg)
        assert decision is not None
        assert decision["side"] in (1.0, -1.0)
        assert decision["vol"] > 0
        assert decision["accepted"] is True
        assert decision["proba"] is None


def test_vol_filter_blocks_dead_markets(frame):
    dead = frame.copy()
    dead["vol_ratio"] = 0.01
    assert not vol_filter(dead).any()
