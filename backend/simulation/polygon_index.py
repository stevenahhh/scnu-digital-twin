from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


Point = Tuple[float, float]
Ring = Sequence[Sequence[float]]


def point_in_rings(x: float, z: float, rings: Sequence[Ring]) -> bool:
    """Even-odd ray casting over the outer ring and its holes."""
    inside = False
    for ring in rings:
        count = len(ring)
        j = count - 1
        for i in range(count):
            xi, zi = float(ring[i][0]), float(ring[i][1])
            xj, zj = float(ring[j][0]), float(ring[j][1])
            if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
                inside = not inside
            j = i
    return inside


class PolygonIndex:
    """Polygons with a `class` property in uniform 20 m grid buckets (same pattern as spatial_index.UniformSpatialGrid).

    Pure Python, no shapely: `classify(x, z)` returns the class of the first polygon containing the point, in the
    order of `priority` when several classes overlap (a crossing over a road counts as a crossing).
    """

    def __init__(self, polygons: Iterable[Dict], cell_size: float = 20.0, priority: Sequence[str] = ()) -> None:
        self.cell_size = max(1.0, float(cell_size))
        self.priority = {name: index for index, name in enumerate(priority)}
        self.polygons: List[Dict] = []
        self.cells: Dict[Tuple[int, int], List[int]] = {}
        for polygon in polygons:
            rings = polygon["rings"]
            xs = [float(p[0]) for ring in rings for p in ring]
            zs = [float(p[1]) for ring in rings for p in ring]
            if not xs:
                continue
            box = (min(xs), min(zs), max(xs), max(zs))
            index = len(self.polygons)
            self.polygons.append({**polygon, "box": box})
            for cx in range(math.floor(box[0] / self.cell_size), math.floor(box[2] / self.cell_size) + 1):
                for cz in range(math.floor(box[1] / self.cell_size), math.floor(box[3] / self.cell_size) + 1):
                    self.cells.setdefault((cx, cz), []).append(index)

    @classmethod
    def load(cls, path: str | Path, priority: Sequence[str] = ()) -> "PolygonIndex":
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        polygons = []
        for feature in payload.get("features", []):
            geometry = feature.get("geometry") or {}
            props = feature.get("properties") or {}
            parts = [geometry.get("coordinates") or []] if geometry.get("type") == "Polygon" else geometry.get("coordinates") or []
            for rings in parts:
                polygons.append({"rings": rings, "class": props.get("class"), "id": props.get("id") or feature.get("id")})
        return cls(polygons, priority=priority)

    @classmethod
    def merge(cls, *indexes: "PolygonIndex", priority: Sequence[str] = ()) -> "PolygonIndex":
        return cls([{key: value for key, value in polygon.items() if key != "box"} for index in indexes for polygon in index.polygons], priority=priority)

    def _containing(self, x: float, z: float) -> List[Dict]:
        key = (math.floor(x / self.cell_size), math.floor(z / self.cell_size))
        found = []
        for index in self.cells.get(key, ()):
            polygon = self.polygons[index]
            box = polygon["box"]
            if box[0] <= x <= box[2] and box[1] <= z <= box[3] and point_in_rings(x, z, polygon["rings"]):
                found.append(polygon)
        return found

    def classify(self, x: float, z: float) -> Optional[str]:
        hits = self._containing(float(x), float(z))
        if not hits:
            return None
        hits.sort(key=lambda polygon: self.priority.get(polygon.get("class"), len(self.priority)))
        return hits[0].get("class")

    def contains(self, x: float, z: float, classes: Optional[Iterable[str]] = None) -> bool:
        wanted = set(classes) if classes is not None else None
        return any(wanted is None or polygon.get("class") in wanted for polygon in self._containing(float(x), float(z)))


def sample_line(points: Sequence[Sequence[float]], step: float = 1.0) -> List[Point]:
    """Points every `step` metres along a polyline, both ends included."""
    pts = [(float(p[0]), float(p[1])) for p in points]
    if len(pts) < 2:
        return pts
    out = [pts[0]]
    carry = step
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):
        length = math.hypot(bx - ax, bz - az)
        distance = carry
        while distance < length:
            t = distance / length
            out.append((ax + (bx - ax) * t, az + (bz - az) * t))
            distance += step
        carry = distance - length
    out.append(pts[-1])
    return out
