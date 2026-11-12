// Letter outlines for free-standing sign lettering (stages/furniture.mjs, gate_sign), read from the dashboard's own font
// (public/fonts/WantedSansVariable.woff2, SIL OFL 1.1) at SIGN_WEIGHT. The typeface of the real sign is not recorded, so
// the face and the weight are estimates. Curves are flattened to a tolerance in metres, so an edge stays that close to
// the font's curve whatever the size of the letters.
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";
import { pointInRing, ringArea } from "./geometry.mjs";

const FONT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public", "fonts", "WantedSansVariable.woff2");
export const SIGN_WEIGHT = 800;
const MAX_SEGMENTS = 32;
let face = null;
const signFace = () => (face ??= fontkit.openSync(FONT_FILE).getVariation({ wght: SIGN_WEIGHT }));

// Closed rings of a glyph, its font-unit points mapped by `at` and its curves cut into chords within `tolerance`.
function ringsOf(glyph, at, tolerance) {
  const rings = [];
  let ring = null;
  const curve = (points) => {
    const p = [ring.at(-1), ...points];
    let bend = 0;
    for (let i = 0; i + 2 < p.length; i += 1) bend = Math.max(bend, Math.hypot(p[i][0] - 2 * p[i + 1][0] + p[i + 2][0], p[i][1] - 2 * p[i + 1][1] + p[i + 2][1]));
    // a chord over 1/n of a quadratic lies within bend / (4 n^2) of it, of a cubic within 3 bend / (4 n^2)
    const n = Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(Math.sqrt(((p.length === 3 ? 0.25 : 0.75) * bend) / tolerance))));
    for (let k = 1; k <= n; k += 1) {
      let q = p;
      while (q.length > 1) q = q.slice(1).map((b, i) => [q[i][0] + (b[0] - q[i][0]) * (k / n), q[i][1] + (b[1] - q[i][1]) * (k / n)]);
      ring.push(q[0]);
    }
  };
  for (const { command, args } of glyph.path.commands) {
    if (command === "moveTo") {
      ring = [at(args)];
      rings.push(ring);
    } else if (command === "lineTo") ring.push(at(args));
    else if (command === "quadraticCurveTo") curve([at(args.slice(0, 2)), at(args.slice(2))]);
    else if (command === "bezierCurveTo") curve([at(args.slice(0, 2)), at(args.slice(2, 4)), at(args.slice(4))]);
  }
  return rings
    .map((r) => r.filter((p, i) => Math.hypot(p[0] - r[(i + 1) % r.length][0], p[1] - r[(i + 1) % r.length][1]) > 1e-7))
    .filter((r) => r.length >= 3);
}

// Outlines of a line of text in the plane of a sign, lengthM long and heightM tall: s from 0 (the left end as read) to
// lengthM, h from 0 (the foot of the line) up to heightM. Every glyph reaches down to h = 0 (the one with the highest
// foot stands on it, rounded letters overshoot below) and the tallest reaches heightM. The letters keep the font's
// proportions and are spaced out to fill lengthM; a line too long for it is condensed instead.
// Returns [{ char, centre, shapes: [{ outer, holes }] }] in reading order, spaces left out; rings are [[s, h], ...].
// A glyph drawn as overlapping contours comes back as overlapping shapes.
export function signLetters(text, { lengthM, heightM, toleranceM = 0.0005 }) {
  const font = signFace();
  const glyphs = [...text].map((char) => {
    if (!font.hasGlyphForCodePoint(char.codePointAt(0))) throw new Error(`signLetters: no glyph for ${char}`);
    return { char, glyph: font.glyphForCodePoint(char.codePointAt(0)) };
  });
  const inked = glyphs.filter((g) => g.glyph.path.commands.length > 0);
  if (inked.length === 0) return [];
  const foot = Math.max(...inked.map((g) => g.glyph.bbox.minY));
  const k = heightM / (Math.max(...inked.map((g) => g.glyph.bbox.maxY)) - foot);
  let pen = 0;
  for (const g of glyphs) {
    g.pen = pen;
    pen += g.glyph.advanceWidth;
  }
  const left = inked[0].pen + inked[0].glyph.bbox.minX;
  const natural = (inked.at(-1).pen + inked.at(-1).glyph.bbox.maxX - left) * k;
  const squeeze = Math.min(1, lengthM / natural);
  const gaps = glyphs.indexOf(inked.at(-1)) - glyphs.indexOf(inked[0]);
  const spread = gaps > 0 ? Math.max(0, lengthM - natural) / gaps : 0;
  return inked.map((g) => {
    const s0 = (g.pen - left) * k * squeeze + (glyphs.indexOf(g) - glyphs.indexOf(inked[0])) * spread;
    const rings = ringsOf(g.glyph, ([x, y]) => [s0 + x * k * squeeze, (y - foot) * k], toleranceM);
    const areas = rings.map(ringArea);
    // TrueType winds an outline one way and its counters the other; the largest contour is an outline
    const solid = Math.sign(areas[areas.reduce((best, a, i) => (Math.abs(a) > Math.abs(areas[best]) ? i : best), 0)]);
    const shapes = rings.filter((_, i) => Math.sign(areas[i]) === solid).map((outer) => ({ outer, holes: [], area: Math.abs(ringArea(outer)) }));
    rings.forEach((ring, i) => {
      if (Math.sign(areas[i]) === solid) return;
      const owner = shapes.filter((shape) => pointInRing(ring[0], shape.outer)).sort((a, b) => a.area - b.area)[0];
      if (!owner) throw new Error(`signLetters: a counter of ${g.char} lies outside its outlines`);
      owner.holes.push(ring);
    });
    const { minX, maxX } = g.glyph.bbox;
    return { char: g.char, centre: s0 + ((minX + maxX) / 2) * k * squeeze, shapes: shapes.map(({ outer, holes }) => ({ outer, holes })) };
  });
}
