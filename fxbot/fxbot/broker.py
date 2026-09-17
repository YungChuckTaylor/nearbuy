"""Deriv-specific order placement.

Flow for a multiplier trade:
    1. proposal(...)  -> ask_price + server-side validation of the parameters
    2. buy(proposal_id, ask_price)
    3. poll portfolio()/proposal_open_contract() -> stop-loss and take-profit
       live on Deriv's side, so a crash here does not leave an unprotected
       position open.

That last point is the main reason multipliers (not "rise/fall" binaries) are
the right contract for an automated system: the risk limits are server-side.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Dict, List, Optional

from .config import CostConfig, DerivConfig
from .risk import Order

log = logging.getLogger(__name__)


class DerivBroker:
    def __init__(self, client, cfg: DerivConfig, costs: Optional[CostConfig] = None):
        self.client = client
        self.cfg = cfg
        self.costs = costs or CostConfig()

    # ------------------------------------------------------------- account
    async def balance(self) -> float:
        resp = await self.client.balance()
        bal = resp.get("balance", {})
        return float(bal.get("balance", 0.0))

    async def open_positions(self) -> List[dict]:
        resp = await self.client.portfolio()
        contracts = resp.get("portfolio", {}).get("contracts", []) or []
        out = []
        for c in contracts:
            out.append({
                "contract_id": c.get("contract_id"),
                "symbol": c.get("symbol"),
                "contract_type": c.get("contract_type"),
                "stake": float(c.get("buy_price", 0) or 0),
                "payout": float(c.get("payout", 0) or 0),
                "purchase_time": c.get("purchase_time"),
            })
        return out

    # --------------------------------------------------------------- trading
    async def quote(self, order: Order) -> dict:
        """Get a proposal first: it validates parameters and returns the ask price."""
        params = order.to_deriv_parameters(self.cfg.currency)
        resp = await self.client.proposal(params)
        proposal = resp.get("proposal", {})
        return {
            "id": proposal.get("id"),
            "ask_price": float(proposal.get("ask_price", 0) or 0),
            "spot": proposal.get("spot"),
            "commission": proposal.get("commission"),
            "raw": proposal,
        }

    async def place(self, order: Order, max_slippage_pct: float = 5.0) -> Optional[dict]:
        """Quote, sanity-check, buy. Returns the buy response or None."""
        quote = await self.quote(order)
        if not quote["id"]:
            log.error("no proposal id returned for %s", order.symbol)
            return None
        expected = float(order.stake)
        if quote["ask_price"] and abs(quote["ask_price"] - expected) / max(expected, 1e-9) * 100 > max_slippage_pct:
            log.warning("quote %.2f differs from expected stake %.2f by more than %.1f%%; skipping",
                        quote["ask_price"], expected, max_slippage_pct)
            return None
        log.info("buying %s %s stake=%.2f x%s SL=%.2f TP=%.2f (risk %.2f)",
                 order.symbol, order.contract_type, order.stake, order.multiplier,
                 order.stop_loss, order.take_profit, order.risk_money)
        resp = await self.client.buy(quote["id"], quote["ask_price"] or expected)
        buy = resp.get("buy", {})
        log.info("filled contract_id=%s  balance_after=%.2f",
                 buy.get("contract_id"), float(resp.get("balance_after", 0) or 0))
        return {**buy, "quote": {k: v for k, v in quote.items() if k != "raw"}}

    async def close(self, contract_id: int, price: float = 0) -> dict:
        return await self.client.sell(contract_id, price)

    async def close_all(self) -> List[dict]:
        results = []
        for pos in await self.open_positions():
            try:
                results.append(await self.close(int(pos["contract_id"])))
            except Exception as exc:  # noqa: BLE001
                log.error("failed to close %s: %s", pos["contract_id"], exc)
        return results

    async def contract_state(self, contract_id: Optional[int] = None) -> dict:
        return await self.client.open_contract(contract_id)

    # ---------------------------------------------------------- cost probing
    async def measure_costs(self, symbols: List[str], multiplier: int = 30,
                            stake: float = 10.0) -> List[dict]:
        """Empirically estimate round-trip cost for each symbol.

        Compares the proposal's spot with the live tick and reads back whatever
        commission figure the API returns. Run this before you size anything --
        the model in `risk.cost_as_pct_of_risk` is only as good as these inputs.
        """
        rows = []
        for symbol in symbols:
            try:
                tick = await self.client.tick(symbol)
                market = float(tick["tick"]["quote"])
                proposal = await self.client.proposal({
                    "contract_type": "MULTUP",
                    "symbol": symbol,
                    "amount": stake,
                    "basis": "stake",
                    "currency": self.cfg.currency,
                    "multiplier": multiplier,
                })
                p = proposal.get("proposal", {})
                spot = p.get("spot")
                commission = p.get("commission")
                implied_spread_bps = None
                if spot:
                    implied_spread_bps = (float(spot) / market - 1.0) * 1e4
                rows.append({
                    "symbol": symbol,
                    "market": market,
                    "proposal_spot": spot,
                    "implied_spread_bps": implied_spread_bps,
                    "api_commission": commission,
                    "modelled_commission": stake * multiplier * self.costs.commission_rate,
                })
            except Exception as exc:  # noqa: BLE001
                log.warning("cost probe failed for %s: %s", symbol, exc)
                rows.append({"symbol": symbol, "error": str(exc)})
            await asyncio.sleep(0.2)
        return rows
