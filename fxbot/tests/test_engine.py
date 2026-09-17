import asyncio

import pytest

from fxbot.config import Config
from fxbot.engine import _seconds_until_next_bar, prepare_frame, run_cycle
from fxbot.mock import FakeDerivClient
from fxbot.state import JsonStateStore


def make_cfg(tmp_path):
    cfg = Config()
    cfg.data.symbols = ["frxEURUSD", "frxGBPUSD"]
    cfg.data.granularity = 300
    cfg.data.live_bars = 1200
    cfg.state_path = str(tmp_path / "state.json")
    cfg.risk.kill_switch_file = str(tmp_path / "STOP")
    cfg.model.enabled = False
    cfg.strategy.lookback = 12
    cfg.strategy.cooldown_bars = 3
    return cfg


def test_prepare_frame_offline():
    cfg = make_cfg(_tmp())
    client = FakeDerivClient(symbols=["frxEURUSD"], granularity=300, bars=2000)

    async def go():
        await client.connect()
        return await prepare_frame(client, "frxEURUSD", cfg)

    frame = asyncio.run(go())
    assert not frame.empty
    assert "vol" in frame.columns
    assert len(frame) > 250


def test_cycle_runs_dry_and_logs_decisions(tmp_path):
    cfg = make_cfg(tmp_path)
    client = FakeDerivClient(symbols=cfg.data.symbols, granularity=300, bars=3000)

    async def go():
        await client.connect()
        return await run_cycle(cfg, client=client, store=JsonStateStore(cfg.state_path),
                               model=None, dry_run=True)

    summary = asyncio.run(go())
    assert set(summary) >= {"decisions", "errors", "opened", "closed"}
    for symbol in cfg.data.symbols:
        assert symbol in summary["decisions"]
        assert symbol not in summary["errors"]
    assert "candles" in client.requests
    # dry run never touches the order path
    assert "buy" not in client.requests


def test_kill_switch_blocks_opening(tmp_path):
    cfg = make_cfg(tmp_path)
    from fxbot.risk import RiskManager

    RiskManager(cfg.risk).engage_kill_switch("test")
    client = FakeDerivClient(symbols=cfg.data.symbols, granularity=300, bars=3000)

    async def go():
        await client.connect()
        return await run_cycle(cfg, client=client, store=JsonStateStore(cfg.state_path),
                               model=None, dry_run=False)

    summary = asyncio.run(go())
    assert summary["opened"] == []
    assert "buy" not in client.requests


def test_state_survives_a_cycle(tmp_path):
    cfg = make_cfg(tmp_path)
    store = JsonStateStore(cfg.state_path)
    store.record_open("123", {"symbol": "frxEURUSD", "stake": 10.0})
    store.record_close("123", 4.2, {"exit_reason": "test"})
    reloaded = JsonStateStore(cfg.state_path)
    assert reloaded.state.day_pnl == pytest.approx(4.2)
    assert reloaded.state.open_positions == {}
    assert len(reloaded.state.trades) == 1


def test_seconds_until_next_bar_is_sane():
    wait = _seconds_until_next_bar(300, offset=5)
    assert 5.0 <= wait <= 305.0


def _tmp():
    import tempfile
    from pathlib import Path

    return Path(tempfile.mkdtemp())
