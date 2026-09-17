"""Background jobs for the dashboard (backtest / train / fetch-data).

Research runs take seconds to minutes, so they run on a single worker thread and
stream their log output into a job record the UI polls.
"""

from __future__ import annotations

import logging
import math
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

log = logging.getLogger("fxbot")

MAX_LOG_LINES = 400


def sanitize(value):
    """Make a result JSON-safe: NaN/inf -> null, numpy scalars -> python scalars.

    Research output is full of NaN (a fold with no taken trades, a profit factor
    with no losses). Starlette refuses to serialise those, so one bad metric
    would otherwise 500 the whole job endpoint.
    """
    if isinstance(value, dict):
        return {k: sanitize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize(v) for v in value]
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, int):
        return value
    item = getattr(value, "item", None)
    if callable(item):                      # numpy scalars
        try:
            return sanitize(value.item())
        except Exception:  # pragma: no cover
            return str(value)
    return str(value)


@dataclass
class Job:
    id: str
    kind: str
    status: str = "queued"        # queued | running | done | error
    started: float = field(default_factory=time.time)
    finished: Optional[float] = None
    logs: List[str] = field(default_factory=list)
    result: Optional[dict] = None
    error: Optional[str] = None

    def to_dict(self, with_logs: bool = True) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "started": self.started,
            "finished": self.finished,
            "elapsed": round((self.finished or time.time()) - self.started, 1),
            "error": self.error,
            "result": sanitize(self.result),
            **({"logs": self.logs[-MAX_LOG_LINES:]} if with_logs else {}),
        }


class JobLogHandler(logging.Handler):
    """Append fxbot log lines to the job that is currently running."""

    def __init__(self, sink: List[str]):
        super().__init__(level=logging.INFO)
        self.sink = sink
        self.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s",
                                            datefmt="%H:%M:%S"))
        logging.Formatter.converter = time.gmtime

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.sink.append(self.format(record))
        except Exception:  # pragma: no cover - logging must never break a job
            pass


class JobManager:
    def __init__(self, max_workers: int = 1):
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="fxbot-job")
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()
        self._running: Optional[str] = None

    def submit(self, kind: str, fn: Callable[[List[str]], dict]) -> Job:
        job = Job(id=uuid.uuid4().hex[:8], kind=kind)
        with self._lock:
            self._jobs[job.id] = job
        self._executor.submit(self._run, job, fn)
        return job

    def _run(self, job: Job, fn: Callable[[List[str]], dict]) -> None:
        job.status = "running"
        handler = JobLogHandler(job.logs)
        root = logging.getLogger("fxbot")
        root.addHandler(handler)
        try:
            job.result = fn(job.logs)
            job.status = "done"
        except Exception as exc:  # noqa: BLE001
            job.status = "error"
            job.error = f"{type(exc).__name__}: {exc}"
            job.logs.append(f"ERROR {job.error}")
            log.exception("job %s failed", job.id)
        finally:
            job.finished = time.time()
            root.removeHandler(handler)

    # ------------------------------------------------------------------ reads
    def get(self, job_id: str) -> Optional[Job]:
        return self._jobs.get(job_id)

    def list(self, limit: int = 20) -> List[dict]:
        jobs = sorted(self._jobs.values(), key=lambda j: j.started, reverse=True)
        return [j.to_dict(with_logs=False) for j in jobs[:limit]]

    @property
    def running(self) -> Optional[str]:
        for j in self._jobs.values():
            if j.status in ("queued", "running"):
                return j.id
        return None
