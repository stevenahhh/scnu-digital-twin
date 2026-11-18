from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from common.campus_auth import authenticate, issue_token
from simulation import main
from simulation.mobility_graph import MobilityGraph
from simulation.schemas import RestrictionRequest
from simulation.simulation_engine import SimulationEngine


ROAD = {"target_type": "road", "target_id": "RD_006", "cause": "construction"}
BUILDING = {"target_type": "building", "target_id": "BLD_D4", "cause": "event", "message": "행사 안내"}


def bearer(account_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_token(authenticate(account_id, '12341234'))['token']}"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SCNU_AUTH_SECRET", "simulation-restriction-test-secret")
    with TestClient(main.app, headers=bearer("admin")) as test_client:
        yield test_client
        for restriction in test_client.get("/api/simulation/restrictions").json()["restrictions"]:
            test_client.delete(f"/api/simulation/restrictions/{restriction['id']}")


def road_request(road_id: str, access: str = "vehicles") -> RestrictionRequest:
    return RestrictionRequest(target_type="road", target_id=road_id, cause="construction", access=access)


def engine_with(counts: dict[str, int], seed: int = 7) -> SimulationEngine:
    engine = SimulationEngine(seed=seed)
    engine.configure("normal", {"car": 0, "person": 0, "scooter": 0, **counts})
    return engine


def edges_of(engine: SimulationEngine, road_id: str, agent_type: str) -> set[str]:
    return {
        edge.edge_id for edge in engine.graph.edges.values()
        if road_id in edge.road_ids and agent_type in edge.allowed_types
    }


def road_on_route(engine: SimulationEngine, agent_type: str) -> str:
    entity = next(value for value in engine.entities.values() if value["type"] == agent_type)
    edges = (engine.graph.edges[edge_id] for edge_id in engine.paths[entity["id"]].edge_ids)
    return next(road for edge in edges for road in edge.road_ids if road.startswith("RD_"))


def reroute_one(engine: SimulationEngine, agent_type: str, access: str):
    for entity in (value for value in engine.entities.values() if value["type"] == agent_type):
        before = engine.paths[entity["id"]]
        for edge_id in reversed(before.edge_ids):
            for road_id in engine.graph.edges[edge_id].road_ids:
                if not road_id.startswith("RD_") or any(
                    item["target_id"] == road_id for item in engine.restrictions.list()
                ):
                    continue
                position = entity["x"], entity["z"], entity["route_distance"]
                restriction, rerouted = engine.add_restriction(road_request(road_id, access))
                if engine.paths[entity["id"]] is not before:
                    return entity, before, position, road_id, rerouted
                engine.remove_restriction(restriction["id"])
    pytest.fail(f"no {agent_type} could be rerouted")


def test_writes_need_an_admin_and_reads_are_public(client) -> None:
    anonymous = TestClient(main.app)

    assert anonymous.post("/api/simulation/restrictions", json=ROAD).status_code == 401
    assert client.post("/api/simulation/restrictions", json=ROAD, headers=bearer("20239901")).status_code == 403
    assert client.post("/api/simulation/restrictions", json=ROAD).status_code == 201
    assert anonymous.get("/api/simulation/restrictions").status_code == 200


def test_create_list_and_delete_follow_the_contract(client) -> None:
    road = client.post("/api/simulation/restrictions", json=ROAD)
    building = client.post("/api/simulation/restrictions", json=BUILDING)

    assert road.status_code == 201 and building.status_code == 201
    created = road.json()["restriction"]
    assert road.json()["rerouted"] >= 0
    assert created["id"].startswith("RST_") and created["created_at"].endswith("+00:00")
    assert created["access"] == "vehicles" and created["message"] == ""
    assert created["target_name"] != "" and created["affected_edges"] == len(created["segments"]) > 0
    assert all(len(point) == 2 for line in created["segments"] for point in line)
    alert = building.json()["restriction"]
    assert (alert["access"], alert["segments"], alert["affected_edges"]) == (None, [], 0)
    assert alert["target_name"] != "BLD_D4" and alert["message"] == "행사 안내"
    listed = client.get("/api/simulation/restrictions").json()["restrictions"]
    assert [item["id"] for item in listed] == [created["id"], alert["id"]]

    assert client.delete(f"/api/simulation/restrictions/{created['id']}").status_code == 204
    assert client.delete(f"/api/simulation/restrictions/{created['id']}").status_code == 404
    assert [item["id"] for item in client.get("/api/simulation/restrictions").json()["restrictions"]] == [alert["id"]]


