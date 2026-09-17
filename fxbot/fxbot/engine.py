"""The run loop: fetch -> decide -> size -> place -> reconcile.

Two entry points, same code path:
  * `run_loop`  - long-lived worker (Railway / Render / Fly / your laptop)
  * `run_cycle` - one pass, exits. This is what a cron or serverless function
                  calls; it keeps no in-memory state.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional

import pandas as pd

from . import data as data_mod
from .broker import DerivBroker
from .config import Config
from .deriv import DerivClient, connect_with_retry
from .features import compute_features
from .news import NewsFilter
from .risk import RiskManager, build_order
from .state import StateStore, make_store
from .strategy import signal_at

log = logging.getLogger(__name__)


async def prepare_frame(client, symbol: str, cfg: Config,
                        server_time: Optional[int] = None,
                        news: Optional[NewsFilter] = None) -> pd.DataFrame:
    """Fetch candles, drop the forming bar, compute features.

    When a `NewsFilter` is supplied the frame carries a `news_blocked` column so
    the live path applies exactly the same filter as the backtester.
    """
    resp = await client.candles(symbol, granularity=cfg.data.granularity,
                                count=cfg.data.live_bars)
    candles = resp.get("candles") or []
    df = data_mod.candles_to_df(candles)
    if server_time is None:
        server_time = int(datetime.now(timezone.utc).timestamp())
    df = data_mod.drop_incomplete(df, cfg.data.granularity, server_time)
    if len(df) < 250:
        return pd.DataFrame()
    frame = compute_features(
        df,
        lookback=cfg.strategy.lookback,
        atr_period=cfg.strategy.atr_period,
        ema_fast=cfg.strategy.ema_fast,
        ema_slow=cfg.strategy.ema_slow,
    )
    if news is not None and cfg.news.enabled:
        frame["news_blocked"] = news.blocked_mask(frame.index, symbol)
    return frame


async def reconcile(broker: DerivBroker, store: StateStore) -> int:
    """Find positions we logged that Deriv says are closed, and book the P&L."""
    closed = 0
    for contract_id in list(store.state.open_positions.keys()):
        try:
            resp = await broker.contract_state(int(contract_id))
            info = resp.get("proposal_open_contract", {})
        except Exception as exc:  # noqa: BLE001
            log.warning("could not poll contract %s: %s", contract_id, exc)
            continue
        if not info:
            continue
        if info.get("is_sold"):
            pnl = float(info.get("profit", 0) or 0)
            store.record_close(contract_id, pnl, {
                "exit_price": info.get("sell_price"),
                "exit_time_epoch": info.get("sell_time"),
                "exit_reason": "broker",
            })
            closed += 1
    return closed


async def run_cycle(cfg: Config, client: Optional[DerivClient] = None,
                    store: Optional[StateStore] = None, model=None,
                    dry_run: bool = True, symbols: Optional[List[str]] = None) -> dict:
    """One pass over all symbols. Never raises: a bad symbol is logged and skipped."""
    store = store or make_store(cfg)
    store.roll_day_if_needed()
    own_client = client is None
    if own_client:
        client = await connect_with_retry(cfg.deriv, authorize=bool(cfg.deriv.token))
    broker = DerivBroker(client, cfg.deriv, cfg.costs)
    risk_mgr = RiskManager(cfg.risk, store=store)
    news = NewsFilter(cfg.news)
    if cfg.news.enabled:
        n_events = news.refresh()
        log.info("news calendar: %s events loaded (feed=%s)%s", n_events, cfg.news.feed,
                 f" ERROR: {news.last_error}" if news.last_error else "")

    summary: Dict[str, dict] = {"decisions": {}, "errors": {}, "opened": [], "closed": 0}
    try:
        if risk_mgr.kill_switch_engaged():
            log.warning("kill switch engaged (%s); not opening new trades", cfg.risk.kill_switch_file)
        server_time = None
        try:
            server_time = await client.server_time()
        except Exception:  # noqa: BLE001
            pass

        if not dry_run:
            summary["closed"] = await reconcile(broker, store)

        equity = 0.0
        if dry_run:
            equity = float(store.state.notes.get("paper_equity")
                           or os.environ.get("FXBOT_PAPER_EQUITY", 10000))
        else:
            try:
                equity = await broker.balance()
            except Exception as exc:  # noqa: BLE001
                log.error("could not read balance: %s", exc)

        live_positions: List[dict] = []
        if not dry_run:
            try:
                live_positions = await broker.open_positions()
            except Exception as exc:  # noqa: BLE001
                log.error("could not read portfolio: %s", exc)
        open_symbols = {p.get("symbol") for p in live_positions}
        open_symbols |= {p.get("symbol") for p in store.state.open_positions.values()}

        if cfg.news.enabled and not dry_run:
            await _flatten_into_news(broker, store, news, cfg)

        for symbol in (symbols or cfg.data.symbols):
            try:
                frame = await prepare_frame(client, symbol, cfg, server_time, news=news)
                if frame.empty:
                    summary["errors"][symbol] = "not enough data"
                    continue
                decision = signal_at(frame, cfg.strategy, model=model,
                                     threshold=cfg.model.threshold,
                                     news_mask=frame.get("news_blocked"))
                store.set_last_bar(symbol, frame.index[-1])
                if not decision:
                    summary["decisions"][symbol] = "no signal"
                    continue
                if decision["side"] == 0:
                    summary["decisions"][symbol] = "flat"
                    continue
                summary["decisions"][symbol] = {
                    "side": int(decision["side"]),
                    "proba": decision.get("proba"),
                    "accepted": decision["accepted"],
                    "reason": decision["reason"],
                    "price": round(decision["price"], 5),
                }
                if not decision["accepted"]:
                    log.info("%s: setup rejected by model (%s)", symbol, decision["reason"])
                    continue
                if symbol in open_symbols:
                    log.info("%s: already exposed; skipping", symbol)
                    continue
                allowed, why = risk_mgr.can_open(equity, len(open_symbols) + len(store.state.open_positions),
                                                 store.state.day_pnl)
                if not allowed:
                    log.info("%s: risk gate says no (%s)", symbol, why)
                    summary["decisions"][symbol]["blocked"] = why
                    continue

                order = build_order(symbol, int(decision["side"]), decision["price"],
                                    decision["vol"], equity,
                                    cfg.strategy.stop_loss_k, cfg.strategy.take_profit_k,
                                    cfg.risk)
                if order is None:
                    summary["decisions"][symbol]["blocked"] = "stake below minimum"
                    continue

                if dry_run:
                    log.info("[PAPER] would open %s %s stake=%.2f x%s SL=%.2f TP=%.2f (%s)",
                             symbol, order.contract_type, order.stake, order.multiplier,
                             order.stop_loss, order.take_profit, decision["reason"])
                    summary["opened"].append({"symbol": symbol, "dry_run": True, **order.to_dict()})
                    continue

                result = await broker.place(order)
                if result and result.get("contract_id"):
                    store.record_open(result["contract_id"], {
                        "symbol": symbol,
                        "side": int(decision["side"]),
                        "stake": order.stake,
                        "multiplier": order.multiplier,
                        "risk_money": order.risk_money,
                        "entry_ref": order.entry_ref,
                        "opened_at": datetime.now(timezone.utc).isoformat(),
                        "proba": decision.get("proba"),
                        "strategy": decision["strategy"],
                    })
                    open_symbols.add(symbol)
                    summary["opened"].append({"symbol": symbol, "contract_id": result["contract_id"],
                                              **order.to_dict()})
            except Exception as exc:  # noqa: BLE001
                log.exception("cycle failed for %s: %s", symbol, exc)
                summary["errors"][symbol] = str(exc)
        store.mark_cycle()
    finally:
        if own_client and client is not None:
            await client.close()
    return summary


async def run_loop(cfg: Config, dry_run: bool = True, model=None,
                   stop_after: Optional[int] = None) -> None:
    """Keep running `run_cycle` just after each bar closes, forever."""
    store = make_store(cfg)
    client = await connect_with_retry(cfg.deriv, authorize=bool(cfg.deriv.token))
    broker = DerivBroker(client, cfg.deriv, cfg.costs)
    news = NewsFilter(cfg.news)
    iterations = 0
    try:
        while stop_after is None or iterations < stop_after:
            started = datetime.now(timezone.utc).timestamp()
            try:
                if iterations % 20 == 0 and cfg.news.enabled:
                    news.refresh()          # pick up newly scheduled events
                await run_cycle(cfg, client=client, store=store, model=model, dry_run=dry_run)
            except Exception as exc:  # noqa: BLE001
                log.exception("cycle error: %s", exc)
            iterations += 1
            if stop_after is not None and iterations >= stop_after:
                break
            next_bar = _seconds_until_next_bar(cfg.data.granularity, offset=5)
            elapsed = datetime.now(timezone.utc).timestamp() - started
            await asyncio.sleep(max(5.0, next_bar - elapsed))
            try:
                await client.ping()
            except Exception:  # noqa: BLE001
                log.warning("ping failed; reconnecting")
                await client.close()
                client = await connect_with_retry(cfg.deriv, authorize=bool(cfg.deriv.token))
                broker = DerivBroker(client, cfg.deriv, cfg.costs)
    finally:
        await client.close()


async def _flatten_into_news(broker: DerivBroker, store: StateStore, news: NewsFilter,
                             cfg: Config) -> int:
    """Close positions that would otherwise be carried into a Tier-1 release.

    The bot's time stop is several hours, so a trade opened at 10:00 would still
    be open at NFP. Around a release the backtest's fill assumptions stop
    holding, so we take the position off before the window opens.
    """
    closed = 0
    for contract_id, pos in list(store.state.open_positions.items()):
        symbol = pos.get("symbol")
        should, reason = news.should_close(symbol=symbol)
        if not should:
            continue
        log.info("closing %s before news (%s)", contract_id, reason)
        try:
            await broker.close(int(contract_id))
        except Exception as exc:  # noqa: BLE001
            log.error("could not close %s before news: %s", contract_id, exc)
            continue
        try:
            info = (await broker.contract_state(int(contract_id))).get("proposal_open_contract", {})
            pnl = float(info.get("profit", 0) or 0)
        except Exception:  # noqa: BLE001
            pnl = 0.0
        if contract_id in store.state.open_positions:
            store.record_close(contract_id, pnl, {"exit_reason": f"news: {reason}"})
        closed += 1
    return closed


def _seconds_until_next_bar(granularity: int, offset: float = 5.0) -> float:
    """Seconds until `offset` seconds after the next bar close (UTC-aligned)."""
    now = datetime.now(timezone.utc).timestamp()
    return granularity - (now % granularity) + offset
