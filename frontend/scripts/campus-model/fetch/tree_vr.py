"""Crown colours read on the SCNU 360 VR tour cube faces (visual reference only; nothing is copied or committed).

    uv run --no-project --with numpy==2.5.4 --with pillow==11.3.0 python -I tree_vr.py INPUT.json OUTPUT.json

treeInventory.mjs writes INPUT and reads OUTPUT. Scene frame (lib/frame.mjs): +x east, +z south, y up, scene units.

INPUT:  crowns     [[x, z, groundY, crownBaseY, topY, radius], ...] (scene units)
        stations   [{scene, x, z, y, yaw}] camera positions (refined when the record has them) and face-f bearing
        buildings  [{ring: [[x, z], ...], topY}] occluders (footprint prisms)
        vr         the .cache/vr directory (scene_<id>/pano_<f|r|b|l>.jpg, 2048 px krpano cube faces)
OUTPUT: per crown [views, r, g, b] (median sRGB of its visible pixels over the faces that see it; views 0 = unseen)

Method: each face (90 degree square perspective, column = 1024 + 1024 tan(horizontal angle), like
scripts/perf/lib/vrCamera.mjs) is drawn at 512 px as a depth buffer of every crown within MAX_RANGE_M as a screen
ellipse (its crown box: radius across, base to top up) at the depth of its nearest point; a pixel belongs to the
nearest crown. A crown is read where it owns pixels in the inner 70 % of its ellipse and no building prism stands
between it and the camera (the sight line passes under the prism top over the footprint). Its colour in that face is
the median of those pixels; over faces, the median of the face colours of the faces with at least MIN_PIXELS pixels,
nearest first, at most 3.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

U = 0.6242171526
RES = 512
MAX_RANGE_M = 110.0
MIN_RANGE_M = 15.0
MIN_PIXELS = 6
FACES = {"f": 0, "r": 90, "b": 180, "l": -90}


def segment_hits_building(cx, cz, cy, px, pz, py, buildings, index):
    # 2D crossings of the sight line with footprint edges; occluded when the line is below the prism top there.
    minx, maxx = min(cx, px), max(cx, px)
    minz, maxz = min(cz, pz), max(cz, pz)
    for bi in index:
        b = buildings[bi]
        bx0, bz0, bx1, bz1 = b["box"]
        if bx1 < minx or bx0 > maxx or bz1 < minz or bz0 > maxz:
            continue
        ring = b["ring"]
        for i in range(len(ring)):
            ax, az = ring[i - 1]
            bx, bz = ring[i]
            d = (px - cx) * (bz - az) - (pz - cz) * (bx - ax)
            if abs(d) < 1e-12:
                continue
            t = ((ax - cx) * (bz - az) - (az - cz) * (bx - ax)) / d
            s = ((ax - cx) * (pz - cz) - (az - cz) * (px - cx)) / d
            if 0.02 < t < 0.97 and 0 <= s <= 1:
                if cy + (py - cy) * t < b["topY"]:
                    return True
    return False


def main():
    inp = json.load(open(sys.argv[1]))
    crowns = np.array(inp["crowns"], dtype=np.float64)
    buildings = inp["buildings"]
    for b in buildings:
        xs = [p[0] for p in b["ring"]]
        zs = [p[1] for p in b["ring"]]
        b["box"] = (min(xs), min(zs), max(xs), max(zs))
    n = len(crowns)
    samples = [[] for _ in range(n)]  # (distance, r, g, b)
    yy, xx = np.mgrid[0:RES, 0:RES]
    for st in inp["stations"]:
        cx, cz, cy = st["x"], st["z"], st["y"]
        dx = crowns[:, 0] - cx
        dz = crowns[:, 1] - cz
        dist = np.hypot(dx, dz) / U
        near = np.where((dist < MAX_RANGE_M) & (dist > MIN_RANGE_M))[0]
        bidx = [i for i, b in enumerate(buildings) if b["box"][0] < cx + MAX_RANGE_M * U and b["box"][2] > cx - MAX_RANGE_M * U
                and b["box"][1] < cz + MAX_RANGE_M * U and b["box"][3] > cz - MAX_RANGE_M * U]
        for face, off in FACES.items():
            th = math.radians(st["yaw"] + off)
            fwd = (math.sin(th), -math.cos(th))
            right = (math.cos(th), math.sin(th))
            depth = np.full((RES, RES), np.inf)
            owner = np.full((RES, RES), -1, dtype=np.int64)
            boxes = {}
            for k in near:
                x, z, gy, by, ty, r = crowns[k]
                rx, rz = x - cx, z - cz
                zf = rx * fwd[0] + rz * fwd[1]
                if zf < r + 0.5:
                    continue
                u = (rx * right[0] + rz * right[1]) / zf
                ur = r / zf
                vt = (ty - cy) / zf
                vb = (by - cy) / zf
                c0 = (0.5 + 0.5 * (u - ur)) * RES
                c1 = (0.5 + 0.5 * (u + ur)) * RES
                r0 = (0.5 - 0.5 * vt) * RES
                r1 = (0.5 - 0.5 * vb) * RES
                if c1 < 0 or c0 >= RES or r1 < 0 or r0 >= RES or c1 - c0 < 1.5:
                    continue
                i0, i1 = max(0, int(c0)), min(RES, int(math.ceil(c1)))
                j0, j1 = max(0, int(r0)), min(RES, int(math.ceil(r1)))
                ex = (xx[j0:j1, i0:i1] + 0.5 - (c0 + c1) / 2) / max(0.5, (c1 - c0) / 2)
                ey = (yy[j0:j1, i0:i1] + 0.5 - (r0 + r1) / 2) / max(0.5, (r1 - r0) / 2)
                inside = ex * ex + ey * ey <= 1
                dz_ = zf - r
                sub = depth[j0:j1, i0:i1]
                win = inside & (dz_ < sub)
                sub[win] = dz_
                owner[j0:j1, i0:i1][win] = k
                boxes[k] = (c0, c1, r0, r1, zf)
            if not boxes:
                continue
            img = None
            debug = os.environ.get("TREE_VR_DEBUG")
            dbg = debug and st["scene"] in os.environ.get("TREE_VR_DEBUG_SCENES", "").split(",")
            marks = []
            for k, (c0, c1, r0, r1, zf) in boxes.items():
                i0, i1 = max(0, int(c0)), min(RES, int(math.ceil(c1)))
                j0, j1 = max(0, int(r0)), min(RES, int(math.ceil(r1)))
                ex = (xx[j0:j1, i0:i1] + 0.5 - (c0 + c1) / 2) / max(0.5, (c1 - c0) / 2)
                ey = (yy[j0:j1, i0:i1] + 0.5 - (r0 + r1) / 2) / max(0.5, (r1 - r0) / 2)
                mine = (owner[j0:j1, i0:i1] == k) & (ex * ex + ey * ey <= 0.49)
                cnt = int(mine.sum())
                if cnt < MIN_PIXELS:
                    continue
                x, z, gy, by, ty, r = crowns[k]
                if segment_hits_building(cx, cz, cy, x, z, (by + ty) / 2, buildings, bidx):
                    continue
                if img is None:
                    img = np.asarray(Image.open(f"{inp['vr']}/{st['scene']}/pano_{face}.jpg").convert("RGB").resize((RES, RES), Image.BILINEAR), dtype=np.float64)
                px = img[j0:j1, i0:i1][mine]
                med = np.median(px, axis=0)
                samples[k].append((float(np.hypot(x - cx, z - cz) / U), *[float(v) for v in med]))
                if dbg:
                    marks.append((mine, j0, i0, med))
            if dbg and img is not None:
                canvas = img.copy()
                for mine, j0, i0, med in marks:
                    jj, ii = np.nonzero(mine)
                    edge = np.zeros_like(mine)
                    edge[:-1, :] |= mine[:-1, :] != mine[1:, :]
                    edge[:, :-1] |= mine[:, :-1] != mine[:, 1:]
                    ej, ei = np.nonzero(edge & mine)
                    canvas[ej + j0, ei + i0] = (255, 0, 255)
                    cj, ci = int(jj.mean()) + j0, int(ii.mean()) + i0
                    canvas[max(0, cj - 3):cj + 4, max(0, ci - 3):ci + 4] = med
                Image.fromarray(canvas.astype(np.uint8)).save(f"{debug}/{st['scene']}-{face}.png")
    out = []
    for s in samples:
        if not s:
            out.append([0, 0, 0, 0])
            continue
        s.sort()
        use = np.array([v[1:] for v in s[:3]])
        med = np.median(use, axis=0)
        out.append([len(s), *[int(round(v)) for v in med]])
    json.dump(out, open(sys.argv[2], "w"))


# ---------------------------------------------------------------- near-station fit (mode "fit")
# For each station and each tree within FIT_RANGE_M (at least FIT_MIN_M away): the crown is projected into every face
# that sees it; where the tree owns at least FIT_VISIBLE of its crown ellipse in the depth buffer of all trees (and no
# building prism stands in front) the VR face is read at 1024 px: foliage pixels (hue 15-175 deg, saturation >= 0.15,
# value >= 0.08), their median colour inside the inner half of the ellipse, the width of the foliage run through the
# crown centre at mid-crown height (searched within 2.2 x the model crown; a run that reaches the search edge is a
# merged row, width unknown) and the top of the foliage contiguous above the centre (within 0.35 x the crown width
# of the centre column; a top at the image edge, or one without sky directly above it, is unknown). Widths and tops are turned into metres at the tree's depth.
FIT_RANGE_M = 40.0
FIT_MIN_M = 3.0
FIT_RES = 1024
FIT_VISIBLE = 0.45


def sky_mask(img):
    r, g, b = img[..., 0] / 255.0, img[..., 1] / 255.0, img[..., 2] / 255.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = np.where(mx > 0, (mx - mn) / (mx + 1e-9), 0)
    return ((b >= g) & (b > r) & (mx >= 0.45)) | ((sat < 0.12) & (mx >= 0.75))


def close_runs(row, gap):
    # fill gaps of at most `gap` pixels between foliage pixels of one row
    out = row.copy()
    idx = np.nonzero(row)[0]
    for a, b in zip(idx[:-1], idx[1:]):
        if 1 < b - a <= gap + 1:
            out[a:b] = True
    return out


def foliage_mask(img):
    r, g, b = img[..., 0] / 255.0, img[..., 1] / 255.0, img[..., 2] / 255.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    d = mx - mn + 1e-9
    hue = np.where(mx == r, (60 * ((g - b) / d)) % 360, np.where(mx == g, 60 * ((b - r) / d) + 120, 60 * ((r - g) / d) + 240))
    sat = np.where(mx > 0, d / (mx + 1e-9), 0)
    return (hue >= 15) & (hue <= 175) & (sat >= 0.15) & (mx >= 0.08)


def fit_main():
    inp = json.load(open(sys.argv[1]))
    trees = np.array(inp["trees"], dtype=np.float64)
    buildings = inp["buildings"]
    for b in buildings:
        xs = [p[0] for p in b["ring"]]
        zs = [p[1] for p in b["ring"]]
        b["box"] = (min(xs), min(zs), max(xs), max(zs))
    n = len(trees)
    obs = [[] for _ in range(n)]
    R = FIT_RES
    yy, xx = np.mgrid[0:R, 0:R]
    for st in inp["stations"]:
        cx, cz, cy = st["x"], st["z"], st["y"]
        dist = np.hypot(trees[:, 0] - cx, trees[:, 1] - cz) / U
        occ = np.where(dist < FIT_RANGE_M + 25)[0]
        target = set(np.where((dist <= FIT_RANGE_M) & (dist >= FIT_MIN_M))[0].tolist())
        if not target:
            continue
        bidx = [i for i, b in enumerate(buildings) if b["box"][0] < cx + 80 * U and b["box"][2] > cx - 80 * U and b["box"][1] < cz + 80 * U and b["box"][3] > cz - 80 * U]
        for face, off in FACES.items():
            th = math.radians(st["yaw"] + off)
            fwd = (math.sin(th), -math.cos(th))
            right = (math.cos(th), math.sin(th))
            depth = np.full((R, R), np.inf)
            owner = np.full((R, R), -1, dtype=np.int64)
            boxes = {}
            for k in occ:
                x, z, gy, by, ty, r = trees[k]
                rx, rz = x - cx, z - cz
                zf = rx * fwd[0] + rz * fwd[1]
                if zf < r + 0.5:
                    continue
                u = (rx * right[0] + rz * right[1]) / zf
                c0 = (0.5 + 0.5 * (u - r / zf)) * R
                c1 = (0.5 + 0.5 * (u + r / zf)) * R
                r0 = (0.5 - 0.5 * (ty - cy) / zf) * R
                r1 = (0.5 - 0.5 * (by - cy) / zf) * R
                if c1 < 0 or c0 >= R or r1 < 0 or r0 >= R:
                    continue
                i0, i1 = max(0, int(c0)), min(R, int(math.ceil(c1)))
                j0, j1 = max(0, int(r0)), min(R, int(math.ceil(r1)))
                if i1 <= i0 or j1 <= j0:
                    continue
                ex = (xx[j0:j1, i0:i1] + 0.5 - (c0 + c1) / 2) / max(0.5, (c1 - c0) / 2)
                ey = (yy[j0:j1, i0:i1] + 0.5 - (r0 + r1) / 2) / max(0.5, (r1 - r0) / 2)
                inside = ex * ex + ey * ey <= 1
                dz_ = zf - r
                sub = depth[j0:j1, i0:i1]
                win = inside & (dz_ < sub)
                sub[win] = dz_
                owner[j0:j1, i0:i1][win] = k
                if k in target:
                    boxes[k] = (c0, c1, r0, r1, zf, u, int(inside.sum()))
            if not boxes:
                continue
            img = None
            mask = None
            for k, (c0, c1, r0, r1, zf, u, area) in boxes.items():
                if c0 < 0 or c1 > R or r0 < 0 or r1 > R or area < 30:
                    continue
                i0, i1 = int(c0), int(math.ceil(c1))
                j0, j1 = int(r0), int(math.ceil(r1))
                own = int((owner[j0:j1, i0:i1] == k).sum())
                if own < FIT_VISIBLE * area:
                    continue
                x, z, gy, by, ty, r = trees[k]
                if segment_hits_building(cx, cz, cy, x, z, (by + ty) / 2, buildings, bidx):
                    continue
                if img is None:
                    img = np.asarray(Image.open(f"{inp['vr']}/{st['scene']}/pano_{face}.jpg").convert("RGB").resize((R, R), Image.BILINEAR), dtype=np.float64)
                    mask = foliage_mask(img)
                    sky = sky_mask(img)
                cc = (c0 + c1) / 2
                rc = (r0 + r1) / 2
                ex = (xx[j0:j1, i0:i1] + 0.5 - cc) / max(0.5, (c1 - c0) / 2)
                ey = (yy[j0:j1, i0:i1] + 0.5 - rc) / max(0.5, (r1 - r0) / 2)
                inner = (ex * ex + ey * ey <= 0.25) & mask[j0:j1, i0:i1]
                if inner.sum() < 8:
                    obs[k].append([st["scene"], face, round(float(dist[k]), 1), -1, -1, -1, -1.0, -1.0, round(own / area, 2)])
                    continue
                med = np.median(img[j0:j1, i0:i1][inner], axis=0)
                # width: foliage run through the centre at mid-crown height (5 rows)
                half = (c1 - c0) / 2
                lo = max(0, int(cc - 2.2 * half))
                hi = min(R - 1, int(cc + 2.2 * half))
                rows = slice(max(0, int(rc) - 2), min(R, int(rc) + 3))
                band = close_runs(mask[rows, :].any(axis=0), 4)
                ci = int(cc)
                width_m = -1.0
                if band[ci]:
                    a = ci
                    while a > lo and band[a - 1]:
                        a -= 1
                    b = ci
                    while b < hi and band[b + 1]:
                        b += 1
                    if a > lo and b < hi:
                        ua = (a / R - 0.5) * 2
                        ub = ((b + 1) / R - 0.5) * 2
                        width_m = (ub - ua) * zf / U
                # top: foliage contiguous above the centre within 0.35 x crown width of the centre column
                cl = max(0, int(cc - 0.35 * half * 2))
                cr = min(R, int(cc + 0.35 * half * 2) + 1)
                top_y = -1.0
                j = int(rc)
                gap = 0
                last = j
                while j > 0 and gap <= 3:
                    j -= 1
                    if mask[j, cl:cr].any():
                        last = j
                        gap = 0
                    else:
                        gap += 1
                # a top counts only where sky lies directly above it (else the foliage runs on into trees or a hill behind)
                above = sky[max(0, last - 7):max(0, last - 1), cl:cr]
                if j > 0 and above.size and above.mean() >= 0.6:
                    v = (0.5 - last / R) * 2
                    top_y = (cy + v * zf - gy) / U
                obs[k].append([st["scene"], face, round(float(dist[k]), 1), int(med[0]), int(med[1]), int(med[2]), round(width_m, 2), round(top_y, 2), round(own / area, 2)])
    json.dump(obs, open(sys.argv[2], "w"))


if __name__ == "__main__":
    if len(sys.argv) > 3 and sys.argv[3] == "fit":
        fit_main()
    else:
        main()
