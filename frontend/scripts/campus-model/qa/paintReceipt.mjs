// Read-only receipt of the final primitive. Never changes vertices or faces.
// A simplified face can span adjacent same-colour pieces. Attribute that whole
// final face to every source piece with positive overlap, rather than inventing
// a pre-decimation face or silently choosing one of its contributing IDs.
const CELL = 8;
const bounds = triangle => [
  Math.min(...triangle.map(p => p[0])), Math.min(...triangle.map(p => p[1])),
  Math.max(...triangle.map(p => p[0])), Math.max(...triangle.map(p => p[1])),
];
const keys = triangle => {
  const b = bounds(triangle), result = [];
  for (let x = Math.floor(b[0] / CELL); x <= Math.floor(b[2] / CELL); x += 1) {
    for (let y = Math.floor(b[1] / CELL); y <= Math.floor(b[3] / CELL); y += 1) result.push(`${x},${y}`);
  }
  return result;
};
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function intersects(a, b) {
  for (const triangle of [a, b]) {
    const sign = Math.sign(cross(...triangle));
    if (sign === 0) return false;
    for (let i = 0; i < 3; i += 1) {
      const p = triangle[i], q = triangle[(i + 1) % 3];
      const other = triangle === a ? b : a;
      if (other.every(r => sign * cross(p, q, r) <= 0)) return false;
    }
  }
  return true;
}

export class PaintReceiptError extends Error {
  constructor(face) {
    super(`Final paint face ${face} has no source-piece attribution`);
    this.name = 'PaintReceiptError';
    this.face = face;
  }
}

// sourcePieces hold original vertex indices AFTER welding; sourcePositions is
// the actual Float32 buffer BEFORE decimation. Final positions are the emitted
// buffer, so welding, quantization and removed faces are reflected exactly.
export function finalPaintReceipt({ primitive, sourcePositions, sourcePieces }) {
  const point = (positions, index) => [positions[index * 3], positions[index * 3 + 2]];
  const grid = new Map(), vertices = new Map(), receipt = new Map();
  for (const piece of sourcePieces) {
    for (const face of piece.faces) {
      const triangle = face.map(i => point(sourcePositions, i));
      const row = { id: piece.id, triangle };
      for (const key of keys(triangle)) {
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(row);
      }
      for (const p of triangle) {
        const key = p.join(',');
        if (!vertices.has(key)) vertices.set(key, new Set());
        vertices.get(key).add(piece.id);
      }
    }
  }
  for (let i = 0; i < primitive.indices.length; i += 3) {
    const triangle = Array.from(primitive.indices.slice(i, i + 3), v => point(primitive.positions, v));
    const candidates = new Set(keys(triangle).flatMap(key => grid.get(key) ?? []));
    const ids = new Set([...candidates].filter(row => intersects(triangle, row.triangle)).map(row => row.id));
    // A real zero-area final face must reach the invariant, not disappear from
    // the receipt. Its surviving vertices retain exact source provenance.
    if (cross(...triangle) === 0) {
      for (const p of triangle) for (const id of vertices.get(p.join(',')) ?? []) ids.add(id);
    }
    if (!ids.size) throw new PaintReceiptError(i / 3);
    for (const id of ids) {
      if (!receipt.has(id)) receipt.set(id, { id, triangles: [] });
      receipt.get(id).triangles.push(triangle);
    }
  }
  return [...receipt.values()];
}
