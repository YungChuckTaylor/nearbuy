"""The secondary model: "should I take this setup?"

Deliberately a gradient-boosted tree on a few dozen tabular features. That
beats LSTM/Transformers on this kind of data almost every time, trains in
seconds, and you can read its permutation importances when it breaks.

Backends: LightGBM if installed, else scikit-learn's HistGradientBoosting.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, Optional, Sequence

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)


def _make_lightgbm(cfg):
    import lightgbm as lgb  # optional dependency

    return lgb.LGBMClassifier(
        n_estimators=cfg.n_estimators,
        learning_rate=cfg.learning_rate,
        max_depth=cfg.max_depth,
        min_child_samples=cfg.min_samples_leaf,
        subsample=0.9,
        subsample_freq=1,
        colsample_bytree=0.8,
        reg_lambda=1.0,
        verbose=-1,
        random_state=42,
    )


def _make_sklearn(cfg):
    from sklearn.ensemble import HistGradientBoostingClassifier

    return HistGradientBoostingClassifier(
        max_iter=max(50, cfg.n_estimators // 4),
        learning_rate=max(0.01, cfg.learning_rate * 3),
        max_depth=cfg.max_depth,
        min_samples_leaf=cfg.min_samples_leaf,
        l2_regularization=1.0,
        random_state=42,
    )


class MetaModel:
    """Thin wrapper so the engine doesn't care which backend is in play."""

    def __init__(self, estimator=None, backend: str = "sklearn",
                 feature_names: Optional[Sequence[str]] = None, cfg=None):
        self.estimator = estimator
        self.backend = backend
        self.feature_names = list(feature_names) if feature_names else None
        self.cfg = cfg

    # ----------------------------------------------------------------- build
    @classmethod
    def new(cls, cfg) -> "MetaModel":
        backend = cfg.backend
        if backend in ("auto", "lightgbm"):
            try:
                est = _make_lightgbm(cfg)
                return cls(est, backend="lightgbm", cfg=cfg)
            except Exception as exc:  # noqa: BLE001 - lightgbm is optional
                if backend == "lightgbm":
                    raise
                log.info("lightgbm unavailable (%s); using sklearn", exc)
        return cls(_make_sklearn(cfg), backend="sklearn", cfg=cfg)

    # ------------------------------------------------------------------ train
    def fit(self, X: pd.DataFrame, y: pd.Series, sample_weight: Optional[pd.Series] = None) -> "MetaModel":
        X = self._align(X)
        self.feature_names = list(X.columns)
        y = np.asarray(y).astype(int)
        kwargs = {}
        if sample_weight is not None:
            kwargs["sample_weight"] = np.asarray(sample_weight.reindex(X.index).fillna(1.0))
        log.info("fitting %s on %s rows x %s features (pos rate %.3f)",
                 self.backend, len(X), X.shape[1], y.mean())
        self.estimator.fit(X, y, **kwargs)
        return self

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        X = self._align(X)
        proba = self.estimator.predict_proba(X)
        # column order is [P(0), P(1)] for both backends
        if proba.shape[1] == 2:
            return proba[:, 1]
        return proba.ravel()

    def importances(self, X: pd.DataFrame, y: pd.Series, top: int = 20,
                    n_repeats: int = 4) -> pd.Series:
        """Permutation importance (works for both backends, comparable across them)."""
        from sklearn.inspection import permutation_importance

        X = self._align(X)
        y = np.asarray(y).astype(int)
        res = permutation_importance(self.estimator, X, y, n_repeats=n_repeats,
                                     random_state=0, scoring="roc_auc", n_jobs=1)
        imp = pd.Series(res.importances_mean, index=X.columns).sort_values(ascending=False)
        return imp.head(top)

    # -------------------------------------------------------------------- io
    def save(self, path: str | Path) -> Path:
        import joblib

        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"estimator": self.estimator, "backend": self.backend,
                     "feature_names": self.feature_names}, path)
        return path

    @classmethod
    def load(cls, path: str | Path) -> "MetaModel":
        import joblib

        blob = joblib.load(Path(path))
        return cls(blob["estimator"], blob.get("backend", "sklearn"), blob.get("feature_names"))

    # ----------------------------------------------------------------- utils
    def _align(self, X: pd.DataFrame) -> pd.DataFrame:
        X = X.astype(float).replace([np.inf, -np.inf], np.nan)
        if self.feature_names:
            missing = [c for c in self.feature_names if c not in X.columns]
            if missing:
                raise ValueError(f"model expects missing features: {missing}")
            X = X[self.feature_names]
        return X.fillna(0.0)


def classification_report(y_true: pd.Series, proba: np.ndarray, threshold: float = 0.5) -> Dict[str, float]:
    """Metrics that matter for a *filter*, not for a forecaster.

    Accuracy is useless here: skipping a winning trade costs opportunity, taking
    a losing trade costs money. So we track precision (of taken trades), the
    take rate, and the realised edge of taken vs skipped trades.
    """
    y_true = np.asarray(y_true).astype(int)
    pred = (np.asarray(proba) >= threshold).astype(int)
    taken = pred.sum()
    if taken == 0:
        return {"threshold": threshold, "taken": 0, "take_rate": 0.0,
                "win_rate_taken": float("nan"), "win_rate_all": float(y_true.mean())}
    from sklearn.metrics import roc_auc_score

    try:
        auc = float(roc_auc_score(y_true, np.asarray(proba)))
    except ValueError:
        auc = float("nan")
    return {
        "threshold": threshold,
        "taken": int(taken),
        "take_rate": float(taken / len(y_true)),
        "win_rate_taken": float(y_true[pred == 1].mean()),
        "win_rate_skipped": float(y_true[pred == 0].mean()) if (pred == 0).any() else float("nan"),
        "win_rate_all": float(y_true.mean()),
        "roc_auc": auc,
    }
