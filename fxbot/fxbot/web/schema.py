"""Parameter metadata that drives the dashboard UI and validates edits.

One place to declare every knob: the web form, the range clamping and the help
text all come from here, so adding a config field means adding one entry.
"""

from __future__ import annotations

from typing import Any, Dict, List

GRANULARITIES = [
    {"value": 60, "label": "M1 (60s)"},
    {"value": 300, "label": "M5 (300s)"},
    {"value": 900, "label": "M15 (900s)"},
    {"value": 1800, "label": "M30 (1800s)"},
    {"value": 3600, "label": "H1 (3600s)"},
    {"value": 14400, "label": "H4 (14400s)"},
]

FIELDS: List[Dict[str, Any]] = [
    # ---------------------------------------------------------------- data
    {"key": "data.symbols", "group": "Market & data", "label": "Symbols", "type": "symbols",
     "help": "Deriv symbols, comma separated. frxEURUSD, frxGBPUSD, frxXAUUSD, R_75 ..."},
    {"key": "data.granularity", "group": "Market & data", "label": "Bar size", "type": "select",
     "options": GRANULARITIES,
     "help": "Bigger bars = wider stops in pips = lower commission share of risk."},
    {"key": "data.history_bars", "group": "Market & data", "label": "History bars (training)",
     "type": "int", "min": 1000, "max": 100000, "step": 1000},
    {"key": "data.cache_dir", "group": "Market & data", "label": "Cache directory", "type": "str"},
    {"key": "data.live_bars", "group": "Market & data", "label": "Bars per live cycle",
     "type": "int", "min": 300, "max": 5000, "step": 100,
     "help": "Must exceed the 200-bar feature warm-up."},

    # ------------------------------------------------------------ strategy
    {"key": "strategy.name", "group": "Strategy", "label": "Signal rule", "type": "select",
     "options": ["donchian_breakout", "ema_pullback", "rsi_reversal"],
     "help": "The rule that proposes trades. The model only decides whether to take them."},
    {"key": "strategy.lookback", "group": "Strategy", "label": "Lookback (bars)", "type": "int",
     "min": 4, "max": 400, "step": 2, "help": "Channel length for breakouts."},
    {"key": "strategy.atr_period", "group": "Strategy", "label": "ATR period", "type": "int",
     "min": 3, "max": 100},
    {"key": "strategy.ema_fast", "group": "Strategy", "label": "Fast EMA", "type": "int", "min": 2, "max": 200},
    {"key": "strategy.ema_slow", "group": "Strategy", "label": "Slow EMA", "type": "int", "min": 3, "max": 400},
    {"key": "strategy.rsi_period", "group": "Strategy", "label": "RSI period", "type": "int", "min": 2, "max": 50},
    {"key": "strategy.rsi_lower", "group": "Strategy", "label": "RSI lower (fade level)",
     "type": "float", "min": 1, "max": 45, "step": 1},
    {"key": "strategy.rsi_upper", "group": "Strategy", "label": "RSI upper (fade level)",
     "type": "float", "min": 55, "max": 99, "step": 1},
    {"key": "strategy.stop_loss_k", "group": "Strategy", "label": "Stop (x bar volatility)",
     "type": "float", "min": 0.25, "max": 20, "step": 0.25,
     "help": "THE COST DIAL. Wider stop = cheaper commission per unit of risk."},
    {"key": "strategy.take_profit_k", "group": "Strategy", "label": "Target (x bar volatility)",
     "type": "float", "min": 0.25, "max": 40, "step": 0.25},
    {"key": "strategy.max_holding_bars", "group": "Strategy", "label": "Time stop (bars)",
     "type": "int", "min": 2, "max": 500},
    {"key": "strategy.cooldown_bars", "group": "Strategy", "label": "Cooldown between entries (bars)",
     "type": "int", "min": 0, "max": 100},
    {"key": "strategy.session_start_hour", "group": "Strategy", "label": "Session start (UTC hour)",
     "type": "int", "min": 0, "max": 23,
     "help": "Fixed UTC hours: ignores DST. London/NY overlap is ~12:00-16:00 UTC."},
    {"key": "strategy.session_end_hour", "group": "Strategy", "label": "Session end (UTC hour)",
     "type": "int", "min": 0, "max": 23},
    {"key": "strategy.avoid_friday_after_hour", "group": "Strategy", "label": "No new trades Friday after (UTC hour)",
     "type": "int", "min": 0, "max": 23},

    # --------------------------------------------------------------- model
    {"key": "model.enabled", "group": "ML filter", "label": "Use the model filter", "type": "bool",
     "help": "When off, every rule signal is taken (baseline)."},
    {"key": "model.backend", "group": "ML filter", "label": "Backend", "type": "select",
     "options": ["auto", "lightgbm", "sklearn"]},
    {"key": "model.threshold", "group": "ML filter", "label": "Take-trade threshold P(win)",
     "type": "float", "min": 0.0, "max": 0.99, "step": 0.01,
     "help": "Higher = fewer, pickier trades. Your main precision/recall dial."},
    {"key": "model.n_estimators", "group": "ML filter", "label": "Trees / iterations", "type": "int",
     "min": 50, "max": 3000, "step": 50},
    {"key": "model.learning_rate", "group": "ML filter", "label": "Learning rate", "type": "float",
     "min": 0.005, "max": 0.3, "step": 0.005},
    {"key": "model.max_depth", "group": "ML filter", "label": "Max depth", "type": "int", "min": 2, "max": 12},
    {"key": "model.min_samples_leaf", "group": "ML filter", "label": "Min samples per leaf",
     "type": "int", "min": 5, "max": 500, "step": 5,
     "help": "Raise this if the model memorises the training folds."},
    {"key": "model.model_path", "group": "ML filter", "label": "Model file", "type": "str"},
    {"key": "model.train_threshold", "group": "ML filter", "label": "Label threshold (training)",
     "type": "float", "min": 0.0, "max": 1.0, "step": 0.05},

    # ---------------------------------------------------------------- risk
    {"key": "risk.risk_per_trade_pct", "group": "Risk", "label": "Risk per trade (% of equity)",
     "type": "float", "min": 0.05, "max": 5.0, "step": 0.05,
     "help": "0.25-0.5% is sane. Above ~2% a normal losing streak ends the account."},
    {"key": "risk.max_daily_loss_pct", "group": "Risk", "label": "Daily loss cap (%)", "type": "float",
     "min": 0.5, "max": 20, "step": 0.5, "help": "Halts new entries for the rest of the UTC day."},
    {"key": "risk.max_open_trades", "group": "Risk", "label": "Max open trades", "type": "int", "min": 1, "max": 20},
    {"key": "risk.multiplier", "group": "Risk", "label": "Deriv multiplier (leverage)", "type": "int",
     "min": 2, "max": 1000, "step": 1,
     "help": "Does NOT change commission as a share of risk - only the stop width does."},
    {"key": "risk.max_notional_x_equity", "group": "Risk", "label": "Max notional / equity", "type": "float",
     "min": 1, "max": 200, "step": 1},
    {"key": "risk.max_stake_pct", "group": "Risk", "label": "Max stake (% of equity)", "type": "float",
     "min": 0.5, "max": 50, "step": 0.5},
    {"key": "risk.min_stake", "group": "Risk", "label": "Minimum stake", "type": "float",
     "min": 0.5, "max": 100, "step": 0.5},

    # --------------------------------------------------------------- costs
    {"key": "costs.commission_rate", "group": "Costs", "label": "Commission rate (x notional)",
     "type": "float", "min": 0.0, "max": 0.01, "step": 0.000001,
     "help": "Deriv publishes ~0.000199 for multipliers. Verify with 'costs --probe'."},
    {"key": "costs.commission_on_exit", "group": "Costs", "label": "Charge commission on exit too",
     "type": "bool", "help": "Pessimistic default; relax once you have measured it."},
    {"key": "costs.spread_bps", "group": "Costs", "label": "Spread (bps of price)", "type": "float",
     "min": 0.0, "max": 20, "step": 0.1},
    {"key": "costs.slippage_bps", "group": "Costs", "label": "Slippage (bps, per fill)", "type": "float",
     "min": 0.0, "max": 50, "step": 0.1},

    # ---------------------------------------------------------------- news
    {"key": "news.enabled", "group": "News blackout", "label": "Enable news blackout", "type": "bool",
     "help": "Blocks new entries around scheduled macro releases."},
    {"key": "news.min_impact", "group": "News blackout", "label": "Minimum impact to block", "type": "select",
     "options": [{"value": 1, "label": "1 - low and above"},
                 {"value": 2, "label": "2 - medium and above"},
                 {"value": 3, "label": "3 - high only"}]},
    {"key": "news.minutes_before_high", "group": "News blackout", "label": "Minutes before (high impact)",
     "type": "int", "min": 0, "max": 240},
    {"key": "news.minutes_after_high", "group": "News blackout", "label": "Minutes after (high impact)",
     "type": "int", "min": 0, "max": 240,
     "help": "Volatility stays elevated ~15 min after a release and slightly elevated for hours."},
    {"key": "news.minutes_before_medium", "group": "News blackout", "label": "Minutes before (medium)",
     "type": "int", "min": 0, "max": 120},
    {"key": "news.minutes_after_medium", "group": "News blackout", "label": "Minutes after (medium)",
     "type": "int", "min": 0, "max": 120},
    {"key": "news.close_before_high", "group": "News blackout", "label": "Close open trades before high impact",
     "type": "bool", "help": "Otherwise the time stop carries positions into the release."},
    {"key": "news.close_lead_minutes", "group": "News blackout", "label": "Close lead time (minutes)",
     "type": "int", "min": 1, "max": 120},
    {"key": "news.minutes_before_low", "group": "News blackout", "label": "Minutes before (low impact)",
     "type": "int", "min": 0, "max": 60, "help": "Only used when the minimum impact to block is 1."},
    {"key": "news.minutes_after_low", "group": "News blackout", "label": "Minutes after (low impact)",
     "type": "int", "min": 0, "max": 60},
    {"key": "news.currency_scope", "group": "News blackout", "label": "Only block affected currencies",
     "type": "bool", "help": "USD news should not block EURGBP."},
    {"key": "news.feed", "group": "News blackout", "label": "Calendar source", "type": "select",
     "options": ["auto", "file", "finnhub", "rules", "none"],
     "help": "auto = your JSON file, else Finnhub, else built-in recurring rules."},
    {"key": "news.calendar_path", "group": "News blackout", "label": "Calendar file", "type": "str"},
    {"key": "news.finnhub_token", "group": "News blackout", "label": "Finnhub API key", "type": "str",
     "help": "Free key at finnhub.io. Set the UTC offset if feed times are local."},
    {"key": "news.finnhub_utc_offset_hours", "group": "News blackout", "label": "Feed UTC offset (hours)",
     "type": "float", "min": -12, "max": 14, "step": 1},
    {"key": "news.include_approx_rules", "group": "News blackout", "label": "Include approximate rule dates",
     "type": "bool", "help": "NFP is exact; CPI is an estimate. Turn off if it blocks the wrong days."},

    # ------------------------------------------------------------- runtime
    {"key": "deriv.app_id", "group": "Runtime", "label": "Deriv app id", "type": "str"},
    {"key": "deriv.currency", "group": "Runtime", "label": "Account currency", "type": "str"},
    {"key": "deriv.endpoint", "group": "Runtime", "label": "Deriv endpoint", "type": "str"},
    {"key": "log_level", "group": "Runtime", "label": "Log level", "type": "select",
     "options": ["DEBUG", "INFO", "WARNING", "ERROR"]},
]

