"""Measured vs estimated make-up of the runtime transport network, for the dashboard (statistics.network_provenance).

Computed once at engine start from campus_transport_network.geojson, walkable_polygons.geojson and, when present,
separation_report.json (the committed 60 s trace). Lengths in metres; shares in percent of the pedestrian network.
Every `estimated` edge or polygon is an estimate (추정), never a measurement.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

NETWORK_FILE = "campus_transport_network.geojson"
WALKABLE_FILE = "walkable_polygons.geojson"
REPORT_FILE = "separation_report.json"


def _length(coordinates) -> float:
    return sum(math.dist(coordinates[i][:2], coordinates[i + 1][:2]) for i in range(len(coordinates) - 1))


def _separation(path: Path) -> Optional[Dict]:
    if not path.exists():
        return None
    report = json.loads(path.read_text(encoding="utf-8"))
    measured = report.get("measured_only") or {}
    return {
        "person_on_walkable": report.get("person_on_walkable"),
        "car_on_road": report.get("car_on_road"),
        "measured_only": {"person_on_walkable": measured.get("person_on_walkable"), "car_on_road": measured.get("car_on_road")},
        "seed": report.get("seed"),
        "seconds": report.get("seconds"),
        "pass": report.get("pass"),
        "generatedAt": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"),
    }


def network_provenance(data_dir: Path) -> Dict:
    data_dir = Path(data_dir)
    network = json.loads((data_dir / NETWORK_FILE).read_text(encoding="utf-8"))
    edges = [f for f in network.get("features", []) if (f.get("properties") or {}).get("feature_type") == "edge"]
    person = car = sidewalk = shared = road = perimeter = 0.0
    connected = set()
    for feature in edges:
        props = feature["properties"]
        length = _length(feature["geometry"]["coordinates"])
        allowed = props.get("allowed_types") or ()
        estimated = bool(props.get("estimated"))
        if "person" in allowed:
            person += length
            if props.get("kind") == "sidewalk" and not estimated and props.get("source") == "NGII-A003":
                sidewalk += length
            if estimated:
                shared += length
            if props.get("kind") == "crosswalk" and props.get("crosswalk_id"):
                connected.add(props["crosswalk_id"])
        if "car" in allowed and props.get("kind") in {"allowed_road", "vehicle_lane"}:
            car += length
            if props.get("source") == "OSM-derived":
                perimeter += length
            elif not estimated:
                road += length
    walkable_path = data_dir / WALKABLE_FILE
    crossings = 0
    if walkable_path.exists():
        walkable = json.loads(walkable_path.read_text(encoding="utf-8"))
        crossings = sum(1 for f in walkable.get("features", []) if (f.get("properties") or {}).get("class") == "crossing" and str(f.get("id", "")).startswith("CW_"))
    share = lambda part: round(100.0 * part / person, 1) if person else 0.0
    return {
        "sidewalk_measured_m": round(sidewalk, 1),
        "crossing_count": crossings,
        "crossing_connected": len(connected),
        "shared_estimated_m": round(shared, 1),
        "road_measured_m": round(road, 1),
        "perimeter_osm_m": round(perimeter, 1),
        "person_measured_share": share(sidewalk),
        "person_estimated_share": share(shared),
        "separation": _separation(data_dir / REPORT_FILE),
    }
