import pytest

from simulation.mobility_graph import MobilityGraph


def graph(edges, pois, nodes):
    return MobilityGraph({
        "metadata": {"derived_lateral_offsets_m": {"person": {"shared_path": 2.8}}},
        "nodes": [{"id": node_id, "x": x, "z": z} for node_id, (x, z) in nodes.items()],
        "pois": pois,
        "edges": edges,
    })


def edge(edge_id, source, target, coordinates, kind="shared_path", allowed=("person",), **extra):
    return {"id": edge_id, "from": source, "to": target, "kind": kind, "allowed_types": list(allowed), "coordinates": coordinates, "bidirectional": True, **extra}


NODES = {"A": (0, 0), "B": (20, 0), "C": (10, 30)}


def test_estimated_edge_drawn_where_people_walk_gets_no_centreline_offset():
    copy = graph([edge("E", "A", "B", [[0, 0], [20, 0]], derived=True)], [{"poi_id": "PA", "node_id": "A", "allowed_types": ["person"]}, {"poi_id": "PB", "node_id": "B", "allowed_types": ["person"]}], NODES)
    placed = graph([edge("E", "A", "B", [[0, 0], [20, 0]], derived=True, placed="walkway_estimated")], [{"poi_id": "PA", "node_id": "A", "allowed_types": ["person"]}, {"poi_id": "PB", "node_id": "B", "allowed_types": ["person"]}], NODES)
    assert abs(copy.interpolate(copy.shortest_path("PA", "PB", "person"), 10, "person")[1]) == pytest.approx(2.8)
    assert placed.interpolate(placed.shortest_path("PA", "PB", "person"), 10, "person")[1] == pytest.approx(0.0)


def test_people_avoid_an_unmarked_carriageway_crossing_when_a_detour_exists():
    pois = [{"poi_id": "PA", "node_id": "A", "allowed_types": ["person"]}, {"poi_id": "PB", "node_id": "B", "allowed_types": ["person"]}]
    edges = [
        edge("DIRECT", "A", "B", [[0, 0], [20, 0]], crosses_carriageway_m=8.0),
        edge("AC", "A", "C", [[0, 0], [10, 30]]),
        edge("CB", "C", "B", [[10, 30], [20, 0]]),
    ]
    assert graph(edges, pois, NODES).shortest_path("PA", "PB", "person").edge_ids == ("AC", "CB")
    # no detour: the crossing edge stays usable (the POIs keep their connection)
    assert graph(edges[:1], pois, NODES).shortest_path("PA", "PB", "person").edge_ids == ("DIRECT",)


def test_cars_use_the_vehicle_anchor_of_a_shared_poi():
    nodes = {"P": (0, 0), "V": (0, -5), "R": (30, -5)}
    pois = [
        {"poi_id": "LOT", "node_id": "P", "vehicle_node_id": "V", "allowed_types": ["person", "car"]},
        {"poi_id": "GATE", "node_id": "R", "allowed_types": ["car"]},
    ]
    edges = [edge("ROAD", "V", "R", [[0, -5], [30, -5]], kind="allowed_road", allowed=("car",), derived=False)]
    path = graph(edges, pois, nodes).shortest_path("LOT", "GATE", "car")
    assert path.node_ids == ("V", "R")


def test_person_on_an_estimated_crossing_is_crossing_so_cars_yield():
    from simulation.polygon_index import PolygonIndex
    from simulation.simulation_engine import SimulationEngine

    g = graph([edge("E", "A", "B", [[0, 0], [20, 0]], derived=True, placed="walkway_estimated")], [{"poi_id": "PA", "node_id": "A", "allowed_types": ["person"]}, {"poi_id": "PB", "node_id": "B", "allowed_types": ["person"]}], NODES)
    path = g.shortest_path("PA", "PB", "person")
    engine = SimulationEngine.__new__(SimulationEngine)
    engine.graph, engine.risk_zone_ids = g, set()
    engine.surface_index = PolygonIndex([{"rings": [[[8, -2], [12, -2], [12, 2], [8, 2], [8, -2]]], "class": "crossing_estimated"}])
    person = {"type": "person", "x": 10.0, "z": 0.0, "previous_x": 10.0, "previous_z": 0.0, "speed": 1.2, "jaywalking": False, "origin": "PA", "destination": "PB", "route_progress": 0.5}
    engine._update_spatial_state(person, path, 0)
    assert person["surface_class"] == "crossing_estimated"
    assert person["in_crosswalk"] is True and person["pedestrian_state"] == "CROSSING"
    elsewhere = {**person, "x": 2.0}
    engine._update_spatial_state(elsewhere, path, 0)
    assert elsewhere["in_crosswalk"] is False
