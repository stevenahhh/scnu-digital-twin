"""Manual control-point resection of the SCNU 360 VR stations (local QA tooling; pixels never go into git).

Control points are features seen both in a station's cube faces and on the NGII 2025 orthophoto (sheet 34702020,
0.25 m GSD, EPSG:5186): kerb, crossing-bar and building-base corners, pole bases. They are read by eye on pick sheets
and stored in scripts/perf/vr-control-points.json:

    { "<scene>": { "points": [ { "face": "d", "col": 812, "row": 1460, "sc": 3141.5, "sr": 3022.0, "what": "..." },
                               { "face": "f", "col": 1310, "sc": 3170.0, "sr": 2950.5, "what": "..." } ] } }

col/row are cube-face pixels (2048 px faces), sc/sr sheet pixels (world-file convention, centre of the top-left pixel).

Model. The d face is a 90-degree pinhole looking straight down with image-up toward the yaw bearing, so a ground point
at face (x, y) = ((col - 1023.5) / 1024, (row - 1023.5) / 1024) lies at

    E = Ec + a x - b y,   N = Nc - b x - a y,   a = h cos(yaw), b = h sin(yaw)

(h = camera height above the local ground). That is linear in Ec, Nc, a, b: three or more d-face points give a least-
squares fit. Points on the f/r/b/l faces add a bearing each (yaw + face offset + atan x); the whole set is then solved by
Gauss-Newton with every residual in metres (d points: ground offset; side points: cross-track offset at the point's
distance). Uncertainty: sigma0^2 (J^T J)^-1 with sigma0 from the residuals (floored at 0.25 m, the sheet pixel).

Refinement (optional, --refine): the down face is then registered on the sheet by vr_station_resection.py's matcher
inside a tight window (+-3 m, h +-6 %, yaw +-2 deg) around the control-point solution, and its quadrant test is run;
the refined pose is used when the quadrant test passes and it agrees with the control-point solution.

    python -I scripts/perf/vr_control_points.py sheet <scene> <out.png> [--E e --N n] [--half 40]
    python -I scripts/perf/vr_control_points.py solve <points.json> <stations.json> <out.json> [--refine] [--scenes a,b]
    python -I scripts/perf/vr_control_points.py check <solved.json> <scene> <out.png> [--points <points.json>] [--old] [--points-only]
    python -I scripts/perf/vr_control_points.py apply <solved.json> <stations.json> [--points <points.json>] [--scenes a,b]
"""
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import vr_station_resection as vr  # noqa: E402

VR = HERE.parent / "campus-model" / ".cache" / "vr"
FACE_OFF = {"f": 0, "r": 90, "b": 180, "l": -90}
ACCEPT = dict(sigmaPosM=1.0, sigmaYawDeg=0.5, maxResidualM=1.5)
SIGMA_FLOOR_M = 0.25
MIN_INLIERS_SOLVE = 8
GRID_FACE = 128


def station(stations, scene):
    s = next(q for q in stations if q["scene"] == scene)
    if "station_refined_x" in s:
        E, N = scene_to_tm(s["station_refined_x"], s["station_refined_z"])
    else:
        E, N = s["station_e"], s["station_n"]
    return s, E, N, (s.get("height_refined_m") or s["height_m_est"]), (s.get("yaw_refined_deg") or s["yaw_deg"])


def scene_to_tm(x, z):
    # inverse of the station_x/z <-> station_e/n pairs: affine fit over the stations that carry both
    return SCENE_FIT[0] @ np.array([x, z, 1.0]), SCENE_FIT[1] @ np.array([x, z, 1.0])


def fit_scene_frame(stations):
    A = np.array([[s["station_x"], s["station_z"], 1.0] for s in stations])
    E = np.array([s["station_e"] for s in stations])
    N = np.array([s["station_n"] for s in stations])
    return np.linalg.lstsq(A, E, rcond=None)[0], np.linalg.lstsq(A, N, rcond=None)[0]


def tm_to_scene(E, N):
    M = np.array([[SCENE_FIT[0][0], SCENE_FIT[0][1]], [SCENE_FIT[1][0], SCENE_FIT[1][1]]])
    x, z = np.linalg.solve(M, np.array([E - SCENE_FIT[0][2], N - SCENE_FIT[1][2]]))
    return float(x), float(z)


# ---------------------------------------------------------------- pick sheet
def pick_sheet(scene, out, E, N, h, yaw, half_m):
    sheet = vr.open_sheet()
    face = Image.open(VR / scene / "pano_d.jpg").convert("RGB").resize((1024, 1024))
    d = ImageDraw.Draw(face)
    for c in range(0, 2049, GRID_FACE):
        d.line([(c / 2, 0), (c / 2, 1024)], fill=(255, 255, 0), width=1)
        d.line([(0, c / 2), (1024, c / 2)], fill=(255, 255, 0), width=1)
        d.text((c / 2 + 2, 2), str(c), fill="yellow")
        d.text((2, c / 2 + 2), str(c), fill="yellow")
    d.text((520, 1010), "d face (up = yaw)", fill="white")
    c0, r0 = vr.tm_to_px(E, N)
    R = int(half_m / vr.GSD)
    S = 1024 / (2 * R)
    crop = Image.fromarray(np.array(sheet[int(r0) - R:int(r0) + R, int(c0) - R:int(c0) + R])).resize((1024, 1024), Image.BICUBIC)
    p = ImageDraw.Draw(crop)
    cs, rs = int(c0) - R, int(r0) - R
    for k in range(0, 2 * R + 1):
        col, row = cs + k, rs + k
        if col % 20 == 0:
            p.line([((k + 0.5) * S, 0), ((k + 0.5) * S, 1024)], fill=(255, 255, 0) if col % 100 == 0 else (150, 150, 0), width=1)
            p.text(((k + 0.5) * S + 2, 2), str(col), fill="yellow")
        if row % 20 == 0:
            p.line([(0, (k + 0.5) * S), (1024, (k + 0.5) * S)], fill=(255, 255, 0) if row % 100 == 0 else (150, 150, 0), width=1)
            p.text((2, (k + 0.5) * S + 2), str(row), fill="yellow")
    # old station and its predicted d-face footprint (cyan), arrow = image-up of the face
    sx, sy = (c0 - cs + 0.5) * S, (r0 - rs + 0.5) * S
    t = math.radians(yaw)
    fw, rt = (math.sin(t), -math.cos(t)), (math.cos(t), math.sin(t))
    hp = h / vr.GSD * S
    corners = [(sx + (fw[0] * a + rt[0] * b) * hp, sy + (fw[1] * a + rt[1] * b) * hp) for a, b in ((1, -1), (1, 1), (-1, 1), (-1, -1))]
    p.line(corners + [corners[0]], fill=(0, 255, 255), width=2)
    p.line([(sx, sy), (sx + fw[0] * hp, sy + fw[1] * hp)], fill=(0, 255, 255), width=3)
    p.ellipse([sx - 5, sy - 5, sx + 5, sy + 5], outline="red", width=2)
    p.text((520, 1010), f"NGII sheet px; old station (red), old footprint (cyan, arrow=up) h{h:.1f} yaw{yaw:.1f}", fill="white")
    out_img = Image.new("RGB", (2056, 1040), (30, 30, 30))
    out_img.paste(face, (0, 16))
    out_img.paste(crop, (1032, 16))
    ImageDraw.Draw(out_img).text((4, 2), f"{scene}", fill="white")
    out_img.save(out)


