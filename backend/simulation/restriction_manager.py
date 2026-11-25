from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, FrozenSet, List, Literal, Optional, Tuple, TypedDict, assert_never

try:
    from .data_loader import load_json
    from .mobility_graph import GraphEdge, MobilityGraph, Point
    from .schemas import RestrictionRequest
except ImportError:
    from data_loader import load_json
    from mobility_graph import GraphEdge, MobilityGraph, Point
    from schemas import RestrictionRequest


COMMON_ELEMENTS = Path(__file__).resolve().parents[2] / "common" / "data" / "common_elemetns.json"
ACCESS_TYPES: Dict[str, Tuple[str, ...]] = {"vehicles": ("car", "scooter"), "all": ("car", "person", "scooter")}


class Restriction(TypedDict):
    id: str
    target_type: Literal["road", "building"]
    target_id: str
    target_name: str
    cause: str
    access: Optional[str]
    message: str
    created_at: str
    segments: List[List[Point]]
    affected_edges: int


class RestrictionNotFound(LookupError):
    pass


class RestrictionConflict(ValueError):
    pass


class RestrictionManager:
    def __init__(self, graph: MobilityGraph, elements_path: Path = COMMON_ELEMENTS) -> None:
        elements = load_json(elements_path)["elements"]
        self.names = {str(item["element_id"]): str(item.get("name") or item["element_id"]) for item in elements}
        self.buildings = sorted(key for key in self.names if key.startswith("BLD_"))
        self.road_edges: Dict[str, List[GraphEdge]] = defaultdict(list)
        for edge in graph.edges.values():
            for road_id in edge.road_ids:
                if road_id.startswith("RD_"):
                    self.road_edges[road_id].append(edge)
        # TripManager reads this mapping, so it is updated in place.
        self.blocked: Dict[str, FrozenSet[str]] = {agent_type: frozenset() for agent_type in ACCESS_TYPES["all"]}
        self._restrictions: Dict[str, Restriction] = {}
        self._counter = 0

    def list(self) -> List[Restriction]:
        return list(self._restrictions.values())

    def targets(self) -> Dict[str, List[Dict[str, str]]]:
        return {
            "roads": [self._target(road_id) for road_id in sorted(self.road_edges)],
            "buildings": [self._target(building_id) for building_id in self.buildings],
        }

    def add(self, request: RestrictionRequest) -> Restriction:
        access: Optional[str]
        match request.target_type:
            case "road":
                known = request.target_id in self.road_edges
                access = request.access or "vehicles"
                edges = self._closed_edges(request.target_id, access) if known else []
            case "building":
                known = request.target_id in self.buildings
                access, edges = None, []
            case unreachable:
                assert_never(unreachable)
        if not known:
            raise RestrictionNotFound(f"통제 대상을 찾을 수 없습니다: {request.target_id}")
        if any(item["target_id"] == request.target_id for item in self._restrictions.values()):
            raise RestrictionConflict(f"이미 통제 중인 대상입니다: {request.target_id}")
        self._counter += 1
        restriction: Restriction = {
            "id": f"RST_{self._counter:04d}",
            "target_type": request.target_type,
            "target_id": request.target_id,
            "target_name": self.names.get(request.target_id, request.target_id),
            "cause": request.cause,
            "access": access,
            "message": request.message,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "segments": [list(edge.points) for edge in edges],
            "affected_edges": len(edges),
        }
        self._restrictions[restriction["id"]] = restriction
        self._refresh_blocked()
        return restriction

    def remove(self, restriction_id: str) -> None:
        if self._restrictions.pop(restriction_id, None) is None:
            raise RestrictionNotFound(f"통제 항목을 찾을 수 없습니다: {restriction_id}")
        self._refresh_blocked()

    def _target(self, target_id: str) -> Dict[str, str]:
        return {"id": target_id, "name": self.names.get(target_id, target_id)}

    def _closed_edges(self, road_id: str, access: str) -> List[GraphEdge]:
        return [edge for edge in self.road_edges[road_id] if set(ACCESS_TYPES[access]) & set(edge.allowed_types)]

    def _refresh_blocked(self) -> None:
        blocked: Dict[str, set] = {agent_type: set() for agent_type in self.blocked}
        for restriction in self._restrictions.values():
            access = restriction["access"]
            if access is None:
                continue
            for edge in self._closed_edges(restriction["target_id"], access):
                for agent_type in set(ACCESS_TYPES[access]) & set(edge.allowed_types):
                    blocked[agent_type].add(edge.edge_id)
        self.blocked.update({agent_type: frozenset(edges) for agent_type, edges in blocked.items()})
