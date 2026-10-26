import assert from "node:assert/strict";
import test from "node:test";

import { inRings, sampleLine } from "./geom.mjs";
import { HALF_CAR_M, islandPolygons, islandRing, routeAroundIslands } from "./gateIslands.mjs";

// a road along x; three islands parallel to it at z = +3.8, 0 (on the centreline) and -4.6, like the main gate
const island = (id, z, width) => ({ id, axis: [[40, z], [50, z]], widthM: width, ring: islandRing([[40, z], [50, z]], width) });
const islands = [island("N", 3.8, 1.4), island("M", 0, 1.6), island("S", -4.6, 1.6)];
const node = (id, p) => ({ type: "Feature", id, geometry: { type: "Point", coordinates: p }, properties: { id, feature_type: "node" } });
const road = () => ({ type: "Feature", id: "EDGE_R", geometry: { type: "LineString", coordinates: [[0, 0], [90, 0]] }, properties: { id: "EDGE_R", feature_type: "edge", kind: "allowed_road", allowed_types: ["car", "scooter"], from_node: "A", to_node: "B", bidirectional: true, derived: false, estimated: false, width_m: 16, lanes: 1, lanes_source: "assumed", lane_offset_cap_m: 4 } });
const clearance = (p) => Math.min(...islands.map((i) => Math.hypot(p[0] - Math.max(40, Math.min(50, p[0])), p[1] - i.axis[0][1]) - i.widthM / 2));

test("a car edge on an island axis is split into two keep-right one-way lines through the gaps", () => {
  const features = [node("A", [0, 0]), node("B", [90, 0]), road()];
  const report = routeAroundIslands(features, islands);
  assert.equal(report.split.length, 1);
  const byId = new Map(features.map((f) => [f.id, f]));
  const fwd = byId.get("EDGE_R_ISL_FWD"), rev = byId.get("EDGE_R_ISL_REV");
  assert.ok(fwd && rev && byId.get("EDGE_R") && byId.get("EDGE_R_E"));
  assert.equal(fwd.properties.bidirectional, false);
  assert.equal(fwd.properties.estimated, true);
  assert.equal(fwd.properties.lane_offset_cap_m, undefined);
  // forward (+x) keeps right = south (z < 0) through the M-S gap; reverse keeps right = north through the N-M gap
  const mid = (f) => f.geometry.coordinates.find((p) => Math.abs(p[0] - 45) < 0.3);
  assert.ok(mid(fwd)[1] < -0.8 && mid(fwd)[1] > -3.8, `fwd ${mid(fwd)}`);
  assert.ok(mid(rev)[1] > 0.8 && mid(rev)[1] < 3.1, `rev ${mid(rev)}`);
  for (const f of [fwd, rev]) for (const p of sampleLine(f.geometry.coordinates, 0.2)) assert.ok(clearance(p) >= HALF_CAR_M - 0.06, `${f.id} at ${p}`);
  // the pieces meet at the split nodes and the reverse line runs from B side to A side
  assert.equal(fwd.properties.from_node, rev.properties.to_node);
  assert.equal(byId.get("EDGE_R").properties.to_node, fwd.properties.from_node);
});

test("a car edge far from every island is left alone; island polygons are estimated and contain the axis", () => {
  const far = road();
  far.geometry.coordinates = [[0, 40], [90, 40]];
  const features = [node("A", [0, 40]), node("B", [90, 40]), far];
  assert.equal(routeAroundIslands(features, islands).split.length, 0);
  assert.equal(features.length, 3);
  const [poly] = islandPolygons(islands);
  assert.equal(poly.class, "island");
  assert.equal(poly.estimated, true);
  assert.ok(inRings([45, 3.8], poly.rings) && !inRings([45, 5], poly.rings));
});
