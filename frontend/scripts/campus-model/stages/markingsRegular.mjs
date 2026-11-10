// Shared stroke geometry only. Photo fitting lives in fit/markingEvidenceFit.mjs.
import { add, dot, norm, scale, sub, unit } from "../lib/markingFit.mjs";
const perpOf = d => [-d[1], d[0]];
export function strokePath(line, half) {
  const pts = line.filter((p, i) => i === 0 || norm(sub(p, line[i - 1])) > 1e-6);
  if (pts.length < 2) return null;
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i += 1) {
    const before = i > 0 ? unit(sub(pts[i], pts[i - 1])) : null;
    const after = i + 1 < pts.length ? unit(sub(pts[i + 1], pts[i])) : null;
    const tangent = before && after ? unit(add(before, after)) : before ?? after;
    const normal = perpOf(tangent);
    const reference = after ?? before;
    const k = half / Math.max(0.5, dot(normal, perpOf(reference)));
    left.push(add(pts[i], scale(normal, k)));
    right.push(sub(pts[i], scale(normal, k)));
  }
  return [...left, ...right.reverse()];
}
