from __future__ import annotations

import json
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Final

from pydantic import JsonValue

type Body = dict[str, JsonValue]
CAPS: Final = {
    "find_place": 1200, "campus_weather": 1600, "building_status": 400,
    "comfort_rank": 1200, "campus_status": 1500, "simulation_overview": 2000,
    "restriction_create": 600, "restriction_remove": 300, "simulation_control": 600,
}


def obj(value: JsonValue) -> Body:
    return value if isinstance(value, dict) else {}


def rows(value: JsonValue) -> list[Body]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def quote(value: JsonValue, limit: int = 120) -> str:
    text = str(value) if value is not None else "-"
    return json.dumps(text[:limit], ensure_ascii=False).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def scalar(value: JsonValue) -> str:
    if value is None:
        return "?"
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (float, int)) and math.isfinite(value):
        return str(value)
    return quote(value)


def fields(body: Body, names: tuple[str, ...]) -> str:
    return " ".join(f"{name}={scalar(body.get(name))}" for name in names)


def header(name: str, body: Body, *, estimated: bool = False, simulation: bool = False) -> str:
    parts = [name]
    if estimated:
        parts.append("추정값")
    if simulation:
        parts.append("시뮬레이션 시나리오")
    if body.get("sample_data") is True:
        parts.append("SAMPLE")
    for source, item in obj(body.get("freshness")).items():
        entry = obj(item)
        if not entry:
            continue
        label = source if source in {"weather", "forecast", "air_quality"} else "source"
        mode = entry.get("source")
        piece = f"{label} {mode}" if mode in ("live", "cache") else label
        observed = entry.get("observed_at")
        if isinstance(observed, str):
            try:
                dt = datetime.fromisoformat(observed).astimezone(timezone(timedelta(hours=9)))
                piece += f" obs {dt:%H:%M} KST"
            except ValueError:
                piece += " obs unknown"
        age = entry.get("age_seconds")
        if isinstance(age, (int, float)) and math.isfinite(age):
            minutes = max(0, int(age) // 60)
            piece += f" age {minutes // 60}h{minutes % 60}m" if minutes >= 60 else f" age {minutes}m"
        if entry.get("stale") is True:
            piece += " STALE"
        if entry.get("error"):
            piece += " UNAVAILABLE"
        parts.append(piece)
    if body.get("unavailable") is True:
        parts.append("UNAVAILABLE")
    return " | ".join(parts)


def render(title: str, lines: list[str], *, cap: int) -> str:
    text = "\n".join([title, *lines])
    if len(text) <= cap:
        return text
    return text[:cap - len("\n[truncated]")].rstrip() + "\n[truncated]"


def unavailable(name: str, body: Body) -> str:
    detail = obj(body.get("detail"))
    parts = [f"{name} UNAVAILABLE"]
    for key in ("source", "code", "retry_after_s"):
        value = str(detail.get(key, ""))
        if value and re.fullmatch(r"[a-z0-9_.-]+", value):
            parts.append(f"{key}={value}")
    message = detail.get("message_ko") or "데이터를 가져오지 못했습니다"
    return render(" ".join(parts), [quote(message)], cap=CAPS.get(name, 4000))


def weather(body: Body, *, forecast: bool) -> str:
    if body.get("unavailable"):
        return unavailable("campus_weather", body)
    base = obj(body.get("base_weather"))
    summary = obj(body.get("summary"))
    lines = [
        "KMA\t" + fields(base, ("temperature", "humidity", "wind_speed", "precipitation_type")),
        "AirKorea\t" + fields(base, ("pm10", "pm25", "o3", "khai_grade")),
        "summary\t" + fields(summary, ("overall_status", "air_quality_status", "highest_risk_zone")),
    ]
    if forecast:
        for frame in rows(body.get("weather_timeline")):
            if frame.get("lead_hour") in (1, 2, 3):
                lines.append(f"+{frame['lead_hour']}h\t" + fields(
                    frame, ("temperature", "humidity", "wind_speed", "precipitation_probability",
                            "source", "fallback_fields")))
    estimated = summary.get("overall_status") not in (None, "정보 없음")
    return render(header("campus_weather", body, estimated=estimated), lines, cap=1600)


def building(body: Body, notices: list[Body]) -> str:
    if body.get("unavailable"):
        return unavailable("building_status", body)
    thermal = obj(body.get("thermal"))
    relevant = [item for item in notices if item.get("target_id") == body.get("element_id")]
    title = header("building_status", body, estimated=True, simulation=bool(relevant))
    values = " ".join(f"{short}={scalar(thermal.get(key))}" for short, key in (
        ("local", "local_temp"), ("feels", "feels_like"), ("utci", "utci"), ("wbgt", "wbgt"),
        ("risk", "risk_level")))
    reasons = body.get("reasons")
    lines = [f"{body.get('element_id')}\t{quote(body.get('name'), 45)}\t{scalar(body.get('zone_id'))}",
             values]
    if isinstance(reasons, list):
        lines.append("reasons\t" + "; ".join(quote(reason, 32) for reason in reasons[:3]))
    note = obj(body.get("data_note"))
    if note:
        lines.append("data_note\t" + quote(note.get("message") or note.get("assumption_level"), 45))
    for notice in relevant:
        lines.append("notice\t" + quote(notice.get("cause"), 15) + " " + quote(notice.get("message"), 45))
    return render(title, lines, cap=400)


def status(restrictions: Body, parking: Body) -> str:
    title = header("campus_status", restrictions, simulation=bool(rows(restrictions.get("restrictions"))))
    title += header("", parking)
    lines = []
    if restrictions.get("unavailable"):
        lines.append(unavailable("restrictions", restrictions))
    else:
        for item in rows(restrictions.get("restrictions")):
            lines.append(fields(item, ("id", "target_id", "target_name", "cause", "access", "message")))
    if parking.get("unavailable"):
        lines.append(unavailable("parking", parking))
    else:
        lines.insert(0, "parking\t" + fields(parking, (
            "current_cars", "total_spaces", "entered", "exited", "is_running",
            "error", "started_at", "last_frame_at")))
    return render(title, lines, cap=1500)


def overview(status_body: Body, statistics: Body) -> str:
    title = header("simulation_overview", status_body, simulation=True) + header("", statistics)
    lines = []
    for name, body, names in (
        ("status", status_body, ("status", "scenario", "simulation_time", "speed_multiplier")),
        ("statistics", statistics, ("car_count", "person_count", "scooter_count", "normal_count",
                                   "caution_count", "warning_count", "danger_count",
                                   "near_miss_count", "current_risks", "entity_count")),
    ):
        if body.get("unavailable"):
            lines.append(unavailable(name, body))
        else:
            lines.append(name + "\t" + fields(body, names))
    for event, count in obj(statistics.get("risk_events")).items():
        lines.append(f"events\t{quote(event)}\t{scalar(count)}")
    return render(title, lines, cap=2000)
