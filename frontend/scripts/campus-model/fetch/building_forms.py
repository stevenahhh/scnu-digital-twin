"""Building forms (masses, voids, roofs) from the VWorld LOD4 building meshes, checked against the NGII 2025 orthophoto.

    uv run --no-project --with shapely==2.2.0 --with numpy==2.5.4 --with opencv-python-headless==5.0.0.93 \
        python -I building_forms.py INPUT.json OUTPUT.json

buildingForms.mjs writes INPUT and turns OUTPUT into data/building-forms.json. All plan coordinates are metres in the
campus model frame (east, north; uni.glb scene units / 0.6242), heights are metres.

INPUT:  models     LOD4 models: name, positions [e, n, h (ellipsoidal)...], indices
        buildings  the buildings the generator models: key, label, floors, parts [{outer, holes, heightMetres, ...}]
                   (their current footprints), terrain (1 m grid of the generator's terrain heights)
        photo      the NGII sheet: tif path, data offset, width, height, affine (e, n) -> (column, row)
        leanField  the relief-lean field fitted in the registration study (TM metres per metre of height)

Method, per building:
  1. Ownership. A LOD4 model belongs to the buildings whose footprints it overlaps (at least 30 % of its roof plan
     over modelled footprints, or at least 70 % of one footprint under it); a model shared by several buildings is
     split between them by nearest footprint. Each building keeps the triangles within 10 m of its footprint.
  2. Ground: the 2nd percentile of the wall vertex heights. Heights below are metres above it.
  3. Roof pieces: up-facing triangles (normal within 80 degrees of up). Flat ones (within 10 degrees) are grouped by
     height (0.25 m gaps) and unioned in plan; sloped ones are split into roof surfaces (triangles sharing an edge,
     end points welded within 6 cm; surfaces that touch in plan at the same height, within 0.3 m, are one surface),
     so a stair-tower cap or a ramp is not merged into the roof beside it, and each surface keeps its triangles.
     Pieces whose mean width is under 0.65 m are parapet tops: they set the parapet height of the wider piece
     0.15-3 m below them and are dropped. Pieces under 6 m2 (plant, vents) and below 1 m (steps, plinths) are
     dropped.
  4. Masses: pieces from the highest down, each minus everything higher, then opened by 0.2 m. Neighbouring flat
     masses within 0.3 m of each other are merged. The result is a set of disjoint plan regions with one roof each;
     the gaps narrower than 1.2 m this leaves between them (dropped parapet strips, the opening) are given to the
     flat mass they share the longest edge with, so no crack opens between neighbouring masses.
  5. Raised bases: down-facing triangles at least 1.8 m above ground (and 2 m above the local terrain) under which the
     mesh has no roof and no enclosed solid (a horizontal slice through the gap, its wall segments welded within
     6 cm, finds no inside) are soffits; a mass over a soffit is split there and that part starts at the soffit
     (pilotis, through-passages, bridges, canopies, eave overhangs); a raised part of a pitched mass keeps the roof
     triangles over it and takes its height from them. Small closed sections in a slice below a raised part are its
     columns.
  6. Kinds, floors, roof types, voids (courtyards: the open part of a hole in the union of the masses, at least
     1.5 m wide and 10 m2; light wells: masses at least 4 m below all their neighbours; passages under raised
     masses at least 1.6 m thick).
  7. Photo check: the roof outline in the photo is displaced by relief lean (about 0.2 m per metre of height on campus,
     towards the middle of the campus). The lean is fitted per candidate (LOD4 masses, curated form, traced outline,
     current footprint) around the registration field (maximum IoU, at most 0.12 m/m off the field), and the building
     keeps the lean of the source it ends up with. The photo roof outline comes from a marker-controlled watershed on the NGII
     sheet: roof seeds where both candidates (LOD4 masses and the current footprint) agree, 2 m inside their outline;
     background seeds 5 m outside and on textured vegetation. IoU is counted outside cast shadows. LOD4 masses whose
     own photo support is under 25 % are dropped when small (they are not on the 2025 photo).
  8. Source: LOD4 masses when their IoU is at least 0.70; for a building
     LOD4 does not show, the curated form of its data/scnu-facades.json entry (masses traced on the NGII sheet, heights
     from storey counts; its photo IoU is reported, not used to reject it: roof gardens read as vegetation and courts
     sit in cast shadow); else a photo-traced outline or the current footprint (flagged).
Everything here is an estimate derived from VWorld's LOD4 models and the photo, not a survey.
"""
import json
import math
import sys
from collections import defaultdict

import cv2
import numpy as np
import shapely
import shapely.affinity
from shapely import LineString, Polygon, make_valid, unary_union
from shapely.ops import polygonize

FLAT_NZ = math.cos(math.radians(10))
UP_NZ = math.cos(math.radians(75))
DOWN_NZ = -math.cos(math.radians(14))
WALL_NZ = 0.9
GRID = 0.01
PHOTO_MPP = 0.25
DEFAULT_PARAPET = 0.9


# ---------------------------------------------------------------- plan geometry
def polys(geom):
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]


def tidy(geom, close=0.05):
    geom = unary_union(polys(make_valid(geom)))
    if close:
        geom = geom.buffer(close, join_style="mitre").buffer(-close, join_style="mitre")
    return unary_union(polys(make_valid(geom)))


def opening(geom, r):
    return unary_union(polys(geom.buffer(-r, join_style="mitre").buffer(r, join_style="mitre")))


def mean_width(p):
    return 2 * p.area / max(p.length, 1e-9)


def fill_small_holes(p, min_hole):
    return Polygon(p.exterior, [h for h in p.interiors if Polygon(h).area >= min_hole])


# ---------------------------------------------------------------- triangle soups
class Soup:
    def __init__(self, tris):
        v1 = tris[:, 1] - tris[:, 0]
        v2 = tris[:, 2] - tris[:, 0]
        n = np.cross(v1, v2)
        ln = np.linalg.norm(n, axis=1)
        ok = ln > 1e-6
        self.T = tris[ok]
        self.n = n[ok] / ln[ok, None]
        self.area = ln[ok] / 2
        self.nz = self.n[:, 2]

    def subset(self, mask):
        out = Soup.__new__(Soup)
        out.T, out.n, out.area, out.nz = self.T[mask], self.n[mask], self.area[mask], self.nz[mask]
        return out


def model_soup(m):
    p = np.array(m["positions"], dtype=np.float64).reshape(-1, 3)
    idx = np.array(m["indices"], dtype=np.int64).reshape(-1, 3)
    return Soup(p[idx])


def plan_area2(tri):
    return (tri[1, 0] - tri[0, 0]) * (tri[2, 1] - tri[0, 1]) - (tri[2, 0] - tri[0, 0]) * (tri[1, 1] - tri[0, 1])


def plan_of(T):
    keep = [Polygon(tri[:, :2]) for tri in T if abs(plan_area2(tri)) > 0.01]
    return tidy(unary_union(keep)) if keep else Polygon()


# ---------------------------------------------------------------- horizontal slices
# Different primitives of one LOD4 model are quantised separately, so wall cuts that should meet miss each other by a
# centimetre or two: section end points within `tol` are merged, and dangling ends within `bridge` are joined.
def weld_segments(segs, tol=0.06, bridge=0.8):
    pts = segs.reshape(-1, 2)
    parent = np.arange(len(pts))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    cells = defaultdict(list)
    for i, (x, y) in enumerate(pts):
        cells[(int(np.floor(x / tol)), int(np.floor(y / tol)))].append(i)
    for (cx, cy), members in cells.items():
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in cells.get((cx + dx, cy + dy), []):
                    for i in members:
                        if i < j and np.hypot(*(pts[i] - pts[j])) <= tol:
                            parent[find(i)] = find(j)
    roots = np.array([find(i) for i in range(len(pts))])
    welded = pts.copy()
    for r in np.unique(roots):
        members = np.nonzero(roots == r)[0]
        welded[members] = pts[members].mean(axis=0)
    out = welded.reshape(-1, 2, 2)
    degree = defaultdict(int)
    for r in roots:
        degree[r] += 1
    dangles = [k for k, r in enumerate(roots) if degree[r] == 1]
    extra = []
    used = set()
    for a in dangles:
        if a in used:
            continue
        best = None
        for b in dangles:
            if b == a or b in used or b // 2 == a // 2:
                continue
            d = np.hypot(*(welded[a] - welded[b]))
            if d <= bridge and (best is None or d < best[0]):
                best = (d, b)
        if best is not None:
            used.update((a, best[1]))
            extra.append([welded[a], welded[best[1]]])
    return np.concatenate([out, np.array(extra)]) if extra else out


