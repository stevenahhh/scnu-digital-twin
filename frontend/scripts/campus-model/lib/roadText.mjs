// Road text in the standard letterform (업무편람 2024 그림 2-2): outlines of data/road-text-glyphs.json (Wanted Sans, OFL,
// fetch/road_text_glyphs.py) stretched to the template syllable box of lib/markingStandards.mjs road_text, so every
// syllable of one marking has one box and one stroke weight, condensed along the road as the 그림 shows.
// Local frame in metres: x to the right of travel, y forward (the top of the text), centred on the block.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEMPLATES } from "./markingStandards.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GLYPHS = path.join(HERE, "..", "data", "road-text-glyphs.json");
let glyphs = null;
const load = () => (glyphs ??= JSON.parse(readFileSync(GLYPHS, "utf8")).glyphs);
export const LETTER_GAP = 0.25; // of a syllable width, between syllables
export const LINE_GAP = 0.25; // of a syllable height, between lines

const area = (ring) => ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
function inside([x, y], ring) {
  let r = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
}

// The syllable box in em: x over the glyph's advance, y over the ink of every Hangul syllable in the file, so all
// syllables share one baseline and one height and a narrow digit stays narrow.
let band = null;
function emBand() {
  if (band) return band;
  const boxes = Object.entries(load()).filter(([c]) => c.codePointAt(0) >= 0xac00).map(([, g]) => g.box);
  band = [Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[3]))];
  return band;
}
// One glyph as polygons ([outer, ...holes]) in a box w x h centred at the origin.
export function glyphPolys(char, w, h) {
  const g = load()[char];
  if (!g) throw new Error(`data/road-text-glyphs.json has no glyph for ${char} (rerun fetch/road_text_glyphs.py)`);
  const [y0, y1] = emBand();
  const map = ([x, y]) => [(x / g.advance - 0.5) * w, ((y - y0) / (y1 - y0) - 0.5) * h];
  const rings = g.rings.map((r) => r.map(map));
  const outerSign = Math.sign(rings.map(area).reduce((best, a) => (Math.abs(a) > Math.abs(best) ? a : best), 0));
  const outers = rings.filter((r) => Math.sign(area(r)) === outerSign).map((r) => [r]);
  for (const hole of rings.filter((r) => Math.sign(area(r)) !== outerSign)) {
    const owner = outers.filter((o) => inside(hole[0], o[0])).sort((a, b) => Math.abs(area(a[0])) - Math.abs(area(b[0])))[0];
    if (owner) owner.push(hole);
  }
  return outers;
}
export const hasRoadGlyph = (char) => char === " " || Boolean(load()[char]);

// A text block: `lines` (top line first, the farthest from the approaching driver), every syllable charW x charH metres
// (template box times `scale`), LETTER_GAP and LINE_GAP between them. Returns { polys, widthM, lengthM }.
export function roadTextBlock(lines, scale) {
  const t = TEMPLATES.road_text;
  const cw = t.charWidthM * scale;
  const ch = t.charHeightM * scale;
  const total = lines.length * ch + (lines.length - 1) * LINE_GAP * ch;
  const longest = Math.max(...lines.map((l) => [...l].length));
  const width = longest * cw + (longest - 1) * LETTER_GAP * cw;
  const polys = [];
  lines.forEach((line, k) => {
    const chars = [...line];
    const y = total / 2 - ch / 2 - k * ch * (1 + LINE_GAP);
    const lineWidth = chars.length * cw + (chars.length - 1) * LETTER_GAP * cw;
    chars.forEach((c, i) => {
      if (c === " ") return;
      const x = -lineWidth / 2 + cw / 2 + i * cw * (1 + LETTER_GAP);
      for (const rings of glyphPolys(c, cw, ch)) polys.push(rings.map((r) => r.map(([px, py]) => [px + x, py + y])));
    });
  });
  return { polys, widthM: width, lengthM: total, charWidthM: cw, charHeightM: ch };
}
