import json

import pytest

from fxbot.config import Config
from fxbot.risk import RiskManager
from fxbot.state import JsonStateStore, RestStateStore, State, make_store


def test_json_store_round_trip(tmp_path):
    store = JsonStateStore(tmp_path / "state.json")
    store.record_open("1", {"symbol": "frxEURUSD"})
    store.record_close("1", 12.5, {"exit_reason": "tp"})
    reloaded = JsonStateStore(tmp_path / "state.json")
    assert reloaded.state.day_pnl == pytest.approx(12.5)
    assert reloaded.state.notes == {}
    assert len(reloaded.state.trades) == 1


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return json.dumps(self._payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_rest_store_load_and_save(monkeypatch):
    """Upstash/Vercel-KV shaped responses: {"result": "<json string>"}."""
    import urllib.request

    stored = {}

    def fake_urlopen(req, timeout=None):
        url = req.full_url if hasattr(req, "full_url") else req
        if url.endswith("/get/fxbot:state"):
            if "fxbot:state" not in stored:
                return _FakeResponse({"result": None})
            return _FakeResponse({"result": stored["fxbot:state"]})
        if url.endswith("/set/fxbot:state"):
            stored["fxbot:state"] = req.data.decode()
            return _FakeResponse({"result": "OK"})
        raise AssertionError(url)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    store = RestStateStore("https://example.upstash.io", "token")
    assert store.state.cycles == 0
    store.record_open("9", {"symbol": "frxEURUSD", "stake": 5.0})
    assert "fxbot:state" in stored

    fresh = RestStateStore("https://example.upstash.io", "token")
    assert "9" in fresh.state.open_positions
    fresh.record_close("9", -3.0, {"exit_reason": "stop"})
    assert fresh.state.day_pnl == pytest.approx(-3.0)


def test_rest_store_survives_a_broken_endpoint(monkeypatch):
    """A dead state store must never stop the trading cycle."""
    import urllib.request

    def boom(*a, **kw):
        raise OSError("network down")

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    store = RestStateStore("https://example.upstash.io", "token")
    assert isinstance(store.state, State)
    store.record_open("1", {"symbol": "frxEURUSD"})  # must not raise


def test_make_store_prefers_rest_when_configured(monkeypatch, tmp_path):
    cfg = Config()
    cfg.state_path = str(tmp_path / "state.json")
    assert isinstance(make_store(cfg), JsonStateStore)
    monkeypatch.setenv("FXBOT_STATE_URL", "https://example.upstash.io")
    monkeypatch.setenv("FXBOT_STATE_TOKEN", "tok")
    assert isinstance(make_store(cfg), RestStateStore)


def test_kill_switch_through_the_state_store(tmp_path):
    """On serverless the STOP file may not persist; the store flag must."""
    cfg = Config()
    cfg.risk.kill_switch_file = str(tmp_path / "STOP")
    store = JsonStateStore(tmp_path / "state.json")
    rm = RiskManager(cfg.risk, store=store)
    assert not rm.kill_switch_engaged()
    rm.engage_kill_switch("drawdown")
    assert rm.kill_switch_engaged()

    import tempfile
    from pathlib import Path

    other = RiskManager(Config().risk.__class__(kill_switch_file=str(Path(tempfile.mkdtemp()) / "STOP")),
                        store=JsonStateStore(tmp_path / "state.json"))
    assert other.kill_switch_engaged(), "kill switch must survive into a fresh process"

    rm.release_kill_switch()
    assert not rm.kill_switch_engaged()
