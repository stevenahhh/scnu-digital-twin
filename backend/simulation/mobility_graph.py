from __future__ import annotations

import heapq
import hashlib
import logging
import math
from dataclasses import dataclass
from pathlib import Path
from typing import AbstractSet, Dict, Iterable, List, NamedTuple, Sequence, Tuple

try:
    from .data_loader import load_json
except ImportError:
    from data_loader import load_json


Point = Tuple[float, float]
LOGGER = logging.getLogger(__name__)

# Estimated values, not survey data: a default lane centre-to-centre width and half a car's width.
DEFAULT_LANE_WIDTH_M = 3.00
HALF_CAR_WIDTH_M = 0.9
CARRIAGEWAY_MIN_WIDTH_M = 5.5
SCOOTER_KERB_BIAS_M = 0.5
VERTEX_BLEND_M = 3.0
# route cost (m-equivalent) per metre of carriageway crossed without a crossing polygon: 1 km detour per 2 m
UNMARKED_CROSSING_COST_PER_M = 500.0


@dataclass(frozen=True)
class GraphEdge:
    edge_id: str
    source: str
    target: str
    kind: str
    allowed_types: Tuple[str, ...]
    speed_limit: float
    road_ids: Tuple[str, ...]
    points: Tuple[Point, ...]
    length: float
    # Old payloads carry no flags: treat their edges as derived single-lane geometry.
    derived: bool = True
    width_m: float | None = None
    lanes: int = 1
    estimated: bool = False
    # "walkway_estimated": the generator drew this estimated edge where people walk (off the carriageway), so the
    # development-only lateral offset for centreline copies does not apply.
    placed: str | None = None
    # largest keep-right offset (m) that keeps a car body on this edge's road polygon (generator, from the polygons)
    lane_offset_cap_m: float | None = None
    # metres of carriageway an estimated person edge crosses with no crossing polygon (generator); routed only when no
    # other connection exists
    crosses_carriageway_m: float = 0.0


@dataclass(frozen=True)
class GraphPath:
    path_id: str
    origin: str
    destination: str
    allowed_types: Tuple[str, ...]
    node_ids: Tuple[str, ...]
    edge_ids: Tuple[str, ...]
    segment_edge_ids: Tuple[str, ...]
    edge_kinds: Tuple[str, ...]
    road_ids: Tuple[str | None, ...]
    speed_limits: Tuple[float, ...]
    points: Tuple[Point, ...]
    segment_lengths: Tuple[float, ...]
    cumulative_lengths: Tuple[float, ...]
    total_length: float
    # Per segment, like edge_kinds; empty for paths built before these fields existed.
    edge_derived: Tuple[bool, ...] = ()
    edge_widths: Tuple[float | None, ...] = ()
    edge_lanes: Tuple[int, ...] = ()
    edge_offset_caps: Tuple[float | None, ...] = ()


class RouteStep(NamedTuple):
    source: str
    target: str
    edge: GraphEdge
    reverse: bool

    @property
    def points(self) -> Tuple[Point, ...]:
        return tuple(reversed(self.edge.points)) if self.reverse else self.edge.points