@pytest.mark.parametrize(
    ("body", "status"),
    [
        ({**ROAD, "target_id": "RD_NONE"}, 404),
        ({**ROAD, "target_id": "BLD_D4"}, 404),
        ({**BUILDING, "target_id": "BLD_NONE"}, 404),
        ({**ROAD, "cause": "parade"}, 422),
        ({**ROAD, "access": "bicycles"}, 422),
        ({**ROAD, "target_type": "node"}, 422),
        ({**ROAD, "message": "가" * 201}, 422),
    ],
)
def test_invalid_requests_are_rejected(client, body, status) -> None:
    response = client.post("/api/simulation/restrictions", json=body)

    assert response.status_code == status
    if status == 404:
        assert any("\uac00" <= char <= "\ud7a3" for char in response.json()["detail"])


def test_restricting_the_same_target_twice_conflicts(client) -> None:
    assert client.post("/api/simulation/restrictions", json=ROAD).status_code == 201

    response = client.post("/api/simulation/restrictions", json={**ROAD, "cause": "event", "access": "all"})

    assert response.status_code == 409
    assert any("\uac00" <= char <= "\ud7a3" for char in response.json()["detail"])


def test_targets_list_routable_roads_and_every_building(client) -> None:
    targets = client.get("/api/simulation/restrictions/targets").json()
    graph_roads = {road for edge in main.provider.engine.graph.edges.values() for road in edge.road_ids}

    road_ids = [item["id"] for item in targets["roads"]]
    building_ids = [item["id"] for item in targets["buildings"]]
    assert road_ids == sorted(road_ids) and building_ids == sorted(building_ids)
    assert set(road_ids) == {road for road in graph_roads if road.startswith("RD_")}
    assert len(building_ids) == 49 and all(item["id"].startswith("BLD_") for item in targets["buildings"])


def test_routes_answer_501_without_the_internal_engine(client, monkeypatch) -> None:
    with monkeypatch.context() as patch:
        patch.setattr(main, "_engine", lambda: None)

        assert client.get("/api/simulation/restrictions").status_code == 501
        assert client.get("/api/simulation/restrictions/targets").status_code == 501
        assert client.post("/api/simulation/restrictions", json=ROAD).status_code == 501
        assert client.delete("/api/simulation/restrictions/RST_0001").status_code == 501


def test_graph_search_detours_around_a_blocked_edge_and_reports_no_route() -> None:
    nodes = {"A": (0, 0), "B": (20, 0), "C": (10, 30)}
    edges = [("DIRECT", "A", "B"), ("AC", "A", "C"), ("CB", "C", "B")]
    graph = MobilityGraph({
        "nodes": [{"id": key, "x": x, "z": z} for key, (x, z) in nodes.items()],
        "pois": [{"poi_id": f"P{key}", "node_id": key, "allowed_types": ["car"]} for key in nodes],
        "edges": [
            {"id": edge_id, "from": source, "to": target, "kind": "allowed_road", "allowed_types": ["car"],
             "coordinates": [list(nodes[source]), list(nodes[target])]}
            for edge_id, source, target in edges
        ],
    })

    assert graph.shortest_path("PA", "PB", "car").edge_ids == ("DIRECT",)
    assert graph.shortest_path("PA", "PB", "car", blocked_edges=frozenset({"DIRECT"})).edge_ids == ("AC", "CB")
    assert graph.find_route("A", "B", "car", blocked_edges=frozenset({"DIRECT", "CB"})) is None
    with pytest.raises(ValueError):
        graph.shortest_path("PA", "PB", "car", blocked_edges=frozenset({"DIRECT", "AC"}))


def test_new_trips_avoid_a_blocked_road() -> None:
    road_id = road_on_route(engine_with({"car": 1}), "car")
    engine = SimulationEngine(seed=7)
    engine.add_restriction(road_request(road_id))

    engine.configure("normal", {"car": 12, "person": 0, "scooter": 12})

    for entity_id, path in engine.paths.items():
        assert edges_of(engine, road_id, engine.entities[entity_id]["type"]).isdisjoint(path.edge_ids)