# Plan section of the mesh at height z: wall triangles cut by the plane give segments oriented by their outward normal;
# the faces of the noded segments with a non-zero winding number are inside (overlapping parts of one model stay solid).
def slice_at(soup, z):
    walls = np.abs(soup.nz) < WALL_NZ
    T = soup.T[walls]
    N = soup.n[walls]
    zs = T[:, :, 2]
    cross = (zs.min(axis=1) < z) & (zs.max(axis=1) > z)
    segs = []
    for tri, nrm in zip(T[cross], N[cross]):
        pts = []
        for i in range(3):
            a, b = tri[i], tri[(i + 1) % 3]
            if (a[2] - z) * (b[2] - z) < 0:
                t = (z - a[2]) / (b[2] - a[2])
                pts.append(a[:2] + t * (b[:2] - a[:2]))
        if len(pts) != 2:
            continue
        p, q = pts
        d = q - p
        if np.hypot(*d) < 1e-4:
            continue
        if d[0] * nrm[1] - d[1] * nrm[0] < 0:
            p, q = q, p
        segs.append((p, q))
    if not segs:
        return Polygon()
    S2 = weld_segments(np.array(segs))
    lines = unary_union([LineString(s) for s in S2 if np.hypot(*(s[1] - s[0])) > 1e-4])
    px, py = S2[:, 0, 0], S2[:, 0, 1]
    qx, qy = S2[:, 1, 0], S2[:, 1, 1]
    keep = []
    for f in polygonize(lines):
        if f.area < 0.05:
            continue
        rp = f.representative_point()
        x, y = rp.x, rp.y
        up = (py <= y) & (qy > y)
        down = (py > y) & (qy <= y)
        side = (qx - px) * (y - py) - (x - px) * (qy - py)
        if np.sum(up & (side > 0)) - np.sum(down & (side < 0)) != 0:
            keep.append(f)
    return tidy(unary_union(keep)) if keep else Polygon()


# ---------------------------------------------------------------- roof pieces and masses
def height_clusters(values, gap=0.25):
    groups = []
    for i in np.argsort(values):
        if groups and values[i] - groups[-1][-1][1] <= gap:
            groups[-1].append((i, values[i]))
        else:
            groups.append([(i, values[i])])
    return [[i for i, _ in g] for g in groups]


# Roof surfaces of a set of sloped triangles: labels per triangle. Triangles sharing an edge (end points welded within
# `tol` in 3D) are one surface; surfaces whose plans touch are merged when their vertices along the contact agree in
# height within `step` (one roof split over separately quantised primitives), and kept apart otherwise (a stair-tower
# cap beside the main roof, a ramp beside a mansard rim).
def surface_labels(T, tol=0.06, step=0.3):
    n = len(T)
    pts = T.reshape(-1, 3)
    parent = np.arange(len(pts))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    cells = defaultdict(list)
    for i, key in enumerate(map(tuple, np.floor(pts / tol).astype(np.int64))):
        cells[key].append(i)
    for (cx, cy, cz), members in cells.items():
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for j in cells.get((cx + dx, cy + dy, cz + dz), []):
                        for i in members:
                            if i < j and np.linalg.norm(pts[i] - pts[j]) <= tol:
                                parent[find(i)] = find(j)
    vid = np.array([find(i) for i in range(len(pts))]).reshape(n, 3)
    tri_parent = np.arange(n)

    def tfind(i):
        while tri_parent[i] != i:
            tri_parent[i] = tri_parent[tri_parent[i]]
            i = tri_parent[i]
        return i

    owner = {}
    for t in range(n):
        for a, b in ((0, 1), (1, 2), (2, 0)):
            edge = (min(vid[t, a], vid[t, b]), max(vid[t, a], vid[t, b]))
            if edge[0] == edge[1]:
                continue
            if edge in owner:
                tri_parent[tfind(t)] = tfind(owner[edge])
            else:
                owner[edge] = t
    labels = np.array([tfind(t) for t in range(n)])
    # Height continuity between plan-touching surfaces.
    groups = {l: np.nonzero(labels == l)[0] for l in np.unique(labels)}
    plans = {l: plan_of(T[ids]) for l, ids in groups.items()}
    keys = [l for l in groups if not plans[l].is_empty]
    tree = shapely.STRtree([plans[l] for l in keys])
    merge_parent = {l: l for l in groups}

    def mfind(l):
        while merge_parent[l] != l:
            merge_parent[l] = merge_parent[merge_parent[l]]
            l = merge_parent[l]
        return l

    for ia, la in enumerate(keys):
        va = T[groups[la]].reshape(-1, 3)
        for ib in tree.query(plans[la].buffer(0.15)):
            lb = keys[ib]
            if lb <= la or mfind(la) == mfind(lb):
                continue
            vb = T[groups[lb]].reshape(-1, 3)
            near_a = va[shapely.distance(plans[lb], shapely.points(va[:, 0], va[:, 1])) < 0.15]
            if not len(near_a):
                continue
            d = np.hypot(near_a[:, None, 0] - vb[None, :, 0], near_a[:, None, 1] - vb[None, :, 1])
            close = d.min(axis=1) < 0.3
            if not close.any():
                continue
            dz = np.abs(near_a[close, 2] - vb[d[close].argmin(axis=1), 2])
            if np.median(dz) < step:
                merge_parent[mfind(la)] = mfind(lb)
    return np.array([mfind(l) for l in labels])


def roof_pieces(soup, ground, dom):
    hz = soup.T[:, :, 2].mean(axis=1) - ground
    flat = np.nonzero(soup.nz > FLAT_NZ)[0]
    sloped = np.nonzero((soup.nz > UP_NZ) & (soup.nz <= FLAT_NZ))[0]
    pieces = []
    for group in height_clusters(hz[flat]):
        ids = flat[group]
        top = float(np.average(hz[ids], weights=soup.area[ids]))
        for part in polys(plan_of(soup.T[ids]).intersection(dom)):
            if part.area >= 0.5:
                pieces.append({"type": "flat", "poly": part, "top": top})
    if len(sloped):
        labels = surface_labels(soup.T[sloped])
        for label in np.unique(labels):
            surface = sloped[labels == label]
            cx = soup.T[surface][:, :, 0].mean(axis=1)
            cy = soup.T[surface][:, :, 1].mean(axis=1)
            for part in polys(plan_of(soup.T[surface]).intersection(dom)):
                if part.area < 0.5:
                    continue
                ids = surface[shapely.contains_xy(part.buffer(0.05), cx, cy)]
                if not len(ids):
                    continue
                tris = soup.T[ids].copy()
                tris[:, :, 2] -= ground
                pieces.append({"type": "sloped", "poly": part, "top": float(tris[:, :, 2].max()), "eave": float(tris[:, :, 2].min()), "tris": tris,
                               "normals": soup.n[ids].copy(), "areas": soup.area[ids].copy()})
    return pieces


