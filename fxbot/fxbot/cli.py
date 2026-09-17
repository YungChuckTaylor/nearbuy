"""Command line entrypoint.

    python -m fxbot.cli costs        # what Deriv's commission does to your edge
    python -m fxbot.cli fetch-data   # download candles to ./data/fxbot
    python -m fxbot.cli backtest     # honest-ish backtest of the rules
    python -m fxbot.cli train        # fit the meta-model with purged walk-forward CV
    python -m fxbot.cli scan         # what would it do right now?
    python -m fxbot.cli paper        # 24/5 paper trading loop (dry run)
    python -m fxbot.cli live         # real money -- read the README first
    python -m fxbot.cli status       # balance, open contracts, day P&L
"""

from __future__ import annotations

import argparse
import asyncio
import os
import json
import logging
import sys
from pathlib import Path
from typing import Optional

from .config import Config, load_config


def _setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    logging.Formatter.converter = __import__("time").gmtime  # UTC timestamps: FX is UTC


# --------------------------------------------------------------------- costs
def cmd_costs(args, cfg: Config) -> int:
    """Print the cost table that decides whether your stop width is survivable."""
    from .risk import cost_as_pct_of_risk

    print(f"\nDeriv multiplier commission: {cfg.costs.commission_rate:.6f} x notional"
          f"  (charged {'twice' if cfg.costs.commission_on_exit else 'once'} per round trip)")
    print("Commission as a percent of the money you risk, by stop width:\n")
    rr = cfg.strategy.take_profit_k / cfg.strategy.stop_loss_k
    print(f"{'stop (x bar vol)':>18} | {'stop in pips*':>13} | {'cost % of risk':>15} | "
          f"{f'break-even win rate (RR={rr:.1f})':>28}")
    print("-" * 82)
    vol = 0.0004  # ~4 pips of M15 EURUSD volatility, as a fraction of price
    for k in (0.5, 1.0, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0):
        stop_pct = vol * k
        pips = stop_pct / 0.0001
        cost = cost_as_pct_of_risk(stop_pct, cfg.costs.commission_rate, cfg.costs.commission_on_exit)
        be = (1 + cost) / (rr + 1)
        flag = "  <-- impossible" if be > 0.75 else "  <-- ruinous" if cost > 1.0 else \
            "  <-- expensive" if cost > 0.4 else ""
        print(f"{k:>18.1f} | {pips:>13.1f} | {cost * 100:>14.1f}% | {be * 100:>27.1f}%{flag}")
    print("\n* pips for a 5-digit EURUSD-like pair at 1.10, using a 4-pip M15 bar volatility.")
    print(f"  With these settings you need a {rr:.1f}R target; every trade pays the cost")
    print("  whether it wins or not, so the break-even hit rate climbs fast as the stop tightens.")
    print("Read this as: your stop must be WIDE relative to volatility, or the")
    print("commission eats more than the amount you are risking. If a tight stop is")
    print("non-negotiable, you need a venue with per-lot commissions, not multipliers.\n")
    if args.probe:
        asyncio.run(_probe_costs(cfg, args.probe))
    return 0


async def _probe_costs(cfg: Config, symbols_csv: str) -> None:
    from .broker import DerivBroker
    from .deriv import connect_with_retry

    symbols = [s.strip() for s in symbols_csv.split(",") if s.strip()]
    client = await connect_with_retry(cfg.deriv, authorize=bool(cfg.deriv.token))
    broker = DerivBroker(client, cfg.deriv, cfg.costs)
    try:
        rows = await broker.measure_costs(symbols, multiplier=cfg.risk.multiplier)
        print(json.dumps(rows, indent=2, default=str))
    finally:
        await client.close()


# ---------------------------------------------------------------- fetch data
async def _fetch(cfg: Config, symbols) -> None:
    from pathlib import Path

    from .data import Cache, drop_incomplete, fetch_history
    from .deriv import connect_with_retry

    cache = Cache(Path(cfg.data.cache_dir))
    client = await connect_with_retry(cfg.deriv, authorize=bool(cfg.deriv.token))
    try:
        server_time = await client.server_time()
        for symbol in symbols:
            df = await fetch_history(client, symbol, cfg.data.granularity, cfg.data.history_bars)
            df = drop_incomplete(df, cfg.data.granularity, server_time)
            path = cache.save(df, symbol, cfg.data.granularity)
            print(f"{symbol}: {len(df)} bars -> {path}  ({df.index[0]} .. {df.index[-1]})")
    finally:
        await client.close()