def test_moving_agent_reroutes_without_jumping_and_keeps_its_current_edge() -> None:
    engine = engine_with({"car": 8})

    entity, before, position, road_id, rerouted = reroute_one(engine, "car", "vehicles")

    after = engine.paths[entity["id"]]
    assert rerouted >= 1
    assert (entity["x"], entity["z"], entity["route_distance"]) == position
    assert entity["route_id"] == after.path_id and entity["route_progress"] <= 1.0
    ends = engine.graph.edge_end_distances(before)
    kept = next(index for index, end in enumerate(ends) if end >= position[2]) + 1
    assert after.edge_ids[:kept] == before.edge_ids[:kept]
    shared_points = after.points[:len(before.points)]
    cut = next(index for index, value in enumerate(before.cumulative_lengths) if value >= ends[kept - 1])
    assert shared_points[:cut + 1] == before.points[:cut + 1]
    assert edges_of(engine, road_id, "car").isdisjoint(after.edge_ids[kept:])


def test_rerouted_agents_move_continuously_on_the_next_step() -> None:
    engine = engine_with({"car": 30, "scooter": 30})
    engine.start()
    checked = 0

    for road_id in sorted(engine.restrictions.road_edges):
        before = dict(engine.paths)
        restriction, _ = engine.add_restriction(road_request(road_id))
        changed = [key for key, path in engine.paths.items() if path is not before[key]]
        engine.step(0.1)
        for key in changed:
            entity = engine.entities.get(key)
            if entity and entity["trip_status"] == "MOVING":
                moved = math.hypot(entity["x"] - entity["previous_x"], entity["z"] - entity["previous_z"])
                assert moved <= entity["speed"] * 0.1 + 0.2
                checked += 1
        engine.remove_restriction(restriction["id"])

    assert checked > 0


def test_removing_a_restriction_does_not_reroute_anyone() -> None:
    engine = engine_with({"car": 8})
    entity, *_ = reroute_one(engine, "car", "vehicles")
    path = engine.paths[entity["id"]]

    engine.remove_restriction(engine.restrictions.list()[0]["id"])

    assert engine.paths[entity["id"]] is path and engine.restrictions.list() == []


def test_vehicle_restriction_leaves_people_alone_and_all_blocks_them() -> None:
    baseline = engine_with({"person": 6})
    road_id = road_on_route(baseline, "person")
    vehicles_only = SimulationEngine(seed=7)
    vehicles_only.configure("normal", {"car": 0, "person": 0, "scooter": 0})
    closed = SimulationEngine(seed=7)
    closed.configure("normal", {"car": 0, "person": 0, "scooter": 0})
    vehicles_only.random.seed(11), baseline.random.seed(11), closed.random.seed(11)
    vehicles_only.add_restriction(road_request(road_id, "vehicles"))
    closed.add_restriction(road_request(road_id, "all"))

    for engine in (baseline, vehicles_only, closed):
        engine.configure("normal", {"car": 0, "person": 6, "scooter": 0})

    assert [path.edge_ids for path in vehicles_only.paths.values()] == [path.edge_ids for path in baseline.paths.values()]
    for path in closed.paths.values():
        assert edges_of(closed, road_id, "person").isdisjoint(path.edge_ids)


def test_all_access_reroutes_a_walking_agent() -> None:
    engine = engine_with({"person": 8})

    entity, _, _, road_id, _ = reroute_one(engine, "person", "all")

    path = engine.paths[entity["id"]]
    kept = next(index for index, end in enumerate(engine.graph.edge_end_distances(path)) if end >= entity["route_distance"]) + 1
    assert edges_of(engine, road_id, "person").isdisjoint(path.edge_ids[kept:])


def test_reset_keeps_restrictions_and_their_routing_effect() -> None:
    road_id = road_on_route(engine_with({"car": 1}), "car")
    engine = engine_with({"car": 4})
    restriction, _ = engine.add_restriction(road_request(road_id))

    engine.reset()
    engine.configure("normal", {"car": 8, "person": 0, "scooter": 0})

    assert engine.restrictions.list() == [restriction]
    for path in engine.paths.values():
        assert edges_of(engine, road_id, "car").isdisjoint(path.edge_ids)