def attach_parapets(pieces):
    wide = [p for p in pieces if mean_width(p["poly"]) >= 0.65]
    for strip in (p for p in pieces if mean_width(p["poly"]) < 0.65):
        best = None
        for w in wide:
            if not (strip["top"] - 3.0 <= w["top"] <= strip["top"] - 0.15):
                continue
            near = strip["poly"].intersection(w["poly"].exterior.buffer(1.0)).area
            if near >= 0.5 * strip["poly"].area and (best is None or w["top"] > best["top"]):
                best = w
        if best is not None:
            best["parapet"] = max(best.get("parapet", 0.0), strip["top"] - best["top"])
    return wide


def decompose(pieces, min_area=3.0):
    covered = Polygon()
    out = []
    for p in sorted(pieces, key=lambda p: -p["top"]):
        vis = p["poly"].difference(covered) if not covered.is_empty else p["poly"]
        covered = unary_union([covered, p["poly"]])
        for part in polys(opening(vis, 0.2)):
            if part.area >= min_area:
                out.append({**p, "poly": part})
    return out


def merge_levels(masses, tol=0.3):
    merged = True
    while merged:
        merged = False
        for i in range(len(masses)):
            for j in range(i + 1, len(masses)):
                a, b = masses[i], masses[j]
                if a["type"] != "flat" or b["type"] != "flat" or abs(a["top"] - b["top"]) > tol:
                    continue
                if a["poly"].buffer(0.05).intersection(b["poly"].buffer(0.05)).area < 0.05:
                    continue
                u = polys(tidy(unary_union([a["poly"], b["poly"]])))
                if len(u) != 1:
                    continue
                top = (a["top"] * a["poly"].area + b["top"] * b["poly"].area) / (a["poly"].area + b["poly"].area)
                masses[i] = {**a, "poly": u[0], "top": top, "parapet": max(a.get("parapet", 0.0), b.get("parapet", 0.0))}
                del masses[j]
                merged = True
                break
            if merged:
                break
    return masses


class Terrain:
    def __init__(self, grid):
        self.e0, self.n0, self.w, self.h = grid["e0"], grid["n0"], grid["w"], grid["h"]
        self.v = np.array(grid["values"], dtype=np.float64).reshape(self.h, self.w)

    def at(self, e, n):
        fx = float(np.clip(e - self.e0, 0, self.w - 1.001))
        fy = float(np.clip(n - self.n0, 0, self.h - 1.001))
        i, j = int(fx), int(fy)
        tx, ty = fx - i, fy - j
        v = self.v
        return (v[j, i] * (1 - tx) + v[j, i + 1] * tx) * (1 - ty) + (v[j + 1, i] * (1 - tx) + v[j + 1, i + 1] * tx) * ty


def soffits(soup, ground, terrain, low_terrain):
    down = np.nonzero(soup.nz < DOWN_NZ)[0]
    if not len(down):
        return []
    dz = soup.T[down][:, :, 2].mean(axis=1) - ground
    up = np.nonzero(soup.nz > UP_NZ)[0]
    up_tris = soup.T[up]
    up_z = up_tris[:, :, 2].max(axis=1) - ground
    valid = [k for k in range(len(up)) if abs(plan_area2(up_tris[k])) > 0.01]
    up_polys = [Polygon(up_tris[k][:, :2]) for k in valid]
    tree = shapely.STRtree(up_polys)
    open_tris = []
    for k, t in enumerate(soup.T[down]):
        b = dz[k]
        if b < 1.8 or abs(plan_area2(t)) < 0.01:
            continue
        poly = Polygon(t[:, :2])
        c = poly.centroid
        if b - (terrain.at(c.x, c.y) - low_terrain) < 2.0:
            continue
        blocked = sum(poly.intersection(up_polys[q]).area for q in tree.query(poly) if 0.3 < up_z[valid[q]] < b + 0.3)
        if blocked < 0.3 * poly.area:
            open_tris.append((b, poly))
    if not open_tris:
        return []
    bs = np.array([b for b, _ in open_tris])
    out = []
    for group in height_clusters(bs, gap=0.3):
        base = float(np.median(bs[group]))
        kept = []
        for part in polys(tidy(unary_union([open_tris[i][1] for i in group]))):
            c = part.representative_point()
            local = terrain.at(c.x, c.y) - low_terrain
            cut = slice_at(soup, ground + (base + local) / 2)
            if cut.is_empty or cut.intersection(part).area < 0.5 * part.area:
                kept.append(part)
        if kept:
            out.append((base, unary_union(kept)))
    return out


# Gaps narrower than `width` between the masses (dropped parapet strips, the opening of decompose): each goes to the
# flat mass it shares the longest edge with (ground masses first), so neighbouring masses meet without a crack. Pitched
# masses take none: their roofs are their LOD4 triangles.
def close_gaps(masses, width=1.2):
    union = unary_union([m["poly"] for m in masses])
    r = width / 2
    closed = union.buffer(r, join_style="mitre", mitre_limit=2.0).buffer(-r, join_style="mitre", mitre_limit=2.0)
    filled = 0.0
    for gap in polys(closed.difference(union)):
        if gap.area < 0.05:
            continue
        best = None
        for m in masses:
            if m["type"] != "flat":
                continue
            shared = gap.boundary.intersection(m["poly"].buffer(0.02)).length
            rank = (m["base"] == 0, shared)
            if shared > 0.05 and (best is None or rank > best[0]):
                best = (rank, m)
        if best is None:
            continue
        grown = polys(tidy(unary_union([best[1]["poly"], gap]), close=0.01))
        if len(grown) == 1:
            best[1]["poly"] = grown[0]
            filled += gap.area
    return filled


def columns_under(soup, ground, region, base):
    if base < 1.5:
        return []
    cut = slice_at(soup, ground + min(base / 2, 1.5))
    return [p for p in polys(cut) if 0.04 <= p.area <= 4.0 and region.buffer(0.3).contains(p.centroid) and mean_width(p) > 0.12]


def clip_triangles(mass_poly, tris):
    out = []
    for tri in tris:
        a, b, c = tri
        normal = np.cross(b - a, c - a)
        if abs(normal[2]) < 1e-9:
            continue
        plane = lambda x, y: a[2] - (normal[0] * (x - a[0]) + normal[1] * (y - a[1])) / normal[2]
        tpoly = Polygon(tri[:, :2])
        if tpoly.area < 1e-4:
            continue
        piece = tpoly.intersection(mass_poly)
        if piece.is_empty:
            continue
        if piece.area >= tpoly.area - 1e-4:
            out.append([[float(v[0]), float(v[1]), float(v[2])] for v in tri])
            continue
        for part in polys(piece):
            for t in polys(shapely.constrained_delaunay_triangles(part)):
                coords = list(t.exterior.coords)[:3]
                out.append([[x, y, float(plane(x, y))] for x, y in coords])
    return out