def cmd_fetch(args, cfg: Config) -> int:
    symbols = [s.strip() for s in args.symbols.split(",")] if args.symbols else cfg.data.symbols
    asyncio.run(_fetch(cfg, symbols))
    return 0


# ------------------------------------------------------------------ backtest
def cmd_synth(args, cfg: Config) -> int:
    """Write synthetic candles into the cache so the whole pipeline runs offline.

    There is no edge in this data. If your configuration "works" on it, the win
    was manufactured by your own code -- that is exactly what this is for.
    """
    from pathlib import Path

    from .data import Cache, synthetic_ohlc

    cache = Cache(Path(cfg.data.cache_dir))
    symbols = [s.strip() for s in args.symbols.split(",")] if args.symbols else cfg.data.symbols
    for i, symbol in enumerate(symbols):
        df = synthetic_ohlc(n=args.bars, seed=args.seed + i, freq=f"{cfg.data.granularity}s")
        path = cache.save(df, symbol, cfg.data.granularity)
        print(f"{symbol}: {len(df)} synthetic bars -> {path}")
    print("\nThis data is random-walk noise. Use it to verify the plumbing, not the strategy.")
    return 0


def cmd_backtest(args, cfg: Config) -> int:
    from .backtest import run_backtest
    from .features import compute_features
    from .pipeline import load_frames
    from .strategy import enforce_cooldown, primary_signals

    frames = load_frames(cfg)
    if not frames:
        print("no cached data: run `python -m fxbot.cli fetch-data --symbols frxEURUSD`")
        return 1
    model = _load_model(cfg) if args.model else None
    for symbol, df in frames.items():
        feats = compute_features(df, lookback=cfg.strategy.lookback,
                                 atr_period=cfg.strategy.atr_period,
                                 ema_fast=cfg.strategy.ema_fast, ema_slow=cfg.strategy.ema_slow)
        sides = enforce_cooldown(primary_signals(feats, cfg.strategy), cfg.strategy.cooldown_bars)
        proba = None
        if model is not None:
            from .features import feature_matrix

            proba = pd.Series(model.predict_proba(feature_matrix(feats)), index=feats.index)
        res = run_backtest(feats, sides,
                           stop_loss_k=cfg.strategy.stop_loss_k,
                           take_profit_k=cfg.strategy.take_profit_k,
                           max_holding_bars=cfg.strategy.max_holding_bars,
                           cooldown_bars=cfg.strategy.cooldown_bars,
                           costs=cfg.costs, risk=cfg.risk,
                           equity0=args.equity,
                           granularity=cfg.data.granularity,
                           proba=proba, threshold=cfg.model.threshold)
        print(f"\n=== {symbol} ({cfg.strategy.name}, model={'on' if model else 'off'}) ===")
        print(res.summary())
        if args.dump:
            out = Path(args.dump) / f"{symbol}_trades.csv"
            out.parent.mkdir(parents=True, exist_ok=True)
            res.trades.to_csv(out)
            print(f"trades -> {out}")
    return 0


def _load_model(cfg: Config):
    from .model import MetaModel

    path = Path(cfg.model.model_path)
    if not path.exists():
        print(f"no model at {path}; run `train` first")
        return None
    return MetaModel.load(path)


