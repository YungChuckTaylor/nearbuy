from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from fxbot.news import (
    HIGH,
    MEDIUM,
    FileCalendar,
    FinnhubFeed,
    NewsConfig,
    NewsEvent,
    NewsFilter,
    RecurringRules,
    symbol_currencies,
    us_eastern_is_dst,
)


def test_symbol_currencies():
    assert symbol_currencies("frxEURUSD") == ("EUR", "USD")
    assert symbol_currencies("frxUSDJPY") == ("USD", "JPY")
    assert symbol_currencies("frxXAUUSD") == ("XAU", "USD")
    assert symbol_currencies("R_75") == ("R_75",)


def test_event_parsing_and_round_trip():
    ev = NewsEvent.from_dict({"time": "2026-10-02T12:30:00Z", "currency": "usd",
                              "name": "US NFP", "impact": 3})
    assert ev.currency == "USD"
    assert ev.time == datetime(2026, 10, 2, 12, 30, tzinfo=timezone.utc)
    assert NewsEvent.from_dict(ev.to_dict()).time == ev.time


def test_blocked_inside_window_only():
    cfg = NewsConfig(minutes_before_high=30, minutes_after_high=30,
                     minutes_before_medium=10, minutes_after_medium=10)
    release = datetime(2026, 6, 5, 12, 30, tzinfo=timezone.utc)
    nf = NewsFilter(cfg, events=[NewsEvent(release, "USD", "NFP", HIGH)])

    assert nf.is_blocked(release, "frxEURUSD")[0]
    assert nf.is_blocked(release - timedelta(minutes=29), "frxEURUSD")[0]
    assert nf.is_blocked(release + timedelta(minutes=29), "frxEURUSD")[0]
    assert not nf.is_blocked(release - timedelta(minutes=31), "frxEURUSD")[0]
    assert not nf.is_blocked(release + timedelta(minutes=31), "frxEURUSD")[0]


def test_currency_scope_ignores_unaffected_pairs():
    release = datetime(2026, 6, 5, 12, 30, tzinfo=timezone.utc)
    cfg = NewsConfig(currency_scope=True)
    nf = NewsFilter(cfg, events=[NewsEvent(release, "USD", "NFP", HIGH)])

    assert nf.is_blocked(release, "frxEURUSD")[0], "USD event must block EURUSD"
    assert not nf.is_blocked(release, "frxEURGBP")[0], "USD event must not block EURGBP"

    nf_all = NewsFilter(NewsConfig(currency_scope=False), events=[NewsEvent(release, "USD", "NFP", HIGH)])
    assert nf_all.is_blocked(release, "frxEURGBP")[0]


def test_min_impact_filters_small_events():
    release = datetime(2026, 6, 5, 12, 30, tzinfo=timezone.utc)
    nf = NewsFilter(NewsConfig(min_impact=HIGH),
                    events=[NewsEvent(release, "USD", "Minor data", 1)])
    assert not nf.is_blocked(release, "frxEURUSD")[0]


def test_disabled_filter_never_blocks():
    release = datetime(2026, 6, 5, 12, 30, tzinfo=timezone.utc)
    nf = NewsFilter(NewsConfig(enabled=False), events=[NewsEvent(release, "USD", "NFP", HIGH)])
    assert not nf.is_blocked(release, "frxEURUSD")[0]


def test_should_close_only_in_the_lead_window():
    release = datetime(2026, 6, 5, 12, 30, tzinfo=timezone.utc)
    nf = NewsFilter(NewsConfig(close_before_high=True, close_lead_minutes=15),
                    events=[NewsEvent(release, "USD", "NFP", HIGH)])
    assert nf.should_close(release - timedelta(minutes=5), "frxEURUSD")[0]
    assert not nf.should_close(release - timedelta(minutes=45), "frxEURUSD")[0]
    assert not nf.should_close(release + timedelta(minutes=5), "frxEURUSD")[0]

    off = NewsFilter(NewsConfig(close_before_high=False),
                     events=[NewsEvent(release, "USD", "NFP", HIGH)])
    assert not off.should_close(release - timedelta(minutes=5), "frxEURUSD")[0]


def test_blocked_mask_matches_is_blocked():
    """The vectorised mask used by backtests must agree with the live check."""
    release = datetime(2026, 6, 5, 12, 30, tzinfo=timezone.utc)
    nf = NewsFilter(NewsConfig(minutes_before_high=30, minutes_after_high=30),
                    events=[NewsEvent(release, "USD", "NFP", HIGH)])
    index = pd.date_range(release - timedelta(hours=2), release + timedelta(hours=2),
                          freq="5min", tz="UTC")
    mask = nf.blocked_mask(index, "frxEURUSD")
    assert mask.sum() == 13          # 30m before + release + 30m after, inclusive
    for ts in index[mask]:
        assert nf.is_blocked(ts.to_pydatetime(), "frxEURUSD")[0]
    for ts in index[~mask][:5]:
        assert not nf.is_blocked(ts.to_pydatetime(), "frxEURUSD")[0]


