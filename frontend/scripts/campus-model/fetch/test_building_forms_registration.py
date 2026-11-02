"""Rigid registration of a LOD4 plan onto its footprint (building_forms.fit_rigid, clip_to_footprint)."""
import pathlib
import sys

import pytest
import shapely.affinity
from shapely import Polygon

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import building_forms as bf  # noqa: E402

# An L-shaped footprint, so rotation is observable.
FOOT = Polygon([(0, 0), (40, 0), (40, 12), (14, 12), (14, 30), (0, 30)])


def test_shifted_and_rotated_plan_is_recovered():
    plan = shapely.affinity.translate(shapely.affinity.rotate(FOOT, 2.0, origin="centroid"), 3.0, 0.0)
    tf = bf.fit_rigid(plan, FOOT)
    fitted = bf.apply_rigid(plan, tf)
    assert abs(tf["rotDeg"] + 2.0) <= 0.1
    assert fitted.centroid.distance(FOOT.centroid) <= 0.05
    assert fitted.hausdorff_distance(FOOT) <= 0.05 + 0.1
    assert tf["iou"] > 0.99 and tf["iouBefore"] < 0.9
    assert tf["residual_m"] <= 0.05
    assert tf["atRotationBound"] is False


def test_rotation_bound_is_reported():
    plan = shapely.affinity.rotate(FOOT, 9.0, origin="centroid")
    assert bf.fit_rigid(plan, FOOT)["atRotationBound"] is True


def test_aligned_plan_keeps_identity():
    tf = bf.fit_rigid(FOOT, FOOT)
    assert (tf["dx"], tf["dy"], tf["rotDeg"]) == (0.0, 0.0, 0.0)


def test_degenerate_polygon_is_a_named_error():
    flat = Polygon([(0, 0), (10, 0), (20, 0)])
    with pytest.raises(bf.RegistrationError, match="degenerate LOD4 plan"):
        bf.fit_rigid(flat, FOOT)
    with pytest.raises(bf.RegistrationError, match="degenerate footprint"):
        bf.fit_rigid(FOOT, Polygon())


def test_main_masses_clip_to_footprint_buffer_cores_kept():
    big = shapely.affinity.scale(FOOT, 1.2, 1.2, origin="centroid")
    masses = [{"poly": big, "kind": "main"}, {"poly": big, "kind": "core"}]
    far = shapely.affinity.translate(FOOT, 500, 0)
    masses.append({"poly": far, "kind": "wing", "top": 6.0})
    masses[0]["top"] = 9.0
    out, dropped = bf.clip_to_footprint(masses, FOOT)
    assert any(d["kind"] == "wing" and "wholly outside" in d["reason"] for d in dropped)
    assert any(d["kind"] == "main" and "cut off" in d["reason"] for d in dropped)
    zone = FOOT.buffer(0.3 + 1e-6, join_style="mitre")
    mains = [m for m in out if m["kind"] == "main"]
    assert mains and all(zone.contains(m["poly"]) for m in mains)
    assert [m for m in out if m["kind"] == "core"][0]["poly"].equals(big)
