import assert from "node:assert/strict";
import test from "node:test";
import { wallsOf } from "./anchors.mjs";
import { compileFacadeGrid, gridCellsOnEdge, recessCutsOnEdge, clipFacadeQuad } from "./facadeGrid.mjs";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";
import { readFileSync } from "node:fs";

const building = "BLD_TEST";
const footprint = { polygons: [[[[244000, 263800], [244000, 263820], [244010, 263820], [244010, 263800]]]] };
footprint.walls = wallsOf(building, footprint);
const record = () => ({
  building, estimated: true,
  storeys: [{ hM: 4, kind: "ground" }, { hM: 3 }],
  walls: {
    W00: {
      bays: { pitchM: 4, count: 4, offsetM: 2 }, default: "window",
      cells: [["blank", "door", "louver", "stair"], null],
      window: { wM: 2, hM: 2, sillM: 1 },
      accents: { piers: { bays: [0, 3], widthM: 0.4, colour: "#ef6a22" }, frames: { bays: [2], colour: "#ef6a22" }, band: { hM: 0.1, colour: "#ef6a22" } },
      materials: { wall: "brick:#9b7070", glass: "#5d7276", frame: "#e8e8e4" },
      evidence: { tier: "T2", refs: ["synthetic wall with four bays"] },
    },
  },
});
const entrances = [{ id: "entry", anchor: { building, wall: "W00", sM: 8 }, widthM: 2 }];

test("D4 passage and recessed tower banks do not become duplicate exterior atlas doors", () => {
  const read = name => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
  const doc = read("buildings/facades/BLD_D4.json");
  const node = read("bld-node-map.json").entries.find(e => e.nodeId === "BLD_D4");
  const fp = { polygons: [[node.walls.map(w => w.A)]], walls: node.walls };
  const grid = compileFacadeGrid(doc, fp, read("buildings/entrances.json").records);
  const ids = [...grid.walls.values()].flatMap(w => w.cells.filter(c => c.entrance).map(c => c.entrance.id));
  assert.deepEqual([...new Set(ids)], ["ENT_D4_E3"]);
});

test("a recorded entrance recess cuts its front volume but leaves the anchored rear door plane", () => {
  const doc = record();
  doc.walls.W00.recesses = [{ entrance: "entry", backM: 0.3, depthM: 2, hM: 3 }];
  const grid = compileFacadeGrid(doc, footprint, entrances);
  assert.deepEqual(recessCutsOnEdge(grid, tmToScene(243999, 263800), tmToScene(243999, 263820)),
    [{ t0: 0.35, t1: 0.45, hM: 3 }]);
  assert.deepEqual(recessCutsOnEdge(grid, tmToScene(244000, 263800), tmToScene(244000, 263820)), []);
  assert.deepEqual(recessCutsOnEdge(grid, tmToScene(243997, 263800), tmToScene(243997, 263820)), []);
});

test("a recess cannot invent an entrance or invert its depth or exceed the ground storey", () => {
  for (const recess of [
    { entrance: "unknown", backM: 0.3, depthM: 2, hM: 3 },
    { entrance: "entry", backM: 2, depthM: 0.3, hM: 3 },
    { entrance: "entry", backM: 0.3, depthM: 2, hM: 5 },
  ]) {
    const doc = record(); doc.walls.W00.recesses = [recess];
    assert.throws(() => compileFacadeGrid(doc, footprint, entrances), /recess/);
  }
});

test("the recess removes only its ground rectangle and keeps both piers and the lintel", () => {
  const pieces = clipFacadeQuad({ t0: 0, t1: 1, y0: 10, y1: 18 }, [{ t0: 0.3, t1: 0.6, y0: 10, y1: 13 }]);
  assert.deepEqual(pieces, [
    { t0: 0, t1: 0.3, y0: 10, y1: 18 },
    { t0: 0.6, t1: 1, y0: 10, y1: 18 },
    { t0: 0.3, t1: 0.6, y0: 13, y1: 18 },
  ]);
});

test("a reviewed source edge can bind a displaced mass without moving GIS bays or leaving end strips", () => {
  const doc = record();
  doc.walls.W00.cells = [null, null];
  doc.walls.W00.surfaceEdges = [{ A: [243999, 263799], B: [243999, 263821], source: "test source mass 0 edge 0" }];
  const grid = compileFacadeGrid(doc, footprint);
  const cells = gridCellsOnEdge(grid, tmToScene(243999, 263799), tmToScene(243999, 263821));
  assert.ok(cells, "the exact reviewed edge must bind");
  const ground = cells.filter(c => c.storey === 0);
  assert.equal(ground[0].t0, 0);
  assert.equal(ground.at(-1).t1, 1);
  assert.equal(ground[0].kind, "blank");
  assert.equal(ground.at(-1).kind, "blank");
  assert.equal(ground.find(c => c.kind === "window").s0M, 2);
  assert.equal(ground.find(c => c.kind === "window").s1M, 6);
  for (let i = 1; i < ground.length; i++) assert.equal(ground[i - 1].t1, ground[i].t0);
  assert.equal(gridCellsOnEdge(grid, tmToScene(243998.98, 263799), tmToScene(243998.98, 263821)), null);
  const unbound = record();
  unbound.walls.W00.cells = [null, null];
  assert.equal(gridCellsOnEdge(compileFacadeGrid(unbound, footprint), tmToScene(243999, 263799), tmToScene(243999, 263821)), null);
});

