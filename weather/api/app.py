# api/app.py
"""
Campus Digital Twin — Weather & Microclimate API

엔드포인트 구조
===============
기존 (zone 기반, 하위 호환 유지)
  GET /                          API 정보
  GET /health                    헬스체크
  GET /environment/current       zone 기반 현재 환경
  GET /environment/full          zone + 예보

신규 (element 기반, microclimate 엔진 사용)
  GET /microclimate/elements              전체 element 미기후 + 체감지표
  GET /microclimate/elements/{id}         특정 element 결과
  GET /microclimate/elements/{id}/popup   건물 클릭 팝업용 UI-ready 응답 ★
  GET /microclimate/zones                 zone별 집계 (heatmap용)
  GET /microclimate/heatmap               heatmap 렌더링용 경량 결과
"""

from __future__ import annotations

import copy
import json
import logging
import os
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

_WEATHER_ROOT = str(Path(__file__).parent.parent)
if _WEATHER_ROOT not in sys.path:
    sys.path.insert(0, _WEATHER_ROOT)

import config

from common.campus_auth import require_admin_for_writes

# 기존 collectors / domain (zone 기반)
from weather.collectors.cache import CacheResult, TTLCache
from weather.collectors.upstream import UpstreamError
from weather.collectors.kma_current import fetch_kma_current
from weather.collectors.air_quality import fetch_air_quality
from weather.collectors.kma_forecast import fetch_kma_forecast
from weather.domain.environment import build_environment_result
from weather.domain.zones import ZONES

# 신규 element 기반 파이프라인
from weather.processors.element_environment import build_element_environment_timeline, summarize_element_environment
from weather.processors.pipeline import aggregate_by_zone, run_pipeline_all, run_pipeline_for_element
from weather.processors.popup_formatter import format_popup_response
from weather.processors.weather_timeline import build_weather_timeline


# =========================================================
# FastAPI 앱 설정
# =========================================================

app = FastAPI(
    title="Campus Digital Twin — Microclimate API",
    description=(
        "캠퍼스 디지털 트윈 기반 미기후 분석 API.\n\n"
        "**신규**: `/microclimate/*` 엔드포인트 — element 단위 UTCI, WBGT, 체감온도 제공\n"
        "**기존**: `/environment/*` 엔드포인트 — zone 기반 환경 정보 (하위 호환)"
    ),
    version="0.2.0",
    dependencies=[Depends(require_admin_for_writes)],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:4173", "http://127.0.0.1:4173",
    ],
    allow_origin_regex=(
        r"^http://(localhost|127\.0\.0\.1|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}"
        r"|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}):\d+$"
    ),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "Authorization"],
)


# =========================================================
# element feature 로딩
# =========================================================

_FEATURE_FILE  = Path(__file__).parent.parent / "data" / "microclimate_features.json"
_ELEMENTS_FILE = Path(__file__).parent.parent.parent / "common" / "data" / "common_elemetns.json"


# =========================================================
# 건물 메타 로더 (이름 / 타입)
# =========================================================

_element_meta_cache: Optional[Dict[str, Dict[str, str]]] = None

def _load_element_meta() -> Dict[str, Dict[str, str]]:
    """
    common_elemetns.json 에서 element_id → {name, element_type} 매핑 반환.
    파일이 없으면 빈 dict 반환 (graceful fallback).
    """
    global _element_meta_cache
    if _element_meta_cache is not None:
        return _element_meta_cache

    if not _ELEMENTS_FILE.exists():
        _element_meta_cache = {}
        return _element_meta_cache

    try:
        content = _ELEMENTS_FILE.read_text(encoding="utf-8").strip()
        # common_elemetns.json 은 두 JSON 블록이 빈 줄로 구분된 포맷
        parts = content.split("\n\n")
        common = json.loads(parts[1] if len(parts) > 1 else parts[0])
        _element_meta_cache = {
            e["element_id"]: {
                "name":         e.get("name", e["element_id"]),
                "element_type": e.get("element_type", "building"),
            }
            for e in common.get("elements", [])
        }
    except Exception:
        _element_meta_cache = {}

    return _element_meta_cache


