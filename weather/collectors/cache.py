from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Generic, TypeVar

T = TypeVar("T")

logger = logging.getLogger(__name__)


@dataclass
class CacheResult(Generic[T]):
    value: T
    fetched_at: float
    source: str
    stale: bool
    error: Exception | None


class TTLCache:
    def __init__(self, persist_path: str | os.PathLike[str] | None = None) -> None:
        self._entries: dict[str, tuple[object, float]] = {}
        self._failures: dict[str, tuple[float, Exception]] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._lock = threading.Lock()
        self._persist_lock = threading.Lock()
        self._persist_path = Path(persist_path) if persist_path is not None else None
        if self._persist_path is not None:
            try:
                with self._persist_path.open(encoding="utf-8") as stream:
                    payload = json.load(stream)
                if not isinstance(payload, dict):
                    return
                self._entries = {
                    key: (item["value"], float(item["fetched_at"]))
                    for key, item in payload.items()
                    if isinstance(item, dict)
                    and "value" in item
                    and "fetched_at" in item
                }
            except (OSError, ValueError, TypeError, KeyError):
                self._entries = {}

    def _key_lock(self, key: str) -> threading.Lock:
        with self._lock:
            return self._locks.setdefault(key, threading.Lock())

    def _persist(self) -> None:
        if self._persist_path is None:
            return
        # 저장은 선택 기능이다. 파일을 쓸 수 없어도 받아 온 실시간 값은 그대로 돌려주고 원인은 로그로 남긴다.
        # 스냅샷과 쓰기를 한 잠금 안에서 해서 오래된 스냅샷이 더 새 파일을 덮어쓰지 못하게 한다.
        with self._persist_lock:
            with self._lock:
                snapshot = dict(self._entries)
            payload = {
                key: {"value": value, "fetched_at": fetched_at}
                for key, (value, fetched_at) in snapshot.items()
            }
            try:
                self._persist_path.parent.mkdir(parents=True, exist_ok=True)
                fd, temporary = tempfile.mkstemp(dir=self._persist_path.parent)
            except OSError as error:
                logger.warning("weather cache persist skipped (%s): %s", self._persist_path, error)
                return
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as stream:
                    json.dump(payload, stream)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, self._persist_path)
            except OSError as error:
                logger.warning("weather cache persist failed (%s): %s", self._persist_path, error)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)

    def get_or_fetch(
        self,
        key: str,
        fetch: Callable[[], T],
        *,
        ttl_s: float,
        max_stale_s: float,
        now: float | None = None,
        retry_after_s: float = 60,
    ) -> CacheResult[T]:
        current = time.time() if now is None else now
        with self._key_lock(key):
            entry = self._entries.get(key)
            if entry is not None:
                value, fetched_at = entry
                age = current - fetched_at
                if age < ttl_s:
                    return CacheResult(value, fetched_at, "cache", False, None)

            failure = self._failures.get(key)
            if failure is not None and current - failure[0] < retry_after_s:
                if entry is not None and current - entry[1] <= max_stale_s:
                    return CacheResult(entry[0], entry[1], "cache", True, failure[1])
                raise failure[1]

            try:
                value = fetch()
            except Exception as error:
                self._failures[key] = (current, error)
                if entry is not None and current - entry[1] <= max_stale_s:
                    return CacheResult(entry[0], entry[1], "cache", True, error)
                raise

            with self._lock:
                self._entries[key] = (value, current)
                self._failures.pop(key, None)
            self._persist()
            return CacheResult(value, current, "live", False, None)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
            self._failures.clear()
            self._locks.clear()
