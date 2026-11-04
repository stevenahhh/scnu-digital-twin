"""Check emitted main/wing rings against the same 0.3 m mitred buffer as the LOD4 clipper."""
import json
import sys

from shapely.geometry import Polygon
from shapely.ops import unary_union

records = json.load(sys.stdin)
results = []
for record in records:
    if record["footprint"] is None:
        results.append({"id": record["id"], "inside": None, "outsideAreaM2": None})
        continue
    footprint = unary_union([Polygon(p[0], p[1:]) for p in record["footprint"]])
    zone = footprint.buffer(0.3, join_style="mitre")
    masses = [Polygon(m["outer"], m["holes"]) for m in record["masses"]]
    outside = sum(m.difference(zone).area for m in masses)
    results.append({"id": record["id"], "inside": all(zone.covers(m) for m in masses), "outsideAreaM2": outside})
json.dump(results, sys.stdout)