def _load_element_features(path: Optional[Path] = None) -> List[Dict[str, Any]]:
    """
    microclimate_features.json 을 로드.
    파일이 없으면 샘플 feature를 반환 (개발용 fallback).
    """
    target = path or _FEATURE_FILE
    if target.exists():
        with open(target, encoding="utf-8") as f:
            payload = json.load(f)
            if isinstance(payload, dict):
                return payload.get("features", [])
            return payload

    # --- fallback: 샘플 데이터 ---
    return _SAMPLE_FEATURES


_SAMPLE_FEATURES: List[Dict[str, Any]] = [
        {
            "element_id": "RD_011",
            "zone_id":    "zone_central",
            "microclimate": {
                "albedo": 0.12, "vegetation_ratio": 0.05,
                "shade_factor": 0.10, "ventilation_factor": 0.75,
                "building_density": 0.30, "facade_reflectivity": 0.20,
                "sky_view_factor": 0.80, "orientation": 180.0,
            },
        },
        {
            "element_id": "GR_020",
            "zone_id":    "zone_green",
            "microclimate": {
                "albedo": 0.20, "vegetation_ratio": 0.60,
                "shade_factor": 0.50, "ventilation_factor": 0.85,
                "building_density": 0.10, "facade_reflectivity": 0.05,
                "sky_view_factor": 0.70, "orientation": 0.0,
            },
        },
        {
            "element_id": "ND_006",
            "zone_id":    "zone_central",
            "microclimate": {
                "albedo": 0.12, "vegetation_ratio": 0.03,
                "shade_factor": 0.05, "ventilation_factor": 0.90,
                "building_density": 0.20, "facade_reflectivity": 0.15,
                "sky_view_factor": 0.90, "orientation": 0.0,
            },
        },
]


def _is_sample(features: List[Dict[str, Any]]) -> bool:
    return features is _SAMPLE_FEATURES


# =========================================================
# 기상 upstream 캐시 / 오류 매핑
# =========================================================

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))

WEATHER_CACHE = TTLCache(persist_path=config.WEATHER_CACHE_FILE or None)

_AIR_QUALITY_FIELDS = ("pm10", "pm25", "o3", "khai_value", "khai_grade")
_UPSTREAM_SOURCES = {"kma_current", "kma_forecast", "airkorea"}
_INTERNAL_ERROR_DETAIL = {
    "code": "internal_error",
    "message_ko": "서버 내부 오류가 발생했습니다",
    "message_en": "Internal server error",
}


def _cached_upstream(key: str, fetch, ttl_s: float) -> CacheResult:
    """Fetch through WEATHER_CACHE; UpstreamError is relabelled with the C1 source name."""
    try:
        result = WEATHER_CACHE.get_or_fetch(
            key,
            fetch,
            ttl_s=ttl_s,
            max_stale_s=config.WEATHER_CACHE_MAX_STALE_S,
            retry_after_s=config.WEATHER_UPSTREAM_RETRY_AFTER_S,
        )
    except UpstreamError as exc:
        raise UpstreamError(key, exc.kind, exc.detail) from None
    # 캐시 값이 route 에서 변형되지 않도록 복사본을 돌려준다.
    return CacheResult(copy.deepcopy(result.value), result.fetched_at, result.source, result.stale, result.error)


def _freshness_entry(result: CacheResult, observed_at: Optional[str]) -> Dict[str, Any]:
    return {
        "source": result.source,
        "observed_at": observed_at,
        "fetched_at": datetime.fromtimestamp(result.fetched_at, tz=KST).isoformat(),
        "age_seconds": max(0, int(time.time() - result.fetched_at)),
        "stale": result.stale,
    }


def _get_current_weather() -> tuple[Dict[str, Any], Dict[str, Any]]:
    result = _cached_upstream(
        "kma_current", lambda: fetch_kma_current(), config.WEATHER_CACHE_TTL_KMA_CURRENT_S
    )
    weather = result.value
    return weather, _freshness_entry(result, weather.get("observed_at"))