class MobilityGraph:
    """Small dependency-free directed graph with agent-type filtering."""

    def __init__(self, source: str | Path | Dict) -> None:
        payload = dict(source) if isinstance(source, dict) else load_json(source)
        self.metadata = dict(payload.get("metadata") or {})
        # route_cost_multipliers (mobility_policy.json): {agent: {kind | kind + "_estimated": factor}}
        self.cost_multipliers = dict(self.metadata.get("route_cost_multipliers") or {})
        self._narrow_logged: set = set()
        self.derived_lateral_offsets = dict(self.metadata.get("derived_lateral_offsets_m") or {
            "person": {"shared_path": 2.8, "sidewalk": 2.8},
            "scooter": {"shared_path": 1.4, "sidewalk": 1.4, "bike_lane": 1.4, "scooter_lane": 1.4, "allowed_road": -1.0},
        })
        self.nodes: Dict[str, Dict] = {str(node["id"]): dict(node) for node in payload["nodes"]}
        self.pois: Dict[str, Dict] = {str(poi["poi_id"]): dict(poi) for poi in payload["pois"]}
        self.edges: Dict[str, GraphEdge] = {}
        self.paths: Dict[str, GraphPath] = {}
        self.adjacency: Dict[str, List[Tuple[str, GraphEdge, bool]]] = {node_id: [] for node_id in self.nodes}
        for raw in payload["edges"]:
            points = tuple((float(value[0]), float(value[1])) for value in raw["coordinates"])
            length = sum(math.dist(points[index], points[index + 1]) for index in range(len(points) - 1))
            if length <= 1e-6:
                # A snapped POI can coincide with its graph node. Retain a
                # visible/routeable connector without creating a zero divisor.
                source_node, target_node = self.nodes[raw["from"]], self.nodes[raw["to"]]
                points = ((float(source_node["x"]), float(source_node["z"])), (float(target_node["x"]) + 0.01, float(target_node["z"])))
                length = 0.01
            edge = GraphEdge(
                edge_id=str(raw["id"]), source=str(raw["from"]), target=str(raw["to"]), kind=str(raw["kind"]),
                allowed_types=tuple(raw["allowed_types"]), speed_limit=float(raw.get("speed_limit", 10)) / 3.6,
                road_ids=tuple(str(value) for value in raw.get("road_ids") or ()), points=points, length=length,
                derived=bool(raw.get("derived", True)),
                width_m=float(raw["width_m"]) if raw.get("width_m") is not None else None,
                # 0 = lane count unknown (the generator assumed 1 lane): lane width falls back to the estimated default
                lanes=0 if raw.get("lanes_source") == "assumed" else int(raw.get("lanes") or 1),
                estimated=bool(raw.get("estimated", False)),
                placed=raw.get("placed"),
                lane_offset_cap_m=float(raw["lane_offset_cap_m"]) if raw.get("lane_offset_cap_m") is not None else None,
                crosses_carriageway_m=float(raw.get("crosses_carriageway_m") or 0.0),
            )
            self.edges[edge.edge_id] = edge
            self.adjacency[edge.source].append((edge.target, edge, False))
            if raw.get("bidirectional", False):
                self.adjacency[edge.target].append((edge.source, edge, True))

    def poi(self, poi_id: str) -> Dict:
        try:
            return self.pois[poi_id]
        except KeyError as exc:
            raise KeyError(f"알 수 없는 POI입니다: {poi_id}") from exc

    def pois_for(self, agent_type: str) -> List[Dict]:
        return [poi for poi in self.pois.values() if agent_type in poi.get("allowed_types", ())]

    def get(self, path_id: str) -> GraphPath:
        try:
            return self.paths[path_id]
        except KeyError as exc:
            raise KeyError(f"알 수 없는 Trip 경로입니다: {path_id}") from exc

    @staticmethod
    def _kind_cost(agent_type: str, kind: str) -> float:
        preferences = {
            "car": {"vehicle_lane": 0.9, "allowed_road": 1.0, "vehicle_gate": 1.0, "parking_connection": 1.0},
            "person": {"sidewalk": 0.85, "shared_path": 0.95, "crosswalk": 1.05, "pedestrian_gate": 1.0, "building_entrance": 1.0, "parking_walk": 1.0},
            "scooter": {"scooter_lane": 0.8, "bike_lane": 0.85, "shared_path": 0.92, "allowed_road": 1.18, "crosswalk": 1.1, "building_entrance": 1.15},
        }
        return preferences.get(agent_type, {}).get(kind, 1.0)

    def _policy_multiplier(self, agent_type: str, edge: GraphEdge) -> float:
        table = self.cost_multipliers.get(agent_type) or {}
        if edge.estimated and f"{edge.kind}_estimated" in table:
            return float(table[f"{edge.kind}_estimated"])
        return float(table.get(edge.kind, 1.0))

    def anchor_node(self, poi_id: str, agent_type: str) -> str:
        # a POI shared by cars and people has a vehicle anchor on the road/lot surface (vehicle_node_id)
        key = "vehicle_node_id" if agent_type == "car" else "node_id"
        return str(self.poi(poi_id).get(key) or self.poi(poi_id)["node_id"])

    def find_route(
        self,
        origin_node: str,
        destination_node: str,
        agent_type: str,
        edge_cost_factors: Dict[str, float] | None = None,
        blocked_edges: AbstractSet[str] = frozenset(),
    ) -> List[RouteStep] | None:
        """Cheapest node-to-node steps avoiding blocked_edges, or None when no such route exists."""
        queue: List[Tuple[float, str]] = [(0.0, origin_node)]
        distance = {origin_node: 0.0}
        previous: Dict[str, Tuple[str, GraphEdge, bool]] = {}
        while queue:
            cost, node_id = heapq.heappop(queue)
            if cost != distance.get(node_id):
                continue
            if node_id == destination_node:
                break
            for neighbor, edge, reverse in self.adjacency.get(node_id, ()):
                if agent_type not in edge.allowed_types or edge.edge_id in blocked_edges:
                    continue
                factor = max(0.1, float((edge_cost_factors or {}).get(edge.edge_id, 1.0)))
                candidate = cost + edge.length * self._kind_cost(agent_type, edge.kind) * self._policy_multiplier(agent_type, edge) * factor
                if agent_type == "person" and edge.crosses_carriageway_m:
                    candidate += UNMARKED_CROSSING_COST_PER_M * edge.crosses_carriageway_m
                if candidate < distance.get(neighbor, math.inf):
                    distance[neighbor] = candidate
                    previous[neighbor] = (node_id, edge, reverse)
                    heapq.heappush(queue, (candidate, neighbor))
        if destination_node not in distance:
            return None
        steps: List[RouteStep] = []
        current = destination_node
        while current != origin_node:
            prior, edge, reverse = previous[current]
            steps.append(RouteStep(prior, current, edge, reverse))
            current = prior
        steps.reverse()
        return steps

    def shortest_path(
        self,
        origin: str,
        destination: str,
        agent_type: str,
        edge_cost_factors: Dict[str, float] | None = None,
        blocked_edges: AbstractSet[str] = frozenset(),
    ) -> GraphPath:
        origin_node = self.anchor_node(origin, agent_type)
        steps = self.find_route(origin_node, self.anchor_node(destination, agent_type), agent_type, edge_cost_factors, blocked_edges)
        if steps is None:
            raise ValueError(f"{agent_type} 경로를 찾을 수 없습니다: {origin} → {destination}")
        return self.build_path((origin, destination), agent_type, origin_node, steps)

    def path_steps(self, path: GraphPath) -> List[RouteStep]:
        steps = []
        for index, edge_id in enumerate(path.edge_ids):
            source, target = path.node_ids[index], path.node_ids[index + 1]
            edge = self.edges[edge_id]
            steps.append(RouteStep(source, target, edge, edge.source != source))
        return steps

    def edge_end_distances(self, path: GraphPath) -> List[float]:
        """Route distance at the end of each edge of path, following build_path's point merging."""
        ends: List[float] = []
        count = 0
        last: Point | None = None
        for step in self.path_steps(path):
            oriented = step.points
            count += len(oriented) - (1 if last is not None and math.dist(last, oriented[0]) <= 1e-6 else 0)
            last = oriented[-1]
            ends.append(path.cumulative_lengths[count - 1])
        return ends

    def build_path(self, od: Tuple[str, str], agent_type: str, origin_node: str, steps: Sequence[RouteStep]) -> GraphPath:
        origin, destination = od
        points: List[Point] = []
        node_ids = [origin_node]
        edge_ids: List[str] = []
        for step in steps:
            oriented = step.points
            if points and math.dist(points[-1], oriented[0]) <= 1e-6:
                oriented = oriented[1:]
            points.extend(oriented)
            node_ids.append(step.target)
            edge_ids.append(step.edge.edge_id)
        if len(points) < 2:
            point = (float(self.nodes[origin_node]["x"]), float(self.nodes[origin_node]["z"]))
            points = [point, (point[0] + 0.01, point[1])]
        segment_lengths = tuple(math.dist(points[index], points[index + 1]) for index in range(len(points) - 1))
        cumulative = [0.0]
        for length in segment_lengths:
            cumulative.append(cumulative[-1] + length)

        # Segment metadata follows edges, while edge geometries currently have
        # one segment. Normalize defensively for authored multi-point edges.
        segment_edge_ids, segment_kinds, segment_roads, segment_speeds = [], [], [], []
        segment_derived, segment_widths, segment_lanes, segment_caps = [], [], [], []
        for _, _, edge, _ in steps:
            count = max(1, len(edge.points) - 1)
            segment_edge_ids.extend([edge.edge_id] * count)
            segment_kinds.extend([edge.kind] * count)
            segment_roads.extend([edge.road_ids[0] if edge.road_ids else None] * count)
            segment_speeds.extend([edge.speed_limit] * count)
            segment_derived.extend([edge.derived and not edge.placed] * count)
            segment_widths.extend([edge.width_m] * count)
            segment_lanes.extend([edge.lanes] * count)
            segment_caps.extend([edge.lane_offset_cap_m] * count)
        signature = hashlib.sha1("|".join(segment_edge_ids).encode("utf-8")).hexdigest()[:8]
        path = GraphPath(
            path_id=f"TRIP_ROUTE_{agent_type}_{origin}_TO_{destination}_{signature}", origin=origin, destination=destination,
            allowed_types=(agent_type,),
            node_ids=tuple(node_ids), edge_ids=tuple(edge_ids), segment_edge_ids=tuple(segment_edge_ids), edge_kinds=tuple(segment_kinds),
            road_ids=tuple(segment_roads), speed_limits=tuple(segment_speeds), points=tuple(points),
            segment_lengths=segment_lengths, cumulative_lengths=tuple(cumulative), total_length=cumulative[-1],
            edge_derived=tuple(segment_derived), edge_widths=tuple(segment_widths), edge_lanes=tuple(segment_lanes), edge_offset_caps=tuple(segment_caps),
        )
        self.paths[path.path_id] = path
        return path

    def lateral_offset(
        self,
        agent_type: str | None,
        edge_kind: str | None,
        derived: bool = True,
        width_m: float | None = None,
        lanes: int = 1,
        cap: float | None = None,
    ) -> float:
        """Lateral offset from the edge line, positive to the left of travel.

        Derived edges (copies of a vehicle centreline) keep the development-only policy offset. A non-derived edge is
        drawn where its feature is, so it gets no offset, except a car on a road of two or more lanes, which keeps to
        the right-hand half: -(width_m or 6.0) / 4. interpolate() adds the offset along the normal (-dz, dx), which
        points to the LEFT of the travel direction (dx, dz) in this x=east, z=north frame, so negative is right.
        """
        if edge_kind in {"crosswalk", "building_entrance", "parking_connection", "parking_walk", "scooter_parking_connection", "pedestrian_gate", "vehicle_gate"}:
            return 0.0
        if derived:
            return float(self.derived_lateral_offsets.get(str(agent_type), {}).get(str(edge_kind), 0.0))
        if agent_type == "car" or (agent_type == "scooter" and edge_kind == "allowed_road"):
            return self._lane_offset(agent_type, width_m, lanes, cap)
        return 0.0

    def _lane_offset(self, agent_type: str, width_m: float | None, lanes: int, cap: float | None = None) -> float:
        """Keep-right half-lane offset (negative), clamped so the agent stays inside the carriageway.

        Lane width is width_m / lanes (estimated 3.00 m when width_m is absent or the lane count is unknown, lanes 0:
        a wide paved zone with an assumed single lane is a two-way road, not one 16 m lane); the magnitude is capped
        at width_m / 2 - 0.9 (half a car width, estimated). A scooter adds 0.5 m toward the kerb under the same cap.
        """
        known = int(lanes) > 0
        lanes = max(1, int(lanes))
        if not (lanes >= 2 or (width_m is not None and width_m >= CARRIAGEWAY_MIN_WIDTH_M)):
            return 0.0
        lane_width = width_m / lanes if width_m and known else DEFAULT_LANE_WIDTH_M
        carriageway = width_m if width_m else lane_width * lanes
        limit = carriageway / 2 - HALF_CAR_WIDTH_M
        if limit <= 0:
            key = (carriageway, lanes)
            if key not in self._narrow_logged:
                self._narrow_logged.add(key)
                LOGGER.warning("edge too narrow for lane offset: width_m=%.2f lanes=%d", carriageway, lanes)
            return 0.0
        magnitude = lane_width / 2 + (SCOOTER_KERB_BIAS_M if agent_type == "scooter" else 0.0)
        # cap: the generator's measured clearance from this centreline to the road polygon edge (minus half a car)
        return -min(magnitude, limit, cap if cap is not None else math.inf)

    @staticmethod
    def _segment_flags(path: GraphPath, segment: int) -> Tuple[bool, float | None, int, float | None]:
        derived = path.edge_derived[segment] if segment < len(path.edge_derived) else True
        width = path.edge_widths[segment] if segment < len(path.edge_widths) else None
        lanes = path.edge_lanes[segment] if segment < len(path.edge_lanes) else 1
        cap = path.edge_offset_caps[segment] if segment < len(path.edge_offset_caps) else None
        return derived, width, lanes, cap

    def interpolate(self, path: GraphPath, distance: float, agent_type: str | None = None) -> Tuple[float, float, float, int]:
        value = min(max(0.0, float(distance)), path.total_length)
        segment = len(path.segment_lengths) - 1
        for index, end in enumerate(path.cumulative_lengths[1:]):
            if value <= end:
                segment = index
                break
        length = max(path.segment_lengths[segment], 1e-9)
        ratio = (value - path.cumulative_lengths[segment]) / length
        first, second = path.points[segment], path.points[segment + 1]
        x = first[0] + (second[0] - first[0]) * ratio
        z = first[1] + (second[1] - first[1]) * ratio
        kind = path.edge_kinds[segment] if segment < len(path.edge_kinds) else None
        offset = self.lateral_offset(agent_type, kind, *self._segment_flags(path, segment))
        if offset:
            has_previous = segment > 0 and segment - 1 < len(path.edge_kinds)
            has_next = segment + 1 < len(path.edge_kinds)
            previous_kind = path.edge_kinds[segment - 1] if has_previous else kind
            next_kind = path.edge_kinds[segment + 1] if has_next else kind
            previous_flags = self._segment_flags(path, segment - 1 if has_previous else segment)
            next_flags = self._segment_flags(path, segment + 1 if has_next else segment)
            start_offset = 0.0 if self.lateral_offset(agent_type, previous_kind, *previous_flags) == 0.0 else offset
            end_offset = 0.0 if self.lateral_offset(agent_type, next_kind, *next_flags) == 0.0 else offset
            smooth_offset = (
                offset * math.sin(math.pi * ratio)
                if start_offset == 0.0 and end_offset == 0.0
                else start_offset + (end_offset - start_offset) * ratio
            )
            dx, dz = second[0] - first[0], second[1] - first[1]
            segment_length = max(math.hypot(dx, dz), 1e-9)
            vx, vz = (-dz / segment_length) * smooth_offset, (dx / segment_length) * smooth_offset
            if not self._segment_flags(path, segment)[0]:
                # Blend the offset normal with the neighbouring segment's over VERTEX_BLEND_M either side of a
                # vertex (weight 0.5 at the vertex) so a corner does not make the position jump.
                for neighbour, weight_distance in ((segment - 1, value - path.cumulative_lengths[segment]),
                                                   (segment + 1, path.cumulative_lengths[segment + 1] - value)):
                    if not 0 <= neighbour < len(path.segment_lengths) or neighbour >= len(path.edge_kinds):
                        continue
                    flags = self._segment_flags(path, neighbour)
                    other = self.lateral_offset(agent_type, path.edge_kinds[neighbour], *flags)
                    if flags[0] or other == 0.0:
                        continue
                    weight = 0.5 * max(0.0, 1.0 - weight_distance / VERTEX_BLEND_M)
                    a, b = path.points[neighbour], path.points[neighbour + 1]
                    ndx, ndz = b[0] - a[0], b[1] - a[1]
                    nlen = max(math.hypot(ndx, ndz), 1e-9)
                    vx += weight * ((-ndz / nlen) * other - vx)
                    vz += weight * ((ndx / nlen) * other - vz)
            x += vx
            z += vz
        heading = (math.degrees(math.atan2(second[0] - first[0], second[1] - first[1])) + 360) % 360
        return x, z, heading, segment

    def predict_trajectory(
        self,
        path: GraphPath,
        route_distance: float,
        speed: float,
        horizon: float,
        step: float,
        agent_type: str,
    ) -> List[Dict[str, float]]:
        samples: List[Dict[str, float]] = []
        value = 0.0
        step = max(0.05, float(step))
        while value <= max(0.0, float(horizon)) + 1e-9:
            x, z, heading, _ = self.interpolate(path, route_distance + max(0.0, speed) * value, agent_type)
            samples.append({"time": round(value, 3), "x": x, "z": z, "heading": heading})
            value += step
        return samples

    @staticmethod
    def turn_angle(path: GraphPath, segment: int) -> float:
        if segment + 2 >= len(path.points):
            return 0.0
        first, second, third = path.points[segment], path.points[segment + 1], path.points[segment + 2]
        heading_a = math.atan2(second[0] - first[0], second[1] - first[1])
        heading_b = math.atan2(third[0] - second[0], third[1] - second[1])
        return abs((math.degrees(heading_b - heading_a) + 180) % 360 - 180)