# --------------------------------------------------------------------- train
def cmd_train(args, cfg: Config) -> int:
    import pandas as pd

    from .pipeline import build_dataset, compare_filter, load_frames, walk_forward_evaluate

    frames = load_frames(cfg)
    if not frames:
        print("no cached data: run `fetch-data` first")
        return 1
    ds = build_dataset(cfg, frames)
    if ds.X.empty:
        print("no labelled events: check your signal parameters and cached history")
        return 1
    print(f"\ndataset: {len(ds.X)} events, {ds.X.shape[1]} features, "
          f"positive rate {ds.y.mean():.3f}")
    report, oos, model = walk_forward_evaluate(cfg, ds)
    if not report.empty:
        print("\n--- purged walk-forward folds (out-of-sample) ---")
        cols = [c for c in ["fold", "n_train", "n_test", "take_rate", "win_rate_taken",
                            "win_rate_all", "roc_auc"] if c in report.columns]
        print(report[cols].to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    comparison = compare_filter(cfg, ds, oos, equity0=args.equity)
    print("\n--- does the model's filter help? ---")
    print(comparison.to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    if model is not None:
        path = model.save(cfg.model.model_path)
        print(f"\nmodel -> {path}")
        if args.importances:
            imp = model.importances(ds.X, ds.y)
            print("\n--- permutation importance (AUC) ---")
            print(imp.to_string(float_format=lambda v: f"{v:.4f}"))
    if args.dump:
        Path(args.dump).parent.mkdir(parents=True, exist_ok=True)
        ds.labels.to_csv(args.dump)
        print(f"labels -> {args.dump}")
    _warn_if_weak(comparison)
    return 0


def _warn_if_weak(comparison) -> None:
    if comparison.empty:
        return
    best = comparison.sort_values("expectancy_r", ascending=False).iloc[0]
    n = float(best.get("n_trades", 0))
    t = float(best.get("t_stat", 0) or 0)
    print("\nverdict: ", end="")
    if n < 100:
        print(f"only {int(n)} trades -- nowhere near enough evidence. Get more history.")
    elif t < 2.0:
        print(f"expectancy {best['expectancy_r']:+.4f}R with t-stat {t:.2f}. "
              "Below ~2 you cannot distinguish this from luck. Do not fund it.")
    else:
        print(f"expectancy {best['expectancy_r']:+.4f}R with t-stat {t:.2f}. "
              "Promising -- now paper trade it for at least 100 live trades.")


# ---------------------------------------------------------------------- scan
async def _scan(cfg: Config, offline: bool, use_model: bool) -> None:
    from .engine import prepare_frame
    from .features import feature_matrix
    from .mock import FakeDerivClient
    from .strategy import signal_at

    model = _load_model(cfg) if use_model else None
    if offline:
        client = FakeDerivClient(symbols=cfg.data.symbols, granularity=cfg.data.granularity)
        await client.connect()
    else:
        from .deriv import connect_with_retry

        client = await connect_with_retry(cfg.deriv, authorize=bool(cfg.deriv.token))
    try:
        for symbol in cfg.data.symbols:
            frame = await prepare_frame(client, symbol, cfg)
            if frame.empty:
                print(f"{symbol}: insufficient data")
                continue
            decision = signal_at(frame, cfg.strategy, model=model, threshold=cfg.model.threshold)
            last = frame.index[-1]
            if not decision:
                print(f"{symbol} @ {last}: no setup")
                continue
            print(f"{symbol} @ {last}: side={int(decision['side']):+d} "
                  f"price={decision['price']:.5f} vol={decision['vol']:.6f} "
                  f"p={decision['proba'] if decision['proba'] is None else round(decision['proba'], 3)} "
                  f"-> {'TAKE' if decision['accepted'] else 'SKIP'} ({decision['reason']})")
    finally:
        await client.close()


# ----------------------------------------------------------------- run modes
def cmd_paper(args, cfg: Config) -> int:
    asyncio.run(_run(cfg, dry_run=True, use_model=not args.no_model, once=args.once,
                     offline=args.offline, cycles=args.cycles))
    return 0


def cmd_live(args, cfg: Config) -> int:
    if not cfg.deriv.token:
        print("refusing to trade live without DERIV_API_TOKEN set")
        return 2
    if not args.yes:
        print("This places REAL trades on your Deriv account.")
        print("Re-run with --yes once you have paper traded this configuration.")
        return 2
    asyncio.run(_run(cfg, dry_run=False, use_model=not args.no_model, once=args.once,
                     offline=False, cycles=args.cycles))
    return 0


async def _run(cfg: Config, dry_run: bool, use_model: bool, once: bool,
               offline: bool, cycles: Optional[int]) -> None:
    from .engine import run_cycle, run_loop
    from .mock import FakeDerivClient
    from .state import make_store

    model = _load_model(cfg) if use_model else None
    store = make_store(cfg)
    if once:
        if offline:
            client = FakeDerivClient(symbols=cfg.data.symbols, granularity=cfg.data.granularity)
            await client.connect()
            summary = await run_cycle(cfg, client=client, store=store, model=model, dry_run=dry_run)
        else:
            summary = await run_cycle(cfg, store=store, model=model, dry_run=dry_run)
        print(json.dumps(summary, indent=2, default=str))
        return
    if offline:
        client = FakeDerivClient(symbols=cfg.data.symbols, granularity=cfg.data.granularity)
        await client.connect()
        await run_cycle(cfg, client=client, store=store, model=model, dry_run=dry_run)
        return
    await run_loop(cfg, dry_run=dry_run, model=model, stop_after=cycles)


# -------------------------------------------------------------------- status
async def _status(cfg: Config) -> None:
    from .broker import DerivBroker
    from .deriv import connect_with_retry
    from .state import make_store

    store = make_store(cfg)
    if not cfg.deriv.token:
        print(json.dumps(store.stats(), indent=2, default=str))
        return
    client = await connect_with_retry(cfg.deriv, authorize=True)
    broker = DerivBroker(client, cfg.deriv, cfg.costs)
    try:
        balance = await broker.balance()
        positions = await broker.open_positions()
        print(json.dumps({"balance": balance, "positions": positions,
                          "state": store.stats(equity=balance)}, indent=2, default=str))
    finally:
        await client.close()


# --------------------------------------------------------------------- brakes
def cmd_kill(args, cfg: Config) -> int:
    from .risk import RiskManager
    from .state import make_store

    RiskManager(cfg.risk, store=make_store(cfg)).engage_kill_switch(args.reason)
    print(f"kill switch engaged ({args.reason}). No new trades will be opened.")
    print(f"resume with: python -m fxbot.cli resume")
    return 0


def cmd_resume(args, cfg: Config) -> int:
    from .risk import RiskManager
    from .state import make_store

    RiskManager(cfg.risk, store=make_store(cfg)).release_kill_switch()
    print("kill switch released.")
    return 0


# ----------------------------------------------------------------------- main
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="fxbot", description="Deriv FX trading bot")
    p.add_argument("--config", default=os.environ.get("FXBOT_CONFIG", "fxbot/config.json"))
    p.add_argument("--log-level", default=None)
    sub = p.add_subparsers(dest="command", required=True)

    c = sub.add_parser("costs", help="show the commission-vs-stop-width table")
    c.add_argument("--probe", metavar="SYMBOLS", help="also query the live API for these symbols")

    c = sub.add_parser("fetch-data", help="download candles into the cache")
    c.add_argument("--symbols", default=None, help="comma separated, e.g. frxEURUSD,frxGBPUSD")

    c = sub.add_parser("synth-data", help="write synthetic candles to the cache (offline smoke test)")
    c.add_argument("--bars", type=int, default=20000)
    c.add_argument("--seed", type=int, default=7)
    c.add_argument("--symbols", default=None)

    c = sub.add_parser("backtest", help="backtest the rules on cached data")
    c.add_argument("--model", action="store_true", help="apply the trained filter")
    c.add_argument("--equity", type=float, default=10_000.0)
    c.add_argument("--dump", default=None, help="directory for trade CSVs")

    c = sub.add_parser("train", help="fit the meta-model with purged walk-forward CV")
    c.add_argument("--equity", type=float, default=10_000.0)
    c.add_argument("--importances", action="store_true")
    c.add_argument("--dump", default=None, help="path for the labels CSV")

    c = sub.add_parser("scan", help="print today's setup decisions")
    c.add_argument("--offline", action="store_true", help="use synthetic data (no network)")
    c.add_argument("--no-model", action="store_true")

    c = sub.add_parser("paper", help="run the loop without placing orders")
    c.add_argument("--once", action="store_true", help="single cycle then exit (cron friendly)")
    c.add_argument("--offline", action="store_true")
    c.add_argument("--no-model", action="store_true")
    c.add_argument("--cycles", type=int, default=None)

    c = sub.add_parser("live", help="place real orders")
    c.add_argument("--yes", action="store_true", help="acknowledge real money")
    c.add_argument("--once", action="store_true")
    c.add_argument("--no-model", action="store_true")
    c.add_argument("--cycles", type=int, default=None)

    sub.add_parser("status", help="balance, open contracts, day P&L")

    c = sub.add_parser("kill", help="stop opening new trades (does not close open ones)")
    c.add_argument("--reason", default="manual")

    sub.add_parser("resume", help="allow new trades again")

    c = sub.add_parser("config", help="write the default config to a file")
    c.add_argument("--out", default="fxbot/config.json")
    return p


def main(argv: Optional[list] = None) -> int:
    args = build_parser().parse_args(argv)
    cfg = load_config(args.config)
    _setup_logging(args.log_level or cfg.log_level)

    if args.command == "config":
        cfg.save(args.out)
        print(f"wrote {args.out}")
        return 0
    if args.command == "costs":
        return cmd_costs(args, cfg)
    if args.command == "fetch-data":
        return cmd_fetch(args, cfg)
    if args.command == "synth-data":
        return cmd_synth(args, cfg)
    if args.command == "backtest":
        return cmd_backtest(args, cfg)
    if args.command == "train":
        return cmd_train(args, cfg)
    if args.command == "scan":
        asyncio.run(_scan(cfg, args.offline, use_model=not args.no_model))
        return 0
    if args.command == "paper":
        return cmd_paper(args, cfg)
    if args.command == "live":
        return cmd_live(args, cfg)
    if args.command == "status":
        asyncio.run(_status(cfg))
        return 0
    if args.command == "kill":
        return cmd_kill(args, cfg)
    if args.command == "resume":
        return cmd_resume(args, cfg)
    return 1


if __name__ == "__main__":
    sys.exit(main())
