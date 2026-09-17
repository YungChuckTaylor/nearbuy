import os
from pathlib import Path

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from fxbot.config import Config  # noqa: E402
from fxbot.web.app import create_app  # noqa: E402


@pytest.fixture()
def app_env(tmp_path, monkeypatch):
    monkeypatch.setenv("FXBOT_MODE", "paper")
    monkeypatch.delenv("FXBOT_WEB_TOKEN", raising=False)
    monkeypatch.delenv("FXBOT_STATE_URL", raising=False)

    cfg = Config()
    cfg.state_path = str(tmp_path / "state.json")
    cfg.risk.kill_switch_file = str(tmp_path / "STOP")
    cfg.news.calendar_path = str(tmp_path / "news.json")
    cfg.data.cache_dir = str(tmp_path / "cache")
    cfg.model.model_path = str(tmp_path / "model.joblib")
    cfg.data.symbols = ["frxEURUSD"]
    config_path = str(tmp_path / "config.json")
    cfg.save(config_path)
    app = create_app(config_path=config_path, cfg=cfg)
    return app, cfg, config_path


@pytest.fixture()
def client(app_env):
    app, _, _ = app_env
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] and body["mode"] == "paper"
    assert body["auth_required"] is False


def test_schema_exposes_every_parameter_with_a_value(client):
    body = client.get("/api/schema").json()
    assert body["groups"]
    for field in body["fields"]:
        assert field["key"] in body["values"], f"{field['key']} has no current value"
    # the cost dial and the news switch must be controllable from the UI
    assert "strategy.stop_loss_k" in body["values"]
    assert "news.enabled" in body["values"]


def test_config_update_persists_and_is_applied(client, app_env):
    _, cfg, config_path = app_env
    r = client.put("/api/config", json={"changes": {
        "strategy.stop_loss_k": 4.0,
        "risk.risk_per_trade_pct": 0.25,
        "news.enabled": False,
    }})
    assert r.status_code == 200
    assert r.json()["saved"] == 3
    assert cfg.strategy.stop_loss_k == 4.0
    assert cfg.risk.risk_per_trade_pct == 0.25
    assert cfg.news.enabled is False
    # written to disk, so a restart keeps it
    assert '"stop_loss_k": 4.0' in Path(config_path).read_text()


def test_config_clamps_out_of_range_values(client, app_env):
    _, cfg, _ = app_env
    r = client.put("/api/config", json={"changes": {"risk.risk_per_trade_pct": 999}})
    assert r.status_code == 200
    assert cfg.risk.risk_per_trade_pct == 5.0          # schema max
    assert any("clamped" in w for w in r.json()["warnings"])


def test_config_rejects_unknown_keys(client):
    body = client.put("/api/config", json={"changes": {"risk.do_the_thing": 1}}).json()
    assert body["saved"] == 0
    assert any("unknown parameter" in w for w in body["warnings"])


def test_symbols_are_parsed_from_text(client, app_env):
    _, cfg, _ = app_env
    client.put("/api/config", json={"changes": {"data.symbols": "frxEURUSD, frxXAUUSD"}})
    assert cfg.data.symbols == ["frxEURUSD", "frxXAUUSD"]


def test_reset_restores_defaults(client, app_env):
    _, cfg, _ = app_env
    client.put("/api/config", json={"changes": {"strategy.stop_loss_k": 9.0}})
    client.post("/api/config/reset")
    assert cfg.strategy.stop_loss_k == Config().strategy.stop_loss_k


def test_insights_quantify_the_cost(client):
    body = client.get("/api/insights").json()
    assert body["cost_pct_of_risk"] > 0
    assert 0 < body["break_even_win_rate"] < 100
    assert len(body["table"]) == 8
    # a wider stop must always be cheaper per unit of risk
    costs = [row["cost_pct_of_risk"] for row in body["table"]]
    assert costs == sorted(costs, reverse=True)


def test_insights_react_to_parameter_changes(client):
    before = client.get("/api/insights").json()["cost_pct_of_risk"]
    client.put("/api/config", json={"changes": {"strategy.stop_loss_k": 8.0}})
    after = client.get("/api/insights").json()["cost_pct_of_risk"]
    assert after < before


