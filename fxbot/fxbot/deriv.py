"""Minimal async client for the Deriv WebSocket API (v3).

Why hand-rolled instead of the official `deriv_api` package: the official one
pulls in RxPY and is awkward to drive from a stateless cron-style worker. This
is ~200 lines, has no surprising dependencies, and exposes request/response
multiplexing plus optional streams.

Endpoint:   wss://ws.derivws.com/websockets/v3?app_id=<APP_ID>
Auth:       {"authorize": "<API_TOKEN>"}  (token needs the Trade scope)
Keepalive:  {"ping": 1} every ~20s or the server drops the socket.
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Dict, Optional

from .config import DerivConfig

log = logging.getLogger(__name__)


class DerivError(RuntimeError):
    """Raised when the API returns an error frame or the socket dies."""

    def __init__(self, message: str, code: Optional[str] = None, payload: Optional[dict] = None):
        super().__init__(message)
        self.code = code
        self.payload = payload or {}


class DerivClient:
    """Connection manager + thin wrappers around the calls this bot needs."""

    def __init__(self, cfg: DerivConfig):
        self.cfg = cfg
        self._ws = None
        self._req_id = 0
        self._pending: Dict[int, asyncio.Future] = {}
        self._streams: Dict[str, asyncio.Queue] = {}
        self._reader_task: Optional[asyncio.Task] = None
        self._keepalive_task: Optional[asyncio.Task] = None
        self._authorized = False

    # ------------------------------------------------------------ lifecycle
    async def connect(self, authorize: bool = True) -> "DerivClient":
        import websockets  # local import: keeps offline tooling importable without it

        url = f"{self.cfg.endpoint}?app_id={self.cfg.app_id}&l=EN&brand=deriv"
        log.info("connecting to %s", self.cfg.endpoint)
        self._ws = await websockets.connect(url, open_timeout=self.cfg.request_timeout,
                                            ping_interval=None)
        self._reader_task = asyncio.create_task(self._reader())
        self._keepalive_task = asyncio.create_task(self._keepalive())
        if authorize and self.cfg.token:
            await self.authorize(self.cfg.token)
        return self

    async def close(self) -> None:
        for task in (self._keepalive_task, self._reader_task):
            if task:
                task.cancel()
        self._keepalive_task = self._reader_task = None
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:  # pragma: no cover - teardown best effort
                pass
            self._ws = None
        self._fail_pending(DerivError("connection closed"))

    async def __aenter__(self) -> "DerivClient":
        return await self.connect()

    async def __aexit__(self, *exc) -> None:
        await self.close()

    # -------------------------------------------------------------- plumbing
    def _next_req_id(self) -> int:
        self._req_id += 1
        return self._req_id

    def _fail_pending(self, exc: BaseException) -> None:
        for fut in list(self._pending.values()):
            if not fut.done():
                fut.set_exception(exc)
        self._pending.clear()

    async def _reader(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                msg = json.loads(raw)
                msg_type = msg.get("msg_type")
                # Route subscriptions: the server echoes the request in echo_req
                # and adds a subscription id on the first frame.
                sub_id = None
                echo = msg.get("echo_req") or {}
                for key, value in echo.items():
                    sub_id = f"{key}:{json.dumps(value, sort_keys=True)}"
                    break
                if msg.get("subscription") and sub_id:
                    queue = self._streams.setdefault(msg["subscription"]["id"], asyncio.Queue())
                    self._streams[sub_id] = queue
                if msg_type in {"tick", "candles", "ohlc"} and sub_id and sub_id in self._streams:
                    await self._streams[sub_id].put(msg)

                req_id = echo.get("req_id") if isinstance(echo, dict) else None
                if req_id is None:
                    req_id = msg.get("req_id")
                if req_id is not None and req_id in self._pending:
                    fut = self._pending.pop(req_id)
                    if not fut.done():
                        fut.set_result(msg)
        except asyncio.CancelledError:  # pragma: no cover
            raise
        except Exception as exc:  # pragma: no cover - network death
            log.warning("reader stopped: %s", exc)
            self._fail_pending(DerivError(f"socket closed: {exc}"))

    async def _keepalive(self) -> None:
        try:
            while True:
                await asyncio.sleep(self.cfg.keepalive_seconds)
                if self._ws is None:
                    return
                try:
                    await self._ws.send(json.dumps({"ping": 1, "req_id": self._next_req_id()}))
                except Exception as exc:
                    log.warning("keepalive failed: %s", exc)
        except asyncio.CancelledError:  # pragma: no cover
            return

    async def send_raw(self, payload: Dict[str, Any]) -> None:
        if self._ws is None:
            raise DerivError("not connected")
        await self._ws.send(json.dumps(payload))

    async def request(self, payload: Dict[str, Any], timeout: Optional[float] = None) -> Dict[str, Any]:
        """Send a request and wait for the matching response frame."""
        if self._ws is None:
            raise DerivError("not connected")
        timeout = timeout or self.cfg.request_timeout
        req_id = self._next_req_id()
        payload = dict(payload)
        payload["req_id"] = req_id
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[req_id] = fut
        await self.send_raw(payload)
        try:
            msg = await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError as exc:
            self._pending.pop(req_id, None)
            raise DerivError(f"timeout waiting for {list(payload)[0]}") from exc
        if msg.get("error"):
            err = msg["error"]
            raise DerivError(err.get("message", "unknown API error"), err.get("code"), msg)
        return msg

    @asynccontextmanager
    async def stream(self, payload: Dict[str, Any]) -> AsyncIterator[AsyncIterator[Dict[str, Any]]]:
        """Subscribe, yield an async iterator of frames, then forget the stream.

        Note: Deriv streams are great for a long-lived worker but useless for a
        serverless/cron worker, which is why the engine uses request/response
        polling instead.
        """
        sub_id = f"{list(payload)[0]}:{json.dumps(payload, sort_keys=True)}"
        queue: asyncio.Queue = asyncio.Queue()
        self._streams[sub_id] = queue
        try:
            async def _gen() -> AsyncIterator[Dict[str, Any]]:
                while True:
                    yield await queue.get()

            yield _gen()
        finally:
            self._streams.pop(sub_id, None)
            if self._ws is not None:
                try:
                    await self.send_raw({"forget_all": list(payload)[0]})
                except Exception:  # pragma: no cover
                    pass

    # ------------------------------------------------------------------- api
    async def authorize(self, token: str) -> Dict[str, Any]:
        resp = await self.request({"authorize": token})
        self._authorized = True
        return resp

    async def ping(self) -> Dict[str, Any]:
        return await self.request({"ping": 1})

    async def server_time(self) -> int:
        resp = await self.request({"time": 1})
        return int(resp["time"])

    async def active_symbols(self, product_type: str = "basic") -> Dict[str, Any]:
        return await self.request({"active_symbols": "brief", "product_type": product_type})

    async def contracts_for(self, symbol: str) -> Dict[str, Any]:
        return await self.request({"contracts_for": symbol})

    async def candles(self, symbol: str, granularity: int = 300, count: int = 5000,
                      end: Optional[int] = None, style: str = "candles") -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "ticks_history": symbol,
            "adjust_start_time": 1,
            "count": count,
            "end": end if end is not None else "latest",
            "granularity": granularity,
            "style": style,
        }
        return await self.request(payload)

    async def tick(self, symbol: str) -> Dict[str, Any]:
        return await self.request({"ticks": symbol, "subscribe": 0})

    async def proposal(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        payload = {"proposal": 1, **parameters}
        return await self.request(payload)

    async def buy(self, proposal_id: str, price: float) -> Dict[str, Any]:
        return await self.request({"buy": proposal_id, "price": float(price)})

    async def sell(self, contract_id: int, price: float = 0) -> Dict[str, Any]:
        return await self.request({"sell": contract_id, "price": float(price)})

    async def portfolio(self) -> Dict[str, Any]:
        return await self.request({"portfolio": 1})

    async def balance(self) -> Dict[str, Any]:
        return await self.request({"balance": 1, "subscribe": 0})

    async def open_contract(self, contract_id: Optional[int] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"proposal_open_contract": 1}
        if contract_id is not None:
            payload["contract_id"] = contract_id
        return await self.request(payload)

    async def profit_table(self, limit: int = 100) -> Dict[str, Any]:
        return await self.request({"profit_table": 1, "limit": limit, "sort": "DESC"})

    @property
    def authorized(self) -> bool:
        return self._authorized


async def connect_with_retry(cfg: DerivConfig, authorize: bool = True,
                             attempts: Optional[int] = None, base_delay: float = 1.5) -> DerivClient:
    """Connect with exponential backoff + jitter (call this from a long-lived worker)."""
    import random

    attempts = attempts or cfg.max_retries
    last: Optional[Exception] = None
    for i in range(attempts):
        client = DerivClient(cfg)
        try:
            return await client.connect(authorize=authorize)
        except Exception as exc:  # noqa: BLE001 - retry on any transport error
            last = exc
            delay = base_delay * (2 ** i) + random.uniform(0, 0.5)
            log.warning("connect attempt %s/%s failed (%s); retrying in %.1fs", i + 1, attempts, exc, delay)
            await asyncio.sleep(delay)
    raise DerivError(f"could not connect after {attempts} attempts: {last}")
