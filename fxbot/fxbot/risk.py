"""Position sizing and the brakes.

The sizing maths for Deriv multipliers:

    notional      = stake * multiplier
    loss at stop  = notional * stop_distance_pct
    => stake      = risk_money / (multiplier * stop_distance_pct)

and Deriv's commission is charged on the notional:

    commission    = commission_rate * notional
                  = commission_rate * risk_money / stop_distance_pct

That last line is the whole ballgame: commission as a fraction of your risk is
INVERSELY proportional to your stop width. Halve the stop, double the cost per
unit of risk. Run `python -m fxbot.cli costs` to see it for your parameters.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Optional

from .config import RiskConfig


@dataclass
class Order:
    """Everything the broker needs to place one multiplier contract."""

    symbol: str
    side: int                 # +1 long (MULTUP) / -1 short (MULTDOWN)
    stake: float
    multiplier: int
    stop_loss: float          # money
    take_profit: float        # money
    stop_distance_pct: float  # price move that triggers the stop
    take_distance_pct: float
    risk_money: float
    entry_ref: float          # reference price (last close) for logging
    reason: str = ""

    @property
    def contract_type(self) -> str:
        return "MULTUP" if self.side > 0 else "MULTDOWN"

    def to_deriv_parameters(self, currency: str = "USD") -> dict:
        """Payload for the `proposal`/`buy` call."""
        return {
            "contract_type": self.contract_type,
            "symbol": self.symbol,
            "amount": round(float(self.stake), 2),
            "basis": "stake",
            "currency": currency,
            "multiplier": int(self.multiplier),
            "limit_order": {
                "stop_loss": round(float(self.stop_loss), 2),
                "take_profit": round(float(self.take_profit), 2),
            },
        }

    def to_dict(self) -> dict:
        return asdict(self)


def stop_distance_pct(vol: float, stop_loss_k: float) -> float:
    return max(1e-8, float(vol) * float(stop_loss_k))


def stake_for_risk(equity: float, risk_pct: float, stop_pct: float,
                   multiplier: int, cfg: RiskConfig) -> float:
    """Stake such that a stop-out loses about `risk_pct`% of equity."""
    if equity <= 0 or stop_pct <= 0 or multiplier <= 0:
        return 0.0
    risk_money = equity * risk_pct / 100.0
    stake = risk_money / (multiplier * stop_pct)
    # caps: never more than max_stake_pct of equity, never tighter than min_stake
    stake = min(stake, equity * cfg.max_stake_pct / 100.0)
    max_notional = equity * cfg.max_notional_x_equity
    stake = min(stake, max_notional / multiplier)
    return max(0.0, round(stake, 2))


def build_order(symbol: str, side: int, price: float, vol: float, equity: float,
                stop_loss_k: float, take_profit_k: float, cfg: RiskConfig) -> Optional[Order]:
    stop_pct = stop_distance_pct(vol, stop_loss_k)
    stake = stake_for_risk(equity, cfg.risk_per_trade_pct, stop_pct, cfg.multiplier, cfg)
    if stake < cfg.min_stake:
        return None
    risk_money = stake * cfg.multiplier * stop_pct
    if risk_money <= 0:
        return None
    rr = take_profit_k / stop_loss_k if stop_loss_k else 2.0
    return Order(
        symbol=symbol,
        side=side,
        stake=stake,
        multiplier=cfg.multiplier,
        stop_loss=round(min(risk_money, stake * 0.99), 2),   # Deriv caps loss at the stake
        take_profit=round(risk_money * rr, 2),
        stop_distance_pct=stop_pct,
        take_distance_pct=stop_pct * rr,
        risk_money=round(risk_money, 2),
        entry_ref=float(price),
    )


class RiskManager:
    """Daily loss cap, exposure cap, kill switch. Boring, and it's what saves you."""

    def __init__(self, cfg: RiskConfig, store=None):
        self.cfg = cfg
        self.store = store

    def kill_switch_engaged(self) -> bool:
        from pathlib import Path

        if Path(self.cfg.kill_switch_file).exists():
            return True
        # serverless: the file may vanish between invocations, so the flag also
        # lives in the (remote) state store
        if self.store is not None and self.store.state.kill_switch:
            return True
        return False

    def engage_kill_switch(self, reason: str = "manual") -> None:
        from pathlib import Path

        path = Path(self.cfg.kill_switch_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(reason)
        if self.store is not None:
            self.store.set_kill_switch(reason)

    def release_kill_switch(self) -> None:
        from pathlib import Path

        Path(self.cfg.kill_switch_file).unlink(missing_ok=True)
        if self.store is not None:
            self.store.set_kill_switch(None)

    def can_open(self, equity: float, open_trades: int, day_pnl: float,
                 new_risk_money: float = 0.0) -> tuple[bool, str]:
        if self.kill_switch_engaged():
            return False, "kill switch engaged"
        if equity <= 0:
            return False, "no equity"
        if open_trades >= self.cfg.max_open_trades:
            return False, f"max open trades ({self.cfg.max_open_trades})"
        loss_pct = -100.0 * day_pnl / equity if equity else 0.0
        if loss_pct >= self.cfg.max_daily_loss_pct:
            return False, f"daily loss cap hit ({loss_pct:.2f}% >= {self.cfg.max_daily_loss_pct}%)"
        if loss_pct + (100.0 * new_risk_money / equity) > self.cfg.max_daily_loss_pct + 1e-9:
            return False, "this trade would breach the daily loss cap"
        return True, "ok"


def commission_for(stake: float, multiplier: int, rate: float) -> float:
    """Deriv charges the multiplier commission on notional (stake x multiplier)."""
    return float(stake) * float(multiplier) * float(rate)


def cost_as_pct_of_risk(stop_pct: float, rate: float, both_sides: bool = True) -> float:
    """The number to look at before choosing a stop width."""
    per_side = rate / stop_pct
    return per_side * (2 if both_sides else 1)