def test_kill_switch_round_trip(client, app_env):
    _, cfg, _ = app_env
    assert client.post("/api/control/kill", json={"reason": "test"}).json()["ok"]
    assert client.get("/api/status").json()["state"]["kill_switch"] == "test"
    client.post("/api/control/resume")
    assert client.get("/api/status").json()["state"]["kill_switch"] is None


def test_status_without_deriv_token_uses_paper_equity(client):
    body = client.get("/api/status").json()
    assert body["balance"] is None
    assert body["positions"] == []
    assert body["paper_equity"] == 10000


def test_live_actions_refuse_in_paper_mode(client):
    assert client.post("/api/positions/123/close").status_code == 409
    assert client.post("/api/control/close-all").status_code == 409


def test_mode_switch_requires_a_token(client, app_env):
    # no DERIV_API_TOKEN configured -> live mode must be refused
    assert client.post("/api/mode", json={"mode": "live"}).status_code == 400
    assert client.post("/api/mode", json={"mode": "nonsense"}).status_code == 400
    assert client.post("/api/mode", json={"mode": "paper"}).json()["ok"]


def test_news_add_and_list(client):
    r = client.post("/api/news/add", json={
        "time": "2030-01-04T13:30:00Z", "currency": "USD",
        "name": "Test NFP", "impact": 3})
    assert r.json()["ok"]
    events = client.get("/api/news").json()["events"]
    assert any(e["name"] == "Test NFP" for e in events)


def test_news_blocks_the_affected_pair_only(client):
    client.post("/api/news/add", json={
        "time": "2030-01-04T13:30:00Z", "currency": "USD", "name": "USD event", "impact": 3})
    client.put("/api/config", json={"changes": {
        "data.symbols": "frxEURUSD,frxEURGBP",
        "news.feed": "file", "news.minutes_before_high": 30, "news.minutes_after_high": 30}})
    # freeze "now" to the event by choosing an event 30 min in the future
    from datetime import datetime, timedelta, timezone

    import fxbot.news as news_mod

    fixed = datetime(2030, 1, 4, 13, 0, tzinfo=timezone.utc)
    original = news_mod.NewsFilter.active_events

    def patched(self, ts=None, symbol=None):
        return original(self, fixed, symbol)

    news_mod.NewsFilter.active_events = patched
    try:
        body = client.get("/api/news").json()
        assert body["symbols"]["frxEURUSD"]["blocked"] is True
        assert body["symbols"]["frxEURGBP"]["blocked"] is False
    finally:
        news_mod.NewsFilter.active_events = original


def test_signals_offline(client):
    body = client.get("/api/signals?offline=true").json()
    assert body["offline"] is True
    assert len(body["signals"]) == 1
    assert body["signals"][0]["symbol"] == "frxEURUSD"
    assert "news_blocked" in body["signals"][0]


def test_jobs_list_and_unknown_job(client):
    assert client.get("/api/jobs").json()["jobs"] == []
    assert client.post("/api/jobs/nonsense").status_code == 404
    assert client.get("/api/jobs/doesnotexist").status_code == 404


def test_logs_endpoint(client):
    assert "lines" in client.get("/api/logs").json()


def test_static_ui_is_served(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "fxbot dashboard" in r.text
    assert client.get("/app.js").status_code == 200
    assert client.get("/styles.css").status_code == 200


def test_token_auth_locks_the_api(tmp_path, monkeypatch):
    monkeypatch.setenv("FXBOT_WEB_TOKEN", "s3cret")
    monkeypatch.setenv("FXBOT_MODE", "paper")
    cfg = Config()
    cfg.state_path = str(tmp_path / "state.json")
    app = create_app(config_path=str(tmp_path / "config.json"), cfg=cfg)

    with TestClient(app) as c:
        assert c.get("/api/health").status_code == 401
        ok = c.get("/api/health", headers={"Authorization": "Bearer s3cret"})
        assert ok.status_code == 200
        assert ok.json()["auth_required"] is True
        # the UI itself stays reachable so the browser can show the login hint
        assert c.get("/").status_code == 200
