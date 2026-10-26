from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple


AGENT_TYPES = {"car", "person", "scooter"}
EDGE_KINDS = {
    "vehicle_lane", "sidewalk", "crosswalk", "bike_lane", "scooter_lane",
    "shared_path", "allowed_road", "pedestrian_gate", "vehicle_gate",
    "building_entrance", "parking_connection", "parking_walk",
    "scooter_parking_connection",
}
SOURCES = {
    "surveyed", "CAD-derived", "GIS-derived", "OSM-derived",
    "GLB-digitized", "manually-digitized", "derived", "unknown",
    "derived_from_vehicle_network", "implementation_specific",
    "NGII-A003", "ortho-traced", "road-zone-measured",
}


class NetworkValidationError(ValueError):
    pass


@dataclass(frozen=True)
class NetworkFeature:
    feature_id: str
    feature_type: str
    geometry_type: str
    coordinates: object
    properties: Dict


def load_feature_collection(path: str | Path) -> Dict:
    path = Path(path)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise NetworkValidationError(f"유효한 GeoJSON이 아닙니다: {path}: {exc}") from exc
    if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):
        raise NetworkValidationError("transport network는 GeoJSON FeatureCollection이어야 합니다.")
    return payload


def finite_point(point: Sequence[float]) -> bool:
    return len(point) >= 2 and all(isinstance(value, (int, float)) and math.isfinite(value) for value in point[:2])


def line_length(coordinates: Sequence[Sequence[float]]) -> float:
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        return 0.0
    if not all(finite_point(point) for point in coordinates):
        return math.nan
    return sum(math.dist(first[:2], second[:2]) for first, second in zip(coordinates, coordinates[1:]))


def iter_features(payload: Dict, feature_type: str | None = None) -> Iterable[NetworkFeature]:
    for raw in payload.get("features", []):
        properties = dict(raw.get("properties") or {})
        kind = str(properties.get("feature_type") or "edge")
        if feature_type and kind != feature_type:
            continue
        geometry = raw.get("geometry") or {}
        feature_id = str(properties.get("id") or raw.get("id") or "")
        yield NetworkFeature(feature_id, kind, str(geometry.get("type") or ""), geometry.get("coordinates"), properties)


def load_policy(path: str | Path) -> Dict:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    kinds = payload.get("kinds")
    if not isinstance(kinds, dict) or not kinds:
        raise NetworkValidationError("mobility policy에 kinds 객체가 필요합니다.")
    for kind, rule in kinds.items():
        allowed = set(rule.get("allowed_types") or ())
        if not allowed <= AGENT_TYPES:
            raise NetworkValidationError(f"{kind}: 허용되지 않은 Agent 타입: {sorted(allowed - AGENT_TYPES)}")
    return payload


def normalize_kind(kind: str, policy: Dict) -> str:
    return str(policy.get("legacy_aliases", {}).get(kind, kind))


def validate_edge(feature: NetworkFeature, policy: Dict) -> List[str]:
    errors: List[str] = []
    props = feature.properties
    kind = normalize_kind(str(props.get("kind") or ""), policy)
    if not feature.feature_id:
        errors.append("edge id 누락")
    if feature.geometry_type != "LineString":
        errors.append(f"geometry는 LineString이어야 함: {feature.geometry_type or 'missing'}")
    length = line_length(feature.coordinates)
    if not math.isfinite(length):
        errors.append("NaN/Infinity 또는 잘못된 좌표")
    elif length <= 1e-6:
        errors.append("zero-length edge")
    if kind not in policy["kinds"]:
        errors.append(f"알 수 없는 kind: {kind}")
    allowed = set(props.get("allowed_types") or ())
    if not allowed or not allowed <= AGENT_TYPES:
        errors.append(f"allowed_types 오류: {sorted(allowed)}")
    if kind in policy["kinds"] and allowed != set(policy["kinds"][kind]["allowed_types"]):
        errors.append(f"policy 불일치: {kind}={sorted(allowed)}")
    if not props.get("from_node") or not props.get("to_node"):
        errors.append("from_node/to_node 누락")
    source = props.get("source", "unknown")
    if source not in SOURCES:
        errors.append(f"알 수 없는 source: {source}")
    confidence = props.get("confidence")
    if confidence is not None and (not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1):
        errors.append("confidence는 null 또는 0~1이어야 함")
    if not isinstance(props.get("derived"), bool):
        errors.append("derived boolean 누락")
    errors.extend(validate_optional_edge_fields(props))
    return errors


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_optional_edge_fields(props: Dict) -> List[str]:
    """Optional measured/estimated attributes; absent is fine, a wrong type or range is an error."""
    errors: List[str] = []
    if "width_m" in props and props["width_m"] is not None and not (_number(props["width_m"]) and props["width_m"] > 0):
        errors.append(f"width_m는 0보다 큰 숫자여야 함: {props['width_m']!r}")
    if "kerb_height_m" in props and props["kerb_height_m"] is not None and not (_number(props["kerb_height_m"]) and 0 <= props["kerb_height_m"] <= 0.5):
        errors.append(f"kerb_height_m는 0~0.5 숫자여야 함: {props['kerb_height_m']!r}")
    if "lanes" in props and props["lanes"] is not None and not (isinstance(props["lanes"], int) and not isinstance(props["lanes"], bool) and 1 <= props["lanes"] <= 4):
        errors.append(f"lanes는 1~4 정수여야 함: {props['lanes']!r}")
    if "estimated" in props and props["estimated"] is not None and not isinstance(props["estimated"], bool):
        errors.append(f"estimated는 boolean이어야 함: {props['estimated']!r}")
    if "source_ref" in props and props["source_ref"] is not None and not isinstance(props["source_ref"], str):
        errors.append(f"source_ref는 문자열이어야 함: {props['source_ref']!r}")
    return errors
