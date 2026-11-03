from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import weather.api.app as app_module
from weather.api.app import create_app
from weather.collectors.cache import TTLCache
from weather.collectors.upstream import UpstreamError


KST = timezone(timedelta(hours=9))

POPUP_BASELINE_KEYS = [
    "element_id",
    "name",
    "zone_id",
    "element_type",
    "timestamp",
    "data_note",
    "thermal",
    "factors",
    "delta",
    "reasons",
    "material",
    "base_weather",
]

FRESHNESS_ENTRY_KEYS = {"source", "observed_at", "fetched_at", "age_seconds", "stale"}


def _current_weather():
    return {
        "timestamp": "20261016T1100",
        "observed_at": "2026-10-16T11:00:00+09:00",
        "temperature": 22.5,
        "humidity": 55.0,
        "wind_speed": 1.8,
        "wind_direction": 180.0,
        "precipitation_type": 0,
        "solar_altitude": 40.0,
        "cloud_cover": 0.1,
        "solar_radiation": 600.0,
    }


def _forecast_rows():
    base = datetime(2026, 10, 16, 12, 0, tzinfo=KST)
    rows = []
    for hour in range(4):
        moment = base + timedelta(hours=hour)
        rows.append({
            "base_date": "20261016",
            "base_time": "1100",
            "observed_at": "2026-10-16T11:00:00+09:00",
            "fcst_date": moment.strftime("%Y%m%d"),
            "fcst_time": moment.strftime("%H%M"),
            "timestamp": moment.strftime("%Y%m%dT%H%M"),
            "lead_hour": hour + 1,
            "temperature": 23.0 + hour,
            "humidity": 50.0,
            "wind_speed": 2.0,
            "wind_direction": 90.0,
            "sky": "맑음",
            "sky_code": 1,
            "precipitation_probability": 0,
            "precipitation_amount": 0.0,
            "precipitation_amount_text": "강수없음",
            "precipitation_type": 0,
        })
    return rows


def _air_quality():
    return {
        "pm10": 30.0,
        "pm25": 15.0,
        "o3": 0.03,
        "khai_value": 60.0,
        "khai_grade": "2",
        "observed_at": "2026-10-16T11:00:00+09:00",
    }


class Collector:
    def __init__(self, value_factory):
        self.value_factory = value_factory
        self.error = None
        self.calls = 0

    def __call__(self, *args, **kwargs):
        self.calls += 1
        if self.error is not None:
            raise self.error
        return self.value_factory()


@pytest.fixture
def collectors(monkeypatch):
    cache = TTLCache(persist_path=None)
    monkeypatch.setattr(app_module, "WEATHER_CACHE", cache)
    app_module.WEATHER_CACHE.clear()
    current = Collector(_current_weather)
    forecast = Collector(_forecast_rows)
    air = Collector(_air_quality)
    monkeypatch.setattr(app_module, "fetch_kma_current", current)
    monkeypatch.setattr(app_module, "fetch_kma_forecast", forecast)
    monkeypatch.setattr(app_module, "fetch_air_quality", air)
    yield {"current": current, "forecast": forecast, "air": air}
    app_module.WEATHER_CACHE.clear()


@pytest.fixture
def client():
    return TestClient(create_app())


def _assert_c1(response, code, source, reason):
    assert response.status_code == 503
    assert response.headers["retry-after"] == "60"
    detail = response.json()["detail"]
    assert detail["code"] == code
    assert detail["source"] == source
    assert detail["reason"] == reason
    assert detail["retry_after_s"] == 60
    assert detail["message_ko"]
    assert detail["message_en"]


def test_live_response_reports_live_freshness(collectors, client):
    response = client.get("/microclimate/elements")

    assert response.status_code == 200
    freshness = response.json()["freshness"]
    assert set(freshness["weather"]) == FRESHNESS_ENTRY_KEYS
    assert freshness["weather"]["source"] == "live"
    assert freshness["weather"]["stale"] is False
    assert freshness["weather"]["observed_at"] == "2026-10-16T11:00:00+09:00"
    assert freshness["forecast"] is None
    assert freshness["air_quality"] is None


