from __future__ import annotations

import bisect
import hashlib
import math
import random
from collections import Counter
from typing import AbstractSet, Callable, Dict, List, Mapping, Tuple

try:
    from .mobility_graph import GraphPath, MobilityGraph
    from .od_manager import ODManager
except ImportError:
    from mobility_graph import GraphPath, MobilityGraph
    from od_manager import ODManager


BASE_SPEEDS = {"car": (4.0, 7.5), "person": (0.9, 1.7), "scooter": (2.5, 5.5)}
BLOCKED_OD_ATTEMPTS = 8
REROUTE_OTHER_POIS = 4


def edge_uniform(trip_key: bytes, edge_id: str, low: float, high: float) -> float:
    """Uniform in [low, high) from (trip key, edge id) alone: independent of how many other edges the graph has."""
    digest = hashlib.blake2b(str(edge_id).encode("utf-8"), digest_size=8, key=trip_key).digest()
    return low + (high - low) * (int.from_bytes(digest, "little") / 2.0**64)


class TripManager:
    def __init__(self, graph: MobilityGraph, od: ODManager, random_source: random.Random, blocked_edges: Mapping[str, AbstractSet[str]]) -> None:
        self.graph = graph
        self.od = od
        self.random = random_source
        self.blocked_edges = blocked_edges
        self.counter = 0
        self.edge_usage = Counter()

    def create_path(self, agent_type: str, origin: str, destination: str, blocked_edges: AbstractSet[str] = frozenset()) -> GraphPath:
        diversity = self.od.route_diversity
        low, high = diversity.get("random_cost_range", [1.0, 1.0])
        per_trip = float(diversity.get("usage_penalty_per_trip", 0.0))
        maximum = float(diversity.get("maximum_usage_penalty", 0.0))
        # One draw from the main stream per trip keys every per-edge cost factor (a hash of the trip key and the edge id),
        # so adding or removing an edge elsewhere changes only that edge's factor, not every later trip, spawn or OD draw.
        trip_key = self.random.getrandbits(64).to_bytes(8, "little")
        factors = {
            edge_id: edge_uniform(trip_key, edge_id, float(low), float(high)) + min(maximum, self.edge_usage[edge_id] * per_trip)
            for edge_id in self.graph.edges
        }
        path = self.graph.shortest_path(origin, destination, agent_type, factors, blocked_edges)
        self.edge_usage.update(set(path.edge_ids))
        return path

    def _plan_path(self, agent_type: str, od_pick: Tuple[str, str], pick_again: Callable[[], Tuple[str, str]]) -> GraphPath:
        blocked = self.blocked_edges[agent_type]
        if blocked:
            pick = od_pick
            for _ in range(BLOCKED_OD_ATTEMPTS):
                try:
                    return self.create_path(agent_type, *pick, blocked)
                except ValueError:
                    pick = pick_again()
        # No open route: an agent shut inside a closed area may still drive out.
        return self.create_path(agent_type, *od_pick)

    def _reroute_destinations(self, agent_type: str, destination: str) -> List[str]:
        anchor = self.graph.nodes[self.graph.poi(destination)["node_id"]]
        def separation(poi: Dict) -> float:
            node = self.graph.nodes[poi["node_id"]]
            return math.hypot(float(node["x"]) - float(anchor["x"]), float(node["z"]) - float(anchor["z"]))
        others = sorted(
            (poi for poi in self.od.trip_pois(agent_type) if poi["poi_id"] != destination),
            key=lambda poi: (separation(poi), poi["poi_id"]),
        )
        return [destination, *(str(poi["poi_id"]) for poi in others[:REROUTE_OTHER_POIS])]

    def reroute(self, entity: Dict, path: GraphPath) -> GraphPath | None:
        """New path keeping everything through the current edge, or None when no change is needed or possible."""
        agent_type = entity["type"]
        blocked = self.blocked_edges[agent_type]
        steps = self.graph.path_steps(path)
        kept = bisect.bisect_left(self.graph.edge_end_distances(path), float(entity["route_distance"])) + 1
        if blocked.isdisjoint(path.edge_ids[kept:]):
            return None
        junction = steps[kept - 1].target
        for destination in self._reroute_destinations(agent_type, str(entity["destination"])):
            tail = self.graph.find_route(junction, self.graph.anchor_node(destination, agent_type), agent_type, blocked_edges=blocked)
            if tail is None:
                continue
            rerouted = self.graph.build_path((path.origin, destination), agent_type, path.node_ids[0], [*steps[:kept], *tail])
            entity.update({
                "destination": destination, "destination_external": bool(self.graph.poi(destination).get("external")),
                "current_route": rerouted.path_id, "route_id": rerouted.path_id,
                "route_progress": float(entity["route_distance"]) / max(rerouted.total_length, 1e-9),
            })
            return rerouted
        return None

    def assign(self, entity: Dict, simulation_time: float, scenario_name: str, origin: str | None = None, destination: str | None = None) -> GraphPath:
        fixed_origin = origin
        if origin is None or destination is None:
            origin, destination = self.od.choose(entity["type"], simulation_time, scenario_name, origin)
        path = self._plan_path(
            entity["type"], (origin, destination),
            lambda: self.od.choose(entity["type"], simulation_time, scenario_name, fixed_origin),
        )
        origin, destination = path.origin, path.destination
        self.counter += 1
        self.graph.poi(origin)
        destination_poi = self.graph.poi(destination)
        self.random.random()  # stable seeded variation between trips
        entity.update({
            "trip_id": f"trip_{self.counter:06d}", "origin": origin, "destination": destination,
            "current_route": path.path_id, "route_id": path.path_id, "current_segment": 0,
            "route_distance": 0.0, "route_progress": 0.0, "trip_status": "MOVING", "state": "MOVING",
            "spawn_time": entity.get("spawn_time", simulation_time), "trip_start_time": simulation_time,
            "arrival_time": None, "dwell_time": 0.0, "dwell_remaining": 0.0,
            "destination_external": bool(destination_poi.get("external")), "active": True, "visible": True,
        })
        x, z, heading, segment = self.graph.interpolate(path, 0.0, entity["type"])
        entity.update({"x": x, "z": z, "previous_x": x, "previous_z": z, "heading": heading, "current_segment": segment})
        return path

    def desired_speed(self, agent_type: str, path: GraphPath, scenario: Dict) -> float:
        low, high = BASE_SPEEDS[agent_type]
        value = self.random.uniform(low, high) * float(scenario.get("speed_multiplier", 1.0))
        if agent_type == "scooter":
            value *= float(scenario.get("scooter_speed_multiplier", 1.0))
        return min(value, max(path.speed_limits or (value,)))

    def arrive(self, entity: Dict, simulation_time: float) -> str:
        entity["arrival_time"] = simulation_time
        entity["trip_status"] = "ARRIVED_EXTERNAL" if entity.get("destination_external") else "ARRIVED"
        entity["state"] = entity["trip_status"]
        entity["speed"] = 0.0
        if entity.get("destination_external"):
            entity["active"] = False
            entity["visible"] = False
            entity["trip_status"] = "DESPAWNED"
            entity["state"] = "DESPAWNED"
            return "despawn"
        dwell = self.od.dwell_time(entity["destination"], entity["type"])
        entity["dwell_time"] = dwell
        entity["dwell_remaining"] = dwell
        entity["trip_status"] = "DWELLING"
        entity["state"] = "DWELLING"
        entity["visible"] = False
        return "dwell"

    def next_trip(self, entity: Dict, simulation_time: float, scenario_name: str) -> GraphPath:
        current = str(entity["destination"])
        origin, destination = self.od.choose(entity["type"], simulation_time, scenario_name, current)
        if entity["type"] != "car" and destination == entity.get("origin"):
            allowed_kinds = {"building", "external", "parking"} if entity["type"] == "person" else {"building", "external", "scooter_parking"}
            alternatives = [
                poi["poi_id"] for poi in self.graph.pois_for(entity["type"])
                if poi["poi_id"] not in {current, entity.get("origin")} and poi.get("kind") in allowed_kinds
            ]
            if alternatives:
                destination = self.random.choice(alternatives)
        entity["trip_status"] = "NEXT_TRIP"
        return self.assign(entity, simulation_time, scenario_name, origin, destination)
