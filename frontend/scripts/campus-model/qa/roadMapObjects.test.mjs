import assert from "node:assert/strict";
import test from "node:test";
import { ShapeUtils, Vector2 } from "three";
import * as compare from "./mapCompare.mjs";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";

const section = "RS_1111111111111111", approach = "JA_2222222222222222";
const crossing = `${approach}/crossing`;
const ring = [[1010, 2010], [1013, 2010], [1013, 2011], [1010, 2011]];
const piece = (grid, points = ring) => ({
  objectId: crossing, ownerId: approach, partId: `${crossing}/${grid}/part/0`,
  kind: "zebra_bar", colour: "white", rings: [points.map(p => tmToScene(...p))],
});
const emitted = p => ({
  partId: p.partId, objectId: p.objectId, ownerId: p.ownerId,
  triangles: ShapeUtils.triangulateShape(p.rings[0].map(q => new Vector2(...q)), []).map(face => face.map(i => p.rings[0][i])),
  sourceAreaScene: 1, emittedAreaScene: 1,
});

test("whole crossing uses emitted stripe union, with per-bar checks retained and dropped plans absent", () => {
  const a = piece(0), b = piece(1, ring.map(([x, y]) => [x, y + 2]));
  const objects = compare.roadMapObjects([a, b], { parts: [emitted(a)] });
  assert.deepEqual(objects.map(o => o.id), [crossing, `${crossing}/0`]);
  const white = new Uint8Array(160 * 160);
  for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
    const E = 1000 + (x + .5) / 4, N = 2040 - (y + .5) / 4;
    if (E > 1010 && E < 1013 && N > 2010 && N < 2011) white[y * 160 + x] = 1;
  }
  const scores = compare.scoreObjects(objects, { w: 160, h: 160, origin: [1000, 2040], gsdM: .25, paint: { white } });
  assert.deepEqual(scores.map(s => [s.tier, s.iou, s.over]), [["crossing", 1, false], ["crossing_bar", 1, false]]);
});

test("bent stroke centreline retains its vertex rather than collapsing to a bounding-box axis", () => {
  const p = {
    objectId: `${section}/centre`, ownerId: section, partId: `${section}/centre/part/0`,
    kind: "centre_line_yellow", colour: "yellow",
    rings: [[[1000, 2000.1], [1001.9, 2000.1], [1001.9, 2002], [1002.1, 2002], [1002.1, 1999.9], [1000, 1999.9]].map(p => tmToScene(...p))],
  };
  const [object] = compare.roadMapObjects([p], { parts: [{ ...emitted(p), sourceAreaScene: 1, emittedAreaScene: 1 }] });
  for (const [i, expected] of [[1000, 2000], [1002, 2000], [1002, 2002]].entries()) {
    object.geometry.parts[0][i].forEach((v, j) => assert.ok(Math.abs(v - expected[j]) < 1e-7));
  }
});

test("a clipped line is explicitly unmeasurable instead of scoring its unrendered centreline", () => {
  const p = { ...piece(0), objectId: `${section}/centre`, ownerId: section, partId: `${section}/centre/part/0`, kind: "edge_line" };
  const [object] = compare.roadMapObjects([p], { parts: [{ ...emitted(p), emittedAreaScene: .5 }] });
  const [score] = compare.scoreObjects([object], { w: 1, h: 1, origin: [0, 0], gsdM: 1, paint: { white: new Uint8Array(1) } });
  assert.equal(score.unmeasurable, true);
  assert.equal(score.residual_m, null);
  assert.equal(score.over, false);
});

test("line residual geometry follows shifted emitted triangles rather than unchanged planned rings", () => {
  const p = { ...piece(0, [[1010, 2010.1], [1013, 2010.1], [1013, 2009.9], [1010, 2009.9]]),
    objectId: `${section}/centre`, ownerId: section, partId: `${section}/centre/part/0`, kind: "edge_line" };
  const shifted = emitted({ ...p, rings: [[[1010, 2010.6], [1013, 2010.6], [1013, 2010.4], [1010, 2010.4]].map(q => tmToScene(...q))] });
  const [object] = compare.roadMapObjects([p], { parts: [shifted] });
  for (const point of object.geometry.parts[0]) assert.ok(Math.abs(point[1] - 2010.5) < 1e-7);
});

test("a physical reference crossing combines split grids and still counts paint from a dropped half", () => {
  const a = { id: "grid-A", geometry: { type: "area", polygons: [[ring]] } };
  const b = { id: "grid-B", geometry: { type: "area", polygons: [[ring.map(([x, y]) => [x, y + 2])]] } };
  const refs = [{ id: "CW_REF", expected: true, objectIds: ["grid-A", "grid-B"], boundsTm: [1010, 2010, 1013, 2013], refs: ["independent photo rectangle"] }];
  const white = new Uint8Array(160 * 160);
  for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
    const E = 1000 + (x + .5) / 4, N = 2040 - (y + .5) / 4;
    if (E > 1010 && E < 1013 && (N > 2010 && N < 2011 || N > 2012 && N < 2013)) white[y * 160 + x] = 1;
  }
  const sheet = { w: 160, h: 160, origin: [1000, 2040], gsdM: .25, paint: { white } };
  for (const [grids, iou, over] of [[[a, b], 1, false], [[a], .5, true], [[], 0, true]]) {
    const [score] = compare.scoreObjects(compare.physicalRoadCrossings(grids, refs), sheet);
    assert.equal(score.iou, iou);
    assert.equal(score.over, over);
  }
});
