import numpy as np
import pandas as pd
import pytest

from fxbot.data import synthetic_ohlc
from fxbot.features import FEATURE_COLUMNS, compute_features, feature_matrix, warmup_bars


@pytest.fixture(scope="module")
def frame():
    df = synthetic_ohlc(n=3000, seed=11)
    return compute_features(df)


def test_all_feature_columns_present(frame):
    missing = [c for c in FEATURE_COLUMNS if c not in frame.columns]
    assert not missing, f"missing features: {missing}"


def test_no_nans_after_warmup(frame):
    X = feature_matrix(frame).iloc[warmup_bars():]
    bad = X.columns[X.isna().any()].tolist()
    assert not bad, f"NaNs remain after warmup in: {bad}"


def test_features_are_causal():
    """Truncating the future must not change any feature value in the past."""
    df = synthetic_ohlc(n=1500, seed=3)
    full = compute_features(df)
    cut = compute_features(df.iloc[:1000])
    common = cut.index.intersection(full.index)
    common = common[common >= full.index[warmup_bars()]]
    for col in FEATURE_COLUMNS:
        a = cut.loc[common, col].astype(float).to_numpy()
        b = full.loc[common, col].astype(float).to_numpy()
        assert np.allclose(a, b, atol=1e-12, rtol=1e-10, equal_nan=True), f"{col} peeks at the future"


def test_vol_is_positive_and_reasonable(frame):
    vol = frame["vol"].dropna()
    assert (vol > 0).all()
    assert vol.median() < 0.01  # sane for FX 5-minute bars


def test_session_flags_exclusive_enough(frame):
    flags = frame[["in_asia", "in_london", "in_ny"]]
    assert flags.sum(axis=1).max() <= 1.0
    assert frame["in_overlap"].isin([0.0, 1.0]).all()


def test_rsi_range(frame):
    rsi = frame["rsi_14"].dropna()
    assert rsi.between(0, 100).all()
