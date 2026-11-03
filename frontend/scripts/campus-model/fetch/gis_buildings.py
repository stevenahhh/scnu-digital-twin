"""Clip 국토교통부 GIS건물통합정보 (AL_D010_*.zip) to a lon/lat bbox and print the records as JSON.

    uv run --no-project --with pyproj==3.8.0 python -I gis_buildings.py ZIP WEST SOUTH EAST NORTH

Reads every shapefile set in the zip straight from the archive: the .shp is scanned record by
record (bounding boxes only, in the source CRS), and only the .dbf rows of hits are decoded, so the
1.5-1.8 GB attribute tables are never loaded. Source CRS comes from the .prj AUTHORITY (EPSG:5186
in the 2026 extract); output is EPSG:4326. Only buildings whose every vertex lies inside the bbox
are printed. Text fields are cp949 unless a .cpg says otherwise.

DBF fields (2026 schema, confirmed against SCNU buildings):
  A1 GIS building id, A2 PNU, A9 main use, A11 structure, A12 building area (m2),
  A13 approval date, A16 height (m), A24 building name, A25 dong name,
  A26 floors above ground, A27 floors below ground.
Numbers that overflow their field ("****") or are blank are reported as 0.
"""
import json
import re
import struct
import sys
import zipfile

from pyproj import Transformer


def read_fields(f):
    header = f.read(32)
    count, header_len, record_len = struct.unpack("<IHH", header[4:12])
    rest = f.read(header_len - 32)
    fields, offset = [], 1
    for i in range(0, len(rest) - 1, 32):
        d = rest[i:i + 32]
        if d[0] == 0x0D:
            break
        name, length = d[:11].split(b"\0")[0].decode("ascii"), d[16]
        fields.append((name, offset, length))
        offset += length
    return count, header_len, record_len, fields


def number(text):
    return float(text) if re.fullmatch(r"\d+(\.\d+)?", text) else 0.0


def signed_area(ring):
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:])) / 2


def point_in_ring(point, ring):
    x, y = point
    inside = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            inside = not inside
    return inside


def polygons_of(parts, points):
    """Shapefile rings -> [[outer, *holes], ...]; outers are clockwise in the source CRS."""
    bounds = list(parts) + [len(points)]
    rings = [points[bounds[i]:bounds[i + 1]] for i in range(len(parts))]
    outers = [[r] for r in rings if signed_area(r) <= 0]
    for hole in (r for r in rings if signed_area(r) > 0):
        owner = next((p for p in outers if point_in_ring(hole[0], p[0])), None)
        if owner is None:
            outers.append([hole])  # counter-clockwise outer written by a non-conforming tool
        else:
            owner.append(hole)
    return outers


def main():
    archive, west, south, east, north = sys.argv[1], *map(float, sys.argv[2:6])
    zf = zipfile.ZipFile(archive)
    names = zf.namelist()
    out = []
    for shp in sorted(n for n in names if n.lower().endswith(".shp")):
        base = shp[:-4]
        prj = zf.read(base + ".prj").decode("ascii", "replace")
        epsg = re.findall(r'AUTHORITY\["EPSG","(\d+)"\]', prj)
        if not epsg:
            sys.exit(f"{base}.prj has no EPSG authority")
        encoding = zf.read(base + ".cpg").decode("ascii").strip() if base + ".cpg" in names else "cp949"
        to_src = Transformer.from_crs(4326, int(epsg[-1]), always_xy=True)
        to_geo = Transformer.from_crs(int(epsg[-1]), 4326, always_xy=True)
        corners = [to_src.transform(x, y) for x in (west, east) for y in (south, north)]
        env = (min(c[0] for c in corners), min(c[1] for c in corners), max(c[0] for c in corners), max(c[1] for c in corners))

        hits = {}
        with zf.open(shp) as f:
            f.read(100)
            index = -1
            while len(header := f.read(8)) == 8:
                index += 1
                content = f.read(struct.unpack(">i", header[4:])[0] * 2)
                if struct.unpack("<i", content[:4])[0] not in (5, 15, 25):
                    continue
                xmin, ymin, xmax, ymax = struct.unpack("<4d", content[4:36])
                if xmax < env[0] or xmin > env[2] or ymax < env[1] or ymin > env[3]:
                    continue
                n_parts, n_points = struct.unpack("<ii", content[36:44])
                parts = struct.unpack(f"<{n_parts}i", content[44:44 + 4 * n_parts])
                flat = struct.unpack(f"<{2 * n_points}d", content[44 + 4 * n_parts:44 + 4 * n_parts + 16 * n_points])
                lonlat = [to_geo.transform(flat[2 * k], flat[2 * k + 1]) for k in range(n_points)]
                if all(west <= lon <= east and south <= lat <= north for lon, lat in lonlat):
                    hits[index] = polygons_of(parts, [(round(lon, 7), round(lat, 7)) for lon, lat in lonlat])

        with zf.open(base + ".dbf") as f:
            count, header_len, record_len, fields = read_fields(f)
            for index in sorted(hits):
                if index >= count:
                    sys.exit(f"{shp} record {index} has no .dbf row")
                f.seek(header_len + index * record_len)  # forward-only on a zip member: decompresses and skips
                row = f.read(record_len)
                if row[:1] == b"*":
                    continue
                text = {name: row[o:o + n].replace(b"\0", b"").decode(encoding, "replace").strip() for name, o, n in fields}
                out.append({
                    "file": shp.rsplit("/", 1)[-1],
                    "record": index,
                    "id": text["A1"],
                    "pnu": text["A2"],
                    "buildingName": text["A24"],
                    "dongName": text["A25"],
                    "floors": int(number(text["A26"])),
                    "undergroundFloors": int(number(text["A27"])),
                    "heightMetres": number(text["A16"]),
                    "registerAreaMetres": number(text["A12"]),
                    "usability": text["A9"] or None,
                    "structure": text["A11"] or None,
                    "approvalDate": text["A13"] or None,
                    "polygons": [[[list(p) for p in ring] for ring in polygon] for polygon in hits[index]],
                })
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
