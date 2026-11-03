"""60 s separation trace: samples every agent after every tick and checks it against the walkable / road polygons.

Run from backend/:
    ../.venv/bin/python -m simulation.tools.trace_separation --seconds 60 --seed 42 --dt 0.1 --out <dir>

Exit 0 when both gated metrics reach their thresholds (and every tick sampled at least one person and one car),
1 when not, 2 when the network or polygon files are missing. Simulated time only (no wall clock, no sleep).

Compliance definitions (never relaxed to pass; they follow the ground model's precedence, where a measured A003
sidewalk is drawn over the road zone under it, and a road or lot is drawn over plazas and estimated paving):
- person sample is on walkable ground when it is inside a crossing or sidewalk polygon, or inside a plaza /
  walkway_estimated polygon that is not also inside a road or lot polygon (vehicle surface never counts as walkable);
- car sample is on the road when it is inside a road or lot polygon and not inside a sidewalk polygon.
Each metric is reported twice: against every polygon (measured + estimated, the gate) and against measured
polygons only (`estimated: false`), so the share that depends on estimated geometry stays visible.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from simulation.polygon_index import PolygonIndex
from simulation.runtime_network import POLYGON_FILES
from simulation.simulation_engine import DATA_DIR, SimulationEngine


NETWORK_FILE = "campus_transport_network.geojson"
# walkable over a road zone (the ground model draws them over it); crossing_estimated is always estimated: true
MEASURED_WALK = ("crossing", "crossing_estimated", "sidewalk")
PAVED_WALK = ("plaza", "walkway_estimated")
VEHICLE_SURFACE = ("road", "lot")
CAR_CLASSES = ("road", "lot")
CLASS_PRIORITY = ("crossing", "crossing_estimated", "sidewalk", "island", "walkway_estimated", "plaza", "road", "lot")
GATED_TYPES = ("person", "car")


def parse_counts(text: Optional[str]) -> Optional[Dict[str, int]]:
    if not text:
        return None
    counts = {}
    for part in text.split(","):
        key, _, value = part.partition("=")
        counts[key.strip()] = int(value)
    return counts


def person_compliance(hits: List[Dict], measured_only: bool) -> bool:
    usable = [hit for hit in hits if not (measured_only and hit.get("estimated"))]
    if any(hit.get("class") in MEASURED_WALK for hit in usable):
        return True
    on_vehicle_surface = any(hit.get("class") in VEHICLE_SURFACE for hit in hits)
    return not on_vehicle_surface and any(hit.get("class") in PAVED_WALK for hit in usable)


# subtracted from the carriageway: a car over a sidewalk or a traffic island is off the road
NOT_CARRIAGEWAY = ("sidewalk", "island")


def car_compliance(hits: List[Dict], measured_only: bool) -> bool:
    if any(hit.get("class") in NOT_CARRIAGEWAY for hit in hits):
        return False
    return any(hit.get("class") in CAR_CLASSES and not (measured_only and hit.get("estimated")) for hit in hits)


def surface_class(hits: List[Dict]) -> Optional[str]:
    classes = {hit.get("class") for hit in hits}
    return next((name for name in CLASS_PRIORITY if name in classes), None)


def percent(part: int, whole: int) -> float:
    return round(100.0 * part / whole, 3) if whole else 0.0


def prepare_data_dir(data_dir: Path, network: Optional[Path], workdir: Path, unchecked_routing: bool = False) -> Path:
    if network is None and not unchecked_routing:
        return data_dir
    target = workdir / "data"
    shutil.copytree(data_dir, target)
    if network is not None:
        shutil.copyfile(network, target / NETWORK_FILE)
    if unchecked_routing:
        # the engine routes as before the polygon check existed (a baseline network); samples are still judged
        # against the polygons of data_dir
        for name in POLYGON_FILES:
            (target / name).unlink(missing_ok=True)
    # SimulationEngine reads the policy from data_dir.parent / "config"
    shutil.copytree(data_dir.parent / "config", workdir / "config")
    return target


def trace(
    data_dir: Path, out: Path, seconds: float = 60.0, dt: float = 0.1, seed: int = 42, scenario: Optional[str] = None,
    counts: Optional[Dict[str, int]] = None, network: Optional[Path] = None, report: Optional[Path] = None,
    min_person: float = 99.0, min_car: float = 99.0, unchecked_routing: bool = False,
) -> int:
    missing = [str(path) for path in [*(data_dir / name for name in POLYGON_FILES), network or data_dir / NETWORK_FILE] if not Path(path).exists()]
    if missing:
        print(f"missing input file(s): {', '.join(missing)}", file=sys.stderr)
        return 2
    gate = min_person >= 99.0 and min_car >= 99.0
    if not gate:
        print("threshold lowered: not a gate run")
    walkable = PolygonIndex.load(data_dir / POLYGON_FILES[0])
    roads = PolygonIndex.load(data_dir / POLYGON_FILES[1])
    surfaces = PolygonIndex.merge(walkable, roads)

    with tempfile.TemporaryDirectory() as workdir:
        engine = SimulationEngine(prepare_data_dir(data_dir, network, Path(workdir), unchecked_routing), seed=seed)
        engine.configure(scenario or engine.scenarios.default, counts)
        engine.start()
        ticks = int(round(seconds / dt))
        out.mkdir(parents=True, exist_ok=True)
        totals = Counter()
        ok = Counter()
        ok_measured = Counter()
        by_kind: Dict[str, Counter] = defaultdict(Counter)
        by_class: Dict[str, Counter] = defaultdict(Counter)
        by_state: Dict[str, Counter] = defaultdict(Counter)
        outside: Dict[tuple, Dict] = {}
        offender_points: Dict[tuple, Dict] = {}
        ticks_missing_type = 0
        agent_ids = {agent: set() for agent in ("person", "car", "scooter")}
        with (out / "trace.jsonl").open("w", encoding="utf-8") as stream:
            for tick in range(1, ticks + 1):
                engine.step(dt)
                seen = Counter()
                for entity in engine.entities.values():
                    agent = entity["type"]
                    x, z = float(entity["x"]), float(entity["z"])
                    hits = surfaces.hits(x, z)
                    cls = surface_class(hits)
                    state = str(entity.get("trip_status") or entity.get("state"))
                    seen[agent] += 1
                    agent_ids[agent].add(entity["id"])
                    totals[agent] += 1
                    stream.write(json.dumps({"t": round(tick * dt, 3), "id": entity["id"], "type": agent, "state": state, "x": round(x, 3), "z": round(z, 3), "edge": entity.get("current_edge"), "edge_kind": entity.get("edge_kind"), "class": cls}) + "\n")
                    if agent not in GATED_TYPES:
                        by_class[f"{agent}:{cls}"]["samples"] += 1
                        continue
                    check = person_compliance if agent == "person" else car_compliance
                    inside, inside_measured = check(hits, False), check(hits, True)
                    ok[agent] += inside
                    ok_measured[agent] += inside_measured
                    for table, key in ((by_kind, entity.get("edge_kind")), (by_class, cls), (by_state, state)):
                        table[f"{agent}:{key}"]["samples"] += 1
                        table[f"{agent}:{key}"]["inside"] += inside
                        table[f"{agent}:{key}"]["inside_measured"] += inside_measured
                    if not inside:
                        group = outside.setdefault((entity["id"], entity.get("current_edge")), {
                            "entity_id": entity["id"], "type": agent, "edge_id": entity.get("current_edge"), "kind": entity.get("edge_kind"),
                            "state": state, "samples": 0, "points": [],
                        })
                        group["samples"] += 1
                        if len(group["points"]) < 50:
                            group["points"].append((x, z))
                        key = (agent, entity.get("current_edge"), round(x * 2) / 2, round(z * 2) / 2)
                        point = offender_points.setdefault(key, {"type": agent, "edge_id": entity.get("current_edge"), "kind": entity.get("edge_kind"), "class": cls, "state": state, "x": key[2], "z": key[3], "samples": 0})
                        point["samples"] += 1
                if not (seen["person"] and seen["car"]):
                    ticks_missing_type += 1

    allowed = {"person": (*MEASURED_WALK, *PAVED_WALK), "car": CAR_CLASSES}
    worst = sorted(outside.values(), key=lambda group: (-group["samples"], group["entity_id"], str(group["edge_id"])))[:20]
    offenders = []
    for group in worst:
        index = walkable if group["type"] == "person" else roads
        distances = [index.distance_to(px, pz, allowed[group["type"]]) for px, pz in group["points"]]
        far = max(range(len(distances)), key=lambda i: distances[i] if distances[i] is not None else float("inf"))
        offenders.append({
            "entity_id": group["entity_id"], "type": group["type"], "edge_id": group["edge_id"], "kind": group["kind"], "state": group["state"],
            "samples_outside": group["samples"], "point": [round(group["points"][far][0], 3), round(group["points"][far][1], 3)],
            "distance_m": None if distances[far] is None else round(distances[far], 3),
        })

    person_pct = percent(ok["person"], totals["person"])
    car_pct = percent(ok["car"], totals["car"])
    passed = person_pct >= min_person and car_pct >= min_car and ticks_missing_type == 0
    summary = {
        "seconds": seconds, "dt": dt, "seed": seed, "ticks": ticks, "scenario": engine.scenario_name,
        "counts": dict(engine.base_counts),
        "network": str(network) if network else NETWORK_FILE,
        "routing_polygon_check": not unchecked_routing,
        "samples": {agent: totals[agent] for agent in ("person", "car", "scooter")},
        "agents_seen": {agent: len(ids) for agent, ids in agent_ids.items()},
        "person_on_walkable": person_pct,
        "car_on_road": car_pct,
        "measured_only": {
            "person_on_walkable": percent(ok_measured["person"], totals["person"]),
            "car_on_road": percent(ok_measured["car"], totals["car"]),
            "pass": percent(ok_measured["person"], totals["person"]) >= min_person and percent(ok_measured["car"], totals["car"]) >= min_car,
        },
        "definitions": {
            "person_on_walkable": "person samples inside crossing|crossing_estimated|sidewalk, or inside plaza|walkway_estimated and not inside road|lot, / all person samples x 100 (measured + estimated polygons)",
            "car_on_road": "car samples inside road|lot and not inside sidewalk|island / all car samples x 100 (measured + estimated polygons)",
            "measured_only": "same, counting only polygons with estimated=false as allowed surface (the vehicle-surface and sidewalk exclusions still use every polygon)",
        },
        "ticks_without_person_or_car": ticks_missing_type,
        "thresholds": {"person": min_person, "car": min_car},
        "gate": gate,
        "pass": passed,
        "breakdown": {
            "edge_kind": {key: dict(value) for key, value in sorted(by_kind.items())},
            "class": {key: dict(value) for key, value in sorted(by_class.items())},
            "state": {key: dict(value) for key, value in sorted(by_state.items())},
        },
        "offenders": offenders,
    }
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if report:
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    features = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [point["x"], point["z"]]}, "properties": {k: v for k, v in point.items() if k not in ("x", "z")}} for point in offender_points.values()]
    (out / "offenders.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False) + "\n", encoding="utf-8")
    (out / "summary.md").write_text(render_markdown(summary), encoding="utf-8")
    print(f"person_on_walkable={person_pct} car_on_road={car_pct} measured_only: person={summary['measured_only']['person_on_walkable']} car={summary['measured_only']['car_on_road']} ticks={ticks} gate={gate} pass={passed}")
    return 0 if passed else 1


def render_markdown(summary: Dict) -> str:
    lines = [
        f"# Separation trace ({summary['seconds']} s, dt {summary['dt']}, seed {summary['seed']}, {summary['scenario']})",
        "",
        f"- network: `{summary['network']}`; counts {summary['counts']}; samples {summary['samples']}; ticks {summary['ticks']}",
        f"- person_on_walkable: **{summary['person_on_walkable']} %** (measured only {summary['measured_only']['person_on_walkable']} %)",
        f"- car_on_road: **{summary['car_on_road']} %** (measured only {summary['measured_only']['car_on_road']} %)",
        f"- thresholds {summary['thresholds']}, gate {summary['gate']}, pass **{summary['pass']}** (measured-only pass {summary['measured_only']['pass']})",
        "",
        "| offender | type | edge | kind | state | samples outside | distance m |",
        "| --- | --- | --- | --- | --- | ---: | ---: |",
    ]
    lines += [f"| {o['entity_id']} | {o['type']} | {o['edge_id']} | {o['kind']} | {o['state']} | {o['samples_outside']} | {o['distance_m']} |" for o in summary["offenders"]]
    return "\n".join(lines) + "\n"


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Trace every agent for N simulated seconds against the walkable/road polygons.")
    parser.add_argument("--seconds", type=float, default=60.0)
    parser.add_argument("--dt", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--scenario")
    parser.add_argument("--counts", help="e.g. person=60,car=25,scooter=10")
    parser.add_argument("--network", type=Path, help="alternative campus_transport_network GeoJSON (e.g. the derived-v1 baseline)")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--report", type=Path, help="also write the summary (without the trace) here")
    parser.add_argument("--min-person", type=float, default=99.0)
    parser.add_argument("--min-car", type=float, default=99.0)
    parser.add_argument("--unchecked-routing", action="store_true", help="route without the polygon check (baseline networks built before it); samples are still judged against the polygons")
    args = parser.parse_args(list(argv) if argv is not None else None)
    return trace(
        args.data_dir, args.out, args.seconds, args.dt, args.seed, args.scenario, parse_counts(args.counts),
        args.network, args.report, args.min_person, args.min_car, args.unchecked_routing,
    )


if __name__ == "__main__":
    raise SystemExit(main())
