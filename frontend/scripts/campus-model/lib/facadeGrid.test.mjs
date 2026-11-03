import assert from "node:assert/strict";
import test from "node:test";
import { wallsOf } from "./anchors.mjs";
import { compileFacadeGrid, gridCellsOnEdge } from "./facadeGrid.mjs";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";

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