def _get_forecast() -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
    result = _cached_upstream(
        "kma_forecast", lambda: fetch_kma_forecast(limit=None), config.WEATHER_CACHE_TTL_KMA_FORECAST_S
    )
    rows = result.value
    observed_at = rows[0].get("observed_at") if rows else None
    return rows, _freshness_entry(result, observed_at)


def _get_air_quality() -> tuple[Dict[str, Any], Dict[str, Any]]:
    """AirKorea 단독 장애는 오류 대신 null 필드 + stale 표시로 저하한다."""
    try:
        result = _cached_upstream(
            "airkorea", lambda: fetch_air_quality(), config.WEATHER_CACHE_TTL_AIRKOREA_S
        )
    except UpstreamError as exc:
        return {**{field: None for field in _AIR_QUALITY_FIELDS}, "air_quality_source": "unavailable"}, {"stale": True, "error": exc.kind}
    air_quality = {**result.value, "air_quality_source": "airkorea"}
    return air_quality, _freshness_entry(result, air_quality.get("observed_at"))


def _gather_upstreams(**fetchers):
    """Run upstream helpers concurrently; re-raise the first failure in argument order."""
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {name: executor.submit(fetch) for name, fetch in fetchers.items()}
        errors = {}
        results = {}
        for name, future in futures.items():
            try:
                results[name] = future.result()
            except Exception as exc:
                errors[name] = exc
    for name in fetchers:
        if name in errors:
            raise errors[name]
    return results


def _upstream_unavailable(source: str, reason: str) -> HTTPException:
    retry_after = int(config.WEATHER_UPSTREAM_RETRY_AFTER_S)
    if reason == "missing_key":
        code = "weather_api_key_missing"
        message_ko = "기상 API 키가 설정되지 않았습니다 (KMA_SERVICE_KEY)"
        message_en = "Weather API key is not configured (KMA_SERVICE_KEY)"
    else:
        code = "weather_upstream_unavailable"
        message_ko = "기상청 응답 지연으로 최신 기상 데이터를 가져오지 못했습니다"
        message_en = "Latest weather data is temporarily unavailable from the upstream service"
    return HTTPException(
        status_code=503,
        detail={
            "code": code,
            "source": source,
            "reason": reason,
            "message_ko": message_ko,
            "message_en": message_en,
            "retry_after_s": retry_after,
        },
        headers={"Retry-After": str(retry_after)},
    )


def _weather_http_error(exc: Exception) -> HTTPException:
    """Map a route failure to C1 503, the existing HTTPException, or an opaque 500."""
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, UpstreamError):
        source = exc.source if exc.source in _UPSTREAM_SOURCES else (
            "airkorea" if str(exc.source).lower() == "airkorea" else "kma_current"
        )
        return _upstream_unavailable(source, exc.kind)
    if getattr(exc, "code", None) == "weather_input_missing":
        return _upstream_unavailable("kma_current", "weather_input_missing")
    logger.error("Unexpected weather route failure", exc_info=exc)
    return HTTPException(status_code=500, detail=dict(_INTERNAL_ERROR_DETAIL))


def _fetch_weather_for_microclimate() -> tuple[Dict[str, Any], Dict[str, Any]]:
    """
    KMA 기상 데이터를 microclimate 파이프라인용으로 정규화.
    (weather, freshness) 를 반환한다.
    """
    weather, weather_freshness = _get_current_weather()
    # 필수 키 보정 (kma_current 에 없을 수 있는 필드)
    weather.setdefault("solar_radiation", 0.0)
    weather.setdefault("cloud_cover", 0.0)
    weather.setdefault("solar_altitude", 45.0)
    return weather, {"weather": weather_freshness, "forecast": None, "air_quality": None}


def _with_provenance(content: Dict[str, Any], freshness: Dict[str, Any], features) -> Dict[str, Any]:
    content["freshness"] = freshness
    if _is_sample(features):
        content["sample_data"] = True
    return content


# =========================================================
# 기본 엔드포인트
# =========================================================