def roof_kind(normals, areas):
    horizontal = normals[:, :2]
    length = np.linalg.norm(horizontal, axis=1)
    keep = length > 1e-3
    if not keep.any():
        return "flat"
    az = np.degrees(np.arctan2(horizontal[keep, 1], horizontal[keep, 0])) % 360
    w = areas[keep]
    bins = np.zeros(18)
    for a, ww in zip(az, w):
        bins[int(a // 20) % 18] += ww
    share = bins / bins.sum()
    clusters = 0
    k = 0
    while k < 18:
        if share[k] >= 0.08:
            clusters += 1
            while k < 18 and share[k] >= 0.02:
                k += 1
        k += 1
    if clusters <= 1:
        return "mono-pitch"
    if clusters == 2:
        return "gable"
    if clusters <= 4:
        return "hipped"
    return "curved"


# ---------------------------------------------------------------- photo
class Sheet:
    def __init__(self, photo):
        self.data = np.memmap(photo["tif"], dtype=np.uint8, mode="r", offset=photo["offset"], shape=(photo["height"], photo["width"], 3))
        self.col = photo["col"]
        self.row = photo["row"]
        self.width = photo["width"]
        self.height = photo["height"]

    def crop(self, e0, n0, e1, n1, mpp=PHOTO_MPP):
        w = int(round((e1 - e0) / mpp))
        h = int(round((n1 - n0) / mpp))
        E, N = np.meshgrid(e0 + (np.arange(w) + 0.5) * mpp, n1 - (np.arange(h) + 0.5) * mpp)
        c = np.clip(self.col[0] * E + self.col[1] * N + self.col[2] - 0.5, 0, self.width - 1.001)
        r = np.clip(self.row[0] * E + self.row[1] * N + self.row[2] - 0.5, 0, self.height - 1.001)
        c0 = np.floor(c).astype(int)
        r0 = np.floor(r).astype(int)
        tc = (c - c0)[..., None]
        tr = (r - r0)[..., None]
        rmin, cmin = r0.min(), c0.min()
        block = np.asarray(self.data[rmin:r0.max() + 2, cmin:c0.max() + 2]).astype(np.float32)
        rr, cc = r0 - rmin, c0 - cmin
        out = (block[rr, cc] * (1 - tc) + block[rr, cc + 1] * tc) * (1 - tr) + (block[rr + 1, cc] * (1 - tc) + block[rr + 1, cc + 1] * tc) * tr
        return np.clip(out + 0.5, 0, 255).astype(np.uint8)

    def tm(self, e, n):
        col = self.col[0] * e + self.col[1] * n + self.col[2]
        row = self.row[0] * e + self.row[1] * n + self.row[2]
        return col, row


def lean_prior(sheet, field, e, n):
    col, row = sheet.tm(e, n)
    E = field["originTm"][0] + field["metresPerPixel"] * col
    N = field["originTm"][1] - field["metresPerPixel"] * row
    dE = (E - field["E0N0"][0]) / 100
    dN = (N - field["E0N0"][1]) / 100
    return np.array([field["E"][0] + field["E"][1] * dE + field["E"][2] * dN, field["N"][0] + field["N"][1] * dE + field["N"][2] * dN])


def luminance(rgb):
    return (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]).astype(np.float32)


# NGII colours (not the VWorld rendition): cast shadows are near-black blue (red <= 18, blue >= green); crowns are green
# and textured (5 x 5 luminance deviation above 7), unlike smooth painted green roofs.
def shadow_mask(rgb):
    r, g, b = [rgb[..., k].astype(np.float32) for k in range(3)]
    return (r <= 18) & (b >= g - 2) & (luminance(rgb) < 60)


def vegetation_mask(rgb):
    r, g, b = [rgb[..., k].astype(np.float32) for k in range(3)]
    lum = luminance(rgb)
    mean = cv2.blur(lum, (5, 5))
    rough = np.sqrt(np.maximum(cv2.blur(lum * lum, (5, 5)) - mean * mean, 0)) > 7.0
    return ((2 * g - r - b) / (r + g + b + 1) > 0.15) & rough & ~shadow_mask(rgb)


class Frame:
    def __init__(self, sheet, e0, n0, e1, n1):
        self.e0, self.n1 = e0, n1
        self.rgb = sheet.crop(e0, n0, e1, n1)
        self.h, self.w = self.rgb.shape[:2]
        self.shadow = shadow_mask(self.rgb)
        self.vegetation = vegetation_mask(self.rgb)

    def px(self, coords, shift):
        a = np.asarray(coords, dtype=np.float64)
        return np.stack([(a[:, 0] + shift[0] - self.e0) / PHOTO_MPP, (self.n1 - (a[:, 1] + shift[1])) / PHOTO_MPP], axis=1)

    def raster(self, masses, lean):
        out = np.zeros((self.h, self.w), np.uint8)
        for poly, h in masses:
            m = np.zeros_like(out)
            d = (lean[0] * h, lean[1] * h)
            cv2.fillPoly(m, [np.round(self.px(poly.exterior.coords, d) * 8).astype(np.int32)], 1, shift=3)
            for hole in poly.interiors:
                cv2.fillPoly(m, [np.round(self.px(hole.coords, d) * 8).astype(np.int32)], 0, shift=3)
            out |= m
        return out


def photo_roof(frame, candidates):
    union = np.zeros((frame.h, frame.w), np.uint8)
    agree = np.ones((frame.h, frame.w), np.uint8)
    for c in candidates:
        union |= c
        agree &= c
    k = int(round(5.0 / PHOTO_MPP))
    band = cv2.dilate(union, np.ones((2 * k + 1, 2 * k + 1), np.uint8))
    dist = cv2.distanceTransform(agree, cv2.DIST_L2, 5)
    core = dist >= max(min(2.0 / PHOTO_MPP, 0.4 * float(dist.max())), 1.0)
    markers = np.zeros(union.shape, np.int32)
    markers[(band == 0) | ((union == 0) & frame.vegetation)] = 1
    markers[core & ~frame.vegetation] = 2
    cv2.watershed(cv2.GaussianBlur(np.ascontiguousarray(frame.rgb[..., ::-1]), (0, 0), 0.8), markers)
    return cv2.morphologyEx((markers == 2).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))


def iou(a, b, ignore):
    keep = ~ignore
    union = (((a > 0) | (b > 0)) & keep).sum()
    return float((((a > 0) & (b > 0)) & keep).sum() / union) if union else None


# The lean (around the registration prior, at most 0.12 m/m off it) that best fits one candidate's masses to the seeds.
def fit_lean(frame, seeds, masses, prior):
    lean = prior
    best = iou(frame.raster(masses, prior), seeds, frame.shadow) or 0
    for step, reach in ((0.02, 0.10), (0.01, 0.02)):
        base = lean
        ks = np.arange(-reach, reach + 1e-9, step)
        for de in ks:
            for dn in ks:
                v = base + np.array([de, dn])
                s = iou(frame.raster(masses, v), seeds, frame.shadow) or 0
                if s > best:
                    best, lean = s, v
    return lean


# Every candidate gets its own fitted lean (a building's candidates can prefer different ones; one shared lean favoured
# whichever candidate it was fitted to), then the photo roof is segmented once with all of them and each is scored.
def measure(sheet, field, candidates):
    pts = np.array([c for masses in candidates for poly, _ in masses for c in poly.exterior.coords])
    reach = 0.5 * max(h for masses in candidates for _, h in masses) + 8
    (e0, n0), (e1, n1) = pts.min(axis=0) - reach, pts.max(axis=0) + reach
    frame = Frame(sheet, e0, n0, e1, n1)
    prior = lean_prior(sheet, field, *pts.mean(axis=0))
    seeds = photo_roof(frame, [frame.raster(m, prior) for m in candidates])
    leans = [fit_lean(frame, seeds, m, prior) for m in candidates]
    rasters = [frame.raster(m, lean) for m, lean in zip(candidates, leans)]
    roof = photo_roof(frame, rasters)
    measurable = roof.sum() > 0
    return {"lean": leans[0], "leans": leans, "prior": prior, "frame": frame, "roof": roof, "ious": [iou(r, roof, frame.shadow) if measurable else None for r in rasters]}


# Roof outline traced on the photo: the watershed roof region over the footprint, moved back by the lean, as a rotated
# rectangle when the region fills its minimum-area rectangle, else as a polygon simplified to 0.4 m.
def traced_outline(frame, roof, footprint_raster, h, lean):
    count, labels = cv2.connectedComponents(roof)
    keep = np.zeros_like(roof)
    for k in range(1, count):
        region = labels == k
        if (region & (footprint_raster > 0)).sum() >= 0.3 * region.sum():
            keep[region] = 1
    if keep.sum() < 16:
        return None
    contours, _ = cv2.findContours(keep, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) < 8:
        return None
    rect = cv2.boxPoints(cv2.minAreaRect(contour))
    if cv2.contourArea(rect) <= 1.2 * cv2.contourArea(contour):
        pts = rect
    else:
        pts = cv2.approxPolyDP(contour, 0.4 / PHOTO_MPP, True)[:, 0, :].astype(np.float64)
    e = frame.e0 + (pts[:, 0] + 0.5) * PHOTO_MPP - lean[0] * h
    n = frame.n1 - (pts[:, 1] + 0.5) * PHOTO_MPP - lean[1] * h
    poly = make_valid(Polygon(np.stack([e, n], axis=1)))
    parts = polys(poly)
    return max(parts, key=lambda p: p.area) if parts else None


