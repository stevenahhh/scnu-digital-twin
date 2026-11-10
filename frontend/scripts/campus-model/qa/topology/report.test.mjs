import assert from "node:assert/strict";
import test from "node:test";
import { summarizeTopology, topologyFailures } from "./report.mjs";

const row = (root, mesh, { trianglesIn, quads, tris = 0, ngons = 0, islands, boundaryEdges = 0 }) =>
  ({ root, mesh, trianglesIn, quads, tris, ngons, islands, boundaryEdges, nonManifoldEdges: boundaryEdges, vertices: 0 });

test("summary groups meshes by root and keeps named meshes", () => {
  const summary = summarizeTopology([
    row("Buildings", "BLD_D4", { trianglesIn: 1000, quads: 480, tris: 10, ngons: 5, islands: 40, boundaryEdges: 100 }),
    row("Buildings", "BLD_A1", { trianglesIn: 1000, quads: 490, tris: 0, ngons: 10, islands: 20, boundaryEdges: 50 }),
    row("Ground", "Topography_joined", { trianglesIn: 500, quads: 100, tris: 300, islands: 1 }),
  ], { meshes: ["BLD_D4"] });
  assert.deepEqual(summary.roots.Buildings, { meshes: 2, trianglesIn: 2000, faces: 995, quads: 970, tris: 10, ngons: 15,
    islands: 60, boundaryEdges: 150, triFaceShare: 0.0101, islandsPerThousandTriangles: 30 });
  assert.equal(summary.meshes.BLD_D4.islands, 40);
  assert.equal(summary.meshes.BLD_D4.triFaceShare, 0.0202);
});

test("limits fail by name, and a missing root or mesh is a failure, not a pass", () => {
  const summary = summarizeTopology([row("Buildings", "BLD_D4", { trianglesIn: 100, quads: 40, tris: 20, islands: 10 })], { meshes: ["BLD_D4"] });
  const limits = { roots: { Buildings: { triFaceShare: 0.05, islandsPerThousandTriangles: 50 }, Context: { triFaceShare: 1 } },
    meshes: { BLD_D4: { islands: 5 }, BLD_A1: { islands: 5 } } };
  assert.deepEqual(topologyFailures(summary, limits), [
    "root Buildings: triFaceShare 0.3333 > 0.05",
    "root Buildings: islandsPerThousandTriangles 100 > 50",
    "root Context: missing from the report",
    "mesh BLD_D4: islands 10 > 5",
    "mesh BLD_A1: missing from the report",
  ]);
});