# ---------------------------------------------------------------- solve
def residuals(params, pts):
    Ec, Nc, yaw, h = params
    t = math.radians(yaw)
    a, b = h * math.cos(t), h * math.sin(t)
    res = []
    for q in pts:
        E, N = vr.px_to_tm(q["sc"], q["sr"])
        x = (q["col"] - 1023.5) / 1024
        if q["face"] == "d":
            y = (q["row"] - 1023.5) / 1024
            res += [Ec + a * x - b * y - E, Nc - b * x - a * y - N]
        else:
            bearing = math.radians(yaw + FACE_OFF[q["face"]]) + math.atan(x)
            dE, dN = E - Ec, N - Nc
            dist = math.hypot(dE, dN)
            # cross-track offset of the point from the observed bearing ray (metres)
            res.append(dE * math.cos(bearing) - dN * math.sin(bearing))
            _ = dist
    return np.array(res)


def solve_points(pts, prior):
    d = [q for q in pts if q["face"] == "d"]
    if len(d) >= 2:
        A, y = [], []
        for q in d:
            E, N = vr.px_to_tm(q["sc"], q["sr"])
            x, yy = (q["col"] - 1023.5) / 1024, (q["row"] - 1023.5) / 1024
            A += [[1, 0, x, -yy], [0, 1, -yy, -x]]
            y += [E, N]
        Ec, Nc, a, b = np.linalg.lstsq(np.array(A), np.array(y), rcond=None)[0]
        p = np.array([Ec, Nc, math.degrees(math.atan2(b, a)) % 360, math.hypot(a, b)])
    else:
        p = np.array(prior, float)
    free = [0, 1, 2, 3] if d else [0, 1, 2]
    for _ in range(30):
        r = residuals(p, pts)
        J = np.zeros((len(r), 4))
        for k in free:
            dp = np.zeros(4)
            dp[k] = 1e-4 if k != 2 else 1e-3
            J[:, k] = (residuals(p + dp, pts) - r) / dp[k]
        Jf = J[:, free]
        step = np.linalg.lstsq(Jf, -r, rcond=None)[0]
        p[free] += step
        if np.max(np.abs(step)) < 1e-6:
            break
    r = residuals(p, pts)
    J = np.zeros((len(r), 4))
    for k in free:
        dp = np.zeros(4)
        dp[k] = 1e-4 if k != 2 else 1e-3
        J[:, k] = (residuals(p + dp, pts) - r) / dp[k]
    Jf = J[:, free]
    dof = max(1, len(r) - len(free))
    s0 = max(SIGMA_FLOOR_M, math.sqrt(float(r @ r) / dof))
    cov = s0 * s0 * np.linalg.pinv(Jf.T @ Jf)
    per = [math.hypot(*r[i:i + 2]) for i in range(0, 2 * len(d), 2)] + list(np.abs(r[2 * len(d):]))
    out = dict(E=float(p[0]), N=float(p[1]), yaw=float(p[2] % 360), h=float(p[3]), n=len(pts), nD=len(d),
               rmsM=float(math.sqrt(np.mean(np.square(per)))), maxResM=float(max(per)),
               sigmaPosM=float(math.sqrt(cov[0, 0] + cov[1, 1])), sigmaYawDeg=float(math.sqrt(cov[2, 2])),
               sigmaHM=float(math.sqrt(cov[3, 3])) if 3 in free else None, residualsM=[round(float(v), 2) for v in per])
    out["accepted"] = bool(out["sigmaPosM"] <= ACCEPT["sigmaPosM"] and out["sigmaYawDeg"] <= ACCEPT["sigmaYawDeg"] and out["maxResM"] <= ACCEPT["maxResidualM"])
    if len(d) and len(d) < MIN_INLIERS_SOLVE:
        out["accepted"] = False
        out["why"] = f"{len(d)} control points (< {MIN_INLIERS_SOLVE})"
    if prior[3] and not (H_RANGE[0] <= out["h"] / prior[3] <= H_RANGE[1]):
        out["accepted"] = False
        out["why"] = f"height {out['h']:.1f} m implausible against the prior {prior[3]} m"
    return out


def refine(scene, sol):
    sheet = vr.open_sheet()

    def sheet_gray(x, y, n):
        return cv2.cvtColor(np.ascontiguousarray(sheet[y:y + n, x:x + n]), cv2.COLOR_RGB2GRAY)

    face = cv2.imread(str(VR / scene / "pano_d.jpg"), cv2.IMREAD_GRAYSCALE)
    c, r = vr.tm_to_px(sol["E"], sol["N"])
    h, yaw = sol["h"], sol["yaw"]
    half = int((3 + 1.06 * h) / vr.GSD) + 2
    fine, origin = vr.search_window(sheet_gray, c, r, half, 1)
    best = None
    for dh, nh, dy, ny in ((0.06, 13, 2.0, 17), (0.01, 9, 0.25, 11)):
        hs = [h * (1 + k) for k in np.linspace(-dh, dh, nh)]
        ys = [yaw + k for k in np.linspace(-dy, dy, ny)]
        best = vr.scan(face, fine, origin, 1, hs, ys)
        if best[1] is None:
            return None
        h, yaw, (cc, rc) = best[1]
    E, N = vr.px_to_tm(cc, rc)
    rms, ysd = vr.quadrant_spread(face, dict(h=h, yaw=yaw, col=cc, row=rc, fine=(fine, origin)))
    shift = math.hypot(E - sol["E"], N - sol["N"])
    return dict(E=float(E), N=float(N), h=float(h), yaw=float(yaw % 360), score=float(best[0]), quadrantRmsM=float(rms),
                quadrantYawSdDeg=float(ysd), shiftFromPointsM=float(shift),
                accepted=bool(rms <= 1.0 and ysd <= 0.5 and shift <= max(1.5, 3 * sol["sigmaPosM"])))


