// Polygon skeleton (centreline) for the network builders: rasterise the polygon, Zhang-Suen thinning, prune the spurs
// the corners leave behind, Douglas-Peucker. Pure module, planar coordinates in metres (EPSG:5186 or the simulation
// frame: only distances matter).
//
//   skeletonize(rings, { pixelM = 0.125, spurFactor = 1, simplifyM = 0.1 })
//     rings   outer ring(s) and holes, [[x, y], ...] each (even-odd fill)
//     -> { paths, junctions, distanceAt(x, y), graph: { nodes: [[x, y]], edges: [{ from, to, points }] } }
//
// A spur (a branch from an end point to a junction) is pruned when it is shorter than spurFactor x the local width,
// the width being 2 x the inscribed-circle radius at its junction (the end fork of a rectangle is 0.71 x width long,
// so spurFactor 1 removes those forks and keeps a side street longer than one width). Loops (a polygon with a hole)
// are kept as closed paths.
const NEIGHBOURS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]; // N NE E SE S SW W NW

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points.at(-1);
  const len = Math.hypot(bx - ax, by - ay);
  let worst = -1;
  let worstD = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i];
    const d = len < 1e-12 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (d > worstD) {
      worstD = d;
      worst = i;
    }
  }
  if (worstD <= tolerance) return [points[0], points.at(-1)];
  return [...simplify(points.slice(0, worst + 1), tolerance).slice(0, -1), ...simplify(points.slice(worst), tolerance)];
}

const pathLength = (points) => points.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);

function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2)) : 0;
  return Math.hypot(px - ax - t * ex, py - ay - t * ey);
}

function insideRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function skeletonize(rings, { pixelM = 0.125, spurFactor = 1, simplifyM = 0.1 } = {}) {
  const distanceAt = (x, y) => {
    if (!insideRings(x, y, rings)) return 0;
    let best = Infinity;
    for (const ring of rings) for (let i = 0; i + 1 < ring.length; i += 1) best = Math.min(best, segmentDistance([x, y], ring[i], ring[i + 1]));
    return best;
  };
  const all = rings.flat();
  const minX = Math.min(...all.map((p) => p[0])) - 2 * pixelM;
  const minY = Math.min(...all.map((p) => p[1])) - 2 * pixelM;
  const cols = Math.ceil((Math.max(...all.map((p) => p[0])) - minX) / pixelM) + 3;
  const rows = Math.ceil((Math.max(...all.map((p) => p[1])) - minY) / pixelM) + 3;
  const grid = new Uint8Array(cols * rows);
  // Even-odd scanline fill at cell centres.
  for (let y = 0; y < rows; y += 1) {
    const cy = minY + (y + 0.5) * pixelM;
    const xs = [];
    for (const ring of rings) {
      for (let i = 0; i + 1 < ring.length; i += 1) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[i + 1];
        if (ay > cy !== by > cy) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k] - minX) / pixelM - 0.5));
      const to = Math.min(cols - 1, Math.floor((xs[k + 1] - minX) / pixelM - 0.5));
      for (let x = from; x <= to; x += 1) grid[y * cols + x] = 1;
    }
  }

  // Zhang-Suen thinning (rows grow downwards in index space; orientation does not matter for the result).
  const around = (x, y) => NEIGHBOURS.map(([dx, dy]) => grid[(y + dy) * cols + x + dx]);
  for (let changed = true; changed;) {
    changed = false;
    for (let pass = 0; pass < 2; pass += 1) {
      const kill = [];
      for (let y = 1; y < rows - 1; y += 1) {
        for (let x = 1; x < cols - 1; x += 1) {
          if (!grid[y * cols + x]) continue;
          const p = around(x, y);
          const b = p.reduce((s, v) => s + v, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let i = 0; i < 8; i += 1) if (!p[i] && p[(i + 1) % 8]) a += 1;
          if (a !== 1) continue;
          const [n, , e, , s, , w] = p;
          if (pass === 0 ? n * e * s || e * s * w : n * e * w || n * s * w) continue;
          kill.push(y * cols + x);
        }
      }
      for (const i of kill) grid[i] = 0;
      if (kill.length) changed = true;
    }
  }

  // Remove the redundant corner pixels thinning leaves in staircases (two neighbours that touch each other).
  const neighbourIndices = (i) => NEIGHBOURS.map(([dx, dy]) => i + dy * cols + dx).filter((q) => grid[q]);
  for (let changed = true; changed;) {
    changed = false;
    for (let y = 1; y < rows - 1; y += 1) {
      for (let x = 1; x < cols - 1; x += 1) {
        const i = y * cols + x;
        if (!grid[i]) continue;
        const ns = neighbourIndices(i);
        if (ns.length !== 2) continue;
        const dx = Math.abs((ns[0] % cols) - (ns[1] % cols));
        const dy = Math.abs(Math.floor(ns[0] / cols) - Math.floor(ns[1] / cols));
        if (dx <= 1 && dy <= 1) {
          grid[i] = 0;
          changed = true;
        }
      }
    }
  }
  // Pixel graph: end pixel = 1 (or 0) neighbours, line = 2, junction >= 3.
  const crossing = new Uint8Array(cols * rows);
  const skeletonPixels = [];
  for (let y = 1; y < rows - 1; y += 1) {
    for (let x = 1; x < cols - 1; x += 1) {
      if (!grid[y * cols + x]) continue;
      skeletonPixels.push(y * cols + x);
      crossing[y * cols + x] = Math.max(1, neighbourIndices(y * cols + x).length);
    }
  }
  const centre = (i) => [minX + ((i % cols) + 0.5) * pixelM, minY + (Math.floor(i / cols) + 0.5) * pixelM];
  const nodePixels = skeletonPixels.filter((i) => crossing[i] !== 2);
  const clusterOf = new Map();
  const nodes = [];
  for (const start of nodePixels) {
    if (clusterOf.has(start)) continue;
    const members = [start];
    clusterOf.set(start, nodes.length);
    for (let k = 0; k < members.length; k += 1) {
      const m = members[k];
      for (const [dx, dy] of NEIGHBOURS) {
        const q = m + dy * cols + dx;
        if (grid[q] && crossing[q] >= 3 && crossing[m] >= 3 && !clusterOf.has(q)) {
          clusterOf.set(q, nodes.length);
          members.push(q);
        }
      }
    }
    const pts = members.map(centre);
    nodes.push({ p: [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length], members });
  }
  const visited = new Set();
  const rawEdges = [];
  const neighboursOf = (i) => NEIGHBOURS.map(([dx, dy]) => i + dy * cols + dx).filter((q) => grid[q]);
  const walk = (fromNode, first) => {
    const pixels = [first];
    visited.add(first);
    let current = first;
    for (;;) {
      if (clusterOf.has(current)) return { to: clusterOf.get(current), pixels };
      const next = neighboursOf(current).filter((q) => (clusterOf.has(q) ? pixels.length > 2 || !nodes[fromNode].members.includes(q) : !visited.has(q)));
      if (!next.length) return { to: null, pixels };
      // prefer a node pixel (ends the walk), then 4-connected moves (avoids cutting staircase corners)
      next.sort((a, b) => (clusterOf.has(b) ? 1 : 0) - (clusterOf.has(a) ? 1 : 0) || Math.abs(a - current === 1 || Math.abs(a - current) === cols ? 0 : 1) - (Math.abs(b - current) === 1 || Math.abs(b - current) === cols ? 0 : 1));
      current = next[0];
      if (!clusterOf.has(current)) visited.add(current);
      pixels.push(current);
    }
  };
  for (let n = 0; n < nodes.length; n += 1) {
    for (const m of nodes[n].members) {
      for (const q of neighboursOf(m)) {
        if (nodes[n].members.includes(q) || visited.has(q)) continue;
        const { to, pixels } = walk(n, q);
        if (to === null) continue;
        rawEdges.push({ from: n, to, points: [nodes[n].p, ...pixels.filter((i) => !clusterOf.has(i)).map(centre), nodes[to].p] });
      }
    }
  }
  // Closed loops that carry no node pixel (a polygon with a hole).
  for (const start of skeletonPixels) {
    if (visited.has(start) || clusterOf.has(start)) continue;
    const id = nodes.length;
    nodes.push({ p: centre(start), members: [] });
    const pixels = [start];
    visited.add(start);
    let current = start;
    for (;;) {
      const next = neighboursOf(current).filter((q) => !visited.has(q));
      if (!next.length) break;
      next.sort((a, b) => (Math.abs(a - current) === 1 || Math.abs(a - current) === cols ? 0 : 1) - (Math.abs(b - current) === 1 || Math.abs(b - current) === cols ? 0 : 1));
      current = next[0];
      visited.add(current);
      pixels.push(current);
    }
    rawEdges.push({ from: id, to: id, points: [...pixels.map(centre), nodes[id].p] });
  }

  // Prune spurs, shortest first, then dissolve degree-2 nodes.
  let edges = rawEdges.map((e) => ({ ...e, length: pathLength(e.points) }));
  const degree = () => {
    const d = new Map();
    for (const e of edges) {
      d.set(e.from, (d.get(e.from) ?? 0) + 1);
      d.set(e.to, (d.get(e.to) ?? 0) + 1);
    }
    return d;
  };
  for (;;) {
    const d = degree();
    const spurs = edges.filter((e) => e.from !== e.to && ((d.get(e.from) === 1 && d.get(e.to) >= 3) || (d.get(e.to) === 1 && d.get(e.from) >= 3)))
      .map((e) => {
        const junction = d.get(e.from) >= 3 ? e.from : e.to;
        return { e, limit: spurFactor * 2 * distanceAt(...nodes[junction].p) };
      })
      .filter((s) => s.e.length < s.limit)
      .sort((a, b) => a.e.length - b.e.length);
    if (!spurs.length) break;
    edges = edges.filter((e) => e !== spurs[0].e);
  }
  for (let merged = true; merged;) {
    merged = false;
    const d = degree();
    for (const [n, count] of d) {
      if (count !== 2) continue;
      const touching = edges.filter((e) => e.from === n || e.to === n);
      if (touching.length !== 2 || touching[0] === touching[1] || touching.some((e) => e.from === e.to)) continue;
      const orient = (e, end) => (e.to === end ? e.points : e.points.slice().reverse()); // ends at n
      const a = touching[0];
      const b = touching[1];
      const first = orient(a, n);
      const second = orient(b, n).slice().reverse(); // starts at n
      const from = a.to === n ? a.from : a.to;
      const to = b.to === n ? b.from : b.to;
      edges = edges.filter((e) => e !== a && e !== b);
      edges.push({ from, to, points: [...first, ...second.slice(1)], length: a.length + b.length });
      merged = true;
      break;
    }
  }

  const used = [...new Set(edges.flatMap((e) => [e.from, e.to]))].sort((a, b) => a - b);
  const remap = new Map(used.map((n, i) => [n, i]));
  const graph = {
    nodes: used.map((n) => nodes[n].p),
    edges: edges.map((e) => ({ from: remap.get(e.from), to: remap.get(e.to), points: simplify(e.points, simplifyM) })),
  };
  const d = degree();
  return {
    paths: graph.edges.map((e) => e.points),
    junctions: used.filter((n) => d.get(n) >= 3).map((n) => nodes[n].p),
    distanceAt,
    graph,
  };
}
