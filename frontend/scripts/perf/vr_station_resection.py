"""Re-solve the SCNU 360 VR stations from their down-looking cube face (local QA tooling; outputs feed
scripts/perf/vr-stations.json, never pixels into git).

A krpano cube's d face is a 90-degree pinhole looking straight down, its image-up toward the scene yaw (the f face).
For level ground that is an exact similarity of the ground plane: the face spans 2 h metres (h = camera height above
the ground), it is rotated by the yaw, and its centre is the station's nadir. So every station's E, N, h and yaw follow
from registering the d face onto the NGII 2025 orthophoto (sheet 34702020, 0.25 m GSD, EPSG:5186):

    1. both images become gradient-magnitude maps (illumination and colour differences drop out);
    2. the d face is scaled to 0.25 m pixels for a trial h, rotated by a trial yaw, the nadir disc (tripod, drone or
       logo patch) is masked, and cv2.matchTemplate (TM_CCOEFF_NORMED) scores it over a search window on the
       sheet around the old station;
    3. a coarse scan (yaw every 2 deg, h every 1-5 m) is refined (yaw 0.1 deg, h 0.1 m), and the sub-pixel peak gives
       the nadir.
Error estimate: the face is also registered from its four quadrants separately (h and yaw fixed); the spread of their
nadirs (RMS, metres) and of their best yaws is the reported 1-sigma uncertainty. Buildings and crowns lean outward in
the d face (relief), which the gradient match tolerates; their ground lines dominate on roads and plazas.

    python -I scripts/perf/vr_station_resection.py <vr-stations.json> <vr cache dir> <out.json> [--scenes a,b]
"""
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
SHEET = HERE.parent / "campus-model" / ".cache" / "ngii-ortho" / "(B060)정사영상_2025_34702020.tif"
TFW = dict(a=0.25, d=-0.25, c=243324.125, f=264485.875)
GSD = 0.25
SEARCH_M = 45
YAW_PRIOR_DEG = 20
ACCEPT = dict(quadrantRmsM=1.0, quadrantYawSdDeg=0.5)
NADIR_MASK = 0.18  # fraction of the face radius masked at the centre


def open_sheet():
    data = SHEET.read_bytes()[:1 << 16]
    ifd = int.from_bytes(data[4:8], "little")
    n = int.from_bytes(data[ifd:ifd + 2], "little")
    tags = {}
    for i in range(n):
        e = data[ifd + 2 + 12 * i: ifd + 14 + 12 * i]
        tag, typ, cnt = int.from_bytes(e[0:2], "little"), int.from_bytes(e[2:4], "little"), int.from_bytes(e[4:8], "little")
        val = int.from_bytes(e[8:12], "little") if typ == 4 else int.from_bytes(e[8:10], "little")
        tags[tag] = (typ, cnt, val)
    width, height = tags[256][2], tags[257][2]
    typ, cnt, val = tags[273]
    offset = val if cnt == 1 else int.from_bytes(SHEET.read_bytes()[val:val + 4], "little")
    return np.memmap(SHEET, dtype=np.uint8, mode="r", offset=offset, shape=(height, width, 3))


def grad(gray):
    g = cv2.GaussianBlur(gray.astype(np.float32), (0, 0), 1.0)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    m = cv2.magnitude(gx, gy)
    return m / (np.percentile(m, 99) + 1e-6)


def tm_to_px(E, N):
    return (E - TFW["c"]) / TFW["a"], (N - TFW["f"]) / TFW["d"]


def px_to_tm(col, row):
    return TFW["c"] + col * TFW["a"], TFW["f"] + row * TFW["d"]


def face_template(face_gray, h, gsd=GSD):
    """d face scaled to gsd-metre pixels (gradient magnitude), nadir disc set to the image mean."""
    size = max(12, int(round(2 * h / gsd)))
    g = grad(cv2.resize(face_gray, (size, size), interpolation=cv2.INTER_AREA))
    yy, xx = np.mgrid[0:size, 0:size]
    c = size / 2 - 0.5
    g[np.hypot(xx - c, yy - c) < NADIR_MASK * size / 2] = float(g.mean())
    return g.astype(np.float32)


