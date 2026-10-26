import assert from "node:assert/strict";
import test from "node:test";

import { CROSSWALK_HEX, ESTIMATED_HEX, ROAD_HEX, SIDEWALK_HEX, styleForEdge } from "./networkDebugStyle.mjs";

test("estimated edges are amber and dashed whatever their kind", () => {
  for (const kind of ["shared_path", "allowed_road", "building_entrance"]) {
    const style = styleForEdge({ kind, estimated: true, derived: true });
    assert.deepEqual([style.color, style.dashed], [ESTIMATED_HEX, true], kind);
  }
});

test("measured sidewalks, crosswalks and roads get their own colours, solid", () => {
  assert.deepEqual(styleForEdge({ kind: "sidewalk" }), { color: SIDEWALK_HEX, dashed: false, opacity: 0.95 });
  assert.deepEqual(styleForEdge({ kind: "crosswalk" }), { color: CROSSWALK_HEX, dashed: false, opacity: 0.95 });
  for (const kind of ["allowed_road", "vehicle_lane", "vehicle_gate", "parking_connection"]) assert.equal(styleForEdge({ kind }).color, ROAD_HEX, kind);
});

test("derived edges stay faint (0.42) as before; unknown kinds fall back to slate dashed", () => {
  assert.equal(styleForEdge({ kind: "allowed_road", derived: true }).opacity, 0.42);
  assert.deepEqual(styleForEdge({ kind: "something_new" }), { color: "#64748b", dashed: true, opacity: 0.95 });
  assert.equal(styleForEdge().dashed, true);
});
