import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def js_origin():
    text = (ROOT / "frontend/src/simulation/utils/campusTrafficCoordinates.mjs").read_text(encoding="utf-8")
    match = re.search(r"origin: \{ x: (-?[\d.]+), y: (-?[\d.]+), z: (-?[\d.]+) \}", text)
    return tuple(float(value) for value in match.groups())


def test_coordinate_transform_json_origin_equals_js_constant():
    origin = json.loads((ROOT / "backend/simulation/data/coordinate_transform.json").read_text(encoding="utf-8"))["origin"]
    assert (origin["x"], origin["y"], origin["z"]) == js_origin(), "coordinate_transform.json origin drifted from campusTrafficCoordinates.mjs"


def test_build_mobility_data_origin_equals_js_constant():
    import build_mobility_data

    x, _, z = js_origin()
    assert build_mobility_data.DISPLAY_ORIGIN == (x, z), "build_mobility_data.py DISPLAY_ORIGIN drifted"