def test_file_calendar_round_trip(tmp_path):
    path = tmp_path / "news.json"
    events = [NewsEvent(datetime(2026, 6, 5, 12, 30, tzinfo=timezone.utc), "USD", "NFP", HIGH),
              NewsEvent(datetime(2026, 6, 10, 9, 0, tzinfo=timezone.utc), "EUR", "EU CPI", MEDIUM)]
    cal = FileCalendar(path)
    path.write_text(__import__("json").dumps({"events": [e.to_dict() for e in events]}))
    loaded = cal.events()
    assert [e.name for e in loaded] == ["NFP", "EU CPI"]
    assert loaded[0].currency == "USD"

    nf = NewsFilter(NewsConfig(feed="file", calendar_path=str(path)))
    assert nf.refresh() == 2
    assert nf.is_blocked(datetime(2026, 6, 5, 12, 30, tzinfo=timezone.utc), "frxEURUSD")[0]


def test_file_calendar_missing_or_corrupt_is_not_fatal(tmp_path):
    assert FileCalendar(tmp_path / "nope.json").events() == []
    bad = tmp_path / "bad.json"
    bad.write_text("{not json")
    assert FileCalendar(bad).events() == []

    nf = NewsFilter(NewsConfig(feed="file", calendar_path=str(bad)))
    assert nf.refresh() == 0
    assert nf.is_blocked(symbol="frxEURUSD")[0] is False


def test_finnhub_feed_without_token_is_inert():
    assert FinnhubFeed(token="").events() == []


def test_finnhub_parsing(monkeypatch):
    import json as _json
    import urllib.request

    payload = {"economicCalendar": [
        {"date": "2026-06-05", "time": "12:30", "country": "US", "event": "Nonfarm Payrolls",
         "impact": "3"},
        {"date": "2026-06-06", "time": "09:00", "country": "EU", "event": "GDP", "impact": "2"},
        {"date": "not-a-date", "time": "xx", "country": "JP", "event": "broken"},
    ]}

    class FakeResponse:
        def read(self):
            return _json.dumps(payload).encode()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=None: FakeResponse())
    events = FinnhubFeed(token="dummy").events()
    assert [e.impact for e in events] == [HIGH, MEDIUM]
    assert events[0].time == datetime(2026, 6, 5, 12, 30, tzinfo=timezone.utc)


def test_recurring_rules_nfp_is_first_friday(tmp_path):
    now = datetime(2026, 9, 17, tzinfo=timezone.utc)
    rules = RecurringRules(months_ahead=0, include_approx=False)
    events = rules.events(now)
    assert len(events) == 1
    nfp = events[0]
    assert nfp.name == "US Non-Farm Payrolls"
    assert nfp.time.weekday() == 4                    # Friday
    assert nfp.time.day <= 7                          # first Friday
    # September is DST in New York: 8:30 EDT = 12:30 UTC
    assert (nfp.time.hour, nfp.time.minute) == (12, 30)


def test_us_eastern_dst_boundaries():
    assert us_eastern_is_dst(datetime(2026, 7, 1, tzinfo=timezone.utc))
    assert not us_eastern_is_dst(datetime(2026, 1, 15, tzinfo=timezone.utc))


def test_upcoming_sorts_and_limits():
    now = datetime(2026, 6, 5, 10, 0, tzinfo=timezone.utc)
    events = [NewsEvent(now + timedelta(hours=5), "USD", "later", HIGH),
              NewsEvent(now + timedelta(hours=1), "EUR", "sooner", MEDIUM),
              NewsEvent(now - timedelta(days=2), "USD", "past", HIGH)]
    nf = NewsFilter(NewsConfig(), events=events)
    rows = nf.upcoming(now=now)
    assert [r["name"] for r in rows] == ["sooner", "later"]      # past excluded, sorted
    assert rows[0]["in_minutes"] == pytest.approx(60, abs=0.1)


def test_filter_never_raises_on_a_broken_calendar(monkeypatch):
    """A dead calendar must degrade to 'no events', not break the trading loop."""
    nf = NewsFilter(NewsConfig(feed="file", calendar_path="/nonexistent/news.json"))

    def boom():
        raise RuntimeError("boom")

    nf._load_unsafe = boom
    assert nf.refresh() == 0
    assert nf.last_error == "boom"
    assert nf.is_blocked(symbol="frxEURUSD") == (False, "")