@app.get("/", summary="API 정보")
def root():
    return {
        "message": "Campus Digital Twin Microclimate API",
        "version": "0.2.0",
        "docs": "/docs",
        "endpoints": {
            "microclimate": [
                "/microclimate/elements",
                "/microclimate/elements/{element_id}",
                "/microclimate/zones",
                "/microclimate/heatmap",
            ],
            "legacy_zone": [
                "/environment/current",
                "/environment/full",
                "/environment/elements/timeline",
                "/environment/elements/{element_id}/timeline",
            ],
        },
    }


@app.get("/health", summary="헬스체크")
def health_check():
    return {"status": "ok"}


# =========================================================
# 신규: element 기반 미기후 엔드포인트
# =========================================================

@app.get(
    "/microclimate/elements",
    summary="전체 element 미기후 결과",
    description=(
        "모든 element에 대한 미기후 계산 결과 반환.\n\n"
        "각 element: local_temp, tmrt, feels_like, UTCI, WBGT, risk_level, reasons 포함."
    ),
)
def get_all_elements(
    detail: bool = Query(False, description="True이면 미기후 세부 계산값 포함"),
):
    try:
        weather, freshness = _fetch_weather_for_microclimate()
        features = _load_element_features()
        results  = run_pipeline_all(weather, features, include_detail=detail)

        return JSONResponse(content=_with_provenance({
            "timestamp":       weather.get("timestamp"),
            "base_weather":    {
                "temperature":  weather.get("temperature"),
                "humidity":     weather.get("humidity"),
                "wind_speed":   weather.get("wind_speed"),
            },
            "element_count":   len(results),
            "elements":        results,
        }, freshness, features))
    except Exception as exc:
        raise _weather_http_error(exc) from None


@app.get(
    "/microclimate/elements/{element_id}",
    summary="특정 element 미기후 결과",
)
def get_element(
    element_id: str,
    detail: bool = Query(False, description="True이면 세부 계산값 포함"),
):
    try:
        weather, freshness = _fetch_weather_for_microclimate()
        features = _load_element_features()

        feature = next(
            (f for f in features if f["element_id"] == element_id), None
        )
        if feature is None:
            raise HTTPException(
                status_code=404,
                detail=f"element_id '{element_id}' 를 찾을 수 없습니다.",
            )

        result = run_pipeline_for_element(weather, feature, include_detail=detail)
        return JSONResponse(content=_with_provenance({
            "timestamp":    weather.get("timestamp"),
            "base_weather": {
                "temperature": weather.get("temperature"),
                "humidity":    weather.get("humidity"),
                "wind_speed":  weather.get("wind_speed"),
            },
            "element": result,
        }, freshness, features))
    except Exception as exc:
        raise _weather_http_error(exc) from None


@app.get(
    "/microclimate/elements/{element_id}/popup",
    summary="건물 클릭 팝업용 UI-ready 응답",
    description=(
        "3D 뷰에서 건물을 클릭했을 때 팝업에 표시할 모든 정보를 한 번에 반환.\n\n"
        "포함 내용:\n"
        "- 건물 이름 / 타입 / zone\n"
        "- local_temp / feels_like / UTCI / WBGT\n"
        "- risk_level + 위험도 색상 코드(risk_color) + 정수 점수(risk_score 0~4)\n"
        "- 미기후 인자 정성 평가 (shade / vegetation / wind / radiation)\n"
        "- 기준 기상 대비 온도 델타\n"
        "- 원인 설명(reasons)\n"
        "- 기준 기상 요약"
    ),
)
def get_element_popup(element_id: str):
    try:
        weather, freshness = _fetch_weather_for_microclimate()
        features = _load_element_features()
        meta     = _load_element_meta()

        feature = next(
            (f for f in features if f["element_id"] == element_id), None
        )
        if feature is None:
            raise HTTPException(
                status_code=404,
                detail=f"element_id '{element_id}' 를 찾을 수 없습니다.",
            )

        pipeline_result = run_pipeline_for_element(weather, feature, include_detail=False)

        # 건물 메타 (없으면 element_id 를 이름으로 사용)
        m = meta.get(element_id, {})
        name         = m.get("name", element_id)
        element_type = m.get("element_type", "building")
        zone_id      = feature.get("zone_id", "")
        microclimate = feature.get("microclimate") or {}

        popup = format_popup_response(
            element_id      = element_id,
            name            = name,
            zone_id         = zone_id,
            element_type    = element_type,
            pipeline_result = pipeline_result,
            microclimate    = microclimate,
            weather         = weather,
            timestamp       = weather.get("timestamp"),
            freshness       = freshness,
        )
        if _is_sample(features):
            popup["sample_data"] = True

        return JSONResponse(content=popup)

    except Exception as exc:
        raise _weather_http_error(exc) from None