test("a surface correspondence needs finite source endpoints, a source identity and nonzero wall span", () => {
  for (const edge of [
    { A: [NaN, 263800], B: [243999, 263820], source: "source" },
    { A: [243999, 263800], B: [243999, 263820], source: "" },
    { A: [243999, 263800], B: [243999, 263800], source: "source" },
    { A: [243999, 263800], B: [243999, 263820], range: [0.7, 0.2], source: "source" },
    { A: [243999, 263800], B: [243999, 263820], range: [-0.1, 1], source: "source" },
  ]) {
    const doc = record(); doc.walls.W00.cells = [null, null]; doc.walls.W00.surfaceEdges = [edge];
    assert.throws(() => compileFacadeGrid(doc, footprint), /surface edge/);
  }
});

test("two reviewed walls partition one source edge in both directions without stretching GIS bays", () => {
  const fp = { polygons: [[[[244000,263800],[244000,263810],[244000,263820],[244010,263820],[244010,263800]]]] };
  fp.walls = wallsOf(building, fp);
  const doc = record();
  const spec = { ...doc.walls.W00, cells: undefined, accents: {}, bays: { pitchM: 4, count: 2, offsetM: 1 } };
  const edge = { A: [243999,263799], B: [243999,263821], source: "synthetic shared source edge (estimated)" };
  doc.walls = {
    W00: { ...spec, surfaceEdges: [{ ...edge, range: [0, 0.5] }] },
    W01: { ...spec, surfaceEdges: [{ ...edge, range: [0.5, 1] }] },
  };
  const grid = compileFacadeGrid(doc, fp);
  for (const reverse of [false, true]) {
    const [a, b] = reverse ? [edge.B, edge.A] : [edge.A, edge.B];
    const cells = gridCellsOnEdge(grid, tmToScene(...a), tmToScene(...b)).filter(c => c.storey === 0);
    assert.deepEqual([...new Set(cells.map(c => c.wall))], reverse ? ["W01","W00"] : ["W00","W01"]);
    assert.equal(cells[0].t0, 0);
    assert.equal(cells.at(-1).t1, 1);
    for (let i = 1; i < cells.length; i++) assert.ok(Math.abs(cells[i-1].t1 - cells[i].t0) < 1e-9);
    assert.ok(cells.filter(c => c.bay >= 0).every(c => c.s1M - c.s0M === 4));
  }
});

test("an explicitly partial observation retains the legacy look outside its counted bays", () => {
  const doc = record();
  doc.walls.W00.cells = [null, null];
  doc.walls.W00.outside = "legacy";
  const grid = compileFacadeGrid(doc, footprint);
  const cells = grid.walls.get("W00").cells;
  assert.ok(cells.filter(c => c.bay === -1).every(c => c.legacy));
  assert.ok(cells.filter(c => c.bay >= 0).every(c => !c.legacy));
  assert.ok([...grid.looks.values()].every(l => l.cell !== "blank"));
  doc.walls.W00.outside = "guess";
  assert.throws(() => compileFacadeGrid(doc, footprint), /outside/);
});

test("wall cells retain metre offsets, storey heights, sparse defaults and anchored doors", () => {
  const grid = compileFacadeGrid(record(), footprint, entrances);
  const cells = grid.walls.get("W00").cells;
  assert.deepEqual(cells.filter(c => c.storey === 0).map(c => [c.kind, c.s0M, c.s1M]), [
    ["blank", 0, 2], ["blank", 2, 6], ["door", 6, 10], ["louver", 10, 14], ["stair", 14, 18], ["blank", 18, 20],
  ]);
  assert.deepEqual(cells.filter(c => c.storey === 1 && c.bay >= 0).map(c => [c.kind, c.h0M, c.h1M]), Array(4).fill(["window", 4, 7]));
  assert.equal(cells.find(c => c.kind === "door").entrance.id, "entry");
  assert.equal(cells.find(c => c.bay === 3).look.piers.width, 0.1);
});

