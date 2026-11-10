"""Every main/wing/podium/tower outer ring of a LOD4 form lies inside its footprint buffered 0.3 m.

    uv run --no-project --with shapely==2.2.0 python check_form_containment.py KEEP_DIR

KEEP_DIR is the --keep directory of fetch/buildingForms.mjs (input.json footprints, output.json forms, model metres).
Prints one line per violation and the count; exits 1 when the count is not 0.
"""
import json
import sys

from shapely import Polygon, unary_union

CLIPPED = ("main", "wing", "podium", "tower")


def violations(inp, out, buffer=0.3):
    foot = {b["key"]: unary_union([Polygon(p["outer"], p["holes"]) for p in b["parts"]]) for b in inp["buildings"]}
    bad, checked = [], 0
    for r in out["buildings"]:
        if not r["source"].startswith("VWorld LOD4"):
            continue
        zone = foot[r["key"]].buffer(buffer + 1e-6, join_style="mitre")
        for i, m in enumerate(r["masses"]):
            if m["kind"] not in CLIPPED:
                continue
            checked += 1
            ring = Polygon(m["outer"])
            if not zone.contains(ring):
                bad.append((r["key"], i, m["kind"], round(ring.difference(zone).area, 3)))
    return bad, checked


if __name__ == "__main__":
    keep = sys.argv[1]
    bad, checked = violations(json.load(open(f"{keep}/input.json")), json.load(open(f"{keep}/output.json")))
    for key, i, kind, area in bad:
        print(f"VIOLATION {key} mass {i} {kind}: {area} m2 outside footprint+0.3 m")
    print(f"containment: {checked} main/wing/podium/tower rings checked, {len(bad)} violations")
    sys.exit(1 if bad else 0)
