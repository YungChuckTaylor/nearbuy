import numpy as np
import pandas as pd
import pytest

from fxbot.features import compute_features
from fxbot.labeling import (
    BarrierSpec,
    meta_labels,
    sample_weights,
    triple_barrier_labels,
    volatility_estimate,
    walk_forward_splits,
)


def make_frame(closes, spread=0.00005):
    idx = pd.date_range("2024-01-01", periods=len(closes), freq="5min", tz="UTC")
    closes = np.asarray(closes, dtype=float)
    return pd.DataFrame({
        "open": closes,
        "high": closes + spread,
        "low": closes - spread,
        "close": closes,
    }, index=idx)


def label_first_bar(closes, side, spec, vol_value=0.001, spread=0.00005):
    """Label a single event at bar 0 with a FIXED volatility so barriers are exact."""
    df = make_frame(closes, spread=spread)
    feats = compute_features(df)
    vol = pd.Series(vol_value, index=df.index)
    sides = pd.Series(float(side), index=[df.index[0]])
    return triple_barrier_labels(feats, sides, spec, vol=vol)


def test_take_profit_label():
    # entry 1.1000, TP +0.2% = 1.1022, SL -0.1% = 1.0989
    labels = label_first_bar([1.1000, 1.1010, 1.1030, 1.1060, 1.1110], 1,
                             BarrierSpec(take_profit_k=2.0, stop_loss_k=1.0, max_holding_bars=10))
    assert len(labels) == 1
    assert labels["label"].iloc[0] == 1
    assert labels["bars"].iloc[0] == 2
    assert labels["gross"].iloc[0] > 0


def test_stop_loss_label():
    # short into a rally: SL +0.1% = 1.1011 is touched at bar 2
    labels = label_first_bar([1.1000, 1.1005, 1.1015, 1.1030, 1.1040], -1,
                             BarrierSpec(take_profit_k=2.0, stop_loss_k=1.0, max_holding_bars=10))
    assert labels["label"].iloc[0] == -1
    assert labels["gross"].iloc[0] < 0


def test_time_stop_label():
    labels = label_first_bar([1.1000 + 1e-6 * i for i in range(40)], 1,
                             BarrierSpec(take_profit_k=50.0, stop_loss_k=50.0, max_holding_bars=5))
    assert labels["label"].iloc[0] == 0
    assert labels["bars"].iloc[0] == 5


def test_both_barriers_in_one_bar_assumes_stop():
    """A bar that spans both levels must be booked as a loss, not a win."""
    labels = label_first_bar([1.1000, 1.1000], 1,
                             BarrierSpec(take_profit_k=1.0, stop_loss_k=1.0, max_holding_bars=5),
                             vol_value=0.01, spread=0.05)
    assert labels["label"].iloc[0] == -1


def test_volatility_estimate_is_positive():
    df = make_frame(list(1.1 + 0.0001 * np.sin(np.arange(200) / 5) + 0.00001 * np.arange(200)))
    vol = volatility_estimate(df)
    assert (vol > 0).all()
    assert not vol.isna().any()


def test_meta_labels_and_weights():
    df = make_frame(list(1.1 + 0.001 * np.sin(np.arange(60) / 3)))
    feats = compute_features(df)
    sides = pd.Series(1.0, index=df.index[:5])
    labels = triple_barrier_labels(feats, sides, BarrierSpec(max_holding_bars=3))
    assert not labels.empty
    y = meta_labels(labels)
    assert set(y.unique()) <= {0, 1}
    w = sample_weights(labels)
    assert len(w) == len(labels)
    assert (w > 0).all()


def test_walk_forward_splits_purge_and_ordering():
    """No training row may resolve at or after the first test timestamp."""
    idx = pd.date_range("2024-01-01", periods=1000, freq="5min", tz="UTC")
    times = pd.Series(idx)
    rng = np.random.default_rng(0)
    t1 = pd.Series(idx + pd.to_timedelta(rng.integers(1, 200, size=len(idx)), unit="m"))
    splits = walk_forward_splits(times, t1, n_splits=5, embargo_frac=0.01)
    assert len(splits) >= 3
    for train_pos, test_pos in splits:
        assert train_pos.max() < test_pos.min(), "training data must strictly precede the test fold"
        first_test_ts = times.iloc[test_pos.min()]
        assert (t1.iloc[train_pos] < first_test_ts).all(), "unpurged overlapping label"
        assert len(train_pos) > 50
