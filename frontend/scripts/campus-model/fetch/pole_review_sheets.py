"""By-eye review sheets for the standing-pole seeds (NGII 2025 orthophoto, local QA only).

Each chip is centred on a seed (red cross) with metre ticks on its border (long tick every 5 m; x east +, y south +),
so a reviewer can read the pole base as an offset in metres for data/photo/pole-review.json. Chips contain photo
pixels: write them to an evidence directory, never into git.

    bun scripts/campus-model/fetch/poleRoots.mjs --seeds-px /tmp/pole-seeds.json
    python fetch/pole_review_sheets.py /tmp/pole-seeds.json <out-prefix> [--ids A,B,...] [--half-m 8] [--scale 5]
        [--cols 4] [--per 8]

When data/photo/pole-roots.json exists the seeds carry each pole's verdict and final base (cyan ring), so the sheet
doubles as the after-check.
Needs numpy and Pillow. The sheet TIFF is read through a memory map (uncompressed, contiguous strips).
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SHEET = HERE.parent / ".cache" / "ngii-ortho" / "(B060)정사영상_2025_34702020.tif"
GSD = 0.25


def open_sheet(path):
    # classic little-endian TIFF, 8-bit RGB, contiguous strips (lib/ngiiSheet.mjs checks the same layout)
    data = path.read_bytes()[:1 << 16]
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
    offset = val if cnt == 1 else int.from_bytes(path.read_bytes()[val:val + 4], "little")
    return np.memmap(path, dtype=np.uint8, mode="r", offset=offset, shape=(height, width, 3))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("seeds")
    ap.add_argument("out")
    ap.add_argument("--ids", default="")
    ap.add_argument("--half-m", type=float, default=8)
    ap.add_argument("--scale", type=int, default=5)
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--per", type=int, default=8)
    a = ap.parse_args()
    img = open_sheet(SHEET)
    seeds = json.loads(Path(a.seeds).read_text())
    by_id = {s["id"]: s for s in seeds}
    sel = [by_id[i] for i in a.ids.split(",")] if a.ids else seeds
    R = int(a.half_m / GSD)
    S = a.scale
    T = 2 * R * S
    H = T + 16
    for page in range(0, len(sel), a.per):
        chunk = sel[page:page + a.per]
        rows = (len(chunk) + a.cols - 1) // a.cols
        sheet = Image.new("RGB", (a.cols * T + (a.cols - 1) * 6, rows * H + (rows - 1) * 6), (40, 40, 40))
        d = ImageDraw.Draw(sheet)
        for i, o in enumerate(chunk):
            x0, y0 = (i % a.cols) * (T + 6), (i // a.cols) * (H + 6)
            cc, rr = int(math.floor(o["col"])), int(math.floor(o["row"]))
            chip = Image.fromarray(np.array(img[rr - R:rr + R, cc - R:cc + R])).resize((T, T), Image.BICUBIC)
            sheet.paste(chip, (x0, y0 + 16))
            sx = x0 + (o["col"] - (cc - R) + 0.5) * S
            sy = y0 + 16 + (o["row"] - (rr - R) + 0.5) * S
            for (ax, ay, bx, by) in ((-6, 0, -2, 0), (2, 0, 6, 0), (0, -6, 0, -2), (0, 2, 0, 6)):
                d.line([(sx + ax, sy + ay), (sx + bx, sy + by)], fill="red", width=2)
            for m in range(-int(a.half_m), int(a.half_m) + 1):
                tx, ty, L = sx + m * 4 * S, sy + m * 4 * S, 10 if m % 5 == 0 else 5
                if x0 <= tx < x0 + T:
                    d.line([(tx, y0 + 16), (tx, y0 + 16 + L)], fill="yellow")
                    d.line([(tx, y0 + 16 + T - L), (tx, y0 + 16 + T)], fill="yellow")
                if y0 + 16 <= ty < y0 + 16 + T:
                    d.line([(x0, ty), (x0 + L, ty)], fill="yellow")
                    d.line([(x0 + T - L, ty), (x0 + T, ty)], fill="yellow")
            verdict = o.get("verdict") or ""
            if "rootCol" in o:
                bx = x0 + (o["rootCol"] - (cc - R) + 0.5) * S
                by = y0 + 16 + (o["rootRow"] - (rr - R) + 0.5) * S
                d.ellipse([bx - 5, by - 5, bx + 5, by + 5], outline="cyan", width=2)
            d.text((x0 + 2, y0 + 2), f"{page + i + 1}. {o['id']} {o['kind'][:10]} {o['source'][:8]} h{o['heightM']} {verdict}", fill="white")
        sheet.save(f"{a.out}-{page // a.per + 1:02d}.png")
    print(f"pole_review_sheets: {len(sel)} chips -> {a.out}-NN.png")


if __name__ == "__main__":
    main()
