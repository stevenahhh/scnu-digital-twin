import json
from pathlib import Path

from simulation.network_schema import load_feature_collection, load_policy
from simulation.tools.build_graph import build
from simulation.tools.validate_network import validate


ROOT = Path(__file__).resolve().parents[1] / "simulation"


def _network_and_policy():
    return (
        load_feature_collection(ROOT / "data" / "campus_transport_network.geojson"),
        load_policy(ROOT / "config" / "mobility_policy.json"),
    )


def test_transport_network_is_traceable_and_structurally_valid():
    # Separated network (frontend/scripts/campus-model/network/buildNetwork.mjs, plan todo 20): measured sidewalks,
    # crossings and road centrelines are authoritative; every derived edge is labelled estimated.
    network, policy = _network_and_policy()
    report = validate(network, policy)
    assert report["valid"] is True
    assert report["errors"] == []
    assert report["summary"]["authoritative_edges"] > 0
    edges = [f for f in network["features"] if f["properties"].get("feature_type") == "edge"]
    assert report["summary"]["derived_edges"] == sum(1 for f in edges if f["properties"].get("estimated") is True)
    codes = {warning["code"] for warning in report["warnings"]}
    assert "CROSSWALK_WITHOUT_PEDESTRIAN_CONNECTION" not in codes
    assert "DUPLICATE_NODE_POSITION" not in codes
    for agent in ("person", "car"):
        assert report["connectivity"][agent]["components"] == 1
        assert report["connectivity"][agent]["connected_percent"] == 100


def test_transport_graph_builder_preserves_multimodal_connectivity():
    network, policy = _network_and_policy()
    graph = build(network, policy)
    assert len(graph["edges"]) == sum(1 for f in network["features"] if f["properties"].get("feature_type") == "edge")
    assert {edge["kind"] for edge in graph["edges"]} >= {"allowed_road", "sidewalk", "shared_path", "crosswalk", "building_entrance"}
    assert {poi["poi_id"] for poi in graph["pois"]} >= {"BLD_D4", "GATE_MAIN", "PARKING_A", "EXTERNAL_MAIN_ROAD_SOUTH"}


def _car_components(edges):
    adjacency = {}
    for edge in edges:
        adjacency.setdefault(edge["from"], set()).add(edge["to"])
        adjacency.setdefault(edge["to"], set()).add(edge["from"])
    seen, components = set(), 0
    for start in adjacency:
        if start in seen:
            continue
        components += 1
        seen.add(start)
        stack = [start]
        while stack:
            for neighbour in adjacency[stack.pop()]:
                if neighbour not in seen:
                    seen.add(neighbour)
                    stack.append(neighbour)
    return components


def test_authoritative_only_graph_routes_on_measured_geometry():
    network, policy = _network_and_policy()
    graph = build(network, policy, authoritative_only=True)
    assert graph["edges"]
    assert all(edge["authoritative"] and not edge["derived"] for edge in graph["edges"])
    car_edges = [edge for edge in graph["edges"] if "car" in edge["allowed_types"]]
    assert car_edges
    # The measured road-zone centrelines are cut where the digitised zone polygons leave a gap (<= 15 m); the estimated
    # gap bridges are the only campus car edges outside a measured polygon, and they join the measured graph into one.
    full = build(network, policy)
    bridges = [edge for edge in full["edges"] if edge["kind"] == "allowed_road" and edge["source"] == "derived_from_vehicle_network"]
    assert 0 < len(bridges) <= 10
    assert _car_components(car_edges + bridges) == 1


def test_baseline_network_is_kept_unchanged_for_comparison():
    baseline = json.loads((ROOT / "data" / "campus_transport_network.derived-v1.geojson").read_text(encoding="utf-8"))
    edges = [f for f in baseline["features"] if f["properties"].get("feature_type") == "edge"]
    assert len(edges) == 364
    assert all(f["properties"]["derived"] for f in edges)