GROUPS = ["Market & data", "Strategy", "ML filter", "Risk", "Costs", "News blackout", "Runtime"]

BY_KEY = {f["key"]: f for f in FIELDS}


def validate_changes(changes: Dict[str, Any]) -> tuple[Dict[str, Any], List[str]]:
    """Coerce and clamp incoming values. Returns (clean_changes, warnings)."""
    clean: Dict[str, Any] = {}
    warnings: List[str] = []
    for key, value in changes.items():
        field = BY_KEY.get(key)
        if field is None:
            warnings.append(f"ignored unknown parameter: {key}")
            continue
        try:
            clean[key] = _coerce(field, value, warnings)
        except (TypeError, ValueError) as exc:
            warnings.append(f"{key}: {exc}")
    return clean, warnings


def _coerce(field: Dict[str, Any], value: Any, warnings: List[str]) -> Any:
    kind = field["type"]
    if kind == "bool":
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)
    if kind == "int":
        out = int(float(value))
    elif kind == "float":
        out = float(value)
    elif kind == "symbols":
        if isinstance(value, str):
            out = [s.strip() for s in value.split(",") if s.strip()]
        else:
            out = [str(s).strip() for s in value if str(s).strip()]
        if not out:
            raise ValueError("at least one symbol is required")
        return out
    else:
        return str(value)

    lo, hi = field.get("min"), field.get("max")
    if lo is not None and out < lo:
        warnings.append(f"{field['key']}: clamped to min {lo}")
        out = lo
    if hi is not None and out > hi:
        warnings.append(f"{field['key']}: clamped to max {hi}")
        out = hi
    return out