@app.get(
    "/microclimate/zones",
    summary="zone별 집계 결과",
    description=(
        "element 결과를 zone 단위로 집계.\n\n"
        "각 zone: 평균 기온, 평균 UTCI, 평균 WBGT, 최고 위험도 제공."
    ),
)
def get_zone_aggregates():
    try:
        weather, freshness = _fetch_weather_for_microclimate()
        features = _load_element_features()
        elements = run_pipeline_all(weather, features)
        zones    = aggregate_by_zone(elements)

        return JSONResponse(content=_with_provenance({
            "timestamp":   weather.get("timestamp"),
            "zone_count":  len(zones),
            "zones":       zones,
        }, freshness, features))
    except Exception as exc:
        raise _weather_http_error(exc) from None


@app.get(
    "/microclimate/heatmap",
    summary="heatmap 렌더링용 경량 결과",
    description=(
        "3D 시각화 / heatmap 렌더링에 필요한 최소 필드만 반환.\n\n"
        "각 element: element_id, zone_id, utci, risk_level"
    ),
)
def get_heatmap():
    try:
        weather, freshness = _fetch_weather_for_microclimate()
        features = _load_element_features()
        results  = run_pipeline_all(weather, features)

        heatmap = [
            {
                "element_id": r["element_id"],
                "zone_id":    r.get("zone_id"),
                "utci":       r["utci"],
                "wbgt":       r["wbgt"],
                "risk_level": r["risk_level"],
            }
            for r in results
        ]

        return JSONResponse(content=_with_provenance({
            "timestamp": weather.get("timestamp"),
            "heatmap":   heatmap,
        }, freshness, features))
    except Exception as exc:
        raise _weather_http_error(exc) from None


# =========================================================
# 기존: zone 기반 엔드포인트 (하위 호환)
# =========================================================

def _build_zone_environment(weather: Dict[str, Any], air_quality: Dict[str, Any]):
    weather = dict(weather)
    weather.update(air_quality)
    return build_environment_result(weather, ZONES)


def _build_environment_timeline_bundle(element_id: Optional[str] = None) -> Dict[str, Any]:
    upstreams = _gather_upstreams(current=_get_current_weather, forecast=_get_forecast)
    current_weather, weather_freshness = upstreams["current"]
    forecast_rows, forecast_freshness = upstreams["forecast"]
    weather_timeline = build_weather_timeline(forecast_rows, current_weather)

    features = _load_element_features()
    sample_data = _is_sample(features)
    if element_id is not None:
        features = [feature for feature in features if feature.get("element_id") == element_id]
        if not features:
            raise HTTPException(
                status_code=404,
                detail=f"element_id '{element_id}' 를 찾을 수 없습니다.",
            )

    element_environment = build_element_environment_timeline(weather_timeline, features)
    return {
        "generated_at": current_weather.get("timestamp"),
        "weather_timeline": weather_timeline,
        "element_environment": element_environment,
        "element_summary": summarize_element_environment(element_environment),
        "element_count": len(features),
        "freshness": {
            "weather": weather_freshness,
            "forecast": forecast_freshness,
            "air_quality": None,
        },
        "sample_data": sample_data,
    }


