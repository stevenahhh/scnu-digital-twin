// Land-cover classes stored in data/landcover.png (one byte per scene unit), classified from
// VWorld summer satellite imagery.
export const LANDCOVER = Object.freeze({
  PAVED: 0,
  GRASS: 1,
  TREE: 2,
  SOIL: 3,
  TRACK: 4,
  COURT: 5,
});

// pixels: array of [r, g, b] samples inside one cell.
export function classifyCell(pixels) {
  if (pixels.length === 0) return LANDCOVER.PAVED;
  let r = 0;
  let g = 0;
  let b = 0;
  let lumSum = 0;
  let lumSq = 0;
  for (const [pr, pg, pb] of pixels) {
    r += pr;
    g += pg;
    b += pb;
    const lum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
    lumSum += lum;
    lumSq += lum * lum;
  }
  const n = pixels.length;
  r /= n;
  g /= n;
  b /= n;
  const lum = lumSum / n;
  const texture = Math.sqrt(Math.max(0, lumSq / n - lum * lum));
  const exg = 2 * g - r - b;

  if (r > 120 && r - g > 35 && r - b > 30) return LANDCOVER.TRACK;
  if (b - r > 70 && b > 140) return LANDCOVER.COURT;
  if (exg > 18 && g > r * 1.15 && lum < 66) return LANDCOVER.TREE;
  if (exg > 32 && g > r * 1.2 && texture < 16) return LANDCOVER.GRASS;
  if (exg > 30 && g > r * 1.2) return LANDCOVER.TREE;
  if (r - b > 25 && r >= g && lum > 80 && lum < 200) return LANDCOVER.SOIL;
  return LANDCOVER.PAVED;
}
