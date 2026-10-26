"""Contract additions to the transport network (plan uhf-ground-roads-routing, todo 7).

The source list grew because network_schema.py:17-21 rejected every source a measured network uses
(NGII-A003 sidewalks, ortho-traced features, road-zone-measured widths): an edge with source "NGII-A003"
failed validation on the old code path.
"""
from pathlib import Path

import pytest

from simulation.mobility_graph import MobilityGraph
from simulation.network_schema import SOURCES, load_policy, validate_edge, NetworkFeature
from simulation.tools.build_graph import build
from simulation.tools.validate_network import validate


ROOT = Path(__file__).resolve().parents[1] / "simulation"
POLICY = load_policy(ROOT / "config" / "mobility_policy.json")


def node(node_id, x, z):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [x, z]}, "properties": {"id": node_id, "feature_type": "node", "kind": "intersection"}}


def edge(edge_id, from_node, to_node, coords, kind, allowed, **extra):
    props = {
        "id": edge_id, "feature_type": "edge", "kind": kind, "allowed_types": allowed, "from_node": from_node, "to_node": to_node,
        "bidirectional": True, "speed_limit": 20, "source": "derived", "confidence": 0.5, "derived": True,
    }
    props.update(extra)
    return {"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords}, "properties": props}


def poi(poi_id, node_id, allowed):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {"id": poi_id, "feature_type": "poi", "poi_id": poi_id, "node_id": node_id, "kind": "building", "allowed_types": allowed}}


def network(*edges):
    return {
        "type": "FeatureCollection", "metadata": {"coordinate_system": "local meters, x=east, z=north"},
        "features": [node("A", 0, 0), node("B", 100, 0), *edges, poi("P_A", "A", ["car", "person"]), poi("P_B", "B", ["car", "person"])],
    }


def feature(props, coords=((0, 0), (10, 0))):
    return NetworkFeature(props["id"], "edge", "LineString", [list(p) for p in coords], props)


def base_props(**extra):
    props = {"id": "E1", "kind": "sidewalk", "allowed_types": ["person"], "from_node": "A", "to_node": "B", "source": "derived", "derived": False}
    props.update(extra)
    return props


def test_old_payload_without_new_fields_still_builds_and_routes():
    payload = build(network(edge("E_ROAD", "A", "B", [[0, 0], [100, 0]], "allowed_road", ["car", "scooter"]),
                            edge("E_WALK", "A", "B", [[0, 0], [100, 0]], "shared_path", ["person", "scooter"])), POLICY)
    graph = MobilityGraph(payload)
    path = graph.shortest_path("P_A", "P_B", "person")
    assert path.total_length == pytest.approx(100)
    x, z, _, _ = graph.interpolate(path, 50, "person")
    # Derived shared path keeps the 2.8 m development offset (left of travel: +z when heading east).
    assert (x, z) == pytest.approx((50, 2.8))
    old_style = {"metadata": {}, "nodes": [{"id": "A", "x": 0, "z": 0}, {"id": "B", "x": 10, "z": 0}],
                 "edges": [{"id": "E", "from": "A", "to": "B", "kind": "sidewalk", "allowed_types": ["person"], "coordinates": [[0, 0], [10, 0]]}],
                 "pois": [{"poi_id": "P_A", "node_id": "A", "allowed_types": ["person"]}, {"poi_id": "P_B", "node_id": "B", "allowed_types": ["person"]}]}
    legacy = MobilityGraph(old_style)
    assert legacy.edges["E"].derived is True and legacy.edges["E"].lanes == 1 and legacy.edges["E"].width_m is None


def test_new_sources_are_accepted_and_kept():
    assert {"NGII-A003", "ortho-traced", "road-zone-measured"} <= SOURCES
    assert {"surveyed", "derived", "derived_from_vehicle_network", "implementation_specific"} <= SOURCES
    assert validate_edge(feature(base_props(source="NGII-A003")), POLICY) == []


