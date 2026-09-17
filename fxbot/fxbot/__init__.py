"""fxbot -- a Deriv-based FX trading system you can actually audit.

Modules, in the order you'll use them:

    config.py     settings tree (JSON + env overrides)
    deriv.py      Deriv WebSocket API client
    data.py       candles -> pandas, caching, synthetic data for offline work
    features.py   causal feature engineering
    labeling.py   triple-barrier labels + purged walk-forward splits
    strategy.py   rule-based primary signals
    model.py      the ML filter ("take this setup or skip it?")
    risk.py       sizing + the brakes
    backtest.py   barrier simulator with real costs
    broker.py     Deriv order placement
    state.py      crash-safe state
    engine.py     the run loop (long-lived or one-shot)
    pipeline.py   research: dataset -> walk-forward CV -> OOS comparison
    cli.py        entrypoint
"""

__version__ = "0.1.0"