# ---------------------------------------------------------------- check view
def check_view(scene, pose, out, points=(), half_m=None):
    """The d face warped onto the sheet with pose (E, N, h, yaw), 50 % over the photo; grid in sheet px; control points:
    sheet position (red ring) and where the pose puts its d-face pixel (cyan dot)."""
    sheet = vr.open_sheet()
    E, N, h, yaw = pose["E"], pose["N"], pose["h"], pose["yaw"]
    half_m = half_m or min(1.15 * GROUND_REACH * h, 1.15 * GROUND_MAX_M)
    c0, r0 = vr.tm_to_px(E, N)
    R = int(half_m / vr.GSD)
    cs, rs = int(c0) - R, int(r0) - R
    photo = np.array(sheet[rs:rs + 2 * R, cs:cs + 2 * R]).astype(np.float32)
    t = math.radians(yaw)
    a, b = h * math.cos(t), h * math.sin(t)
    rows, cols = np.mgrid[0:2 * R, 0:2 * R].astype(np.float32)
    Eg = vr.TFW["c"] + (cs + cols) * vr.TFW["a"]
    Ng = vr.TFW["f"] + (rs + rows) * vr.TFW["d"]
    dE, dN = Eg - E, Ng - N
    x = ((a * dE - b * dN) / (h * h)).astype(np.float32)
    y = ((-b * dE - a * dN) / (h * h)).astype(np.float32)
    warped, srcmap = ground_image(scene, x, y, gray=False)
    inside = (srcmap >= 0) & (np.hypot(x, y) < GROUND_REACH)
    blend = photo.copy()
    blend[inside] = 0.5 * photo[inside] + 0.5 * warped[inside]
    img = Image.fromarray(np.clip(blend, 0, 255).astype(np.uint8)).resize((1024, 1024), Image.BICUBIC)
    S = 1024 / (2 * R)
    d = ImageDraw.Draw(img)
    for k in range(0, 2 * R + 1):
        if (cs + k) % 20 == 0:
            d.line([((k + 0.5) * S, 0), ((k + 0.5) * S, 1024)], fill=(150, 150, 0), width=1)
            d.text(((k + 0.5) * S + 2, 2), str(cs + k), fill="yellow")
        if (rs + k) % 20 == 0:
            d.line([(0, (k + 0.5) * S), (1024, (k + 0.5) * S)], fill=(150, 150, 0), width=1)
            d.text((2, (k + 0.5) * S + 2), str(rs + k), fill="yellow")
    for q in points:
        if q["face"] != "d":
            continue
        X, Y = (q["sc"] - cs + 0.5) * S, (q["sr"] - rs + 0.5) * S
        d.ellipse([X - 6, Y - 6, X + 6, Y + 6], outline="red", width=2)
        xq, yq = (q["col"] - 1023.5) / 1024, (q["row"] - 1023.5) / 1024
        pc, pr = vr.tm_to_px(E + a * xq - b * yq, N - b * xq - a * yq)
        X, Y = (pc - cs + 0.5) * S, (pr - rs + 0.5) * S
        d.ellipse([X - 3, Y - 3, X + 3, Y + 3], fill=(0, 255, 255))
    d.text((4, 1008), f"{scene} ground-projected cube on NGII 50 %: E {E:.1f} N {N:.1f} h {h:.1f} yaw {yaw:.1f}", fill="white")
    img.save(out)


# ---------------------------------------------------------------- ground projection of the whole cube
# Camera frame: F forward (yaw), Rt right, U up. Each face: centre axis, right axis, image-down axis.
FACES = {
    "f": ((1, 0, 0), (0, 1, 0), (0, 0, -1)), "r": ((0, 1, 0), (-1, 0, 0), (0, 0, -1)),
    "b": ((-1, 0, 0), (0, -1, 0), (0, 0, -1)), "l": ((0, -1, 0), (1, 0, 0), (0, 0, -1)),
    "d": ((0, 0, -1), (0, 1, 0), (-1, 0, 0)),
}
_face_cache = {}


def face_img(scene, f, gray):
    key = (scene, f, gray)
    if key not in _face_cache:
        im = cv2.imread(str(VR / scene / f"pano_{f}.jpg"), cv2.IMREAD_GRAYSCALE if gray else cv2.IMREAD_COLOR)
        _face_cache[key] = im if gray else cv2.cvtColor(im, cv2.COLOR_BGR2RGB)
    return _face_cache[key]


def ground_image(scene, xs, ys, gray=True):
    """Pixels of the cube seen along the ground rays of virtual d-face coordinates (xs, ys arrays: x right, y = -forward,
    both in units of the camera height). Returns (image, source face index map)."""
    F, Rt, U = -ys, xs, -np.ones_like(xs)
    out = np.zeros(xs.shape + (() if gray else (3,)), np.float32)
    src = np.full(xs.shape, -1, np.int8)
    for k, (name, (c, r, dn)) in enumerate(FACES.items()):
        den = F * c[0] + Rt * c[1] + U * c[2]
        ok = den > 1e-6
        fx = np.where(ok, (F * r[0] + Rt * r[1] + U * r[2]) / np.where(ok, den, 1), 9)
        fy = np.where(ok, (F * dn[0] + Rt * dn[1] + U * dn[2]) / np.where(ok, den, 1), 9)
        sel = ok & (np.abs(fx) <= 1) & (np.abs(fy) <= 1) & (src < 0)
        if not sel.any():
            continue
        im = face_img(scene, name, gray).astype(np.float32)
        mx = (1023.5 + 1024 * fx).astype(np.float32)
        my = (1023.5 + 1024 * fy).astype(np.float32)
        warped = cv2.remap(im, mx, my, cv2.INTER_LINEAR)
        out[sel] = warped[sel]
        src[sel] = k
    return out, src


def face_pixel(x, y):
    """(face, col, row) of the cube pixel on the ground ray of virtual d-face coordinates (x, y)."""
    F, Rt, U = -y, x, -1.0
    for name, (c, r, dn) in FACES.items():
        den = F * c[0] + Rt * c[1] + U * c[2]
        if den <= 1e-6:
            continue
        fx = (F * r[0] + Rt * r[1] + U * r[2]) / den
        fy = (F * dn[0] + Rt * dn[1] + U * dn[2]) / den
        if abs(fx) <= 1 and abs(fy) <= 1:
            return name, round(float(1023.5 + 1024 * fx), 1), round(float(1023.5 + 1024 * fy), 1)
    return None, None, None


# ---------------------------------------------------------------- automatic control points (SIFT + RANSAC)
AUTO_GSD = 0.125          # both images resampled to 0.125 m pixels
AUTO_SEARCH_M = 60        # photo window: old station +- this + 1.6 h
RANSAC_PX = 5.0           # 0.6 m


