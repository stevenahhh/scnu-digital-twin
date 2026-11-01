"""Lamp positions from VR bearings (local QA tooling; pixels never go into git).

For every lamp candidate (a seed position in EPSG:5186) and every resected VR station (scripts/perf/vr-stations.json,
refined pose) between MIN_M and MAX_M away, the lamp's predicted pole is projected into the station's side cube face:
base row from the camera height, head row from the lamp height. Around the predicted column (+- the angle a SEARCH_M
offset subtends) the pole is looked for as a thin vertical ridge: the second x-derivative of the grey face, averaged
over the rows between head and base, at its strongest column. A detection needs its ridge to beat the window median by
RIDGE_K robust sigmas. Each detection is a bearing from the station; two or more bearings that cross at >= MIN_CROSS_DEG
are intersected by least squares; residualM is the RMS perpendicular distance of the rays from the point.

    python -I scripts/perf/vr_lamp_bearings.py <candidates.json> <out.json> [--chips <dir>]

candidates.json: [{ "id", "E", "N", "heightM", "kind" }]. Output per candidate: detections (scene, face, col, bearing,
ridge score), the intersection (E, N), residualM, nStations, maxCrossDeg, shiftM from the seed, and a verdict:
"vr-fixed" (>= 2 stations, residual <= 0.5 m), "vr-weak" (>= 2 stations, residual <= 1.5 m) or "unresolved".
"""
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
VR = HERE.parent / "campus-model" / ".cache" / "vr"
sys.path.insert(0, str(HERE))
import vr_control_points as cp  # noqa: E402

MIN_M, MAX_M = 5.0, 45.0
SEARCH_M = 4.0
RIDGE_K = 4.0
MIN_CROSS_DEG = 20.0
FACE_OFF = {"f": 0, "r": 90, "b": 180, "l": -90}


def stations_resected():
    st = json.loads((HERE / "vr-stations.json").read_text())
    cp.SCENE_FIT = cp.fit_scene_frame(st)
    out = []
    for s in st:
        if "manual control-point" not in (s.get("refined_by") or "") and "d-face resection" not in (s.get("refined_by") or ""):
            continue
        E, N = cp.scene_to_tm(s["station_refined_x"], s["station_refined_z"])
        out.append(dict(scene=s["scene"], E=float(E), N=float(N), h=float(s["height_refined_m"]), yaw=float(s["yaw_refined_deg"])))
    return out


_faces = {}


def face(scene, f):
    key = (scene, f)
    if key not in _faces:
        _faces[key] = cv2.imread(str(VR / scene / f"pano_{f}.jpg"), cv2.IMREAD_GRAYSCALE).astype(np.float32)
    return _faces[key]


def project(st, E, N, z_above_ground):
    """(face, col, row) of a point at height z above the ground under the station (flat ground assumed)."""
    dE, dN = E - st["E"], N - st["N"]
    d = math.hypot(dE, dN)
    bearing = math.degrees(math.atan2(dE, dN)) % 360
    for f, off in FACE_OFF.items():
        a = ((bearing - st["yaw"] - off + 540) % 360) - 180
        if abs(a) < 45:
            x = math.tan(math.radians(a))
            # vertical: point is (z - h) above the camera at horizontal distance d along the face axis cos(a) d
            y = (st["h"] - z_above_ground) / (d * math.cos(math.radians(a)))
            return f, 1023.5 + 1024 * x, 1023.5 + 1024 * y, bearing, d
    return None


def detect(st, cand):
    pr = project(st, cand["E"], cand["N"], 0.0)
    if not pr:
        return None
    f, col, row_base, bearing, d = pr
    if not (MIN_M <= d <= MAX_M):
        return None
    _, _, row_head, _, _ = project(st, cand["E"], cand["N"], cand.get("heightM", 6.0) * 0.85)
    r0, r1 = int(max(0, min(row_head, row_base))), int(min(2047, max(row_head, row_base)))
    if r1 - r0 < 20:
        return None
    half = int(1024 * math.tan(math.atan(SEARCH_M / d))) + 4
    c0, c1 = int(max(2, col - half)), int(min(2045, col + half))
    if c1 - c0 < 10:
        return None
    img = face(st["scene"], f)[r0:r1, c0 - 2:c1 + 2]
    img = cv2.GaussianBlur(img, (0, 0), 1.0)
    ridge = np.abs(img[:, 2:] - 2 * img[:, 1:-1] + img[:, :-2])[:, 1:-1]
    prof = ridge.mean(axis=0)
    med = np.median(prof)
    mad = np.median(np.abs(prof - med)) * 1.4826 + 1e-6
    k = int(np.argmax(prof))
    z = (prof[k] - med) / mad
    if z < RIDGE_K:
        return None
    col_hit = c0 + k
    a = math.degrees(math.atan((col_hit - 1023.5) / 1024))
    return dict(scene=st["scene"], face=f, col=round(float(col_hit), 1), predCol=round(float(col), 1), rowBase=round(float(row_base), 1),
                rowHead=round(float(row_head), 1), z=round(float(z), 2), distM=round(d, 1),
                bearing=round((st["yaw"] + FACE_OFF[f] + a) % 360, 3), E0=st["E"], N0=st["N"])


def intersect(dets):
    # each ray: point (E0, N0), direction (sin b, cos b); minimise perpendicular distances
    A, y = [], []
    for d in dets:
        b = math.radians(d["bearing"])
        n = (math.cos(b), -math.sin(b))  # normal to the ray
        A.append(n)
        y.append(n[0] * d["E0"] + n[1] * d["N0"])
    A, y = np.array(A), np.array(y)
    p = np.linalg.lstsq(A, y, rcond=None)[0]
    res = A @ p - y
    return float(p[0]), float(p[1]), float(math.sqrt(np.mean(res ** 2)))


def max_cross(dets):
    best = 0.0
    for i in range(len(dets)):
        for j in range(i + 1, len(dets)):
            a = abs(((dets[i]["bearing"] - dets[j]["bearing"] + 540) % 360) - 180)
            best = max(best, min(a, 180 - a))
    return best


def main():
    cands = json.loads(Path(sys.argv[1]).read_text())
    out_path = Path(sys.argv[2])
    stations = stations_resected()
    results = {}
    for c in cands:
        dets = [d for d in (detect(st, c) for st in stations) if d]
        r = dict(id=c["id"], kind=c.get("kind"), seed=[c["E"], c["N"]], detections=dets, nStations=len(dets))
        if len(dets) >= 2 and max_cross(dets) >= MIN_CROSS_DEG:
            E, N, res = intersect(dets)
            r.update(E=round(E, 2), N=round(N, 2), residualM=round(res, 2), maxCrossDeg=round(max_cross(dets), 1),
                     shiftM=round(math.hypot(E - c["E"], N - c["N"]), 2))
            r["verdict"] = "vr-fixed" if res <= 0.5 else "vr-weak" if res <= 1.5 else "unresolved"
        else:
            r["verdict"] = "unresolved"
            r["why"] = f"{len(dets)} station(s) see a pole" + (f", rays cross at only {max_cross(dets):.0f} deg" if len(dets) >= 2 else "")
        results[c["id"]] = r
        print(c["id"], r["verdict"], r.get("nStations"), r.get("residualM"), r.get("shiftM"), r.get("why", ""), flush=True)
    out_path.write_text(json.dumps(results, indent=1))
    print(f"stations used: {len(stations)}; " + ", ".join(f"{k} {sum(1 for r in results.values() if r['verdict'] == k)}" for k in ("vr-fixed", "vr-weak", "unresolved")))


if __name__ == "__main__":
    main()
