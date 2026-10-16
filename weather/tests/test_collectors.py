from datetime import datetime
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))

import weather.collectors.air_quality as air_quality
import weather.collectors.kma_current as kma_current
import weather.collectors.kma_forecast as kma_forecast
from weather.collectors.upstream import UpstreamError


def response(items, *, code="00"):
    return {
        "response": {
            "header": {"resultCode": code},
            "body": {"items": {"item": items}},
        }
    }


def test_kma_current_parses_observed_at_and_retries_no_data(monkeypatch):
    calls = []

    def fake_request(source, url, params, **kwargs):
        calls.append((source, url, params, kwargs))
        if len(calls) == 1:
            raise UpstreamError(source, "no_data", "not published")
        return response([{"category": "T1H", "obsrValue": "21.5"}])

    monkeypatch.setattr(kma_current.config, "KMA_SERVICE_KEY", "test-key")
    monkeypatch.setattr(kma_current, "request_json", fake_request)

    result = kma_current.fetch_kma_current(datetime(2025, 1, 2, 4, 30))

    assert len(calls) == 2
    assert calls[0][2]["base_time"] == "0300"
    assert calls[1][2]["base_time"] == "0200"
    assert calls[0][3]["connect_timeout"] == kma_current.config.WEATHER_UPSTREAM_CONNECT_TIMEOUT_S
    assert result["observed_at"] == "2025-01-02T02:00:00+09:00"
    assert result["temperature"] == 21.5


@pytest.mark.parametrize("error_kind", ["timeout", "connection"])
def test_kma_current_does_not_retry_transport_errors(monkeypatch, error_kind):
    calls = []

    def fake_request(source, url, params, **kwargs):
        calls.append(params)
        raise UpstreamError(source, error_kind, "failed")

    monkeypatch.setattr(kma_current.config, "KMA_SERVICE_KEY", "test-key")
    monkeypatch.setattr(kma_current, "request_json", fake_request)
    with pytest.raises(UpstreamError) as caught:
        kma_current.fetch_kma_current(datetime(2025, 1, 2, 4, 30))
    assert caught.value.kind == error_kind
    assert len(calls) == 1


def test_collectors_reject_missing_keys_before_request(monkeypatch):
    def unexpected(*args, **kwargs):
        pytest.fail("request must not be made without a key")

    for module, key in (
        (kma_current, "KMA_SERVICE_KEY"),
        (kma_forecast, "KMA_SERVICE_KEY"),
        (air_quality, "AIRKOREA_SERVICE_KEY"),
    ):
        monkeypatch.setattr(module.config, key, "")
        monkeypatch.setattr(module, "request_json", unexpected)
    with pytest.raises(UpstreamError, match="missing_key"):
        kma_current.fetch_kma_current(datetime(2025, 1, 2, 4, 30))
    with pytest.raises(UpstreamError, match="missing_key"):
        kma_forecast.fetch_kma_forecast(now=datetime(2025, 1, 2, 4, 30))
    with pytest.raises(UpstreamError, match="missing_key"):
        air_quality.fetch_air_quality()


def test_air_quality_parses_data_time_and_empty_items(monkeypatch):
    monkeypatch.setattr(air_quality.config, "AIRKOREA_SERVICE_KEY", "test-key")
    monkeypatch.setattr(
        air_quality,
        "request_json",
        lambda *args, **kwargs: response(
            [{"dataTime": "2025-01-02 03:00", "pm10Value": "12", "pm25Value": "4"}]
        ),
    )
    result = air_quality.fetch_air_quality()
    assert result["observed_at"] == "2025-01-02T03:00:00+09:00"
    assert result["pm10"] == 12
    assert result["pm25"] == 4

    monkeypatch.setattr(
        air_quality, "request_json", lambda *args, **kwargs: response([])
    )
    with pytest.raises(UpstreamError) as caught:
        air_quality.fetch_air_quality()
    assert caught.value.kind == "no_data"


def test_air_quality_maps_midnight_24_00_and_rejects_bad_times(monkeypatch):
    monkeypatch.setattr(air_quality.config, "AIRKOREA_SERVICE_KEY", "test-key")
    monkeypatch.setattr(
        air_quality,
        "request_json",
        lambda *args, **kwargs: response([{"dataTime": "2025-01-01 24:00", "pm10Value": "9"}]),
    )
    assert air_quality.fetch_air_quality()["observed_at"] == "2025-01-02T00:00:00+09:00"

    monkeypatch.setattr(
        air_quality,
        "request_json",
        lambda *args, **kwargs: response([{"dataTime": "not-a-time", "pm10Value": "9"}]),
    )
    with pytest.raises(UpstreamError) as caught:
        air_quality.fetch_air_quality()
    assert caught.value.kind == "malformed"


def test_kma_forecast_adds_observed_at(monkeypatch):
    monkeypatch.setattr(kma_forecast.config, "KMA_SERVICE_KEY", "test-key")
    monkeypatch.setattr(
        kma_forecast,
        "request_json",
        lambda *args, **kwargs: response(
            [{"fcstDate": "20250102", "fcstTime": "0600", "category": "TMP", "fcstValue": "5"}]
        ),
    )
    result = kma_forecast.fetch_kma_forecast(
        now=datetime(2025, 1, 2, 4, 30), limit=None
    )
    assert result[0]["observed_at"] == "2025-01-02T02:00:00+09:00"
    assert result[0]["temperature"] == 5


def test_upstream_classifies_xml_auth(monkeypatch):
    monkeypatch.setattr(kma_current.config, "KMA_SERVICE_KEY", "test-key")

    def fake_request(source, url, params, **kwargs):
        raise UpstreamError(source, "auth", "XML returnReasonCode 30")

    monkeypatch.setattr(kma_current, "request_json", fake_request)
    with pytest.raises(UpstreamError) as caught:
        kma_current.fetch_kma_current(datetime(2025, 1, 2, 4, 30))
    assert caught.value.kind == "auth"