GROUND_REACH = 3.5          # ground projection out to 3.5 h (max GROUND_MAX_M)
GROUND_MAX_M = 55
MIN_INLIERS = 8
H_RANGE = (0.4, 2.5)        # solved height / prior height


def similarity_ransac(src, dst, iters=20000, scale_range=(0.5, 2.0), seed=7):
    """2-point RANSAC for a similarity dst = s R src + t with s in scale_range (the ground image is built at the photo's
    pixel size, so s = prior height / true height); returns (inlier mask, s) of the largest consensus, refitted."""
    rng = np.random.default_rng(seed)
    zs, zd = src[:, 0] + 1j * src[:, 1], dst[:, 0] + 1j * dst[:, 1]
    best, best_n = None, 0
    n = len(zs)
    for _ in range(iters):
        i, j = rng.choice(n, 2, replace=False)
        if abs(zs[i] - zs[j]) < 20:
            continue
        m = (zd[i] - zd[j]) / (zs[i] - zs[j])
        if not (scale_range[0] <= abs(m) <= scale_range[1]):
            continue
        t = zd[i] - m * zs[i]
        mask = np.abs(m * zs + t - zd) < RANSAC_PX
        k = int(mask.sum())
        if k > best_n:
            best, best_n = mask, k
    if best is None or best_n < 3:
        return None, None
    for _ in range(3):  # least-squares refit on the inliers, then re-select
        A = np.stack([zs[best], np.ones(best_n)], 1)
        m, t = np.linalg.lstsq(A, zd[best], rcond=None)[0]
        mask = np.abs(m * zs + t - zd) < RANSAC_PX
        if mask.sum() < 3:
            break
        best, best_n = mask, int(mask.sum())
    return best, float(abs(m))


