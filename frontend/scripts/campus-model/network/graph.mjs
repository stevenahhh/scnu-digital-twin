// Mutable network graph shared by the builders that attach to the sidewalk graph (crossings, fallback, connectors,
// buildNetwork). Nodes { id, p, ...props }, edges { id, from, to, points, ...props } in the simulation frame.
import { UnionFind, dist, lineLength, segmentNearest } from "./geom.mjs";

export class NetGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = [];
  }

  static fromSidewalks(sidewalks) {
    const g = new NetGraph();
    for (const n of sidewalks.nodes) g.addNode(n.id, n.p, { kind: "sidewalk", sidewalk_id: n.sidewalk_id });
    for (const e of sidewalks.edges) g.addEdge({ ...e, points: e.points.map((p) => p.slice()) });
    return g;
  }

  clone() {
    const g = new NetGraph();
    for (const [id, n] of this.nodes) g.nodes.set(id, { ...n, p: n.p.slice() });
    g.edges = this.edges.map((e) => ({ ...e, points: e.points.map((p) => p.slice()) }));
    return g;
  }

  addNode(id, p, props = {}) {
    if (this.nodes.has(id)) throw new Error(`duplicate node id ${id}`);
    this.nodes.set(id, { id, p, ...props });
    return id;
  }

  addEdge(edge) {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) throw new Error(`edge ${edge.id}: unknown node ${edge.from} / ${edge.to}`);
    this.edges.push(edge);
    return edge;
  }

  nearestNode(p, reach, filter = null) {
    let best = null;
    for (const n of this.nodes.values()) {
      if (filter && !filter(n)) continue;
      const d = dist(p, n.p);
      if (d <= reach && (!best || d < best.d)) best = { node: n, d };
    }
    return best;
  }

  nearestOnEdges(p, reach, filter = null) {
    let best = null;
    for (const e of this.edges) {
      if (filter && !filter(e)) continue;
      for (let i = 0; i + 1 < e.points.length; i += 1) {
        const r = segmentNearest(p, e.points[i], e.points[i + 1]);
        if (r.d <= reach && (!best || r.d < best.d)) best = { edge: e, seg: i, q: r.q, d: r.d };
      }
    }
    return best;
  }

  // Splits `edge` at point q on segment `seg`; the halves are `<id>-1` and `<id>-2`. Returns the new node id.
  split(edge, seg, q, nodeId, nodeProps = {}) {
    const at = this.edges.indexOf(edge);
    if (at < 0) throw new Error(`split: edge ${edge.id} not in graph`);
    this.addNode(nodeId, q, nodeProps);
    const first = { ...edge, id: `${edge.id}-1`, to: nodeId, points: [...edge.points.slice(0, seg + 1), q] };
    const second = { ...edge, id: `${edge.id}-2`, from: nodeId, points: [q, ...edge.points.slice(seg + 1)] };
    this.edges.splice(at, 1, first, second);
    return nodeId;
  }

  // Node at the nearest point of the matching edges within reach: an existing end node when within `mergeM` of it,
  // else a split. Returns { id, d } or null.
  snap(p, reach, { filter = null, nodeId, nodeProps = {}, mergeM = 0.5 } = {}) {
    const hit = this.nearestOnEdges(p, reach, filter);
    if (!hit) return null;
    const e = hit.edge;
    for (const end of [e.from, e.to]) if (dist(this.nodes.get(end).p, hit.q) <= mergeM) return { id: end, d: dist(p, this.nodes.get(end).p) };
    if (lineLength(e.points.slice(0, hit.seg + 1).concat([hit.q])) < 1e-6) return { id: e.from, d: hit.d };
    return { id: this.split(e, hit.seg, hit.q, nodeId, nodeProps), d: hit.d };
  }

  // Connected components over the edges accepted by `filter`: Map node id -> component root.
  components(filter = null) {
    const uf = new UnionFind();
    for (const e of this.edges) if (!filter || filter(e)) uf.union(e.from, e.to);
    const out = new Map();
    for (const e of this.edges) {
      if (filter && !filter(e)) continue;
      out.set(e.from, uf.find(e.from));
      out.set(e.to, uf.find(e.to));
    }
    return out;
  }
}
