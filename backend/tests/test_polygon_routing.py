import json
import logging
import shutil
from pathlib import Path

import pytest

from simulation.mobility_graph import MobilityGraph
from simulation.network_schema import load_policy
from simulation.polygon_index import PolygonIndex
from simulation.runtime_network import load_runtime_graph
from simulation.tools.build_graph import build


POLICY_PATH = Path(__file__).resolve().parents[1] / "simulation" / "config" / "mobility_policy.json"


def node(node_id, x, z):
    return {"type": "Feature", "id": node_id, "geometry": {"type": "Point", "coordinates": [x, z]}, "properties": {"id": node_id, "feature_type": "node", "kind": "sidewalk"}}


def edge(edge_id, source, target, coordinates, kind, allowed, estimated=False):
    return {
        "type": "Feature", "id": edge_id, "geometry": {"type": "LineString", "coordinates": coordinates},
        "properties": {
            "id": edge_id, "feature_type": "edge", "kind": kind, "allowed_types": allowed, "from_node": source, "to_node": target,
            "bidirectional": True, "speed_limit": 10, "source": "derived_from_vehicle_network" if estimated else "NGII-A003",
            "derived": estimated, "estimated": estimated, "authoritative": not estimated, "confidence": 0.2 if estimated else 0.8,
        },
    }