def rotated_search(search, yaw):
    """The map window turned so the bearing `yaw` points up (the d face's orientation): content turns counter-clockwise
    by yaw. Returns (image, inverse affine back to the unrotated window)."""
    h, w = search.shape
    centre = (w / 2 - 0.5, h / 2 - 0.5)
    rot = cv2.getRotationMatrix2D(centre, yaw, 1.0)
    img = cv2.warpAffine(search, rot, (w, h), flags=cv2.INTER_LINEAR, borderValue=0)
    return img, cv2.invertAffineTransform(rot)


def best_match(search_rot, tpl):
    if tpl.shape[0] >= search_rot.shape[0] - 4:
        return -1, None
    res = cv2.matchTemplate(search_rot, tpl, cv2.TM_CCOEFF_NORMED)
    res[~np.isfinite(res)] = -1
    _, score, _, loc = cv2.minMaxLoc(res)
    return score, (res, loc)


def subpixel(res, loc):
    x, y = loc
    dx = dy = 0.0
    if 0 < x < res.shape[1] - 1:
        a, b, c = res[y, x - 1], res[y, x], res[y, x + 1]
        den = a - 2 * b + c
        dx = 0.5 * (a - c) / den if den else 0.0
    if 0 < y < res.shape[0] - 1:
        a, b, c = res[y - 1, x], res[y, x], res[y + 1, x]
        den = a - 2 * b + c
        dy = 0.5 * (a - c) / den if den else 0.0
    return x + dx, y + dy


def locate(found, tpl, inv, origin, scale):
    res, loc = found
    sx, sy = subpixel(res, loc)
    cx, cy = sx + (tpl.shape[1] - 1) / 2, sy + (tpl.shape[0] - 1) / 2
    ux = inv[0, 0] * cx + inv[0, 1] * cy + inv[0, 2]
    uy = inv[1, 0] * cx + inv[1, 1] * cy + inv[1, 2]
    return origin[0] + ux * scale, origin[1] + uy * scale