def coarse_pose(scene, sheet, E0, N0, h0, reach):
    """Pose (E, N, h, yaw, score) from the gradient NCC of the ground-projected cube against the photo: 1 m pixels,
    +-AUTO_SEARCH_M around the old station, h 0.6-1.8 h0, yaw every 2 deg (then 0.5 deg)."""
    n = 512
    g = (np.arange(n, dtype=np.float32) + 0.5) / n * 2 * reach - reach
    xs, ys = np.meshgrid(g, g)
    G, src = ground_image(scene, xs, ys, gray=True)
    valid = (src >= 0) & (np.hypot(xs, ys) < reach)
    G[~valid] = float(G[valid].mean())
    Gg = vr.grad(G.astype(np.float32))
    Gg[~valid] = float(Gg[valid].mean())
    scale = 4  # 1 m pixels
    c0, r0 = vr.tm_to_px(E0, N0)
    half = int((AUTO_SEARCH_M + 1.9 * reach * h0) / vr.GSD)
    x0, y0 = max(0, int(c0) - half), max(0, int(r0) - half)
    big = cv2.cvtColor(np.ascontiguousarray(sheet[y0:int(r0) + half, x0:int(c0) + half]), cv2.COLOR_RGB2GRAY)
    search = vr.grad(cv2.resize(big, (big.shape[1] // scale, big.shape[0] // scale), interpolation=cv2.INTER_AREA)).astype(np.float32)
    def run(hs, yaws):
        best = (-1, None)
        tpls = {h: cv2.resize(Gg, (max(8, int(round(2 * reach * h / (vr.GSD * scale)))),) * 2, interpolation=cv2.INTER_AREA) for h in hs}
        for yaw in yaws:
            rot, inv = vr.rotated_search(search, yaw)
            for h, tpl in tpls.items():
                sc, found = vr.best_match(rot, tpl)
                if sc > best[0]:
                    best = (sc, (float(h), float(yaw) % 360, vr.locate(found, tpl, inv, (x0, y0), scale)))
        return best
    best = run(list(h0 * np.arange(0.6, 1.801, 0.05)), range(0, 360, 2))
    h, yaw, _ = best[1]
    best = run([h * k for k in np.arange(0.94, 1.061, 0.02)], [yaw + k for k in np.arange(-2, 2.01, 0.5)])
    h, yaw, (col, row) = best[1]
    E, N = vr.px_to_tm(col, row)
    return dict(E=float(E), N=float(N), h=float(h), yaw=float(yaw), score=float(best[0]))


GUIDE_M = 3.0
DECOY_M = 12.0


def auto_points(scene, E0, N0, h0, max_points=60, seed=None):
    """Control points: coarse pose from the whole ground-projected cube (coarse_pose), then SIFT keypoints of the ground
    image matched only to photo keypoints within GUIDE_M of where that pose puts them, a 2-point similarity RANSAC
    (scale 0.8-1.25), and the inliers as control points in virtual d-face pixels with the cube face/pixel they were seen
    in. Returns (points, info)."""
    sheet = vr.open_sheet()
    reach = min(GROUND_REACH, GROUND_MAX_M / h0)
    cp = dict(seed) if seed else coarse_pose(scene, sheet, E0, N0, h0, reach)
    h1 = cp["h"]
    # guide radius: 3 m for a tight seed, up to 8 m for a rough one (its own residual RMS x 2)
    guide_m = min(8.0, max(GUIDE_M, 2 * float(cp.get("rmsM") or 0)))
    reach = min(GROUND_REACH, GROUND_MAX_M / h1)
    n = int(2 * reach * h1 / AUTO_GSD)
    g = (np.arange(n, dtype=np.float32) + 0.5) / n * 2 * reach - reach
    xs, ys = np.meshgrid(g, g)
    gimg, _ = ground_image(scene, xs, ys, gray=True)
    gimg = np.clip(gimg, 0, 255).astype(np.uint8)
    c1, r1 = vr.tm_to_px(cp["E"], cp["N"])
    R = int((reach * h1 + 2 * guide_m) / vr.GSD)
    cs, rs = max(0, int(c1) - R), max(0, int(r1) - R)
    ph = cv2.cvtColor(np.ascontiguousarray(sheet[rs:int(r1) + R, cs:int(c1) + R]), cv2.COLOR_RGB2GRAY)
    up = vr.GSD / AUTO_GSD
    ph = cv2.resize(ph, None, fx=up, fy=up, interpolation=cv2.INTER_CUBIC)
    clahe = cv2.createCLAHE(2.0, (8, 8))
    gimg, ph = clahe.apply(gimg), clahe.apply(ph)
    sift = cv2.SIFT_create(nfeatures=20000)
    kf, df = sift.detectAndCompute(gimg, None)
    kp, dp = sift.detectAndCompute(ph, None)
    info = dict(seed={k: round(float(cp[k]), 3) for k in ("E", "N", "h", "yaw")}, seededBy=(cp.get("source") or "seed") if seed else "coarse NCC", guideM=round(guide_m, 1))
    if df is None or dp is None or len(kf) < 8 or len(kp) < 8:
        return [], dict(info, reason="too few features")
    # predicted photo position (upsampled px) of each ground keypoint under the coarse pose
    t = math.radians(cp["yaw"])
    a, b = h1 * math.cos(t), h1 * math.sin(t)
    P = np.float32([k.pt for k in kp])
    src, dst = [], []
    for i, k in enumerate(kf):
        x = (k.pt[0] / n * 2 - 1) * reach
        y = (k.pt[1] / n * 2 - 1) * reach
        pc, pr = vr.tm_to_px(cp["E"] + a * x - b * y, cp["N"] - b * x - a * y)
        u, v = (pc - cs) * up, (pr - rs) * up
        near = np.where(np.hypot(P[:, 0] - u, P[:, 1] - v) < guide_m / AUTO_GSD)[0]
        if len(near) == 0:
            continue
        dist = np.linalg.norm(dp[near] - df[i], axis=1)
        order = np.argsort(dist)
        if len(order) > 1 and dist[order[0]] > 0.9 * dist[order[1]]:
            continue
        src.append(k.pt)
        dst.append(P[near[order[0]]])
    info["guided"] = len(src)
    if len(src) < 6:
        return [], dict(info, reason=f"{len(src)} guided matches")
    src, dst = np.float32(src), np.float32(dst)
    inl, scale = similarity_ransac(src, dst, scale_range=(0.8, 1.25))
    if inl is None:
        return [], dict(info, reason="no consistent similarity")
    pts = []
    for (u, v), (px, py) in zip(src[inl], dst[inl]):
        x = (u / n * 2 - 1) * reach
        y = (v / n * 2 - 1) * reach
        face, fc, fr = face_pixel(x, y)
        # virtual d-face pixels are relative to the coarse height h1; the solver works in units of h, so rescale to h1
        pts.append(dict(face="d", col=round(float(1023.5 + 1024 * x), 1), row=round(float(1023.5 + 1024 * y), 1),
                        sc=round(float(cs + px / up), 2), sr=round(float(rs + py / up), 2),
                        seen=dict(face=face, col=fc, row=fr), what="ground-projected cube pixel matched on the sheet (guided SIFT/RANSAC)"))
    if len(pts) > max_points:
        chosen = [0]
        while len(chosen) < max_points:
            dmin = [min(math.hypot(q["col"] - pts[c]["col"], q["row"] - pts[c]["row"]) for c in chosen) for q in pts]
            chosen.append(int(np.argmax(dmin)))
        pts = [pts[i] for i in chosen]
    return pts, dict(info, inliers=int(inl.sum()), scale=round(scale, 3), reachH=round(reach, 2),
                     faces=sorted({q["seen"]["face"] for q in pts if q["seen"]["face"]}))


def pick_sheet2(scene, out, E, N, h, half_m, reach=GROUND_REACH):
    """Left: the ground-projected cube in virtual d-face pixels (image-up = the face yaw), grid every 256 px labelled.
    Right: the NGII crop around (E, N), grid every 20 sheet px labelled. Points are read as (col, row) left and (sc, sr)
    right."""
    sheet = vr.open_sheet()
    n = 1024
    g = (np.arange(n, dtype=np.float32) + 0.5) / n * 2 * reach - reach
    xs, ys = np.meshgrid(g, g)
    G, src = ground_image(scene, xs, ys, gray=False)
    G[src < 0] = 40
    left = Image.fromarray(np.clip(G, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(left)
    lo, hi = 1023.5 - 1024 * reach, 1023.5 + 1024 * reach
    for v in range(int(math.ceil(lo / 256) * 256), int(hi) + 1, 256):
        X = (v - lo) / (hi - lo) * n
        colr = (255, 255, 0) if v % 1024 == 0 else (150, 150, 0)
        d.line([(X, 0), (X, n)], fill=colr, width=1)
        d.line([(0, X), (n, X)], fill=colr, width=1)
        d.text((X + 2, 2), str(v), fill="yellow")
        d.text((2, X + 2), str(v), fill="yellow")
    d.text((4, 1010), f"ground-projected cube (virtual d px), up = old yaw; reach {reach:.1f} h", fill="white")
    c0, r0 = vr.tm_to_px(E, N)
    R = int(half_m / vr.GSD)
    S = 1024 / (2 * R)
    cs, rs = int(c0) - R, int(r0) - R
    right = Image.fromarray(np.array(sheet[rs:rs + 2 * R, cs:cs + 2 * R])).resize((1024, 1024), Image.BICUBIC)
    p = ImageDraw.Draw(right)
    step = 20 if R <= 250 else 40
    for k in range(0, 2 * R + 1):
        if (cs + k) % step == 0:
            p.line([((k + 0.5) * S, 0), ((k + 0.5) * S, 1024)], fill=(150, 150, 0), width=1)
            p.text(((k + 0.5) * S + 2, 2), str(cs + k), fill="yellow")
        if (rs + k) % step == 0:
            p.line([(0, (k + 0.5) * S), (1024, (k + 0.5) * S)], fill=(150, 150, 0), width=1)
            p.text((2, (k + 0.5) * S + 2), str(rs + k), fill="yellow")
    p.ellipse([(c0 - cs) * S - 5, (r0 - rs) * S - 5, (c0 - cs) * S + 5, (r0 - rs) * S + 5], outline="red", width=2)
    p.text((4, 1010), "NGII 2025 (sheet px, north up); red = old station", fill="white")
    img = Image.new("RGB", (2056, 1040), (30, 30, 30))
    img.paste(left, (0, 16))
    img.paste(right, (1032, 16))
    ImageDraw.Draw(img).text((4, 2), scene, fill="white")
    img.save(out)


def global_sift_pose(scene, sheet, E0, N0, h0, reach):
    """Unguided SIFT between the ground-projected cube (reach in units of h; 1 = the d face only) and the photo window
    around the old station, similarity RANSAC with scale 0.5-2, least squares on the inliers. Returns a solution or None."""
    n = int(2 * reach * h0 / AUTO_GSD)
    g = (np.arange(n, dtype=np.float32) + 0.5) / n * 2 * reach - reach
    xs, ys = np.meshgrid(g, g)
    gimg, _ = ground_image(scene, xs, ys, gray=True)
    gimg = np.clip(gimg, 0, 255).astype(np.uint8)
    c0, r0 = vr.tm_to_px(E0, N0)
    R = int((AUTO_SEARCH_M + 1.6 * reach * h0) / vr.GSD)
    cs, rs = max(0, int(c0) - R), max(0, int(r0) - R)
    ph = cv2.cvtColor(np.ascontiguousarray(sheet[rs:int(r0) + R, cs:int(c0) + R]), cv2.COLOR_RGB2GRAY)
    up = vr.GSD / AUTO_GSD
    ph = cv2.resize(ph, None, fx=up, fy=up, interpolation=cv2.INTER_CUBIC)
    clahe = cv2.createCLAHE(2.0, (8, 8))
    gimg, ph = clahe.apply(gimg), clahe.apply(ph)
    sift = cv2.SIFT_create(nfeatures=20000)
    kf, df = sift.detectAndCompute(gimg, None)
    kp, dp = sift.detectAndCompute(ph, None)
    if df is None or dp is None or len(kf) < 8 or len(kp) < 8:
        return None
    matches = cv2.BFMatcher(cv2.NORM_L2).knnMatch(df, dp, k=2)
    good = [m for m, nn in (p for p in matches if len(p) == 2) if m.distance < 0.85 * nn.distance]
    if len(good) < 6:
        return None
    src = np.float32([kf[m.queryIdx].pt for m in good])
    dst = np.float32([kp[m.trainIdx].pt for m in good])
    inl, scale = similarity_ransac(src, dst)
    if inl is None or inl.sum() < 4:
        return None
    pts = []
    for (u, v), (px, py) in zip(src[inl], dst[inl]):
        x, y = (u / n * 2 - 1) * reach, (v / n * 2 - 1) * reach
        pts.append(dict(face="d", col=float(1023.5 + 1024 * x), row=float(1023.5 + 1024 * y), sc=float(cs + px / up), sr=float(rs + py / up)))
    sol = solve_points(pts, [E0, N0, 0, h0])
    sol["inliersRansac"] = int(inl.sum())
    return sol


def triage(scene, stations, out, centre=None):
    s, E0, N0, h0, yaw0 = station(stations, scene)
    if centre:
        E0, N0 = centre
    sheet = vr.open_sheet()
    reach = min(GROUND_REACH, GROUND_MAX_M / h0)
    cands = {"old": dict(E=E0, N=N0, h=h0, yaw=yaw0)}
    for name, rr in (("siftD", 1.0), ("siftG", reach)):
        sol = global_sift_pose(scene, sheet, E0, N0, h0, rr)
        if sol:
            cands[name] = sol
    cands["ncc"] = coarse_pose(scene, sheet, E0, N0, h0, reach)
    panels = []
    for name, pose in cands.items():
        tmp = Path(out).with_suffix(f".{name}.png")
        check_view(scene, pose, tmp, half_m=min(1.15 * GROUND_REACH * pose["h"], 1.15 * GROUND_MAX_M) if pose["h"] > 0 else 40)
        im = Image.open(tmp).resize((512, 512))
        ImageDraw.Draw(im).rectangle([0, 0, 511, 14], fill=(0, 0, 0))
        extra = f" n{pose.get('inliersRansac', '')} rms{pose.get('rmsM', 0):.2f}" if "rmsM" in pose else ""
        ImageDraw.Draw(im).text((3, 2), f"{name}: h{pose['h']:.1f} yaw{pose['yaw']:.1f}{extra}", fill="white")
        panels.append(im)
        tmp.unlink()
    sheet_img = Image.new("RGB", (512 * len(panels) + 6 * (len(panels) - 1), 512), (30, 30, 30))
    for i, im in enumerate(panels):
        sheet_img.paste(im, (i * 518, 0))
    sheet_img.save(out)
    return {k: {kk: (round(float(v), 3) if isinstance(v, (float, int, np.floating)) else v) for kk, v in c.items() if kk in ("E", "N", "h", "yaw", "rmsM", "inliersRansac", "score")} for k, c in cands.items()}


# ---------------------------------------------------------------- photometric landscape test
LAND_M = 12.0
LAND_REACH = 2.5


def landscape(scene, pose):
    """Gradient NCC of the ground-projected cube (warped north-up at the pose's yaw and height, out to LAND_REACH h, max
    GROUND_MAX_M) against the photo, over +-LAND_M shifts, yaw +-2 deg, h +-4 %. Returns the best shift (m), its yaw/h
    offsets, the peak score and the best score outside 3 m of the peak (the runner-up)."""
    sheet = vr.open_sheet()
    E, N = pose["E"], pose["N"]
    best = None
    for dyaw in (-2, -1, 0, 1, 2):
        for kh in (0.96, 1.0, 1.04):
            h, yaw = pose["h"] * kh, pose["yaw"] + dyaw
            reach_m = min(LAND_REACH * h, GROUND_MAX_M)
            R = int(reach_m / vr.GSD)
            n = 2 * R
            cols, rows = np.meshgrid(np.arange(n, dtype=np.float32) - R + 0.5, np.arange(n, dtype=np.float32) - R + 0.5)
            dE, dN = cols * vr.GSD, -rows * vr.GSD
            t = math.radians(yaw)
            a, b = h * math.cos(t), h * math.sin(t)
            x = ((a * dE - b * dN) / (h * h)).astype(np.float32)
            y = ((-b * dE - a * dN) / (h * h)).astype(np.float32)
            G, src = ground_image(scene, x, y, gray=True)
            valid = (src >= 0) & (np.hypot(dE, dN) < reach_m)
            tpl = vr.grad(G.astype(np.float32))
            tpl[~valid] = 0
            tpl = (tpl - tpl[valid].mean()) * valid
            c0, r0 = vr.tm_to_px(E, N)
            S = R + int(LAND_M / vr.GSD)
            ph = cv2.cvtColor(np.ascontiguousarray(sheet[int(r0) - S:int(r0) + S, int(c0) - S:int(c0) + S]), cv2.COLOR_RGB2GRAY)
            res = cv2.matchTemplate(vr.grad(ph).astype(np.float32), tpl.astype(np.float32), cv2.TM_CCORR_NORMED, mask=valid.astype(np.float32))
            res[~np.isfinite(res)] = 0
            _, peak, _, loc = cv2.minMaxLoc(res)
            if best is None or peak > best["peak"]:
                yy, xx = np.mgrid[0:res.shape[0], 0:res.shape[1]]
                far = np.hypot(xx - loc[0], yy - loc[1]) > 3 / vr.GSD
                c = (res.shape[1] - 1) / 2
                best = dict(peak=float(peak), runnerUp=float(res[far].max()), dxM=float((loc[0] - c) * vr.GSD), dyM=float((c - loc[1]) * vr.GSD),
                            dyaw=dyaw, kh=kh, zeroScore=float(res[int(round(c)), int(round(c))]))
    best["shiftM"] = math.hypot(best["dxM"], best["dyM"])
    best["contrast"] = best["peak"] / max(1e-6, best["runnerUp"])
    best["passed"] = bool(best["shiftM"] <= 1.0 and abs(best["dyaw"]) <= 1 and best["contrast"] >= LAND_CONTRAST)
    return best


LAND_CONTRAST = 1.05


def main():
    cmd = sys.argv[1]
    global SCENE_FIT
    if cmd == "sheet":
        scene, out = sys.argv[2], sys.argv[3]
        stations = json.loads((HERE / "vr-stations.json").read_text())
        SCENE_FIT = fit_scene_frame(stations)
        s, E, N, h, yaw = station(stations, scene)
        if "--E" in sys.argv:
            E, N = float(sys.argv[sys.argv.index("--E") + 1]), float(sys.argv[sys.argv.index("--N") + 1])
        half = float(sys.argv[sys.argv.index("--half") + 1]) if "--half" in sys.argv else 40
        pick_sheet(scene, out, E, N, h, yaw, half)
        print(scene, "old", round(E, 1), round(N, 1), "h", h, "yaw", yaw)
    elif cmd == "triage":
        # triage <cands.json> <outdir> [--scenes a,b]
        stations = json.loads((HERE / "vr-stations.json").read_text())
        SCENE_FIT = fit_scene_frame(stations)
        cpath, outdir = Path(sys.argv[2]), Path(sys.argv[3])
        cands = json.loads(cpath.read_text()) if cpath.exists() else {}
        only = sys.argv[sys.argv.index("--scenes") + 1].split(",") if "--scenes" in sys.argv else [q["scene"] for q in stations]
        for scene in only:
            centres = json.loads(Path(sys.argv[sys.argv.index("--centres") + 1]).read_text()) if "--centres" in sys.argv else {}
            cands[scene] = triage(scene, stations, outdir / f"triage-{scene}.png", centres.get(scene))
            print(scene, json.dumps(cands[scene]), flush=True)
            cpath.write_text(json.dumps(cands, indent=1))
    elif cmd == "sheet2":
        scene, out = sys.argv[2], sys.argv[3]
        stations = json.loads((HERE / "vr-stations.json").read_text())
        SCENE_FIT = fit_scene_frame(stations)
        s, E, N, h, yaw = station(stations, scene)
        if "--E" in sys.argv:
            E, N = float(sys.argv[sys.argv.index("--E") + 1]), float(sys.argv[sys.argv.index("--N") + 1])
        half = float(sys.argv[sys.argv.index("--half") + 1]) if "--half" in sys.argv else min(140, 45 + 3.5 * h)
        reach = float(sys.argv[sys.argv.index("--reach") + 1]) if "--reach" in sys.argv else min(GROUND_REACH, GROUND_MAX_M * 1.6 / h)
        pick_sheet2(scene, out, E, N, h, half, reach)
        print(scene, "old", round(E, 1), round(N, 1), "h", h, "yaw", yaw, "half", round(half), "reach", round(reach, 2))
    elif cmd == "solve":
        pts_all = json.loads(Path(sys.argv[2]).read_text())
        stations = json.loads(Path(sys.argv[3]).read_text())
        SCENE_FIT = fit_scene_frame(stations)
        out_path = Path(sys.argv[4])
        results = json.loads(out_path.read_text()) if out_path.exists() else {}
        only = set(sys.argv[sys.argv.index("--scenes") + 1].split(",")) if "--scenes" in sys.argv else None
        for scene, entry in pts_all.items():
            if only and scene not in only:
                continue
            s, E0, N0, h0, yaw0 = station(stations, scene)
            sol = solve_points(entry["points"], [E0, N0, yaw0, h0])
            sol["oldShiftM"] = float(math.hypot(sol["E"] - E0, sol["N"] - N0))
            # split-half check: even and odd points solved alone; the two poses must agree (independent of RANSAC)
            pts = entry["points"]
            if len(pts) >= 8:
                a_, b_ = solve_points(pts[0::2], [E0, N0, yaw0, h0]), solve_points(pts[1::2], [E0, N0, yaw0, h0])
                sol["splitPosM"] = float(math.hypot(a_["E"] - b_["E"], a_["N"] - b_["N"]))
                sol["splitYawDeg"] = float(abs(((a_["yaw"] - b_["yaw"] + 540) % 360) - 180))
                sol["splitHM"] = float(abs(a_["h"] - b_["h"]))
                if sol["splitPosM"] > ACCEPT["sigmaPosM"] or sol["splitYawDeg"] > ACCEPT["sigmaYawDeg"]:
                    sol["accepted"] = False
                    sol["why"] = f"split halves disagree by {sol['splitPosM']:.2f} m / {sol['splitYawDeg']:.2f} deg"
            sol["oldDyawDeg"] = float(((sol["yaw"] - yaw0 + 540) % 360) - 180)
            if "--refine" in sys.argv and sol["nD"] >= 3 and sol["accepted"]:
                sol["refined"] = refine(scene, sol)
            results[scene] = sol
            rf = sol.get("refined") or {}
            print(scene, f"n{sol['n']} rms {sol['rmsM']:.2f} max {sol['maxResM']:.2f} sPos {sol['sigmaPosM']:.2f} sYaw {sol['sigmaYawDeg']:.2f} split {sol.get('splitPosM', float('nan')):.2f}m/{sol.get('splitYawDeg', float('nan')):.2f}deg h {sol['h']:.1f} yaw {sol['yaw']:.1f} shift {sol['oldShiftM']:.1f} acc {sol['accepted']}",
                  f"| refined q {rf.get('quadrantRmsM', float('nan')):.2f} m {rf.get('quadrantYawSdDeg', float('nan')):.2f} deg d {rf.get('shiftFromPointsM', float('nan')):.2f} acc {rf.get('accepted')}" if rf else "", flush=True)
        out_path.write_text(json.dumps(results, indent=1))
    elif cmd == "auto":
        # auto <points.json> [--scenes a,b] [--h-scale k]: adds SIFT/RANSAC control points per scene (overwrites that scene)
        pts_path = Path(sys.argv[2])
        stations = json.loads((HERE / "vr-stations.json").read_text())
        SCENE_FIT = fit_scene_frame(stations)
        allpts = json.loads(pts_path.read_text()) if pts_path.exists() else {}
        only = sys.argv[sys.argv.index("--scenes") + 1].split(",") if "--scenes" in sys.argv else [q["scene"] for q in stations]
        hk = float(sys.argv[sys.argv.index("--h-scale") + 1]) if "--h-scale" in sys.argv else 1.0
        seeds = json.loads(Path(sys.argv[sys.argv.index("--seed") + 1]).read_text()) if "--seed" in sys.argv else {}
        for scene in only:
            _, E0, N0, h0, _ = station(stations, scene)
            if "--seed" in sys.argv and scene not in seeds:
                continue
            manual = allpts.get(scene, {}).get("manual", [])
            pts, info = auto_points(scene, E0, N0, h0 * hk, seed=seeds.get(scene))
            print(scene, json.dumps(info), flush=True)
            if len(pts) >= 3:
                allpts[scene] = dict(method="manual control points read on the ground-projected cube and the NGII sheet seed a guided SIFT match (3 m window) whose RANSAC inliers are the control points; checked on the warped blend",
                                     manual=manual, info=info, points=pts)
        pts_path.write_text(json.dumps(allpts, indent=1))
    elif cmd == "decoy":
        # decoy <sol.json> <out.json> [--scenes a,b]: guided-match inliers at the solved pose vs 4 poses shifted DECOY_M
        sol_all = json.loads(Path(sys.argv[2]).read_text())
        out_path = Path(sys.argv[3])
        stations = json.loads((HERE / "vr-stations.json").read_text())
        SCENE_FIT = fit_scene_frame(stations)
        res = json.loads(out_path.read_text()) if out_path.exists() else {}
        only = sys.argv[sys.argv.index("--scenes") + 1].split(",") if "--scenes" in sys.argv else list(sol_all)
        for scene in only:
            sol = sol_all[scene]
            base = dict(E=sol["E"], N=sol["N"], h=sol["h"], yaw=sol["yaw"])
            counts = {}
            for name, (dE, dN) in {"true": (0, 0), "N": (0, DECOY_M), "S": (0, -DECOY_M), "E": (DECOY_M, 0), "W": (-DECOY_M, 0)}.items():
                seed = dict(base, E=base["E"] + dE, N=base["N"] + dN)
                pts, info = auto_points(scene, seed["E"], seed["N"], seed["h"], max_points=10 ** 6, seed=seed)
                counts[name] = int(info.get("inliers", 0))
            best_decoy = max(v for k, v in counts.items() if k != "true")
            res[scene] = dict(counts, ratio=round(counts["true"] / max(1, best_decoy), 2), passed=bool(counts["true"] >= 2 * max(1, best_decoy)))
            print(scene, json.dumps(res[scene]), flush=True)
            out_path.write_text(json.dumps(res, indent=1))
    elif cmd == "landscape":
        sol_all = json.loads(Path(sys.argv[2]).read_text())
        out_path = Path(sys.argv[3])
        stations = json.loads((HERE / "vr-stations.json").read_text())
        SCENE_FIT = fit_scene_frame(stations)
        res = json.loads(out_path.read_text()) if out_path.exists() else {}
        only = sys.argv[sys.argv.index("--scenes") + 1].split(",") if "--scenes" in sys.argv else list(sol_all)
        for scene in only:
            sol = sol_all[scene]
            res[scene] = landscape(scene, dict(E=sol["E"], N=sol["N"], h=sol["h"], yaw=sol["yaw"]))
            r = res[scene]
            print(scene, f"peak {r['peak']:.3f} runner {r['runnerUp']:.3f} contrast {r['contrast']:.3f} shift {r['shiftM']:.2f} m (dx {r['dxM']:.2f} dy {r['dyM']:.2f}) dyaw {r['dyaw']} kh {r['kh']} pass {r['passed']}", flush=True)
            out_path.write_text(json.dumps(res, indent=1))
    elif cmd == "check":
        # check <solved.json|stations> <scene> <out.png> [--points <points.json>] [--old]
        scene, out = sys.argv[3], sys.argv[4]
        stations = json.loads((HERE / "vr-stations.json").read_text())
        SCENE_FIT = fit_scene_frame(stations)
        if "--old" in sys.argv:
            _, E, N, h, yaw = station(stations, scene)
            pose = dict(E=E, N=N, h=h, yaw=yaw)
        else:
            sol = json.loads(Path(sys.argv[2]).read_text())[scene]
            pose = sol.get("refined") if sol.get("refined", {}).get("accepted") and "--points-only" not in sys.argv else sol
        pts = json.loads(Path(sys.argv[sys.argv.index("--points") + 1]).read_text()).get(scene, {}).get("points", []) if "--points" in sys.argv else []
        check_view(scene, pose, out, pts)
    elif cmd == "apply":
        solved = json.loads(Path(sys.argv[2]).read_text())
        path = Path(sys.argv[3])
        pts_all = json.loads(Path(sys.argv[sys.argv.index("--points") + 1]).read_text()) if "--points" in sys.argv else {}
        only = set(sys.argv[sys.argv.index("--scenes") + 1].split(",")) if "--scenes" in sys.argv else None
        stations = json.loads(path.read_text())
        SCENE_FIT = fit_scene_frame(stations)
        n = 0
        for s in stations:
            sol = solved.get(s["scene"])
            if not sol:
                continue
            if only and s["scene"] not in only:
                continue
            if not sol["accepted"]:
                continue
            rf = sol.get("refined") or {}
            x, z = tm_to_scene(sol["E"], sol["N"])
            s.update(station_refined_x=round(x, 2), station_refined_z=round(z, 2), yaw_refined_deg=round(sol["yaw"], 2),
                     height_refined_m=round(sol["h"], 2), refined_by="manual control-point resection (scripts/perf/vr_control_points.py)",
                     refined_note=(f"{sol['n']} control points on the ground-projected cube and the NGII 2025 sheet (scripts/perf/vr-control-points.json; "
                                   f"seeded by {(pts_all.get(s['scene'], {}).get('info', {}) or {}).get('seededBy', 'manual points')}); least squares: residual RMS {sol['rmsM']:.2f} m, max {sol['maxResM']:.2f} m; "
                                   f"split-half agreement {sol.get('splitPosM', float('nan')):.2f} m / {sol.get('splitYawDeg', float('nan')):.2f} deg; "
                                   f"formal sigma {sol['sigmaPosM']:.2f} m / {sol['sigmaYawDeg']:.2f} deg"
                                   + (f"; d-face NCC quadrant test {rf['quadrantRmsM']:.2f} m / {rf['quadrantYawSdDeg']:.2f} deg" if rf else "")
                                   + "; height from the face scale (estimated)"),
                     refined_confidence=0.85, refined_residual_deg=round(max(sol.get("splitYawDeg", 0), sol["sigmaYawDeg"]), 2),
                     refined_residual_m=round(max(sol.get("splitPosM", 0), sol["sigmaPosM"]), 2))
            n += 1
        path.write_text(json.dumps(stations, indent=2, ensure_ascii=False) + "\n")
        print(f"applied {n} stations")


if __name__ == "__main__":
    main()
