import json
import shutil
from pathlib import Path

from simulation.network_provenance import network_provenance
from simulation.simulation_engine import SimulationEngine

DATA = Path(__file__).resolve().parents[1] / "simulation" / "data"


def test_statistics_carry_network_provenance_with_non_negative_values():
    stats = SimulationEngine(seed=42).statistics()
    provenance = stats["network_provenance"]
    for key in ("sidewalk_measured_m", "shared_estimated_m", "road_measured_m", "perimeter_osm_m", "person_measured_share", "person_estimated_share"):
        assert provenance[key] >= 0, key
    assert 0 < provenance["crossing_connected"] <= provenance["crossing_count"] == 31
    assert provenance["person_measured_share"] + provenance["person_estimated_share"] <= 100.0
    # the existing statistics keys are still there (add-only)
    assert "network_runtime" in stats and "network_coverage" in stats


def test_separation_comes_from_the_committed_report(tmp_path):
    report = json.loads((DATA / "separation_report.json").read_text(encoding="utf-8"))
    separation = network_provenance(DATA)["separation"]
    assert separation["person_on_walkable"] == report["person_on_walkable"]
    assert separation["car_on_road"] == report["car_on_road"]
    assert separation["measured_only"]["person_on_walkable"] == report["measured_only"]["person_on_walkable"]
    assert separation["seed"] == report["seed"] and separation["seconds"] == report["seconds"]
    assert separation["generatedAt"]


def test_separation_is_null_without_a_report(tmp_path):
    for name in ("campus_transport_network.geojson", "walkable_polygons.geojson"):
        shutil.copyfile(DATA / name, tmp_path / name)
    provenance = network_provenance(tmp_path)
    assert provenance["separation"] is None
    assert provenance["crossing_count"] == 31
