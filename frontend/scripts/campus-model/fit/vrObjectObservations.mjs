// Reviewed silhouettes in the original 2048-pixel cube face, not catalogue visibility ranges.
export function objectObservations(document, stations) {
  if (document.frameVersion !== 2 || !Array.isArray(document.records)) throw new RangeError("stale object observations");
  const scenes = new Set(stations.map(s => s.scene));
  return document.records.map(record => {
    const fail = detail => { throw new RangeError(`${record.id}: ${detail}`); };
    if (record.estimated !== true || !scenes.has(record.scene) || !["f", "r", "b", "l"].includes(record.face)) fail("invalid scene, face or estimated flag");
    if (!record.target) fail("physical target description required");
    const ring = record.referencePolygon;
    if (ring === null) {
      if (!record.reason) fail("unmeasurable correspondence needs a reason");
      return { ...record, col: null };
    }
    if (!Array.isArray(ring) || ring.length < 3 || ring.some(p =>
      !Array.isArray(p) || p.length !== 2 || p.some(v => !Number.isFinite(v) || v < 0 || v > 2048))) fail("invalid reference polygon");
    let area2 = 0, x = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const cross = p[0] * q[1] - q[0] * p[1];
      area2 += cross;
      x += (p[0] + q[0]) * cross;
    }
    if (Math.abs(area2) < 1e-6) fail("zero-area reference polygon");
    return { ...record, col: x / (3 * area2) };
  });
}