def support(frame, roof, poly, h, lean):
    m = frame.raster([(poly, h)], lean)
    keep = (m > 0) & ~frame.shadow
    return float((keep & (roof > 0)).sum() / keep.sum()) if keep.sum() else None


# ---------------------------------------------------------------- rigid registration to the footprint
class RegistrationError(ValueError):
    pass


def _checked(poly, what):
    if poly is None or poly.is_empty or not poly.is_valid or poly.area < 1.0:
        area = 0.0 if poly is None or poly.is_empty else poly.area
        raise RegistrationError(f"registration: degenerate {what} polygon (area {area:.3f} m2, valid {poly is not None and not poly.is_empty and poly.is_valid})")
    return poly


def apply_rigid(geom, tf):
    out = shapely.affinity.rotate(geom, tf["rotDeg"], origin=tuple(tf["pivot"]))
    return shapely.affinity.translate(out, tf["dx"], tf["dy"])


def rigid_points(xy, tf):
    a = math.radians(tf["rotDeg"])
    c, s = math.cos(a), math.sin(a)
    px, py = tf["pivot"]
    x, y = xy[..., 0] - px, xy[..., 1] - py
    return np.stack([c * x - s * y + px + tf["dx"], s * x + c * y + py + tf["dy"]], axis=-1)


def _plan_iou(a, b):
    inter = a.intersection(b).area
    return inter / max(a.union(b).area, 1e-9)


# Translation and a small rotation (at most max_rot degrees, about the plan centroid) of the LOD4 roof plan onto the
# footprint: start from the centroids aligned, scan the rotation, then refine dx, dy and the rotation by a shrinking
# pattern search on the plan IoU. The identity is kept when it scores higher. residual_m is the mean distance of the
# fitted plan outline (sampled every 0.25 m) from the footprint outline; hausdorff_m its maximum.
def fit_rigid(plan, target, max_rot=5.0):
    plan = _checked(plan, "LOD4 plan")
    target = _checked(target, "footprint")
    pivot = (plan.centroid.x, plan.centroid.y)
    base = (target.centroid.x - pivot[0], target.centroid.y - pivot[1])

    def score(dx, dy, rot):
        return _plan_iou(apply_rigid(plan, {"dx": dx, "dy": dy, "rotDeg": rot, "pivot": pivot}), target)

    rots = np.arange(-max_rot, max_rot + 1e-9, 0.25)
    best_rot = max(rots, key=lambda r: score(base[0], base[1], float(r)))
    best = [base[0], base[1], float(best_rot)]
    best_s = score(*best)
    for step_m, step_d in ((0.5, 0.2), (0.25, 0.1), (0.1, 0.05), (0.05, 0.02), (0.02, 0.01), (0.01, 0.005)):
        improved = True
        while improved:
            improved = False
            for k, d in ((0, step_m), (0, -step_m), (1, step_m), (1, -step_m), (2, step_d), (2, -step_d)):
                cand = list(best)
                cand[k] += d
                if abs(cand[2]) > max_rot:
                    continue
                s = score(*cand)
                if s > best_s + 1e-9:
                    best, best_s, improved = cand, s, True
    if score(0.0, 0.0, 0.0) >= best_s:
        best, best_s = [0.0, 0.0, 0.0], score(0.0, 0.0, 0.0)
    tf = {"dx": best[0], "dy": best[1], "rotDeg": best[2], "pivot": [pivot[0], pivot[1]], "atRotationBound": abs(best[2]) >= max_rot - 1e-9}
    fitted = apply_rigid(plan, tf)
    ring = unary_union([p.exterior for p in polys(fitted)])
    edge = unary_union([p.exterior for p in polys(target)])
    n = max(8, int(ring.length / 0.25))
    samples = [ring.interpolate(i / n, normalized=True) for i in range(n)]
    d = [edge.distance(p) for p in samples]
    tf.update(iou=best_s, iouBefore=score(0.0, 0.0, 0.0), residual_m=float(np.mean(d)), hausdorff_m=float(fitted.hausdorff_distance(target)))
    return tf


def transform_soup(soup, tf):
    out = Soup.__new__(Soup)
    T = soup.T.copy()
    T[:, :, :2] = rigid_points(T[:, :, :2], tf)
    n = soup.n.copy()
    a = math.radians(tf["rotDeg"])
    c, s = math.cos(a), math.sin(a)
    n[:, 0], n[:, 1] = c * soup.n[:, 0] - s * soup.n[:, 1], s * soup.n[:, 0] + c * soup.n[:, 1]
    out.T, out.n, out.area, out.nz = T, n, soup.area, soup.nz
    return out


# Main, wing, podium and tower masses are cut to the footprint buffered 0.3 m, regardless of source.
# Cores and canopies keep their outline.
CLIPPED_KINDS = ("main", "wing", "podium", "tower")


# Returns (kept masses, dropped): every clipped mass part under 3 m2, and every mass wholly outside the zone, is listed
# in `dropped` so the caller can flag it.
def clip_to_footprint(masses, footprint, buffer=0.3):
    # One grid step inside the buffer: snapping to GRID moves a vertex by up to half a step, which must not leave it.
    zone = footprint.buffer(buffer - GRID, join_style="mitre")
    out = []
    dropped = []
    for m in masses:
        if m["kind"] not in CLIPPED_KINDS:
            out.append(m)
            continue
        parts = polys(shapely.set_precision(m["poly"].intersection(zone), GRID))
        kept = [p for p in parts if p.area >= 3.0]
        out.extend({**m, "poly": p} for p in kept)
        lost = m["poly"].area - sum(p.area for p in kept)
        if not kept:
            dropped.append({"kind": m["kind"], "topMetres": round(m["top"], 2), "areaSquareMetres": round(m["poly"].area, 1), "reason": "wholly outside footprint+0.3 m or under 3 m2 after the clip"})
        else:
            dropped.extend({"kind": m["kind"], "topMetres": round(m["top"], 2), "areaSquareMetres": round(p.area, 2), "reason": "clipped part under 3 m2"} for p in parts if p.area < 3.0)
            if lost >= 3.0:
                dropped.append({"kind": m["kind"], "topMetres": round(m["top"], 2), "areaSquareMetres": round(lost, 1), "reason": "cut off outside footprint+0.3 m"})
    return out, dropped


# ---------------------------------------------------------------- per building
def ownership(models, plans, foot):
    owners = defaultdict(list)
    shared = {}
    for i, plan in enumerate(plans):
        if plan.is_empty or plan.area < 4:
            continue
        ov = []
        for j, f in enumerate(foot):
            a = plan.intersection(f.buffer(1.0)).area
            if a >= max(4.0, 0.05 * plan.area) or a >= 0.5 * f.area:
                ov.append((a, j))
        if sum(a for a, _ in ov) >= 0.3 * plan.area:
            shared[i] = ([j for _, j in ov], 10.0)
        else:
            whole = [j for a, j in ov if a >= 0.7 * foot[j].area]
            if not whole:
                continue
            shared[i] = (whole, 1.5)
        for j in shared[i][0]:
            owners[j].append(i)
    return owners, shared


