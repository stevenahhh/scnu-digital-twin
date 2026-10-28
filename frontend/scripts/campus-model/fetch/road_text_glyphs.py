#!/usr/bin/env python3
"""Road-text letterforms for stages/markingsStandard.mjs: outlines of the syllables and digits the campus road text
uses, from Wanted Sans Variable (SIL OFL 1.1, frontend/public/fonts/WantedSansVariable.woff2, licence beside it) at
weight 700, flattened to polylines and written to data/road-text-glyphs.json in em units (1 em = 1.0, y up).

The road-marking letterform of 업무편람 2024 그림 2-2 (printed p13) is a heavy gothic condensed along the road; the stage
stretches these outlines to the template's character box (lib/markingStandards.mjs road_text). Outlines only: no
pixel of any photo.

    python3 -m venv .venv-fonts && .venv-fonts/bin/pip install fonttools brotli skia-pathops
    .venv-fonts/bin/python frontend/scripts/campus-model/fetch/road_text_glyphs.py
"""
import json
import os

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import OverlapMode, instantiateVariableFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "..", "..", "..", "public", "fonts", "WantedSansVariable.woff2")
OUT = os.path.join(HERE, "..", "data", "road-text-glyphs.json")
TEXT_FILE = os.path.join(HERE, "..", "data", "photo", "markings-text.json")
# statute words drawn where the photo shows text but no reading (stages/markingsRegular.mjs), the protection-zone
# words, digits and the P of a parking bay
EXTRA = "서행천천히경차정지어린이보호구역노인장애인버스전용주차금지0123456789P"
WEIGHT = 700
STEPS = 8  # segments per curve


class FlattenPen(BasePen):
    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.rings = []
        self.ring = []

    def _moveTo(self, p):
        self.ring = [p]

    def _lineTo(self, p):
        self.ring.append(p)

    def _curveToOne(self, p1, p2, p3):
        p0 = self.ring[-1]
        for k in range(1, STEPS + 1):
            t = k / STEPS
            a = (1 - t) ** 3
            b = 3 * (1 - t) ** 2 * t
            c = 3 * (1 - t) * t * t
            d = t ** 3
            self.ring.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))

    def _qCurveToOne(self, p1, p2):
        p0 = self.ring[-1]
        for k in range(1, STEPS + 1):
            t = k / STEPS
            self.ring.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]))

    def _closePath(self):
        if len(self.ring) >= 3:
            if self.ring[0] == self.ring[-1]:
                self.ring.pop()
            self.rings.append(self.ring)
        self.ring = []

    _endPath = _closePath


def main():
    with open(TEXT_FILE, encoding="utf-8") as f:
        readings = json.load(f)["markings"]
    chars = set(EXTRA)
    for m in readings:
        for line in m.get("lines", []):
            chars |= set(line)
    chars.discard(" ")
    font = TTFont(FONT)
    # overlapping contours of the variable font merged (skia-pathops), so each glyph is clean outlines and holes
    font = instantiateVariableFont(font, {"wght": WEIGHT}, overlap=OverlapMode.REMOVE)
    em = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    glyphs = {}
    for ch in sorted(chars):
        name = cmap.get(ord(ch))
        if name is None:
            raise SystemExit(f"Wanted Sans has no glyph for {ch!r}")
        pen = FlattenPen(glyph_set)
        glyph_set[name].draw(pen)
        rings = [[[round(x / em, 5), round(y / em, 5)] for x, y in ring] for ring in pen.rings]
        xs = [p[0] for r in rings for p in r]
        ys = [p[1] for r in rings for p in r]
        glyphs[ch] = {"advance": round(glyph_set[name].width / em, 5), "box": [min(xs), min(ys), max(xs), max(ys)], "rings": rings}
    out = {
        "source": "Wanted Sans Variable (SIL Open Font License 1.1), frontend/public/fonts/WantedSansVariable.woff2, wght 700",
        "letterform": "업무편람 2024 그림 2-2 (printed p13): heavy gothic, condensed along the road by the stage",
        "units": "em, y up; curves flattened to 8 segments",
        "glyphs": glyphs,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"{len(glyphs)} glyphs -> {os.path.relpath(OUT)}")


if __name__ == "__main__":
    main()
