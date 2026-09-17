import pandas as pd
import pytest

from fxbot.config import Config
from fxbot.data import synthetic_ohlc
from fxbot.pipeline import build_dataset, compare_filter, walk_forward_evaluate


@pytest.fixture(scope="module")
def cfg_and_frames():
    cfg = Config()
    cfg.data.symbols = ["frxEURUSD", "frxGBPUSD"]
    cfg.data.granularity = 300
    cfg.strategy.lookback = 12          # small lookback => plenty of events for a smoke test
    cfg.strategy.cooldown_bars = 3
    cfg.strategy.max_holding_bars = 18
    frames = {s: synthetic_ohlc(n=9000, seed=41 + i, freq="5min")
              for i, s in enumerate(cfg.data.symbols)}
    return cfg, frames


def test_build_dataset(cfg_and_frames):
    cfg, frames = cfg_and_frames
    ds = build_dataset(cfg, frames)
    assert not ds.X.empty
    assert len(ds.X) == len(ds.y) == len(ds.w) == len(ds.t1) == len(ds.times)
    assert set(ds.y.unique()) <= {0, 1}
    assert ds.X.isna().sum().sum() == 0
    assert ds.times.is_monotonic_increasing
    # labels must resolve after the event
    assert (ds.t1.to_numpy() >= ds.times.to_numpy()).all()


def test_walk_forward_evaluate(cfg_and_frames):
    cfg, frames = cfg_and_frames
    ds = build_dataset(cfg, frames)
    report, oos, model = walk_forward_evaluate(cfg, ds)
    scored = oos.dropna()
    assert len(scored) > 0, "no out-of-sample predictions -- not enough events"
    assert report["n_test"].sum() == len(scored)
    assert model is not None
    assert 0.0 <= scored.min() and scored.max() <= 1.0


def test_compare_filter(cfg_and_frames):
    cfg, frames = cfg_and_frames
    ds = build_dataset(cfg, frames)
    _, oos, _ = walk_forward_evaluate(cfg, ds)
    table = compare_filter(cfg, ds, oos)
    assert set(table["variant"]) >= {"take_all", f"model>={cfg.model.threshold}"}
    assert table["n_trades"].sum() > 0
    assert "commission_pct_of_risk" in table.columns
