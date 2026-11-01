from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Dict, Tuple

try:
    from .data_loader import load_json
    from .network_schema import load_feature_collection, load_policy
    from .polygon_index import PolygonIndex
except ImportError:
    from data_loader import load_json
    from network_schema import load_feature_collection, load_policy
    from polygon_index import PolygonIndex


LOGGER = logging.getLogger(__name__)
POLYGON_FILES = ("walkable_polygons.geojson", "road_polygons.geojson")


def load_polygon_indexes(data_dir: Path) -> Tuple[PolygonIndex | None, PolygonIndex | None]:
    walkable, roads = (data_dir / name for name in POLYGON_FILES)
    return (PolygonIndex.load(walkable) if walkable.exists() else None, PolygonIndex.load(roads) if roads.exists() else None)


def load_runtime_graph(data_dir: Path, mode: str | None = None) -> Tuple[Dict, Dict]:
    """Build the runtime Graph from the transport Source of Truth.

    transport-derived is the development default. Research mode refuses to
    start without approved geometry instead of silently using derived lines.
    """
    selected = str(mode or os.getenv("SIMULATION_NETWORK_MODE", "transport-derived")).strip().lower()
    if selected == "legacy":
        graph = load_json(data_dir / "mobility_graph.json")
        return graph, {"mode": selected, "valid": True, "source": "mobility_graph.json", "derived_allowed": True}
    if selected not in {"transport-derived", "transport-authoritative", "research"}:
        raise ValueError(f"알 수 없는 SIMULATION_NETWORK_MODE입니다: {selected}")

    network_path = data_dir / "campus_transport_network.geojson"
    policy_path = data_dir.parent / "config" / "mobility_policy.json"
    try:
        from .tools.build_graph import build
        from .tools.validate_network import validate
    except ImportError:
        from tools.build_graph import build
        from tools.validate_network import validate
    network = load_feature_collection(network_path)
    policy = load_policy(policy_path)
    authoritative_only = selected in {"transport-authoritative", "research"}
    walkable, roads = load_polygon_indexes(data_dir)
    polygon_check = walkable is not None and roads is not None
    if not polygon_check:
        if authoritative_only:
            missing = ", ".join(name for name in POLYGON_FILES if not (data_dir / name).exists())
            raise ValueError(f"보행·차도 판정 폴리곤 파일이 없습니다({missing}). 연구 모드에서는 폴리곤 검사 없이 실행하지 않습니다.")
        LOGGER.warning("polygon index unavailable: %s missing; edges are not checked against walkable/road polygons", ", ".join(POLYGON_FILES))
        walkable = roads = None
    report = validate(network, policy, walkable, roads)
    if not report["valid"]:
        raise ValueError(f"통합 교통망 검증에 실패했습니다: {report['errors']}")
    graph = build(network, policy, authoritative_only=authoritative_only, walkable=walkable, roads=roads)
    if not graph["edges"]:
        raise ValueError(
            "승인된(authoritative=true) Runtime Edge가 없습니다. "
            "연구 모드에서는 파생 경로로 실행하지 않습니다."
        )
    if not graph["pois"]:
        raise ValueError(
            "승인된(authoritative=true) POI가 없습니다. 출입구·정문·주차장 위치가 아직 추정값이므로 "
            "연구 모드에서는 실행하지 않습니다."
        )
    graph["metadata"].update({
        "runtime_mode": selected,
        "derived_allowed": not authoritative_only,
        "validation_errors": len(report["errors"]),
        "validation_warnings": len(report["warnings"]),
    })
    return graph, {
        "mode": selected, "valid": True, "source": str(network_path.name), "derived_allowed": not authoritative_only, "quality": report["summary"],
        "polygon_check": polygon_check, "polygon_violations": len(graph["metadata"]["polygon_violations"]),
    }