def search_window(sheet_gray, col, row, half_px, scale):
    x0, y0 = int(col) - half_px, int(row) - half_px
    img = sheet_gray(x0, y0, 2 * half_px)
    if scale > 1:
        img = cv2.resize(img, (img.shape[1] // scale, img.shape[0] // scale), interpolation=cv2.INTER_AREA)
    return grad(img).astype(np.float32), (x0, y0)


def scan(face_gray, search, origin, scale, hs, yaws):
    best = (-1, None)
    tpls = {h: face_template(face_gray, h, GSD * scale) for h in hs}
    for yaw in yaws:
        rot, inv = rotated_search(search, yaw)
        for h in hs:
            score, found = best_match(rot, tpls[h])
            if score > best[0]:
                best = (score, (float(h), float(yaw) % 360, locate(found, tpls[h], inv, origin, scale)))
    return best


def solve(face_gray, sheet_gray, c0, r0, h0, yaw0):
    # coarse: 0.5 m pixels, +-SEARCH_M around the old station, h 0.75-1.4 h0, yaw within YAW_PRIOR_DEG of the old yaw
    # (the old yaws come from hotspot bearings, median error ~2 deg; an unconstrained scan prefers small, spurious
    # templates). Zero-mean NCC still favours small templates, so h stays near the prior and the quadrant test below
    # rejects a wrong fit.
    scale = 2
    half = int((SEARCH_M + 2 * 1.4 * h0) / GSD)
    search, origin = search_window(sheet_gray, c0, r0, half, scale)
    hs = list(h0 * np.arange(0.75, 1.4001, 0.05))
    coarse = scan(face_gray, search, origin, scale, hs, [yaw0 + k for k in range(-YAW_PRIOR_DEG, YAW_PRIOR_DEG + 1)])
    h, yaw, (cc, rc) = coarse[1]
    # fine: 0.25 m pixels, +-6 m around the coarse nadir; h +-6 % / yaw +-2 deg, then +-1.5 % / +-0.4 deg
    half_f = int((6 + 1.2 * h) / GSD)
    fine, origin_f = search_window(sheet_gray, cc, rc, half_f, 1)
    best = coarse
    for dh, nh, dy, ny in ((0.06, 7, 2.0, 9), (0.015, 7, 0.4, 9)):
        hs_f = [h * (1 + k) for k in np.linspace(-dh, dh, nh)]
        ys_f = [yaw + k for k in np.linspace(-dy, dy, ny)]
        best = scan(face_gray, fine, origin_f, 1, hs_f, ys_f)
        h, yaw, (cc, rc) = best[1]
    return dict(score=float(best[0]), coarseScore=float(coarse[0]), h=h, yaw=yaw, col=cc, row=rc, fine=(fine, origin_f))


def quadrant_spread(face_gray, sol):
    """Each quadrant of the face matched alone (h fixed, yaw +-1 deg): RMS of the nadirs it implies about the solution
    (m) and SD of its yaws (deg)."""
    fine, origin = sol["fine"]
    tpl_full = face_template(face_gray, sol["h"])
    n = tpl_full.shape[0]
    pts, yaws = [], []
    for qy in (0, 1):
        for qx in (0, 1):
            q = tpl_full[qy * n // 2:(qy + 1) * n // 2, qx * n // 2:(qx + 1) * n // 2]
            best = (-1, None)
            for dyaw in np.linspace(-1, 1, 21):
                rot, inv = rotated_search(fine, sol["yaw"] + dyaw)
                score, found = best_match(rot, q)
                if score > best[0]:
                    res, loc = found
                    sx, sy = subpixel(res, loc)
                    # the quadrant's top-left in the rotated window -> where the full face's centre would be
                    cx, cy = sx - qx * n // 2 + (n - 1) / 2, sy - qy * n // 2 + (n - 1) / 2
                    ux = inv[0, 0] * cx + inv[0, 1] * cy + inv[0, 2]
                    uy = inv[1, 0] * cx + inv[1, 1] * cy + inv[1, 2]
                    best = (score, (float(dyaw), (origin[0] + ux, origin[1] + uy)))
            yaws.append(best[1][0])
            pts.append(best[1][1])
    pts = np.array(pts)
    rms = float(np.sqrt(np.mean(np.sum((pts - np.array([sol["col"], sol["row"]])) ** 2, axis=1))) * GSD)
    return rms, float(np.std(yaws))


def main():
    stations = json.loads(Path(sys.argv[1]).read_text())
    vr = Path(sys.argv[2])
    out_path = Path(sys.argv[3])
    only = None
    if "--scenes" in sys.argv:
        only = set(sys.argv[sys.argv.index("--scenes") + 1].split(","))
    sheet = open_sheet()

    def sheet_gray(x, y, n):
        return cv2.cvtColor(np.ascontiguousarray(sheet[y:y + n, x:x + n]), cv2.COLOR_RGB2GRAY)

    results = json.loads(out_path.read_text()) if out_path.exists() else {}
    for s in stations:
        scene = s["scene"]
        if only and scene not in only:
            continue
        face_path = vr / scene / "pano_d.jpg"
        if not face_path.exists():
            results[scene] = {"error": "no d face"}
            continue
        face = cv2.imread(str(face_path), cv2.IMREAD_GRAYSCALE)
        E0, N0 = s["station_e"], s["station_n"]
        c0, r0 = tm_to_px(E0, N0)
        h0 = s.get("height_refined_m") or s["height_m_est"]
        yaw0 = s.get("yaw_refined_deg") or s["yaw_deg"]
        sol = solve(face, sheet_gray, c0, r0, h0, yaw0)
        rms_m, yaw_sd = quadrant_spread(face, sol)
        E, N = px_to_tm(sol["col"], sol["row"])
        results[scene] = {
            "coarseScore": round(float(sol["coarseScore"]), 4),
            "E": round(float(E), 2), "N": round(float(N), 2), "h": round(float(sol["h"]), 2), "yaw": round(float(sol["yaw"]), 2), "score": round(float(sol["score"]), 4),
            "quadrantRmsM": round(float(rms_m), 2), "quadrantYawSdDeg": round(float(yaw_sd), 2),
            "accepted": bool(rms_m <= ACCEPT["quadrantRmsM"] and yaw_sd <= ACCEPT["quadrantYawSdDeg"]),
        }
        print(scene, json.dumps(results[scene]), flush=True)
        out_path.write_text(json.dumps(results, indent=1))


if __name__ == "__main__":
    main()
