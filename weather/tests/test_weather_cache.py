from __future__ import annotations

import json
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from weather.collectors.cache import TTLCache


class UpstreamError(Exception):
    pass


def test_fresh_hit_avoids_fetch() -> None:
    cache = TTLCache()
    calls = 0

    def fetch() -> str:
        nonlocal calls
        calls += 1
        return "live"

    first = cache.get_or_fetch("weather", fetch, ttl_s=10, max_stale_s=30, now=100)
    second = cache.get_or_fetch("weather", fetch, ttl_s=10, max_stale_s=30, now=105)
    assert (first.value, first.source, first.stale) == ("live", "live", False)
    assert (second.value, second.source, second.stale) == ("live", "cache", False)
    assert calls == 1


def test_expiry_refreshes_entry() -> None:
    cache = TTLCache()
    values = iter(("first", "second"))
    cache.get_or_fetch("weather", lambda: next(values), ttl_s=5, max_stale_s=30, now=100)
    result = cache.get_or_fetch(
        "weather", lambda: next(values), ttl_s=5, max_stale_s=30, now=106,
    )
    assert (result.value, result.source, result.fetched_at) == ("second", "live", 106)


def test_failed_fetch_returns_stale_last_good_value() -> None:
    cache = TTLCache()
    cache.get_or_fetch("weather", lambda: {"temp": 20}, ttl_s=5, max_stale_s=30, now=100)
    error = UpstreamError("offline")

    def fail() -> object:
        raise error

    result = cache.get_or_fetch("weather", fail, ttl_s=5, max_stale_s=30, now=106)
    assert result.value == {"temp": 20}
    assert (result.source, result.stale, result.error) == ("cache", True, error)


def test_too_old_last_good_reraises_original_upstream_error() -> None:
    cache = TTLCache()
    cache.get_or_fetch("weather", lambda: "last-good", ttl_s=5, max_stale_s=10, now=100)
    error = UpstreamError("offline")

    def fail() -> str:
        raise error

    with pytest.raises(UpstreamError) as raised:
        cache.get_or_fetch("weather", fail, ttl_s=5, max_stale_s=10, now=111)
    assert raised.value is error


def test_single_flight_for_eight_concurrent_callers() -> None:
    cache = TTLCache()
    barrier = threading.Barrier(8)
    fetch_started = threading.Event()
    release_fetch = threading.Event()
    calls = 0
    calls_lock = threading.Lock()

    def fetch() -> str:
        nonlocal calls
        with calls_lock:
            calls += 1
        fetch_started.set()
        assert release_fetch.wait(timeout=2)
        return "shared"

    def request() -> str:
        barrier.wait(timeout=2)
        return cache.get_or_fetch(
            "weather", fetch, ttl_s=10, max_stale_s=30, now=100,
        ).value

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(request) for _ in range(8)]
        assert fetch_started.wait(timeout=2)
        release_fetch.set()
        assert [future.result(timeout=2) for future in futures] == ["shared"] * 8
    assert calls == 1


def test_failure_backoff_returns_stale_without_refetching() -> None:
    cache = TTLCache()
    cache.get_or_fetch("weather", lambda: "last-good", ttl_s=5, max_stale_s=30, now=100)
    error = UpstreamError("offline")
    calls = 0

    def fail() -> str:
        nonlocal calls
        calls += 1
        raise error

    first = cache.get_or_fetch(
        "weather", fail, ttl_s=5, max_stale_s=30, now=106, retry_after_s=10,
    )
    second = cache.get_or_fetch(
        "weather", fail, ttl_s=5, max_stale_s=30, now=110, retry_after_s=10,
    )
    assert calls == 1
    assert first.error is error
    assert second.error is error and second.stale


def test_persistence_round_trip_between_instances(tmp_path) -> None:
    path = tmp_path / "cache.json"
    first_cache = TTLCache(path)
    first_cache.get_or_fetch(
        "weather", lambda: {"temp": 21.5}, ttl_s=10, max_stale_s=60, now=100,
    )
    second_cache = TTLCache(path)
    result = second_cache.get_or_fetch(
        "weather", lambda: pytest.fail("persisted entry should be fresh"),
        ttl_s=10, max_stale_s=60, now=105,
    )
    assert (result.value, result.source, result.stale) == (
        {"temp": 21.5}, "cache", False,
    )


def test_corrupt_persistence_file_is_ignored(tmp_path) -> None:
    path = tmp_path / "cache.json"
    path.write_text("{invalid", encoding="utf-8")
    cache = TTLCache(path)
    result = cache.get_or_fetch("weather", lambda: "live", ttl_s=10, max_stale_s=60, now=100)
    assert result.value == "live"
    assert json.loads(path.read_text(encoding="utf-8"))["weather"]["value"] == "live"
