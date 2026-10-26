from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path
from xml.etree.ElementTree import Element, ElementTree, SubElement

from simulation.network_schema import iter_features, load_feature_collection


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SUMO = ROOT / "sumo"
PROJ_EPSG5186 = "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs"
PEDESTRIAN_KINDS = {"sidewalk", "crosswalk", "shared_path", "pedestrian_gate", "building_entrance", "parking_walk"}


def write_xml(root: Element, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def _anchor(transform: dict) -> tuple[float, float]:
    anchor = transform.get("epsg5186_anchor")
    if not anchor or "E" not in anchor or "N" not in anchor:
        raise KeyError("coordinate_transform.json에 epsg5186_anchor(E, N)가 없습니다. 상대 좌표로 SUMO 파일을 쓰지 않습니다.")
    return float(anchor["E"]), float(anchor["N"])


def _local_to_grid(transform: dict) -> tuple[float, float, float, float]:
    matrix = transform.get("epsg5186_local_to_grid")
    if not matrix or len(matrix) != 4:
        raise KeyError("coordinate_transform.json에 epsg5186_local_to_grid(자오선 수렴각·축척 행렬)가 없습니다. 회전 없이 SUMO 파일을 쓰지 않습니다.")
    return tuple(float(v) for v in matrix)


def _coord(value: float) -> str:
    return f"{round(value, 6):.6f}".rstrip("0").rstrip(".")


def prepare(network: dict, output: Path, transform: dict | None = None) -> dict:
    """Write SUMO PlainXML in absolute EPSG:5186 metres (the D4 anchor + M [x, z], M = epsg5186_local_to_grid: the
    simulation frame is true east/north, the grid is turned by the meridian convergence) with netOffset 0,0."""
    config = transform if transform is not None else json.loads((DATA / "coordinate_transform.json").read_text(encoding="utf-8"))
    east, north = _anchor(config)
    a, b, c, d = _local_to_grid(config)
    absolute = lambda point: f"{_coord(a * float(point[0]) + b * float(point[1]) + east)},{_coord(c * float(point[0]) + d * float(point[1]) + north)}"
    node_features = {feature.feature_id: feature for feature in iter_features(network, "node")}
    nodes = Element("nodes")
    SubElement(nodes, "location", netOffset="0.00,0.00", projParameter=PROJ_EPSG5186)
    for node_id, feature in node_features.items():
        x, y = absolute(feature.coordinates).split(",")
        SubElement(nodes, "node", id=node_id, x=x, y=y, type="priority")
    edges_xml = Element("edges")
    included = []
    for feature in iter_features(network, "edge"):
        props = feature.properties
        if props.get("derived") or not props.get("authoritative", False):
            continue
        allowed = set(props.get("allowed_types") or ())
        if not allowed:
            continue
        if props.get("kind") in PEDESTRIAN_KINDS:
            sumo_allow = ["pedestrian"]
        elif "car" in allowed:
            sumo_allow = ["passenger"]
        else:
            sumo_allow = [name for agent, name in (("person", "pedestrian"), ("scooter", "bicycle")) if agent in allowed]
        attributes = {
            "id": feature.feature_id, "from": str(props["from_node"]), "to": str(props["to_node"]),
            "numLanes": str(int(props.get("lanes") or 1)) if "passenger" in sumo_allow else "1",
            "speed": str(float(props.get("speed_limit") or 10) / 3.6),
            "allow": " ".join(sumo_allow),
            "shape": " ".join(absolute(point) for point in feature.coordinates),
        }
        if props.get("width_m") is not None:
            attributes["width"] = str(float(props["width_m"]) / int(attributes["numLanes"]))
        SubElement(edges_xml, "edge", **attributes)
        included.append(feature.feature_id)
    write_xml(nodes, output / "campus.nod.xml")
    write_xml(edges_xml, output / "campus.edg.xml")

    routes = Element("routes")
    SubElement(routes, "vType", id="car_cautious", vClass="passenger", accel="1.5", decel="3.2", emergencyDecel="6.0", minGap="7.0", tau="1.8")
    SubElement(routes, "vType", id="car_normal", vClass="passenger", accel="2.0", decel="4.5", emergencyDecel="7.0", minGap="6.0", tau="1.4")
    SubElement(routes, "vType", id="car_aggressive", vClass="passenger", accel="2.6", decel="5.0", emergencyDecel="8.0", minGap="4.0", tau="1.0")
    SubElement(routes, "vType", id="e_scooter_safe", vClass="bicycle", accel="1.3", decel="3.0", emergencyDecel="5.5", length="1.2", width="0.65", minGap="2.5", maxSpeed="5.5")
    SubElement(routes, "vType", id="e_scooter_normal", vClass="bicycle", accel="1.7", decel="3.2", emergencyDecel="6.0", length="1.2", width="0.65", minGap="2.0", maxSpeed="6.94")
    SubElement(routes, "vType", id="e_scooter_aggressive", vClass="bicycle", accel="2.2", decel="3.8", emergencyDecel="7.0", length="1.2", width="0.65", minGap="1.4", maxSpeed="8.3")
    write_xml(routes, output / "campus.rou.xml")
    write_xml(Element("routes"), output / "campus.person.xml")
    write_xml(Element("additional"), output / "campus.add.xml")
    write_xml(Element("additional"), output / "detectors.add.xml")
    write_xml(Element("additional"), output / "traffic_lights.add.xml")

    netconvert = shutil.which("netconvert")
    net_path = output / "campus.net.xml"
    built = False
    error = None
    if netconvert and included:
        result = subprocess.run([
            netconvert, "--node-files", str(output / "campus.nod.xml"), "--edge-files", str(output / "campus.edg.xml"),
            "--offset.disable-normalization", "true", "--output-file", str(net_path),
        ], capture_output=True, text=True)
        built = result.returncode == 0
        error = None if built else result.stderr.strip()
    config = Element("configuration")
    input_node = SubElement(config, "input")
    SubElement(input_node, "net-file", value="campus.net.xml")
    SubElement(input_node, "route-files", value="campus.rou.xml,campus.person.xml")
    SubElement(input_node, "additional-files", value="campus.add.xml,detectors.add.xml,traffic_lights.add.xml")
    time_node = SubElement(config, "time")
    SubElement(time_node, "begin", value="0")
    SubElement(time_node, "step-length", value="0.1")
    write_xml(config, output / "campus.sumocfg")
    status = {
        "authoritative_edges_exported": len(included), "netconvert_available": bool(netconvert),
        "campus_net_built": built, "error": error,
        "ready": built and net_path.exists(),
        "frame": "EPSG:5186", "net_offset": [0, 0], "epsg5186_anchor": {"E": east, "N": north}, "epsg5186_local_to_grid": [a, b, c, d],
        "note": "Derived/unapproved geometry is deliberately excluded from SUMO network generation.",
    }
    (output / "generation_status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return status


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare SUMO inputs from authoritative transport-network features.")
    parser.add_argument("--network", type=Path, default=DATA / "campus_transport_network.geojson")
    parser.add_argument("--output", type=Path, default=SUMO)
    args = parser.parse_args()
    status = prepare(load_feature_collection(args.network), args.output)
    print(json.dumps(status, ensure_ascii=False))
    # Smoke only: without netconvert the PlainXML inputs are still written (exit 0); a failed netconvert run exits 2.
    raise SystemExit(0 if status["ready"] or not status["netconvert_available"] else 2)


if __name__ == "__main__":
    main()