def test_cached_value_served_stale_after_upstream_failure(collectors, client, monkeypatch):
    monkeypatch.setattr(app_module.config, "WEATHER_CACHE_TTL_KMA_CURRENT_S", 0)
    assert client.get("/microclimate/heatmap").status_code == 200

    collectors["current"].error = UpstreamError("KMA", "timeout", "read timeout")
    response = client.get("/microclimate/heatmap")

    assert response.status_code == 200
    weather = response.json()["freshness"]["weather"]
    assert weather["source"] == "cache"
    assert weather["stale"] is True


def test_cold_failure_returns_c1_503(collectors, client):
    collectors["current"].error = UpstreamError("KMA", "timeout", "read timeout")

    response = client.get("/microclimate/zones")

    _assert_c1(response, "weather_upstream_unavailable", "kma_current", "timeout")
    assert "read timeout" not in response.text


def test_missing_key_returns_key_missing_503(collectors, client):
    collectors["current"].error = UpstreamError("KMA", "missing_key", "not configured")

    response = client.get("/microclimate/elements/BLD_D4/popup")

    _assert_c1(response, "weather_api_key_missing", "kma_current", "missing_key")


def test_airkorea_only_failure_degrades_to_null_fields(collectors, client):
    collectors["air"].error = UpstreamError("AirKorea", "timeout", "read timeout")

    response = client.get("/environment/current")

    assert response.status_code == 200
    body = response.json()
    for field in ("pm10", "pm25", "o3", "khai_value", "khai_grade"):
        assert body["base_weather"][field] is None
    assert body["freshness"]["air_quality"] == {"stale": True, "error": "timeout"}
    assert body["freshness"]["weather"]["source"] == "live"


def test_environment_full_reports_all_freshness_sources(collectors, client):
    response = client.get("/environment/full")

    assert response.status_code == 200
    body = response.json()
    for key in ("forecast", "weather_timeline", "element_environment", "zones", "base_weather"):
        assert key in body
    for source in ("weather", "forecast", "air_quality"):
        assert body["freshness"][source]["source"] == "live"


def test_unknown_element_keeps_404(collectors, client):
    response = client.get("/microclimate/elements/BLD_DOES_NOT_EXIST/popup")

    assert response.status_code == 404


def test_popup_keeps_baseline_keys_and_adds_freshness(collectors, client):
    response = client.get("/microclimate/elements/BLD_D4/popup")

    assert response.status_code == 200
    popup = response.json()
    for key in POPUP_BASELINE_KEYS:
        assert key in popup
    assert popup["freshness"]["weather"]["source"] == "live"
    assert "sample_data" not in popup


def test_sample_features_are_flagged(collectors, client, monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, "_FEATURE_FILE", tmp_path / "missing.json")

    response = client.get("/microclimate/heatmap")

    assert response.status_code == 200
    assert response.json()["sample_data"] is True


def test_second_request_inside_backoff_does_not_call_collector(collectors, client):
    collectors["current"].error = UpstreamError("KMA", "connection", "refused")

    first = client.get("/microclimate/elements")
    second = client.get("/microclimate/elements")

    assert first.status_code == 503
    assert second.status_code == 503
    assert collectors["current"].calls == 1


def test_unexpected_error_returns_opaque_500(collectors, client):
    collectors["current"].error = RuntimeError("secret internal detail")

    response = client.get("/microclimate/elements")

    assert response.status_code == 500
    assert response.json()["detail"] == {
        "code": "internal_error",
        "message_ko": "서버 내부 오류가 발생했습니다",
        "message_en": "Internal server error",
    }
    assert "secret internal detail" not in response.text


def test_lan_origin_receives_cors_header(collectors, client):
    response = client.get("/health", headers={"Origin": "http://192.168.0.10:5173"})

    assert response.headers["access-control-allow-origin"] == "http://192.168.0.10:5173"


@pytest.mark.parametrize(
    "path",
    ["/environment/elements/timeline", "/environment/elements/BLD_D4/timeline"],
)
def test_timeline_routes_return_c1_when_collectors_raise(collectors, client, path):
    collectors["current"].error = UpstreamError("KMA", "timeout", "read timeout")
    collectors["forecast"].error = UpstreamError("KMA", "timeout", "read timeout")

    response = client.get(path)

    _assert_c1(response, "weather_upstream_unavailable", "kma_current", "timeout")


def test_timeline_forecast_failure_names_forecast_source(collectors, client):
    collectors["forecast"].error = UpstreamError("KMA", "quota", "HTTP 429")

    response = client.get("/environment/elements/timeline")

    _assert_c1(response, "weather_upstream_unavailable", "kma_forecast", "quota")