def _timeline_content(content: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    content["freshness"] = payload["freshness"]
    if payload["sample_data"]:
        content["sample_data"] = True
    return content


@app.get("/environment/current", summary="[기존] zone 기반 현재 환경")
def get_environment_current():
    try:
        upstreams = _gather_upstreams(current=_get_current_weather, air=_get_air_quality)
        current_weather, weather_freshness = upstreams["current"]
        air_quality, air_freshness = upstreams["air"]
        result = _build_zone_environment(current_weather, air_quality)
        result["freshness"] = {
            "weather": weather_freshness,
            "forecast": None,
            "air_quality": air_freshness,
        }
        return JSONResponse(content=result)
    except Exception as exc:
        raise _weather_http_error(exc) from None


@app.get("/environment/full", summary="[기존] zone 기반 환경 + 예보")
def get_environment_full():
    try:
        upstreams = _gather_upstreams(
            current=_get_current_weather, forecast=_get_forecast, air=_get_air_quality
        )
        current_weather, weather_freshness = upstreams["current"]
        forecast_rows, forecast_freshness = upstreams["forecast"]
        air_quality, air_freshness = upstreams["air"]
        result = _build_zone_environment(current_weather, air_quality)
        forecast = forecast_rows[:12]
        weather_timeline = build_weather_timeline(forecast, current_weather)
        features = _load_element_features()
        element_environment = build_element_environment_timeline(weather_timeline, features)
        content = {
            **result,
            "forecast": forecast,
            "weather_timeline": weather_timeline,
            "element_environment": summarize_element_environment(element_environment),
        }
        return JSONResponse(content=_with_provenance(content, {
            "weather": weather_freshness,
            "forecast": forecast_freshness,
            "air_quality": air_freshness,
        }, features))
    except Exception as exc:
        raise _weather_http_error(exc) from None


@app.get("/environment/elements/timeline", summary="element 단위 시간별 local environment")
def get_environment_elements_timeline():
    try:
        payload = _build_environment_timeline_bundle()
        return JSONResponse(content=_timeline_content({
            "generated_at": payload["generated_at"],
            "element_count": payload["element_count"],
            "weather_timeline": payload["weather_timeline"],
            "element_environment": payload["element_environment"],
        }, payload))
    except Exception as exc:
        raise _weather_http_error(exc) from None


@app.get("/environment/elements/{element_id}/timeline", summary="단일 element 시간별 local environment")
def get_environment_element_timeline(element_id: str):
    try:
        payload = _build_environment_timeline_bundle(element_id=element_id)
        element_rows = payload["element_environment"]
        return JSONResponse(content=_timeline_content({
            "generated_at": payload["generated_at"],
            "weather_timeline": payload["weather_timeline"],
            "element": {
                "element_id": element_id,
                "zone_id": element_rows[0].get("zone_id") if element_rows else None,
                "element_type": element_rows[0].get("element_type") if element_rows else None,
                "timeline": element_rows,
            },
        }, payload))
    except Exception as exc:
        raise _weather_http_error(exc) from None


from weather.api.auth import router as auth_router
from weather.api.energy import router as energy_router
from weather.api.model_edits import router as model_edits_router

app.include_router(auth_router)
app.include_router(energy_router)
app.include_router(model_edits_router)


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(_request: Request, exc: RequestValidationError):
    details = [{"type": item["type"], "location": list(item["loc"]), "message": item["msg"]}
               for item in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": {
        "code": "request_validation_error",
        "message_en": "The request failed validation.",
        "message_ko": "\uc694\uccad \uac80\uc99d\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.",
        "details": details,
    }})


@app.exception_handler(sqlite3.OperationalError)
async def sqlite_operational_error_handler(_request: Request, _exc: sqlite3.OperationalError):
    return JSONResponse(status_code=503, content={"detail": {
        "code": "database_unavailable",
        "message_en": "The database is temporarily unavailable.",
        "message_ko": "\ub370\uc774\ud130\ubca0\uc774\uc2a4\ub97c \uc0ac\uc6a9\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.",
    }})


def create_app() -> FastAPI:
    """Return the configured app; dependencies read current environment settings."""
    return app
