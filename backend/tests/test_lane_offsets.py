import logging
import math

import pytest

from simulation.mobility_graph import MobilityGraph


def make_graph(edges, lanes_source=None, cap=None):
    nodes, pois, raw = {}, [], []
    for index, (coords, width, lanes) in enumerate(edges):
        start, end = f"N{index}A", f"N{index}B"
        for node_id, point in ((start, coords[0]), (end, coords[-1])):
            nodes[node_id] = {"id": node_id, "x": point[0], "z": point[1]}
            pois.append({"poi_id": f"P_{node_id}", "node_id": node_id, "allowed_types": ["car", "scooter"]})
        raw.append({
            "id": f"E{index}", "from": start, "to": end, "kind": "allowed_road", "allowed_types": ["car", "scooter"],
            "coordinates": coords, "bidirectional": True, "derived": False, "width_m": width, "lanes": lanes,
            **({"lanes_source": lanes_source} if lanes_source else {}),
            **({"lane_offset_cap_m": cap} if cap is not None else {}),
        })
    return MobilityGraph({"metadata": {}, "nodes": list(nodes.values()), "pois": pois, "edges": raw})


def test_two_lane_road_offsets_to_opposite_sides_with_half_lane_magnitude():
    graph = make_graph([([[0, 0], [100, 0]], 7.0, 2)])
    east = graph.shortest_path("P_N0A", "P_N0B", "car")
    west = graph.shortest_path("P_N0B", "P_N0A", "car")
    z_east = graph.interpolate(east, 50, "car")[1]
    z_west = graph.interpolate(west, 50, "car")[1]
    assert z_east == pytest.approx(-1.75, abs=0.01)
    assert z_west == pytest.approx(1.75, abs=0.01)
    assert z_east * z_west < 0


def test_narrow_single_lane_road_has_no_offset():
    graph = make_graph([([[0, 0], [100, 0]], 4.0, 1)])
    path = graph.shortest_path("P_N0A", "P_N0B", "car")
    assert graph.interpolate(path, 50, "car")[1] == pytest.approx(0.0)


def test_wide_single_lane_carriageway_is_offset_and_clamped():
    graph = make_graph([([[0, 0], [100, 0]], 6.0, 1)])
    assert graph.lateral_offset("car", "allowed_road", derived=False, width_m=6.0, lanes=1) == pytest.approx(-2.1)


def test_scooter_adds_kerb_bias_and_pedestrians_stay_unshifted():
    graph = make_graph([([[0, 0], [100, 0]], 8.0, 2)])
    assert graph.lateral_offset("scooter", "allowed_road", derived=False, width_m=8.0, lanes=2) == pytest.approx(-2.5)
    assert graph.lateral_offset("scooter", "allowed_road", derived=False, width_m=7.0, lanes=2) == pytest.approx(-2.25)
    assert graph.lateral_offset("scooter", "allowed_road", derived=False, width_m=5.0, lanes=2) == pytest.approx(-1.6)
    assert graph.lateral_offset("person", "sidewalk", derived=False, width_m=7.0, lanes=2) == 0.0
    assert graph.lateral_offset("scooter", "allowed_road", derived=True) == -1.0


def test_edge_narrower_than_a_car_gets_no_offset_and_logs(caplog):
    graph = make_graph([([[0, 0], [100, 0]], 1.5, 2)])
    path = graph.shortest_path("P_N0A", "P_N0B", "car")
    with caplog.at_level(logging.WARNING):
        z = graph.interpolate(path, 50, "car")[1]
    assert z == 0.0
    assert "edge too narrow for lane offset" in caplog.text


def test_points_stay_inside_a_rectangle_road_polygon():
    half = 3.5
    graph = make_graph([([[0, 0], [200, 0]], 7.0, 2)])
    for start, end in (("P_N0A", "P_N0B"), ("P_N0B", "P_N0A")):
        path = graph.shortest_path(start, end, "car")
        for index in range(100):
            x, z, _, _ = graph.interpolate(path, path.total_length * index / 99, "car")
            assert 0 <= x <= 200 and -half <= z <= half


def test_ninety_degree_corner_has_no_position_jump():
    graph = make_graph([([[0, 0], [50, 0], [50, 50]], 7.0, 2)])
    path = graph.shortest_path("P_N0A", "P_N0B", "car")
    previous = graph.interpolate(path, 0.0, "car")[:2]
    worst, distance = 0.0, 0.1
    while distance <= path.total_length:
        point = graph.interpolate(path, distance, "car")[:2]
        worst = max(worst, math.dist(previous, point))
        previous, distance = point, distance + 0.1
    assert worst < 0.5


def test_assumed_single_lane_on_a_wide_zone_keeps_a_default_half_lane():
    # a 16 m paved zone with an assumed lane count: keep right by half the estimated 3.00 m lane, not 7.3 m
    graph = make_graph([([[0, 0], [100, 0]], 16.0, 1)], lanes_source="assumed")
    path = graph.shortest_path("P_N0A", "P_N0B", "car")
    assert graph.interpolate(path, 50, "car")[1] == pytest.approx(-1.5, abs=0.01)


def test_generator_clearance_caps_the_offset():
    graph = make_graph([([[0, 0], [100, 0]], 7.0, 2)], cap=0.6)
    path = graph.shortest_path("P_N0A", "P_N0B", "car")
    assert graph.interpolate(path, 50, "car")[1] == pytest.approx(-0.6, abs=0.01)