test("missing, stale and unknown walls are errors rather than estimated fallback", () => {
  for (const [fp, doc, pattern] of [
    [{ ...footprint, walls: undefined }, record(), /missing/],
    [{ ...footprint, walls: footprint.walls.map(w => ({ ...w, lengthM: w.lengthM + 1 })) }, record(), /stale/],
    [footprint, { ...record(), walls: { W99: record().walls.W00 } }, /W99/],
  ]) assert.throws(() => compileFacadeGrid(doc, fp, entrances), pattern);
});

test("invalid count, overflowing grid, unknown cells and unanchored doors are refused", () => {
  for (const mutate of [
    d => { d.walls.W00.bays.count = 4.5; },
    d => { d.walls.W00.bays.offsetM = 5; },
    d => { d.walls.W00.cells[0][0] = "invented"; },
    d => { d.walls.W00.cells[0][0] = "door"; },
    d => { d.walls.W00.window.hM = 5; },
  ]) {
    const doc = record(); mutate(doc);
    assert.throws(() => compileFacadeGrid(doc, footprint, entrances));
  }
});

test("an entrance replaces its default ground cell but explicit disagreement fails", () => {
  const doc = record(); doc.walls.W00.cells[0] = null;
  assert.equal(compileFacadeGrid(doc, footprint, entrances).walls.get("W00").cells.find(c => c.storey === 0 && c.bay === 1).kind, "door");
  doc.walls.W00.cells[0] = ["window", "window", "window", "window"];
  assert.throws(() => compileFacadeGrid(doc, footprint, entrances), /entrance/);
});

test("reverse and partial mesh edges clip cells without moving the GIS wall or stretching bays", () => {
  const grid = compileFacadeGrid(record(), footprint, entrances);
  const cells = gridCellsOnEdge(grid, tmToScene(244000, 263815), tmToScene(244000, 263805));
  assert.deepEqual(cells.filter(c => c.storey === 0).map(c => [c.kind, c.t0, c.t1]), [
    ["stair", 0, 0.1], ["louver", 0.1, 0.5], ["door", 0.5, 0.9], ["blank", 0.9, 1],
  ]);
  assert.equal(gridCellsOnEdge(grid, tmToScene(244010, 263800), tmToScene(244010, 263820)), null);
  assert.equal(gridCellsOnEdge(grid, tmToScene(244001, 263800), tmToScene(244001, 263820)), null);
});

test("a mass edge extending past a GIS wall falls back instead of leaving uncovered end strips", () => {
  const grid = compileFacadeGrid(record(), footprint, entrances);
  assert.equal(gridCellsOnEdge(grid, tmToScene(244000, 263799.9), tmToScene(244000, 263820.1)), null);
});

test("a door keeps its entrance centre inside the bay instead of snapping to the bay centre", () => {
  const entry = { ...entrances[0], anchor: { ...entrances[0].anchor, sM: 7.5 } };
  const cell = compileFacadeGrid(record(), footprint, [entry]).walls.get("W00").cells.find(c => c.kind === "door");
  assert.equal(cell.look.windowCentre, 0.375);
});

test("per-cell window overrides and nonrectangular wall frames keep independent layouts", () => {
  const doc = record();
  doc.walls.W00.overrides = [{ storey: 1, bay: 2, cell: "vent", window: { wM: 1, hM: 1 } }];
  const cell = compileFacadeGrid(doc, footprint, entrances).walls.get("W00").cells.find(c => c.storey === 1 && c.bay === 2);
  assert.equal(cell.kind, "vent");
  assert.equal(cell.look.windowWidth, 0.25);
  const lShape = { polygons: [[[[244000,263800],[244000,263820],[244010,263820],[244010,263810],[244005,263810],[244005,263800]]]] };
  lShape.walls = wallsOf(building, lShape);
  assert.deepEqual(compileFacadeGrid(doc, lShape, entrances).fallbackWalls, ["W01","W02","W03","W04","W05"]);
});

test("an anchored doorway crossing a bay boundary keeps its entire width and does not stretch neighbouring cells", () => {
  const doc = record();
  doc.walls.W00.cells[0] = null;
  const entry = { ...entrances[0], widthM: 3.6, anchor: { ...entrances[0].anchor, sM: 9.5 } };
  const grid = compileFacadeGrid(doc, footprint, [entry]);
  const door = grid.walls.get("W00").cells.find(c => c.storey === 0 && c.kind === "door");
  assert.ok(Math.abs(door.s0M - 7.7) < 1e-9);
  assert.ok(Math.abs(door.s1M - 11.3) < 1e-9);
  assert.equal(door.look.windowCentre, 0.5);
  assert.equal(door.look.doorWidth, 1);
  const clipped = gridCellsOnEdge(grid, tmToScene(244000,263800),tmToScene(244000,263820));
  const neighbour = clipped.find(c => c.storey === 0 && c.bay === 2);
  assert.ok(Math.abs(neighbour.u0 - 0.325) < 1e-9);
  assert.equal(neighbour.u1, 1);
});