def domain(j, foot, others, reach):
    dom = foot[j].buffer(reach)
    if not others:
        return dom
    minx, miny, maxx, maxy = dom.bounds
    step = 0.5
    X, Y = np.meshgrid(np.arange(minx, maxx, step) + step / 2, np.arange(miny, maxy, step) + step / 2)
    pts = shapely.points(X.ravel(), Y.ravel())
    dj = shapely.distance(foot[j], pts)
    closer = np.ones(dj.shape, dtype=bool)
    for o in others:
        closer &= dj <= shapely.distance(foot[o], pts)
    x, y = X.ravel()[closer], Y.ravel()[closer]
    return unary_union(shapely.box(x - step / 2, y - step / 2, x + step / 2, y + step / 2)).intersection(dom)


# Roof pieces of a model shared with neighbours come from the whole model near the building (`wide`, `reach`): a piece
# goes whole to the footprint it overlaps most (`keep` returns its plan for this building, cut along the nearest-
# footprint line only when it spans two footprints), so no roof is sliced at an arbitrary diagonal.
def lod4_masses(soup, ground, dom, terrain, low_terrain, wide=None, reach=None, keep=None):
    if wide is None:
        pieces = roof_pieces(soup, ground, dom)
    else:
        pieces = []
        for p in roof_pieces(wide, ground, reach):
            poly = keep(p["poly"])
            for part in polys(poly):
                if part.area >= 0.5:
                    pieces.append({**p, "poly": part})
    pieces = [p for p in pieces if p["top"] >= 1.0]
    pieces = [p for p in attach_parapets(pieces) if p["poly"].area >= 6.0]
    masses = merge_levels(decompose(pieces))
    decks = soffits(soup, ground, terrain, low_terrain)
    for m in masses:
        m["base"] = 0.0
    raised = []
    for m in masses:
        for base, region in sorted(decks, key=lambda d: d[0]):
            if base >= m["top"] - 0.25:
                continue
            part = opening(m["poly"].intersection(region), 0.5)
            if part.area < 4.0:
                continue
            m["poly"] = m["poly"].difference(part)
            kept = []
            for piece in polys(part):
                lifted = {**m, "poly": piece, "base": base, "columns": columns_under(soup, ground, piece, base)}
                if m["type"] == "sloped":
                    # The roof over it (an eave overhang, a pitched bridge) sets its own top and eave; a piece no roof
                    # triangle covers stays with the mass it was cut from.
                    over = np.array(clip_triangles(piece, m["tris"]))
                    if not len(over):
                        kept.append(piece)
                        continue
                    lifted.update(tris=over, top=float(over[:, :, 2].max()), eave=float(over[:, :, 2].min()))
                raised.append(lifted)
            if kept:
                m["poly"] = unary_union([m["poly"], *kept])
    out = []
    for m in [m for m in masses if not m["poly"].is_empty] + raised:
        for part in polys(m["poly"]):
            for snapped in polys(shapely.set_precision(part, GRID)):
                if snapped.area >= 3.0:
                    out.append({**m, "poly": fill_small_holes(snapped, 4.0).simplify(0.03)})
    out = [m for m in out if m["top"] >= 2.5 or m["base"] > 0]
    close_gaps(out)
    return out


def classify(masses, floors_hint, label, tower=None):
    total = sum(m["poly"].area for m in masses)
    ground_masses = [m for m in masses if m["base"] == 0]
    largest = max((m["poly"].area for m in ground_masses), default=0)
    sizable = [m for m in ground_masses if m["poly"].area >= 0.2 * largest]
    main = max((m for m in sizable if m["top"] >= 0.5 * max(x["top"] for x in sizable)), key=lambda m: m["poly"].area) if sizable else masses[0]
    storey = 4.0
    # The floor hint counts the building's lower parts when a curated tower stands on them; the tower's storeys apply
    # when the main mass is that tower (its roof within 4 m of the tower height).
    if tower and tower.get("floors") and tower.get("heightMetres") and abs(main["top"] - tower["heightMetres"]) <= 4.0 and 2.6 <= main["top"] / tower["floors"] <= 5.6:
        storey = main["top"] / tower["floors"]
    elif floors_hint:
        s = main["top"] / floors_hint
        if 2.6 <= s <= 5.6:
            storey = s
    elif label and any(w in label for w in ("생활관", "기숙사", "관사")):
        storey = 3.0
    weighted = sorted(((m["top"], m["poly"].area) for m in ground_masses), key=lambda t: t[0])
    half = sum(a for _, a in weighted) / 2
    acc = 0.0
    median_top = weighted[-1][0] if weighted else main["top"]
    for top, a in weighted:
        acc += a
        if acc >= half:
            median_top = top
            break
    for m in masses:
        poly = m["poly"]
        touching = [o for o in masses if o is not m and poly.buffer(0.3).intersection(o["poly"]).area > 0.05]
        lower = [o for o in touching if o["top"] < m["top"] - 1.0 and o["base"] == 0]
        lower_share = sum(poly.exterior.buffer(0.3).intersection(o["poly"].buffer(0.3)).length for o in lower) / max(poly.length, 1e-6)
        thickness = m["top"] - m["base"]
        if m["base"] > 0:
            m["kind"] = "canopy" if thickness < 1.6 else "raised"
        elif m is not main and poly.area < 15 and m["top"] > 2 * math.sqrt(poly.area):
            m["kind"] = "core"
        elif poly.area < max(40.0, 0.06 * total) and lower and lower_share >= 0.4 and m is not main and m["top"] - max(o["top"] for o in lower) <= 8.0:
            # A rooftop core rises at most about two storeys over the roof beside it; a taller block is a tower or wing.
            m["kind"] = "core"
        elif m is main:
            m["kind"] = "main"
        elif m["top"] >= 1.5 * median_top and poly.area >= 0.08 * total:
            m["kind"] = "tower"
        elif m["top"] < 4.0 and poly.area < 30:
            m["kind"] = "annex"
        else:
            m["kind"] = "wing"
        m["floors"] = max(1, int(round(thickness / storey))) if m["kind"] not in ("canopy", "core") else max(1, int(round(thickness / storey)))
        if m["type"] == "sloped":
            m["roof"] = roof_kind(m["normals"], m["areas"])
        else:
            m["roof"] = "flat"
    if any(m["kind"] == "tower" for m in masses) and main["kind"] == "main" and main["top"] < max(m["top"] for m in masses if m["kind"] == "tower"):
        main["kind"] = "podium"
    return storey


def voids_of(masses):
    out = []
    union = unary_union([m["poly"] for m in masses])
    for p in polys(union):
        for h in p.interiors:
            # Only the open part of the hole counts (masses may stand inside it), and only where it is at least 1.5 m wide.
            for hp in polys(opening(Polygon(h).difference(union), 0.75)):
                if hp.area < 10:
                    continue
                rim = [m["top"] for m in masses if m["poly"].buffer(0.3).intersection(hp.exterior.buffer(0.3)).area > 0.1]
                out.append({"kind": "courtyard", "area": round(hp.area, 1), "depth": round(min(rim), 2) if rim else None, "ring": [[round(x, 3), round(y, 3)] for x, y in hp.exterior.coords[:-1]]})
    for m in masses:
        if m["base"] > 0:
            if m["top"] - m["base"] >= 1.6 and m["base"] >= 2.5:
                out.append({"kind": "passage", "area": round(m["poly"].area, 1), "clearance": round(m["base"], 2), "ring": [[round(x, 3), round(y, 3)] for x, y in m["poly"].exterior.coords[:-1]]})
            continue
        rim = m["poly"].exterior.buffer(0.3)
        around = [o for o in masses if o is not m and o["poly"].buffer(0.3).intersection(rim).area > 0.05]
        shared = sum(rim.intersection(o["poly"].buffer(0.3)).area for o in around) / max(rim.area, 1e-6)
        if around and shared >= 0.75 and min(o["top"] for o in around) >= m["top"] + 4.0 and m["poly"].area >= 10:
            out.append({"kind": "light well", "area": round(m["poly"].area, 1), "floor": round(m["top"], 2), "depth": round(min(o["top"] for o in around) - m["top"], 2),
                        "ring": [[round(x, 3), round(y, 3)] for x, y in m["poly"].exterior.coords[:-1]]})
    return out


