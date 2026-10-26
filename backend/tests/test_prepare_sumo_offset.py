import json
import shutil
import subprocess
from pathlib import Path
from xml.etree import ElementTree

import pytest

from simulation.coordinate_transform import CoordinateTransform
from simulation.tools import prepare_sumo
from simulation.tools.prepare_sumo import prepare


ANCHOR = {"E": 243506.088, "N": 263876.4214}
TRANSFORM = {"epsg5186_anchor": ANCHOR}


def node(node_id, x, z):
    return {"type": "Feature", "id": node_id, "geometry": {"type": "Point", "coordinates": [x, z]}, "properties": {"id": node_id, "feature_type": "node", "kind": "sidewalk"}}


def edge(edge_id, source, target, coordinates, kind, allowed, **extra):
    return {
        "type": "Feature", "id": edge_id, "geometry": {"type": "LineString", "coordinates": coordinates},
        "properties": {"id": edge_id, "feature_type": "edge", "kind": kind, "allowed_types": allowed, "from_node": source, "to_node": target,
                       "speed_limit": 30, "derived": False, "authoritative": True, **extra},
    }


NETWORK = {"type": "FeatureCollection", "features": [
    node("A", 0.0, 0.0), node("B", 40.25, -3.5), node("C", 40.25, 20.0),
    edge("RD_1", "A", "B", [[0.0, 0.0], [40.25, -3.5]], "allowed_road", ["car", "scooter"], width_m=7.0, lanes=2),
    edge("SW_1", "B", "C", [[40.25, -3.5], [40.25, 20.0]], "sidewalk", ["person", "scooter"]),
    edge("CW_1", "C", "A", [[40.25, 20.0], [0.0, 0.0]], "crosswalk", ["person", "scooter"]),
]}


def test_two_runs_write_byte_identical_nodes(tmp_path):
    prepare(NETWORK, tmp_path / "a", TRANSFORM)
    prepare(NETWORK, tmp_path / "b", TRANSFORM)
    assert (tmp_path / "a" / "campus.nod.xml").read_bytes() == (tmp_path / "b" / "campus.nod.xml").read_bytes()
    assert (tmp_path / "a" / "campus.edg.xml").read_bytes() == (tmp_path / "b" / "campus.edg.xml").read_bytes()


def test_nodes_are_absolute_epsg5186_with_a_fixed_offset(tmp_path):
    status = prepare(NETWORK, tmp_path, TRANSFORM)
    root = ElementTree.parse(tmp_path / "campus.nod.xml").getroot()
    location = root.find("location")
    assert location.get("netOffset") == "0.00,0.00"
    assert "+proj=tmerc +lat_0=38 +lon_0=127" in location.get("projParameter")
    origin = next(item for item in root.findall("node") if item.get("id") == "A")
    assert float(origin.get("x")) == pytest.approx(ANCHOR["E"], abs=1e-6)
    assert float(origin.get("y")) == pytest.approx(ANCHOR["N"], abs=1e-6)
    other = next(item for item in root.findall("node") if item.get("id") == "B")
    assert float(other.get("x")) - ANCHOR["E"] == pytest.approx(40.25, abs=1e-6)
    assert status["frame"] == "EPSG:5186" and status["net_offset"] == [0, 0]
    written = json.loads((tmp_path / "generation_status.json").read_text(encoding="utf-8"))
    assert written["frame"] == "EPSG:5186"


def test_pedestrian_and_road_edges_get_their_sumo_classes(tmp_path):
    prepare(NETWORK, tmp_path, TRANSFORM)
    edges = {item.get("id"): item for item in ElementTree.parse(tmp_path / "campus.edg.xml").getroot().findall("edge")}
    assert edges["SW_1"].get("allow") == "pedestrian"
    assert edges["CW_1"].get("allow") == "pedestrian"
    assert edges["RD_1"].get("allow") == "passenger"
    assert edges["RD_1"].get("numLanes") == "2" and float(edges["RD_1"].get("width")) == pytest.approx(3.5)
    first_point = edges["RD_1"].get("shape").split()[0].split(",")
    assert float(first_point[0]) == pytest.approx(ANCHOR["E"], abs=1e-6)


def test_netconvert_runs_without_offset_normalization(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(prepare_sumo.shutil, "which", lambda name: "/usr/local/bin/netconvert")

    def fake_run(argv, **kwargs):
        calls.append(argv)
        return subprocess.CompletedProcess(argv, 1, "", "fake netconvert")

    monkeypatch.setattr(prepare_sumo.subprocess, "run", fake_run)
    status = prepare(NETWORK, tmp_path, TRANSFORM)
    argv = calls[0]
    flag = argv.index("--offset.disable-normalization")
    assert argv[flag + 1] == "true"
    assert "--sidewalks.guess" not in argv
    assert status["campus_net_built"] is False


def test_missing_anchor_fails_instead_of_writing_relative_coordinates(tmp_path):
    with pytest.raises(KeyError, match="epsg5186_anchor"):
        prepare(NETWORK, tmp_path, {"scale": 1.0})
    assert not (tmp_path / "campus.nod.xml").exists()


def test_sumo_origin_makes_sim_to_sumo_a_pure_translation():
    transform = CoordinateTransform(sumo_origin={"x": 0.0, "z": 0.0, **ANCHOR})
    assert transform.simulation_to_sumo(0, 0) == pytest.approx((ANCHOR["E"], ANCHOR["N"]))
    assert transform.sumo_to_simulation(ANCHOR["E"] + 12.5, ANCHOR["N"] - 3) == pytest.approx((12.5, -3))
    repo_transform = CoordinateTransform.from_file(Path(prepare_sumo.DATA) / "coordinate_transform.json")
    assert repo_transform.simulation_to_sumo(0, 0) == pytest.approx((ANCHOR["E"], ANCHOR["N"]))


def test_real_netconvert_keeps_a_zero_net_offset(tmp_path):
    if not shutil.which("netconvert"):
        pytest.skip("netconvert not installed")
    status = prepare(NETWORK, tmp_path, TRANSFORM)
    assert status["campus_net_built"], status["error"]
    assert '<location netOffset="0.00,0.00"' in (tmp_path / "campus.net.xml").read_text(encoding="utf-8")
