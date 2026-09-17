"""Configuration for the FX bot.

Config is a plain dataclass tree that can be built from a JSON file and/or
environment variables. Nothing here contacts the network.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, fields, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from .news import NewsConfig


DEFAULT_ENDPOINT = "wss://ws.derivws.com/websockets/v3"


def _env(key: str, default: Optional[str] = None) -> Optional[str]:
    return os.environ.get(key, default)


def _coerce(typ: Any, value: Any) -> Any:
    """Best-effort coercion so JSON/env values land on the declared type."""
    try:
        if typ is bool:
            if isinstance(value, str):
                return value.strip().lower() in {"1", "true", "yes", "on"}
            return bool(value)
        if typ is int:
            return int(value)
        if typ is float:
            return float(value)
        if typ is str:
            return str(value)
    except (TypeError, ValueError):
        return value
    return value


@dataclass
class DerivConfig:
    """Connection settings for the Deriv WebSocket API."""

    endpoint: str = DEFAULT_ENDPOINT
    app_id: str = "1089"          # 1089 is Deriv's public sample app id; register your own for live use
    token: str = ""               # API token (needs Trade scope). Empty => market-data only.
    currency: str = "USD"
    request_timeout: float = 20.0
    keepalive_seconds: float = 20.0
    max_retries: int = 5

    @classmethod
    def from_env(cls) -> "DerivConfig":
        return cls(
            endpoint=_env("DERIV_ENDPOINT", DEFAULT_ENDPOINT) or DEFAULT_ENDPOINT,
            app_id=_env("DERIV_APP_ID", "1089") or "1089",
            token=_env("DERIV_API_TOKEN", "") or "",
            currency=_env("DERIV_CURRENCY", "USD") or "USD",
        )


@dataclass
class DataConfig:
    symbols: List[str] = field(default_factory=lambda: [
        "frxEURUSD", "frxGBPUSD", "frxUSDJPY", "frxAUDUSD", "frxUSDCHF",
    ])
    # M15 is the sweet spot here: M5 stops are so tight relative to the noise
    # that Deriv's multiplier commission eats the risk budget (run `costs`).
    granularity: int = 900          # bar size in seconds (300 = M5, 900 = M15, 3600 = H1)
    history_bars: int = 20000       # bars to pull per symbol for training (~7 months on M15)
    live_bars: int = 600            # bars pulled on each live cycle
    cache_dir: str = "data/fxbot"


@dataclass
class StrategyConfig:
    """Primary (rule-based) signal + trade structure."""

    name: str = "donchian_breakout"   # one of: donchian_breakout, ema_pullback, rsi_reversal
    lookback: int = 48                # channel / indicator lookback in bars
    atr_period: int = 14
    ema_fast: int = 12
    ema_slow: int = 48
    rsi_period: int = 14
    rsi_lower: float = 25.0
    rsi_upper: float = 75.0

    # Barriers are expressed in units of EWMA bar volatility (see labeling.py),
    # so they adapt to the instrument and the regime automatically.
    # Wide-ish stops are not a preference, they are arithmetic: commission is
    # charged on notional, so cost/risk = commission_rate / stop_distance_pct.
    # On M15, 3.0 x vol is roughly a 12-pip stop on EURUSD -> ~35% of risk.
    take_profit_k: float = 6.0        # TP = 6.0 x bar volatility (2R)
    stop_loss_k: float = 3.0          # SL = 3.0 x bar volatility
    max_holding_bars: int = 32        # time stop -> flat after 8h on M15

    # Session filter (UTC hours). FX is quiet and wide-spread outside these.
    session_start_hour: int = 7
    session_end_hour: int = 16
    avoid_friday_after_hour: int = 20  # no new trades late Friday (weekend gap + wide spreads)

    cooldown_bars: int = 4            # min bars between new entries per symbol


@dataclass
class ModelConfig:
    """Secondary model: does it take the setup or skip it?"""

    enabled: bool = True
    backend: str = "auto"             # auto | sklearn | lightgbm
    threshold: float = 0.55           # take the trade only if P(win) >= this
    n_estimators: int = 400
    learning_rate: float = 0.03
    max_depth: int = 4
    min_samples_leaf: int = 50
    model_path: str = "data/fxbot/model.joblib"
    train_threshold: float = 0.50     # label threshold used when meta-labelling


@dataclass
class RiskConfig:
    risk_per_trade_pct: float = 0.5   # % of equity lost if the stop is hit
    max_daily_loss_pct: float = 2.0   # halt new entries after -2% in a day
    max_open_trades: int = 3
    max_notional_x_equity: float = 30.0
    multiplier: int = 30              # Deriv multiplier (leverage) per contract
    min_stake: float = 1.0
    max_stake_pct: float = 5.0        # never stake more than 5% of equity on one contract
    kill_switch_file: str = "data/fxbot/STOP"


@dataclass
class CostConfig:
    """Deriv multiplier costs.

    commission_rate is charged on NOTIONAL (stake x multiplier) at entry.
    Deriv's published example: stake 20, multiplier 30 -> notional 600 ->
    commission 0.1194  =>  rate = 0.000199 of notional.
    Since notional = risk / stop_distance_pct, the commission as a fraction of
    your risk is  commission_rate / stop_distance_pct. Tight stops are therefore
    ruinous -- run `costs` to see this for your own parameters.
    """

    commission_rate: float = 0.000199
    spread_bps: float = 0.6           # half of the typical EURUSD retail spread, in bps of price
    slippage_bps: float = 0.2         # extra slippage assumed on entry and on stops
    commission_on_exit: bool = True   # be pessimistic until you have measured it


@dataclass
class Config:
    deriv: DerivConfig = field(default_factory=DerivConfig)
    data: DataConfig = field(default_factory=DataConfig)
    strategy: StrategyConfig = field(default_factory=StrategyConfig)
    model: ModelConfig = field(default_factory=ModelConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    costs: CostConfig = field(default_factory=CostConfig)
    news: NewsConfig = field(default_factory=NewsConfig)
    state_path: str = "data/fxbot/state.json"
    # Optional remote state (Upstash Redis / Vercel KV REST). Needed for
    # serverless deployments where the filesystem is ephemeral.
    state_url: str = ""
    state_token: str = ""
    log_level: str = "INFO"

    # ------------------------------------------------------------------ io
    @classmethod
    def from_file(cls, path: str | Path) -> "Config":
        raw = json.loads(Path(path).read_text())
        return cls.from_dict(raw)

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "Config":
        cfg = cls()
        for f in fields(cls):
            if f.name not in raw:
                continue
            value = raw[f.name]
            sub = getattr(cfg, f.name)
            if hasattr(sub, "__dataclass_fields__") and isinstance(value, dict):
                for sf in fields(sub):
                    if sf.name in value:
                        setattr(sub, sf.name, _coerce(sf.type, value[sf.name]))
            else:
                setattr(cfg, f.name, _coerce(f.type, value))
        cfg.deriv = cfg.deriv if isinstance(cfg.deriv, DerivConfig) else DerivConfig.from_env()
        return cfg

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def save(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps(self.to_dict(), indent=2, sort_keys=True))

    def with_env_overrides(self) -> "Config":
        """Env vars win over the file (handy for hosting platforms)."""
        cfg = self
        cfg.deriv = DerivConfig.from_env()
        if _env("FXBOT_SYMBOLS"):
            cfg.data.symbols = [s.strip() for s in _env("FXBOT_SYMBOLS", "").split(",") if s.strip()]
        if _env("FXBOT_GRANULARITY"):
            cfg.data.granularity = int(_env("FXBOT_GRANULARITY", "300") or 300)
        if _env("FXBOT_LIVE") is not None:
            cfg.model.model_path = _env("FXBOT_MODEL_PATH", cfg.model.model_path) or cfg.model.model_path
        return cfg


def load_config(path: Optional[str] = None) -> Config:
    """Load config from JSON if present, else defaults, then apply env overrides."""
    if path and Path(path).exists():
        cfg = Config.from_file(path)
    else:
        cfg = Config()
    return cfg.with_env_overrides()