def ring_out(coords):
    return [[round(x, 3), round(y, 3)] for x, y in list(coords)[:-1]]


def mass_out(m):
    out = {"outer": ring_out(m["poly"].exterior.coords), "holes": [ring_out(h.coords) for h in m["poly"].interiors],
           "baseMetres": round(m["base"], 2), "topMetres": round(m["top"], 2), "kind": m["kind"], "floors": m["floors"], "roof": m["roof"],
           "areaSquareMetres": round(m["poly"].area, 1)}
    if m["type"] == "flat":
        out["parapetMetres"] = round(m.get("parapet", DEFAULT_PARAPET) if m.get("parapet") else DEFAULT_PARAPET, 2)
        if not m.get("parapet") or m.get("parapetEstimated"):
            out["parapetEstimated"] = True
    else:
        out["eaveMetres"] = round(m["eave"], 2)
        out["triangles"] = [[[round(v, 3) for v in p] for p in t] for t in clip_triangles(m["poly"], m["tris"])]
    if m.get("columns"):
        out["columns"] = [ring_out(c.exterior.coords) for c in m["columns"]]
    if m.get("photoSupport") is not None:
        out["photoSupport"] = round(m["photoSupport"], 2)
    if m.get("heightSource"):
        out["heightSource"] = m["heightSource"]
    return out


# Masses of a curated form (the `form` of a data/scnu-facades.json entry, in plan metres here): flat roofs, kinds and
# storeys as given, parapets estimated.
def curated_masses(curated):
    return [{"poly": Polygon(m["outer"], m.get("holes") or []), "base": float(m.get("baseMetres", 0.0)), "top": float(m["topMetres"]), "type": "flat",
             "parapet": float(m.get("parapetMetres", DEFAULT_PARAPET)), "parapetEstimated": True, "kind": m["kind"], "floors": int(m["floors"]), "roof": "flat",
             "columns": [Polygon(c) for c in m.get("columns") or []], "heightSource": m.get("heightSource")} for m in curated["masses"]]


def accept_lod4(photo_iou: float | None) -> bool:
    """Todo 25: unsupported LOD4 roofs fall back to the ground footprint, not another photo trace."""
    return photo_iou is not None and photo_iou >= 0.70


