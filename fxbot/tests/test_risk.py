import pytest

from fxbot.config import RiskConfig
from fxbot.risk import (
    RiskManager,
    build_order,
    commission_for,
    cost_as_pct_of_risk,
    stake_for_risk,
    stop_distance_pct,
)


def test_stake_maths():
    # risk 0.5% of 10k = 50; stop 0.2%; multiplier 30 -> notional 25k -> stake 833.33
    stake = stake_for_risk(10_000, 0.5, 0.002, 30, RiskConfig(max_stake_pct=50.0))
    assert stake == pytest.approx(833.33, abs=0.01)
    loss_at_stop = stake * 30 * 0.002
    assert loss_at_stop == pytest.approx(50.0, abs=0.05)


def test_stake_is_capped_by_equity_fraction():
    # a razor-thin stop would otherwise demand more stake than the account has
    stake = stake_for_risk(10_000, 0.5, 0.00002, 30, RiskConfig(max_stake_pct=5.0))
    assert stake == pytest.approx(500.0)


def test_build_order_sets_server_side_risk():
    order = build_order("frxEURUSD", 1, 1.10, vol=0.0003, equity=10_000,
                        stop_loss_k=1.0, take_profit_k=2.0, cfg=RiskConfig())
    assert order is not None
    assert order.contract_type == "MULTUP"
    assert order.stop_loss <= order.stake          # Deriv caps loss at the stake
    assert order.take_profit > order.stop_loss
    params = order.to_deriv_parameters("USD")
    assert params["contract_type"] == "MULTUP"
    assert params["multiplier"] == 30
    assert set(params["limit_order"]) == {"stop_loss", "take_profit"}
    assert params["symbol"] == "frxEURUSD"


def test_build_order_short_uses_multdown():
    order = build_order("frxGBPUSD", -1, 1.25, vol=0.0004, equity=5_000,
                        stop_loss_k=1.0, take_profit_k=2.0, cfg=RiskConfig())
    assert order.contract_type == "MULTDOWN"


def test_tiny_stake_is_rejected():
    order = build_order("frxEURUSD", 1, 1.10, vol=0.0003, equity=5,
                        stop_loss_k=1.0, take_profit_k=2.0, cfg=RiskConfig(min_stake=1.0))
    assert order is None


def test_commission_scales_with_notional():
    assert commission_for(100, 30, 0.000199) == pytest.approx(0.597, abs=1e-6)


def test_cost_inverse_to_stop_width():
    tight = cost_as_pct_of_risk(0.0002, 0.000199)
    wide = cost_as_pct_of_risk(0.002, 0.000199)
    assert tight / wide == pytest.approx(10.0, abs=1e-6)
    assert tight > 1.0, "a 2-pip stop costs more than 100% of the risk per round trip"


def test_risk_gates(tmp_path):
    cfg = RiskConfig(kill_switch_file=str(tmp_path / "STOP"),
                     max_daily_loss_pct=2.0, max_open_trades=2)
    rm = RiskManager(cfg)
    assert rm.can_open(10_000, 0, 0.0)[0]
    assert not rm.can_open(10_000, 2, 0.0)[0]                 # too many open
    assert not rm.can_open(10_000, 0, -250.0)[0]              # -2.5% daily
    assert not rm.can_open(10_000, 0, -100.0, new_risk_money=200.0)[0]  # would breach
    rm.engage_kill_switch("test")
    assert rm.kill_switch_engaged()
    assert not rm.can_open(10_000, 0, 0.0)[0]
    rm.release_kill_switch()
    assert rm.can_open(10_000, 0, 0.0)[0]


def test_stop_distance_is_positive():
    assert stop_distance_pct(0.0003, 1.0) == pytest.approx(0.0003)
    assert stop_distance_pct(0.0, 1.0) > 0
