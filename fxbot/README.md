# fxbot — a Deriv FX trading system you can audit

Short-term FX, automated on Deriv, written so that **you can check every claim
it makes**. It shares nothing with the NearBuyGoods app in this repo; it lives
in its own directory.

> **Not financial advice.** This is a research harness with an execution layer
> attached. Read [Before you fund it](#before-you-fund-it) before enabling live
> trading. Most configurations will lose money; the system is designed to tell
> you that quickly rather than quietly.

---

## 1. Read this first: Deriv's cost structure decides your strategy

Deriv's **Multipliers** (the `MULTUP`/`MULTDOWN` contracts this bot trades) charge
commission on **notional** = `stake × multiplier`, at roughly `0.000199 × notional`
per side. Since you size the stake so that a stop-out loses a fixed amount:

```
notional   = risk_money / stop_distance_pct
commission = 0.000199 × notional
           = 0.000199 × risk_money / stop_distance_pct

=>  commission / risk  =  0.000199 / stop_distance_pct
```

**Your cost per unit of risk is inversely proportional to your stop width.** Halve
the stop and you double the cost, for the same risk. Run it yourself:

```bash
python -m fxbot.cli costs
```

```
  stop (x bar vol) | stop in pips* | cost % of risk | break-even win rate (RR=2.0)
----------------------------------------------------------------------------------
               0.5 |           2.0 |          199.0% |                        99.7%  <-- impossible
               1.0 |           4.0 |           99.5% |                        66.5%  <-- expensive
               2.0 |           8.0 |           49.8% |                        49.9%  <-- expensive
               3.0 |          12.0 |           33.2% |                        44.4%
               6.0 |          24.0 |           16.6% |                        38.9%
              12.0 |          48.0 |            8.3% |                        36.1%
```

Consequences, in order of importance:

1. **Scalping with 2–5 pip stops on Deriv multipliers is arithmetically doomed.**
   You would need a ~70–100% hit rate just to break even.
2. The shipped defaults are therefore M15 bars with a **3× bar-volatility stop**
   (≈12 pips on EURUSD, ≈33% of risk in commission) and a **2R target**. Holding
   times land in the 1–8 hour range — "short term", but not "5 pips in 90 seconds".
3. If you genuinely want 3-pip stops, don't use multipliers. Use **Deriv MT5**
   (spread + per-lot commission — normal FX economics) — but note that automating
   MT5 needs a Windows host running the terminal, i.e. a VPS. Deriv's WebSocket
   API cannot place MT5 CFD orders.
4. Deriv's **synthetic indices** (e.g. `R_75`, `stpRNG`) have far higher
   volatility per bar, so the same pip-width stop is a smaller fraction of price
   and the commission hurts less. They trade 24/7. Worth testing if your
   schedule doesn't match the FX sessions.

Verify the numbers on your own account before trusting any backtest:
`python -m fxbot.cli costs --probe frxEURUSD,frxGBPUSD`.

---

## 2. The news blackout window

### What it is

A time window around scheduled macro releases (NFP, CPI, FOMC, ECB/BOE rate
decisions, PMIs…) during which the bot **opens nothing**, and — optionally —
**closes** what it is holding before the biggest ones. Typical settings:

| Tier | Events | Window | Why |
|---|---|---|---|
| High | NFP, CPI, FOMC, rate decisions | 30 min before → 30 min after | Volume and volatility jump from ~30 min before to ~30 min after, and spreads blow out [3](https://public.econ.duke.edu/~boller/Published_Papers/restud_18.pdf) |
| Medium | PMI, retail sales, jobless claims | 10 min before → 10 min after | Shorter-lived impact |
| Low | minor regional data | none | Not worth the lost trades |

It is **currency-scoped**: US data blocks `frxEURUSD` and `frxUSDJPY`, but not
`frxEURGBP` [3](https://www.mt4copier.com/news-filter-copier/).

### Why it exists (the mechanics, not the vibes)

Two things happen at a release, and both invalidate a short-term system's
assumptions:

1. **Liquidity vanishes.** Market makers pull top-of-book quotes rather than
   take directional risk into a print. Retail spreads on majors go from sub-pip
   to 5–30 pips for seconds to minutes. Your stop is then triggered by the *ask*
   several pips beyond the level your chart shows — the classic "phantom
   stop-out" [2](https://fxnx.com/en/blog/spread-widening-scheduled-news-peaks-recovery-times).
2. **Price jumps instead of walking.** Macro surprises produce discontinuities,
   and the largest FX jumps cluster around scheduled announcements. Ederington &
   Lee [5](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1540-6261.1993.tb04750.x)
   found the bulk of the adjustment happens within the first minute, with
   volatility elevated ~15 minutes and still slightly elevated for hours.

So the filter is not trying to *trade* the news — it is protecting the
**validity of your backtest**. The backtester assumes you exit near your stop.
Around a release you do not, so those bars are exactly where your live results
diverge from your simulated ones.

### Does it improve the bot?

Honestly: **it is a risk filter, not an edge. Expect the tail to improve, not
the headline number.**

* **What it reliably fixes:** the worst trades. For a breakout system, news
  spikes punch through a channel and retrace within minutes — the bot buys the
  spike and eats a full stop. Those losses cluster in a handful of minutes per
  month, and removing them improves max drawdown, worst-trade and profit factor
  more than it improves average expectancy.
* **What it costs:** trades. NFP is monthly, CPI monthly, FOMC eight times a
  year — with 30/30 windows that is ~2–4% of trading hours removed, plus
  whatever your medium-tier events remove. Fewer trades means *less* statistical
  power when you evaluate everything else.
* **What it will not do:** make a bad strategy good. On synthetic noise the
  blackout changes almost nothing, because there is no news in synthetic noise.
* **The strongest argument for it is not expectancy at all.** It is that your
  backtest cannot model a 20-pip spread expansion, so the honest options are
  "don't trade there" or "accept that this slice of your results is fiction".

You can measure it yourself rather than take my word for it:

```bash
python -m fxbot.cli backtest            # baseline
# set news.enabled = false in fxbot/config.json
python -m fxbot.cli backtest            # compare expectancy, max DD, worst trade
```

Compare `max_drawdown_pct` and the worst single trade, not just `expectancy_r`.
If the blackout makes no difference at all on *real* data, your calendar is
probably empty (check `python -m fxbot.cli news`).

### Calendars

| `news.feed` | Source | Notes |
|---|---|---|
| `file` | `data/fxbot/news.json` | You maintain it. Add with `news --add "2026-10-02T12:30:00Z,USD,US NFP,3"` |
| `finnhub` | Finnhub `/calendar/economic` | Free key, set `news.finnhub_token` + UTC offset |
| `rules` | Built-in recurring rules | NFP is exact (first Friday, 8:30 New York). CPI is **approximate** — verify against the BLS calendar |
| `auto` (default) | file → finnhub → rules |  |

A missing or broken calendar degrades to "no events", never to a crash.

One gap worth knowing: the filter blocks **entries**. With an 8-hour time stop a
position opened at 10:00 would still be open at NFP, so `news.close_before_high`
(default on) flattens those positions `close_lead_minutes` before a high-impact
event.

---

## 3. Architecture

```
                     ┌────────── research (offline, repeatable) ──────────┐
   Deriv candles ──► features ──► rules ──► triple-barrier labels
                                    │              │
                                    │              └──► meta-model  (LightGBM / sklearn)
                                    │                        │  "take this setup?"
                                    └────────────────────────┴──► backtest w/ costs
                                                                        │
   ┌──── runtime (online) ──────────────────────────────────────────────┘
   │  bar close ──► features ──► rules ──► model filter ──► risk sizing ──► Deriv order
   │                                                            │              (SL/TP server-side)
   │                                                       kill switch
   └────► state (JSON or Upstash Redis) ──► reconciliation ──► day P&L
```

| Module | Job |
|---|---|
| `deriv.py` | Deriv WebSocket v3 client (request/response + keepalive + streams) |
| `data.py` | candles → pandas, gzip cache, synthetic generator for offline work |
| `features.py` | 28 causal features (no lookahead — tested) |
| `labeling.py` | triple-barrier labels, sample weights, purged walk-forward splits |
| `strategy.py` | rule-based primary signals (`donchian_breakout`, `ema_pullback`, `rsi_reversal`) |
| `model.py` | the ML filter: "take this setup or skip it?" |
| `risk.py` | stake sizing, daily loss cap, kill switch, cost maths |
| `backtest.py` | barrier simulator with commission/spread/slippage |
| `broker.py` | proposal → buy → reconcile, cost probing |
| `state.py` | crash-safe state (JSON file or Upstash REST) |
| `engine.py` | the loop, plus a one-shot cycle for cron/serverless |
| `news.py` | economic-calendar blackout filter (file / Finnhub / recurring rules) |
| `pipeline.py` | dataset → purged walk-forward CV → OOS comparison |
| `web/` | dashboard: FastAPI backend + vanilla-JS UI (see below) |

**Why the ML model doesn't predict direction.** A single model asked "will EURUSD
go up in 15 minutes?" has to learn direction, timing and regime from a tiny
signal-to-noise ratio. Splitting it in two (López de Prado's *meta-labelling*)
works better with retail-sized data:

* the **rule** proposes trades (interpretable, large sample, you can eyeball it);
* the **model** only decides whether to take this particular setup.

When it breaks you can tell which half broke. A "predict the next bar" LSTM is
worse on this data and impossible to debug — don't.

---

## 4. Quickstart

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1. see the cost table (no network needed)
python -m fxbot.cli costs

# 2. offline smoke test: synthetic random-walk data through the whole pipeline
python -m fxbot.cli synth-data --bars 20000
python -m fxbot.cli backtest
python -m fxbot.cli train
python -m fxbot.cli scan --offline

# 3. real data (needs DERIV_APP_ID; add DERIV_API_TOKEN for account access)
export DERIV_APP_ID=1089
python -m fxbot.cli fetch-data --symbols frxEURUSD,frxGBPUSD,frxUSDJPY
python -m fxbot.cli backtest
python -m fxbot.cli train --importances

# 4. paper trade, then (much later) live
python -m fxbot.cli paper
python -m fxbot.cli live --yes         # reads DERIV_API_TOKEN
```

On synthetic noise the shipped config prints roughly **−0.4R to −0.5R per trade**
with a ~30% commission drag. That is the honest "no edge" baseline. **If your
real-data result is not clearly better than that, you do not have a system.**

`train` ends with a verdict and refuses to flatter you:

```
verdict: expectancy -0.5053R with t-stat -9.03. Below ~2 you cannot
distinguish this from luck. Do not fund it.
```

---

## 5. Can I run this on Vercel?

**Short answer: yes for the plumbing, no as your primary home.** Vercel has no
persistent process, and a trading bot wants one. But the bot is deliberately
built so a stateless cron *can* drive it:

* one CLI entrypoint (`--once`) and one HTTP handler (`deploy/vercel/api/cron.py`)
  that each run **exactly one cycle** and exit;
* no in-memory state between cycles — state goes to Upstash Redis / Vercel KV
  (`FXBOT_STATE_URL`, `FXBOT_STATE_TOKEN`);
* risk limits live **server-side** on Deriv (`limit_order.stop_loss` /
  `take_profit`), so an invocation that dies after `buy` still leaves a
  protected position. There is no unprotected-open-position window.

The frictions that make me recommend against it as the main deployment:

| Issue | Detail |
|---|---|
| Cron cadence | **Hobby caps cron at once per day** — useless. Pro ($20/mo) allows per-minute, or point an external scheduler (cron-job.org, Upstash QStash, GitHub Actions) at `/api/cron`. |
| Cold starts | pandas + scikit-learn in a serverless bundle → 5–15s cold starts. `--no-model` (rules only) helps a lot. |
| Timing | Cron is approximate. Fine for M15 bar-close decisions, not for anything tighter. |
| Bundle size | Python functions have size limits; keep `requirements.txt` minimal. |

### Recommended hosts instead (all ≈ $3–7/month, all always-on)

| Host | Cost | Notes |
|---|---|---|
| **Railway** | ~$5 | `railway up` with the included `Dockerfile`; persistent volume for `/app/data` |
| **Fly.io** | ~$3–5 | `fly deploy` with `deploy/fly.toml` (already sets `min_machines_running = 1`) |
| **Render** | ~$7 | `deploy/render.yaml`; use a **worker**, not a web service (a web service sleeps) |
| **Oracle Cloud free tier** | $0 | Always-free AMD VM (1/8 OCPU, 1GB) is enough for this; requires a bit of Linux setup |
| **Termux on an old Android phone** | $0 | Genuinely viable: `pkg install python`, `pip install -r requirements.txt`, `python -m fxbot.cli paper`. Keep it plugged in. |
| **Vercel + external cron** | $0–20 | Works; use it if you insist on staying serverless |

```bash
# Railway
railway login && railway init && railway up
railway variables set DERIV_API_TOKEN=... FXBOT_MODE=paper

# Fly.io
fly launch --config deploy/fly.toml --dockerfile Dockerfile
fly secrets set DERIV_API_TOKEN=... FXBOT_MODE=paper
fly deploy

# Any Docker host
docker build -t fxbot . && docker run -d --name fxbot \
  --env-file .env -v fxbot_data:/app/data fxbot
```

Vercel path, if you want it:

```bash
cp deploy/vercel/vercel.json deploy/vercel/requirements.txt .   # if deploying fxbot/ as the project root
cp -r deploy/vercel/api .
vercel env add DERIV_API_TOKEN
vercel env add FXBOT_STATE_URL        # https://<your-db>.upstash.io
vercel env add FXBOT_STATE_TOKEN
vercel deploy --prod
```

---

## 6. The dashboard

```bash
pip install -r requirements-web.txt
python -m fxbot.cli serve            # http://localhost:8000
```

A single-page UI (no build step, no npm) over a FastAPI backend:

| Tab | What it gives you |
|---|---|
| **Overview** | balance/equity, day P&L, win rate, open positions, recent trades, equity curve, and the live **cost reality check** (commission % of risk, break-even hit rate) |
| **Signals** | scan every symbol now: side, P(win), TAKE/SKIP, and whether the news blackout is blocking it |
| **Parameters** | every parameter in 7 groups, with ranges, clamping and help text. Edits are validated server-side and written to `config.json` |
| **Research** | run fetch-data / backtest / train as background jobs and stream their logs |
| **News blackout** | upcoming events, per-symbol blocked/clear status, add events by hand |
| **Logs** | live server log tail |

Controls: kill switch, resume, run one cycle now, close a single contract,
close everything, and switch the process between paper and live mode.

**Safety model.** The process starts in `FXBOT_MODE` (paper by default) and
endpoints that move money return `409` while it is in paper mode — switching to
live is an explicit `POST /api/mode {"mode":"live"}` and requires a Deriv token.
Set `FXBOT_WEB_TOKEN` to require `Authorization: Bearer <token>` on every
`/api/*` call; without it the UI shows a warning banner, because an open
dashboard can place trades.

Docker one-liner for a host instead of running it locally:

```bash
docker build -t fxbot . && docker run -d -p 8000:8000 \
  -e FXBOT_WEB_TOKEN=$(openssl rand -hex 16) -e FXBOT_MODE=paper \
  -v fxbot_data:/app/data fxbot python -m fxbot.cli serve
```

> **The backtest job always scores the model OUT-OF-SAMPLE.** While wiring this
> up I watched an in-sample run report a **92% win rate and +1.5R on synthetic
> random noise** — the model had simply memorised its training bars. The same
> configuration scored honestly is −0.5R with a t-stat of −9. If your tooling
> lets you evaluate a model on its own training data, you will eventually
> believe a lie like that one.

## 7. Before you fund it

Work through this list. Skipping a line is how accounts die.

- [ ] `costs` shows commission below ~40% of risk for your stop width
- [ ] At least ~6 months of M15 history per symbol (`fetch-data`)
- [ ] `train` reports a positive expectancy in **every** walk-forward fold, not
      just on average — one bad fold means regime dependence, not an edge
- [ ] Out-of-sample expectancy has **t-stat ≥ 2** over **≥ 100 trades**
- [ ] `compare_filter` shows the model's filter beating "take every setup"
- [ ] News calendar is populated (`python -m fxbot.cli news` lists real events)
- [ ] Paper traded ≥ 100 live trades, and live fills match backtest assumptions
      (check the state file's realised P&L vs. the backtest's expectancy)
- [ ] Stake is small enough that a 20-trade losing streak doesn't hurt
- [ ] You know how to stop it: `python -m fxbot.cli kill` (or delete the broker
      token / close positions in the Deriv app)

Guardrails that are on by default: 0.5% risk per trade, −2% daily loss cap,
max 3 concurrent positions, per-symbol exposure once, session filter, volatility
filter, cooldown between entries, and a kill switch that survives restarts.

**Known gaps** (fix before scaling, in rough priority order):

1. **Calendar completeness.** The built-in rules know NFP (exact) and CPI
   (approximate). Everything else — FOMC, ECB/BOE, PMIs — needs your JSON file
   or a Finnhub key. An empty calendar means an unfiltered bot.
2. **Session hours ignore DST.** The London/NY windows shift by an hour twice a
   year; `features.session_flags` uses fixed UTC hours.
3. **Spread is a fixed assumption** (`CostConfig.spread_bps`), not measured.
   Use `costs --probe` to calibrate it per symbol/session.
4. **One position per symbol, long-only exposure logic per signal** — no
   correlation cap across correlated pairs (EURUSD and GBPUSD are ~the same
   trade). Either trade one of them or add a basket-level cap.
5. `commission_on_exit=True` is deliberately pessimistic; measure it and relax.

---

## 8. Tuning

Everything lives in `fxbot/config.json` (generate with `python -m fxbot.cli
config`; env vars override it).

| Knob | Where | Effect |
|---|---|---|
| `strategy.stop_loss_k` / `take_profit_k` | strategy | **The cost dial.** Wider stop → lower commission share, lower win rate |
| `data.granularity` | data | 300 (M5) / 900 (M15) / 3600 (H1). Lower = more trades, higher cost share |
| `strategy.name` | strategy | `donchian_breakout` (trend), `ema_pullback`, `rsi_reversal` (fade) |
| `model.threshold` | model | Higher = fewer, pickier trades. This is your main precision/recall dial |
| `risk.risk_per_trade_pct` | risk | 0.25–0.5% is sane; 2%+ is how accounts die |
| `risk.multiplier` | risk | Leverage per contract. Does **not** change cost/risk ratio |
| `strategy.session_start_hour` / `_end_hour` | strategy | Concentrate on London/NY overlap |
| `news.enabled` / `news.min_impact` | news | Turn the blackout on and set which tiers block |
| `news.minutes_before_high` / `_after_high` | news | 30/30 is the standard Tier-1 window |
| `news.feed` / `news.calendar_path` | news | Where the events come from |

A reasonable experiment loop:

```bash
python -m fxbot.cli backtest --dump out/           # baseline
# edit fxbot/config.json
python -m fxbot.cli backtest --dump out/           # compare
python -m fxbot.cli train --importances            # refit + see what matters
```

Track how many configurations you try. If you test 50 variants, the best one
will look good by chance — that is what the walk-forward folds and the t-stat
are there to protect you from.

---

## 9. Tests

```bash
python -m pytest -q
```

The tests are not decoration; they encode the failure modes that produce fake
profits:

* `test_features.py::test_features_are_causal` — truncating the future must not
  change any past feature value (catches look-ahead bugs)
* `test_labeling.py::test_walk_forward_splits_purge_and_ordering` — no training
  row may resolve at or after the first test timestamp
* `test_backtest.py::test_both_barriers_in_one_bar_assumes_stop` — an ambiguous
  bar is booked as a loss, never as a win
* `test_backtest.py::test_on_random_walk_edge_is_not_miraculous` — synthetic
  noise must not produce a fat positive edge
* `test_risk.py::test_cost_inverse_to_stop_width` — the cost maths
* `test_news.py` — blackout windows, currency scoping, the vectorised mask that
  the backtester uses must agree with the live check, and a broken calendar must
  degrade to "no events" instead of raising
* `test_web.py` — every parameter is exposed with a current value, edits persist
  and are clamped, money endpoints refuse to run in paper mode, token auth works

---

## 10. Licence / responsibility

You own every trade this places. Start with the smallest stake Deriv allows and
size up only after the paper-trading statistics hold up for a few hundred live
trades. If the bot is losing, the honest possibilities are (a) there is no edge,
(b) the edge is smaller than the costs, (c) the edge is real and your sample is
too small to see it. In that order.