def poi(poi_id, node_id, allowed):
    return {"type": "Feature", "id": poi_id, "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {"id": poi_id, "poi_id": poi_id, "feature_type": "poi", "kind": "gate", "node_id": node_id, "allowed_types": allowed, "derived": False, "authoritative": True}}


def polygons(cls, *rings):
    return {"type": "FeatureCollection", "features": [{"type": "Feature", "id": f"{cls}_{i}", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": {"id": f"{cls}_{i}", "class": cls}} for i, ring in enumerate(rings)]}


def rect(x0, z0, x1, z1):
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]]


# A and B 20 m apart; the sidewalk goes round through M1 and M2 (each leg inside a walkable strip), a straight
# "sidewalk" shortcut A-B crosses the lawn; a road runs A-C-D-B inside its road polygons.
def fixture(extra_edges=(), height=10):
    h = height
    features = [
        node("A", 0, 0), node("M1", 0, h), node("M2", 20, h), node("B", 20, 0), node("C", 0, -10), node("D", 20, -10),
        edge("SW_A1", "A", "M1", [[0, 0], [0, h]], "sidewalk", ["person"]),
        edge("SW_12", "M1", "M2", [[0, h], [20, h]], "sidewalk", ["person"]),
        edge("SW_2B", "M2", "B", [[20, h], [20, 0]], "sidewalk", ["person"]),
        edge("SW_SHORTCUT", "A", "B", [[0, 0], [20, 0]], "sidewalk", ["person"]),
        edge("RD_AC", "A", "C", [[0, 0], [0, -10]], "allowed_road", ["car", "scooter"]),
        edge("RD_CD", "C", "D", [[0, -10], [20, -10]], "allowed_road", ["car", "scooter"]),
        edge("RD_DB", "D", "B", [[20, -10], [20, 0]], "allowed_road", ["car", "scooter"]),
        poi("P_A", "A", ["person", "car"]), poi("P_B", "B", ["person", "car"]),
        *extra_edges,
    ]
    walkable = polygons("sidewalk", rect(-1, -1, 1, h + 1), rect(-1, h - 1, 21, h + 1), rect(19, -1, 21, h + 1))
    roads = polygons("road", rect(-1, -11, 21, -9), rect(-1, -11, 1, 1), rect(19, -11, 21, 1))
    return {"type": "FeatureCollection", "features": features}, walkable, roads


def indexes(walkable, roads, tmp_path):
    (tmp_path / "w.geojson").write_text(json.dumps(walkable))
    (tmp_path / "r.geojson").write_text(json.dumps(roads))
    return PolygonIndex.load(tmp_path / "w.geojson"), PolygonIndex.load(tmp_path / "r.geojson")


def test_polygon_index_classifies_points_and_holes(tmp_path):
    index = PolygonIndex([{"rings": [rect(0, 0, 10, 10), rect(4, 4, 6, 6)], "class": "plaza"}, {"rings": [rect(8, 8, 20, 20)], "class": "road"}], priority=("plaza", "road"))
    assert index.classify(1, 1) == "plaza"
    assert index.classify(5, 5) is None  # inside the hole
    assert index.classify(9, 9) == "plaza"  # overlap: priority
    assert index.classify(15, 15) == "road"
    assert index.classify(30, 30) is None


def test_person_routes_on_the_sidewalk_not_the_lawn_shortcut(tmp_path):
    network, walkable, roads = fixture()
    w, r = indexes(walkable, roads, tmp_path)
    graph = MobilityGraph(build(network, load_policy(POLICY_PATH), walkable=w, roads=r))
    path = graph.shortest_path("P_A", "P_B", "person")
    assert path.edge_ids == ("SW_A1", "SW_12", "SW_2B")


def test_violating_edge_loses_its_agent_type_and_is_reported(tmp_path):
    network, walkable, roads = fixture()
    w, r = indexes(walkable, roads, tmp_path)
    payload = build(network, load_policy(POLICY_PATH), walkable=w, roads=r)
    shortcut = next(item for item in payload["edges"] if item["id"] == "SW_SHORTCUT")
    assert "person" not in shortcut["allowed_types"]
    reported = [item for item in payload["metadata"]["polygon_violations"] if item["edge"] == "SW_SHORTCUT"]
    assert len(reported) == 1 and reported[0]["agent_type"] == "person" and reported[0]["share"] < 0.95
    assert len(payload["metadata"]["polygon_violations"]) == 1


def test_car_never_routes_onto_a_sidewalk(tmp_path):
    network, walkable, roads = fixture()
    w, r = indexes(walkable, roads, tmp_path)
    graph = MobilityGraph(build(network, load_policy(POLICY_PATH), walkable=w, roads=r))
    path = graph.shortest_path("P_A", "P_B", "car")
    assert set(path.edge_kinds) == {"allowed_road"}
    assert path.edge_ids == ("RD_AC", "RD_CD", "RD_DB")


def test_estimated_shared_path_only_when_the_sidewalk_is_over_four_times_longer():
    # an estimated 20 m shared path A-B against the sidewalk detour of 20 + 2 h metres: at h = 30 the detour is 4 x as
    # long and still wins (cost 80 x 0.85 = 68 < 20 x 0.95 x 4 = 76); at h = 50 (6 x) the estimated path is taken
    policy = load_policy(POLICY_PATH)
    assert policy["route_cost_multipliers"]["person"]["shared_path_estimated"] == 4.0
    assert policy["route_cost_multipliers"]["car"]["parking_connection"] == 2.0
    for height, expected in ((30, ("SW_A1", "SW_12", "SW_2B")), (50, ("FB",))):
        network, _, _ = fixture([edge("FB", "A", "B", [[0, 0], [20, 0]], "shared_path", ["person", "scooter"], estimated=True)], height=height)
        network["features"] = [f for f in network["features"] if f["id"] != "SW_SHORTCUT"]
        graph = MobilityGraph(build(network, policy))
        assert graph.shortest_path("P_A", "P_B", "person").edge_ids == expected


def test_estimated_edges_outside_the_polygons_are_tagged_not_removed(tmp_path):
    network, walkable, roads = fixture([edge("FB", "A", "B", [[0, 0], [20, 0]], "shared_path", ["person", "scooter"], estimated=True)])
    w, r = indexes(walkable, roads, tmp_path)
    payload = build(network, load_policy(POLICY_PATH), walkable=w, roads=r)
    fb = next(item for item in payload["edges"] if item["id"] == "FB")
    assert fb["allowed_types"] == ["person", "scooter"]
    assert fb["outside_walkable"] is True


def _data_dir(tmp_path, with_polygons):
    data = tmp_path / "data"
    data.mkdir()
    (tmp_path / "config").mkdir()
    shutil.copy(POLICY_PATH, tmp_path / "config" / "mobility_policy.json")
    network, walkable, roads = fixture()
    (data / "campus_transport_network.geojson").write_text(json.dumps(network))
    if with_polygons:
        (data / "walkable_polygons.geojson").write_text(json.dumps(walkable))
        (data / "road_polygons.geojson").write_text(json.dumps(roads))
    return data


def test_missing_polygons_warn_in_derived_mode_and_refuse_in_research_mode(tmp_path, caplog):
    data = _data_dir(tmp_path, with_polygons=False)
    with caplog.at_level(logging.WARNING):
        graph, runtime = load_runtime_graph(data, mode="transport-derived")
    assert runtime["polygon_check"] is False
    assert "polygon index unavailable" in caplog.text
    with pytest.raises(ValueError, match="판정 폴리곤 파일이 없습니다"):
        load_runtime_graph(data, mode="research")


def test_polygons_present_are_checked_at_runtime(tmp_path):
    data = _data_dir(tmp_path, with_polygons=True)
    graph, runtime = load_runtime_graph(data, mode="transport-derived")
    assert runtime["polygon_check"] is True
    assert runtime["polygon_violations"] == 1