def main():
    data = json.load(open(sys.argv[1]))
    sheet = Sheet(data["photo"])
    field = data["leanField"]
    models = data["models"]
    buildings = data["buildings"]
    soups = [model_soup(m) for m in models]
    plans = [plan_of(s.T[s.nz > UP_NZ]) for s in soups]
    foot = [tidy(unary_union([Polygon(p["outer"], p["holes"]) for p in b["parts"]])) for b in buildings]
    owners, shared = ownership(models, plans, foot)
    out = []
    for j, b in enumerate(buildings):
        label = b.get("label") or ""
        record = {"key": b["key"], "lod4Models": sorted(models[i]["name"] for i in owners.get(j, [])), "flags": []}
        footprint = [(Polygon(p["outer"], p["holes"]), p["heightMetres"] + DEFAULT_PARAPET) for p in b["parts"]]
        masses = []
        registration = None
        if owners.get(j):
            ms = owners[j]
            reach = max(shared[i][1] for i in ms)
            others = sorted({k for i in ms for k in shared[i][0] if k != j})
            dom = domain(j, foot, others, reach)
            full = Soup(np.concatenate([soups[i].T for i in ms]))
            inside = lambda s, region: s.subset(shapely.contains_xy(region, s.T[:, :, 0].mean(axis=1), s.T[:, :, 1].mean(axis=1)))
            soup = inside(full, dom)
            if len(soup.T):
                # Rigid fit of the LOD4 roof plan onto the footprint; the models are moved before the masses are cut.
                plan = plan_of(soup.T[soup.nz > UP_NZ])
                if not plan.is_empty and plan.area >= 1.0:
                    tf = fit_rigid(plan, foot[j])
                    if tf["iou"] >= 0.3:
                        full = transform_soup(full, tf)
                        soup = inside(full, dom)
                        registration = tf
            if len(soup.T):
                wallz = soup.T[np.abs(soup.nz) < 0.26][:, :, 2].ravel()
                ground = float(np.percentile(wallz, 2)) if len(wallz) else float(soup.T[:, :, 2].min())
                terrain = Terrain(b["terrain"])
                low_terrain = min(p["groundMetres"] for p in b["parts"])
                if others:
                    reach_dom = foot[j].buffer(reach)
                    wide = inside(full, reach_dom)
                    owners_here = [j, *others]

                    def keep(poly, owners_here=owners_here, dom=dom):
                        overlap = {k: poly.intersection(foot[k].buffer(1.0)).area for k in owners_here}
                        if max(overlap.values()) < 0.05 * poly.area:
                            best = min(owners_here, key=lambda k: foot[k].distance(poly))
                        else:
                            best = max(overlap, key=overlap.get)
                        if sum(1 for a in overlap.values() if a >= 0.2 * poly.area) >= 2:
                            return poly.intersection(dom)
                        return poly if best == j else Polygon()

                    masses = lod4_masses(soup, ground, dom, terrain, low_terrain, wide=wide, reach=reach_dom, keep=keep)
                else:
                    masses = lod4_masses(soup, ground, dom, terrain, low_terrain)
                record["lod4GroundEllipsoidMetres"] = round(ground, 2)
                if others:
                    record["flags"].append("LOD4 model shared with " + ", ".join(buildings[k]["key"] for k in others) + "; split by nearest footprint")
        curated = curated_masses(b["curated"]) if b.get("curated") and not masses else []
        candidates = [[(m["poly"], m["top"] + m.get("parapet", 0.0)) for m in (masses or curated)]] if masses or curated else []
        result = measure(sheet, field, candidates + [footprint])
        lean = result["lean"]
        record["lean"] = [round(float(v), 3) for v in lean]
        record["leanPrior"] = [round(float(v), 3) for v in result["prior"]]
        iou_footprint = result["ious"][-1]
        iou_lod4 = result["ious"][0] if masses else None
        if masses:
            kept = []
            for m in masses:
                m["photoSupport"] = support(result["frame"], result["roof"], m["poly"], m["top"] + m.get("parapet", 0.0), lean)
                small = m["poly"].area < 60 and m["base"] == 0
                if small and m["photoSupport"] is not None and m["photoSupport"] < 0.25 and m["top"] < 8:
                    record.setdefault("droppedMasses", []).append({"areaSquareMetres": round(m["poly"].area, 1), "topMetres": round(m["top"], 2), "photoSupport": round(m["photoSupport"], 2)})
                    continue
                kept.append(m)
            if len(kept) != len(masses):
                masses = kept
                frame = result["frame"]
                iou_lod4 = iou(frame.raster([(m["poly"], m["top"] + m.get("parapet", 0.0)) for m in masses], lean), result["roof"], frame.shadow)
        record["iou"] = {"lod4": None if iou_lod4 is None else round(iou_lod4, 3), "footprint": None if iou_footprint is None else round(iou_footprint, 3)}
        use_lod4 = bool(masses) and accept_lod4(iou_lod4)
        rejected_lod4 = bool(masses) and not use_lod4
        # A photo-traced outline for a simple footprint the photo disagrees with: it replaces the footprint when it beats it
        # by 0.05, and marginal LOD4 masses (photo IoU under 0.8) that are only one flat prism when it beats them by 0.05
        # too (LOD4 steps, raised parts and pitched roofs are kept).
        prism = bool(masses) and all(m["type"] == "flat" and m["base"] == 0 for m in masses) and max(m["top"] for m in masses) - min(m["top"] for m in masses) < 1.5
        traced = None
        if not rejected_lod4 and not curated and len(b["parts"]) == 1 and not b["parts"][0]["holes"] and (iou_footprint or 0) < 0.8 and (not use_lod4 or (iou_lod4 < 0.8 and prism)):
            h = b["parts"][0]["heightMetres"] + DEFAULT_PARAPET
            outline = traced_outline(result["frame"], result["roof"], result["frame"].raster(footprint, result["leans"][-1]), h, result["leans"][-1])
            if outline is not None and 0.5 <= outline.area / footprint[0][0].area <= 2.0:
                check = measure(sheet, field, [[(outline, h)], footprint])
                iou_traced, iou_again = check["ious"]
                record["iou"]["traced"] = None if iou_traced is None else round(iou_traced, 3)
                if iou_traced is not None and iou_again is not None and iou_traced >= iou_again + 0.05 and (not use_lod4 or iou_traced >= iou_lod4 + 0.05):
                    traced = outline
                    record["lean"] = [round(float(v), 3) for v in check["lean"]]
                    record["iou"]["footprint"] = round(iou_again, 3)
                    record["flags"].append("outline traced on the NGII 2025 orthophoto (lean-corrected); its IoU comes from the same watershed, seeded symmetrically with the current footprint")
                    if use_lod4:
                        record["flags"].append(f"LOD4 masses (photo IoU {iou_lod4:.3f}) replaced by the photo-traced outline")
                        use_lod4 = False
        if masses and not use_lod4 and traced is None:
            record["flags"].append(f"LOD4 masses rejected: photo IoU {iou_lod4} against {iou_footprint} for the current footprint")
        # Keep the fit diagnostic even when the photo rejects the LOD4 geometry.
        if registration is not None:
            record["registration"] = {"dx": round(registration["dx"], 3), "dy": round(registration["dy"], 3), "rotDeg": round(registration["rotDeg"], 3),
                                      "pivot": [round(v, 3) for v in registration["pivot"]], "residual_m": round(registration["residual_m"], 3),
                                      "hausdorff_m": round(registration["hausdorff_m"], 3), "planIou": round(registration["iou"], 3),
                                      "planIouBefore": round(registration["iouBefore"], 3), "atRotationBound": registration["atRotationBound"]}
            record["lod4Residual_m"] = round(registration["residual_m"], 3)
        clipped = []
        if use_lod4:
            storey = classify(masses, b.get("floors") or 0, label, b.get("tower"))
            masses, clipped = clip_to_footprint(masses, foot[j])
            if registration is not None and registration["atRotationBound"]:
                record["flags"].append(f"registration rotation at the {registration['rotDeg']:+.1f} deg bound; the fit may need more rotation or a review")
                print(f"WARN {b['key']}: registration rotation at the bound ({registration['rotDeg']:+.2f} deg)", file=sys.stderr)
            record["source"] = "VWorld LOD4 mesh (slices and roof pieces)"
            record["storeyMetres"] = round(storey, 2)
            record["masses"] = [mass_out(m) for m in sorted(masses, key=lambda m: (m["base"] > 0, -m["poly"].area))]
            record["voids"] = voids_of(masses)
            record["iou"]["final"] = record["iou"]["lod4"]
        elif curated:
            iou_curated = result["ious"][0]
            record["iou"]["curated"] = None if iou_curated is None else round(iou_curated, 3)
            bounded_curated = []
            zone = foot[j].buffer(0.3, join_style="mitre")
            for mass in curated:
                kept, dropped = clip_to_footprint([mass], foot[j]) if mass["kind"] in CLIPPED_KINDS and not zone.covers(mass["poly"]) else ([mass], [])
                bounded_curated.extend(kept)
                clipped.extend(dropped)
            curated = bounded_curated
            main_mass = max((m for m in curated if m["kind"] == "main"), key=lambda m: m["poly"].area, default=curated[0])
            record["source"] = b["curated"]["source"]
            record["storeyMetres"] = round(main_mass["top"] / main_mass["floors"], 2)
            record["masses"] = [mass_out(m) for m in sorted(curated, key=lambda m: (m["base"] > 0, -m["poly"].area))]
            record["voids"] = voids_of(curated)
            record["iou"]["final"] = record["iou"]["curated"]
            if clipped:
                final_iou = iou(result["frame"].raster([(m["poly"], m["top"] + m.get("parapet", 0.0)) for m in curated], result["lean"]),
                                result["roof"], result["frame"].shadow)
                record["iou"]["final"] = None if final_iou is None else round(final_iou, 3)
            record["flags"].append(f"curated form (data/scnu-facades.json): photo IoU {record['iou']['curated']} against {record['iou']['footprint']} for the current footprint")
        elif traced is not None:
            part = b["parts"][0]
            traced_masses, clipped = clip_to_footprint(
                [{"poly": traced, "kind": "main", "top": part["heightMetres"]}], foot[j])
            record["source"] = "NGII 2025 orthophoto roof outline (lean-corrected)"
            record["iou"]["final"] = record["iou"]["traced"]
            record["masses"] = [{"outer": ring_out(m["poly"].exterior.coords), "holes": [ring_out(h.coords) for h in m["poly"].interiors], "baseMetres": 0.0, "topMetres": round(part["heightMetres"], 2),
                                 "kind": "main", "floors": part.get("floors") or None, "roof": "flat", "parapetMetres": DEFAULT_PARAPET, "parapetEstimated": True,
                                 "areaSquareMetres": round(m["poly"].area, 1), "heightFromFootprint": True} for m in traced_masses]
            if clipped:
                final_iou = iou(check["frame"].raster([(m["poly"], part["heightMetres"] + DEFAULT_PARAPET) for m in traced_masses], check["lean"]),
                                check["roof"], check["frame"].shadow)
                record["iou"]["final"] = None if final_iou is None else round(final_iou, 3)
            record["voids"] = []
        else:
            record["source"] = b["footprintSource"]
            record["lean"] = [round(float(v), 3) for v in result["leans"][-1]]
            record["iou"]["final"] = record["iou"]["footprint"]
            record["masses"] = [{"outer": ring_out(Polygon(p["outer"]).exterior.coords), "holes": [ring_out(Polygon(h).exterior.coords) for h in p["holes"]],
                                 "baseMetres": 0.0, "topMetres": round(p["heightMetres"], 2), "kind": "main", "floors": p.get("floors") or None, "roof": "flat",
                                 "parapetMetres": DEFAULT_PARAPET, "parapetEstimated": True, "areaSquareMetres": round(Polygon(p["outer"], p["holes"]).area, 1),
                                 "fromFootprint": True} for p in b["parts"]]
            record["voids"] = [{"kind": "courtyard", "area": round(Polygon(h).area, 1), "ring": ring_out(Polygon(h).exterior.coords)} for p in b["parts"] for h in p["holes"] if Polygon(h).area >= 10]
            if not owners.get(j):
                record["flags"].append("no VWorld LOD4 model over this footprint")
        for d in clipped:
            record.setdefault("clippedMasses", []).append(d)
            record["flags"].append(f"clip: {d['kind']} {d['areaSquareMetres']} m2 at {d['topMetres']} m dropped ({d['reason']})")
            print(f"WARN {b['key']}: clip dropped {d['kind']} {d['areaSquareMetres']} m2 ({d['reason']})", file=sys.stderr)
        record.setdefault("lod4Residual_m", None)
        out.append(record)
        print(f"{b['key']}: {record['source'][:24]} masses {len(record['masses'])} voids {len(record['voids'])} IoU lod4 {record['iou']['lod4']} footprint {record['iou']['footprint']} lean {record['lean']}", file=sys.stderr)
    json.dump({"buildings": out}, open(sys.argv[2], "w"), ensure_ascii=False)


if __name__ == "__main__":
    main()
