"""A fake Deriv client so the pipeline is testable (and demoable) offline.

Implements the same surface as `deriv.DerivClient` for the calls the engine
uses. Prices come from `data.synthetic_ohlc`, so there is no real edge in them:
a strategy that looks profitable against this client is a bug in your code.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional

import pandas as pd

from . import data as data_mod


@dataclass
class FakeDerivClient:
    symbols: List[str] = field(default_factory=lambda: ["frxEURUSD"])
    granularity: int = 300
    bars: int = 5000
    seed: int = 7
    equity: float = 10_000.0
    contracts: Dict[int, dict] = field(default_factory=dict)
    requests: List[str] = field(default_factory=list)
    authorized: bool = True
    _counter: itertools.count = field(default_factory=lambda: itertools.count(1))

    def __post_init__(self):
        self._frames: Dict[str, pd.DataFrame] = {
            s: data_mod.synthetic_ohlc(n=self.bars, seed=self.seed + i, freq=f"{self.granularity}s")
            for i, s in enumerate(self.symbols)
        }
        self._now_offset = 0

    # ------------------------------------------------------------- lifecycle
    async def connect(self, authorize: bool = True):
        return self

    async def close(self):
        return None

    # ------------------------------------------------------------------ api
    async def server_time(self) -> int:
        frame = next(iter(self._frames.values()))
        return int(frame.index[-1].timestamp()) + self._now_offset

    async def candles(self, symbol: str, granularity: int = 300, count: int = 5000,
                      end: Optional[int] = None, style: str = "candles") -> dict:
        self.requests.append("candles")
        df = self._frames.get(symbol)
        if df is None:
            return {"candles": []}
        if end is not None and end != "latest":
            df = df.loc[:pd.Timestamp(end, unit="s", tz="UTC")]
        df = df.iloc[-count:]
        return {"candles": [
            {"epoch": int(ts.timestamp()), "open": float(r.open), "high": float(r.high),
             "low": float(r.low), "close": float(r.close)}
            for ts, r in df.iterrows()
        ]}

    async def tick(self, symbol: str) -> dict:
        self.requests.append("tick")
        df = self._frames[symbol]
        return {"tick": {"quote": float(df["close"].iloc[-1]), "symbol": symbol,
                         "epoch": int(df.index[-1].timestamp())}}

    async def balance(self) -> dict:
        return {"balance": {"balance": float(self.equity), "currency": "USD"}}

    async def portfolio(self) -> dict:
        return {"portfolio": {"contracts": [
            {"contract_id": cid, "symbol": c["symbol"], "contract_type": c["contract_type"],
             "buy_price": c["stake"], "payout": c["stake"] * 2}
            for cid, c in self.contracts.items() if not c.get("sold")
        ]}}

    async def proposal(self, parameters: dict) -> dict:
        self.requests.append("proposal")
        return {"proposal": {
            "id": f"P{next(self._counter)}",
            "ask_price": float(parameters.get("amount", 10)),
            "spot": 1.10,
            "commission": float(parameters.get("amount", 10)) * int(parameters.get("multiplier", 30)) * 0.000199,
        }}

    async def buy(self, proposal_id: str, price: float) -> dict:
        self.requests.append("buy")
        cid = next(self._counter)
        self.contracts[cid] = {"symbol": "frxEURUSD", "contract_type": "MULTUP",
                               "stake": price, "sold": False}
        return {"buy": {"contract_id": cid, "buy_price": price}, "balance_after": self.equity}

    async def sell(self, contract_id: int, price: float = 0) -> dict:
        self.requests.append("sell")
        c = self.contracts.get(int(contract_id))
        if c:
            c["sold"] = True
        return {"sell": {"contract_id": int(contract_id), "sold_for": price}}

    async def open_contract(self, contract_id: Optional[int] = None) -> dict:
        self.requests.append("open_contract")
        if contract_id is None:
            return {"proposal_open_contract": {}}
        c = self.contracts.get(int(contract_id), {})
        return {"proposal_open_contract": {
            "contract_id": int(contract_id),
            "is_sold": bool(c.get("sold", False)),
            "profit": 0.0 if not c.get("sold") else 3.5,
            "sell_price": 1.10,
        }}

    async def ping(self) -> dict:
        return {"ping": "pong"}
