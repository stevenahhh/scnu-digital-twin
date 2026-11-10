"""A main mass that the footprint clip drops whole comes back on the uncovered footprint (building_forms.restore_lost_main)."""
import pathlib
import sys

from shapely import Polygon, box

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import building_forms as bf  # noqa: E402

FOOT = box(0, 0, 40, 15)


def mass(poly, kind="wing", top=12.0):
    return {"poly": poly, "base": 0.0, "top": top, "type": "flat", "kind": kind, "floors": 3, "roof": "flat"}


def test_lost_main_is_restored_on_the_uncovered_footprint():
    # BLD_A10: the east third keeps its wings, the main mass over the rest lies outside the clip zone
    masses = [mass(box(26, 0, 40, 15))]
    dropped = [{"kind": "main", "topMetres": 13.23, "areaSquareMetres": 313.4, "reason": "wholly outside footprint+0.3 m or under 3 m2 after the clip"}]
    out, restored = bf.restore_lost_main(masses, dropped, FOOT)
    assert len(restored) == 1
    assert abs(restored[0]["areaSquareMetres"] - 26 * 15) < 1.0
    new = [m for m in out if m["kind"] == "main"]
    assert len(new) == 1 and new[0]["top"] == 13.23 and new[0]["base"] == 0.0
    assert "estimated" in new[0]["heightSource"]
    assert abs(sum(m["poly"].area for m in out) - FOOT.area) < 1.0


def test_nothing_is_added_without_a_lost_main_or_for_slivers():
    masses = [mass(box(26, 0, 40, 15))]
    cut = [{"kind": "wing", "topMetres": 12.0, "areaSquareMetres": 50.0, "reason": "cut off outside footprint+0.3 m"}]
    assert bf.restore_lost_main(masses, cut, FOOT) == (masses, [])
    # the kept masses already cover the footprint but for a 0.4 m strip
    full = [mass(box(0, 0, 40, 14.6), kind="main")]
    lost = [{"kind": "main", "topMetres": 9.0, "areaSquareMetres": 100.0, "reason": "wholly outside footprint+0.3 m or under 3 m2 after the clip"}]
    out, restored = bf.restore_lost_main(full, lost, FOOT)
    assert restored == [] and len(out) == 1
