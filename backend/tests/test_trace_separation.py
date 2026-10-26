import json
import shutil
from collections import Counter
from pathlib import Path

import pytest

from simulation.tools.trace_separation import car_compliance, main, person_compliance


BACKEND = Path(__file__).resolve().parents[1] / "simulation"
BIG = [[-5000, -5000], [5000, -5000], [5000, 5000], [-5000, 5000], [-5000, -5000]]


def collection(cls, rings):
    return {"type": "FeatureCollection", "features": [{"type": "Feature", "id": f"{cls}_0", "geometry": {"type": "Polygon", "coordinates": rings}, "properties": {"id": f"{cls}_0", "class": cls, "estimated": False}}]}


@pytest.fixture()
def data_dir(tmp_path):
    """A copy of the real data dir (engine reads ../config) with polygons replaced per test."""
    shutil.copytree(BACKEND / "config", tmp_path / "config")
    target = tmp_path / "data"
    shutil.copytree(BACKEND / "data", target, ignore=shutil.ignore_patterns("observations", "source", "*.derived-v1.geojson"))
    (target / "walkable_polygons.geojson").write_text(json.dumps(collection("crossing", [BIG])))
    (target / "road_polygons.geojson").write_text(json.dumps(collection("road", [BIG])))
    return target


def run(data_dir, out, *extra):
    return main(["--data-dir", str(data_dir), "--out", str(out), "--seconds", "2", "--dt", "0.1", "--seed", "42", "--counts", "person=8,car=8,scooter=0", *extra])


def test_all_inside_passes(data_dir, tmp_path):
    assert run(data_dir, tmp_path / "out") == 0
    summary = json.loads((tmp_path / "out" / "summary.json").read_text())
    assert summary["ticks"] == 20 and summary["pass"] and summary["gate"]
    assert summary["person_on_walkable"] == 100.0 and summary["car_on_road"] == 100.0
    assert summary["samples"]["person"] >= 20 * 8 - 8 and summary["samples"]["car"] >= 20 * 8 - 8
    for name in ("trace.jsonl", "offenders.geojson", "summary.md"):
        assert (tmp_path / "out" / name).stat().st_size > 0


def test_car_edge_outside_its_road_polygon_fails_and_is_listed(data_dir, tmp_path):
    assert run(data_dir, tmp_path / "first") == 0
    samples = [json.loads(line) for line in (tmp_path / "first" / "trace.jsonl").read_text().splitlines()]
    edge_id, _ = Counter(sample["edge"] for sample in samples if sample["type"] == "car").most_common(1)[0]
    # Cut a hole in the road polygon where that car drove. Car edges are flagged estimated in a network copy so the
    # graph keeps them although they now leave their polygon (estimated car edges carry no route-cost multiplier,
    # so the seeded routes stay identical).
    track = [(s["x"], s["z"]) for s in samples if s["edge"] == edge_id and s["type"] == "car"]
    x0, x1 = min(p[0] for p in track) - 1, max(p[0] for p in track) + 1
    z0, z1 = min(p[1] for p in track) - 1, max(p[1] for p in track) + 1
    hole = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]]
    (data_dir / "road_polygons.geojson").write_text(json.dumps(collection("road", [BIG, hole])))
    network = json.loads((data_dir / "campus_transport_network.geojson").read_text())
    for feature in network["features"]:
        if "car" in (feature["properties"].get("allowed_types") or ()):
            feature["properties"]["estimated"] = True
    flagged = tmp_path / "flagged.geojson"
    flagged.write_text(json.dumps(network))
    assert run(data_dir, tmp_path / "second", "--network", str(flagged)) == 1
    summary = json.loads((tmp_path / "second" / "summary.json").read_text())
    assert summary["car_on_road"] < 99.0 and summary["pass"] is False
    assert edge_id in {offender["edge_id"] for offender in summary["offenders"] if offender["type"] == "car"}


def test_missing_polygons_or_network_exit_2(data_dir, tmp_path, capsys):
    assert run(data_dir, tmp_path / "out", "--network", "/nonexistent.geojson") == 2
    assert "/nonexistent.geojson" in capsys.readouterr().err
    (data_dir / "walkable_polygons.geojson").unlink()
    assert run(data_dir, tmp_path / "out") == 2


def test_same_seed_gives_identical_summary(data_dir, tmp_path):
    run(data_dir, tmp_path / "a")
    run(data_dir, tmp_path / "b")
    assert (tmp_path / "a" / "summary.json").read_text() == (tmp_path / "b" / "summary.json").read_text()


def test_lowered_threshold_is_not_a_gate(data_dir, tmp_path, capsys):
    run(data_dir, tmp_path / "out", "--min-person", "90")
    assert "threshold lowered: not a gate run" in capsys.readouterr().out
    assert json.loads((tmp_path / "out" / "summary.json").read_text())["gate"] is False


def test_vehicle_surface_is_never_walkable_and_estimated_counts_only_in_the_wider_definition():
    apron_on_road = [{"class": "plaza", "estimated": True}, {"class": "road", "estimated": False}]
    assert person_compliance(apron_on_road, False) is False
    sidewalk_over_road_zone = [{"class": "sidewalk", "estimated": False}, {"class": "road", "estimated": False}]
    assert person_compliance(sidewalk_over_road_zone, True) is True
    crossing = [{"class": "crossing", "estimated": False}, {"class": "road", "estimated": False}]
    assert person_compliance(crossing, True) is True
    estimated_walkway = [{"class": "walkway_estimated", "estimated": True}]
    assert person_compliance(estimated_walkway, False) is True
    assert person_compliance(estimated_walkway, True) is False
    walkway_in_lot = [{"class": "walkway_estimated", "estimated": True}, {"class": "lot", "estimated": False}]
    assert person_compliance(walkway_in_lot, False) is False


def test_car_on_a_sidewalk_is_off_the_road():
    assert car_compliance([{"class": "road", "estimated": False}], True) is True
    assert car_compliance([{"class": "road", "estimated": False}, {"class": "sidewalk", "estimated": False}], False) is False
    assert car_compliance([{"class": "road", "estimated": True}], True) is False
    assert car_compliance([{"class": "road", "estimated": True}], False) is True


def test_unchecked_routing_still_judges_samples_against_the_polygons(data_dir, tmp_path):
    # with a walkable polygon nowhere near the campus, routing ignores the polygons but every person sample fails
    far = [[9000, 9000], [9001, 9000], [9001, 9001], [9000, 9001], [9000, 9000]]
    (data_dir / "walkable_polygons.geojson").write_text(json.dumps(collection("crossing", [far])))
    assert run(data_dir, tmp_path / "out", "--unchecked-routing") == 1
    summary = json.loads((tmp_path / "out" / "summary.json").read_text())
    assert summary["routing_polygon_check"] is False and summary["person_on_walkable"] == 0.0