def test_new_fields_are_validated():
    good = base_props(width_m=2.4, kerb_height_m=0.15, lanes=1, estimated=True, source_ref="100034702020A00310100000000047701")
    assert validate_edge(feature(good), POLICY) == []
    bad = validate_edge(feature(base_props(width_m=-1, kerb_height_m=0.8, lanes=7, estimated="yes", source_ref=12)), POLICY)
    assert any("width_m" in message for message in bad)
    assert any("kerb_height_m" in message for message in bad)
    assert any("lanes" in message for message in bad)
    assert any("estimated" in message for message in bad)
    assert any("source_ref" in message for message in bad)
    report = validate(network(edge("E_BAD", "A", "B", [[0, 0], [100, 0]], "sidewalk", ["person"], derived=False, width_m=-1)), POLICY)
    assert {"code": "INVALID_EDGE", "feature_id": "E_BAD"} == {k: v for k, v in report["errors"][0].items() if k != "message"}
    assert "width_m" in report["errors"][0]["message"]


def test_build_graph_carries_the_new_fields():
    payload = build(network(edge("E_WALK", "A", "B", [[0, 0], [100, 0]], "sidewalk", ["person"], derived=False, authoritative=True,
                                 source="NGII-A003", width_m=3.2, kerb_height_m=0.15, estimated=True, source_ref="ufid-1")), POLICY)
    runtime = payload["edges"][0]
    assert runtime["derived"] is False and runtime["authoritative"] is True
    assert (runtime["width_m"], runtime["kerb_height_m"], runtime["estimated"], runtime["source_ref"]) == (3.2, 0.15, True, "ufid-1")
    assert "lanes" not in runtime


def test_no_offset_on_a_non_derived_sidewalk():
    payload = build(network(edge("E_WALK", "A", "B", [[0, 0], [100, 0]], "sidewalk", ["person"], derived=False, source="NGII-A003", width_m=3)), POLICY)
    graph = MobilityGraph(payload)
    path = graph.shortest_path("P_A", "P_B", "person")
    assert graph.lateral_offset("person", "sidewalk", derived=False) == 0.0
    assert graph.interpolate(path, 50, "person")[:2] == pytest.approx((50, 0))


def test_car_keeps_to_the_right_half_of_a_two_lane_non_derived_road():
    payload = build(network(edge("E_ROAD", "A", "B", [[0, 0], [100, 0]], "allowed_road", ["car", "scooter"], derived=False,
                                 source="road-zone-measured", width_m=8.0, lanes=2)), POLICY)
    graph = MobilityGraph(payload)
    assert graph.lateral_offset("car", "allowed_road", derived=False, width_m=8.0, lanes=2) == pytest.approx(-2.0)
    assert graph.lateral_offset("car", "allowed_road", derived=False, width_m=None, lanes=2) == pytest.approx(-1.5)
    assert graph.lateral_offset("car", "allowed_road", derived=False, width_m=8.0, lanes=1) == 0.0
    east = graph.shortest_path("P_A", "P_B", "car")
    x, z, heading, _ = graph.interpolate(east, 50, "car")
    # Heading east (+x), the right-hand side is south (-z).
    assert heading == pytest.approx(90)
    assert (x, z) == pytest.approx((50, -2.0))
    west = graph.shortest_path("P_B", "P_A", "car")
    x, z, heading, _ = graph.interpolate(west, 50, "car")
    assert heading == pytest.approx(270)
    assert (x, z) == pytest.approx((50, 2.0))


def test_statute_checks_are_warnings_only():
    report = validate(network(
        edge("E_WALK", "A", "B", [[0, 0], [100, 0]], "sidewalk", ["person"], derived=False, width_m=1.2, kerb_height_m=0.3),
        edge("E_CW", "A", "B", [[0, 0], [0, 10], [100, 0]], "crosswalk", ["person", "scooter"], derived=False, width_m=3.0),
    ), POLICY)
    codes = {warning["code"] for warning in report["warnings"]}
    assert {"SIDEWALK_NARROWER_THAN_1_5M", "KERB_ABOVE_LEGAL_CAP", "CROSSING_NARROWER_THAN_4M"} <= codes
    assert not [error for error in report["errors"] if error["code"] == "INVALID_EDGE"]
