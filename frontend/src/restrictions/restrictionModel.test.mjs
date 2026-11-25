import assert from "node:assert/strict";
import test from "node:test";
import { buildingNotice, describeRestriction, parseRestrictions, restrictionRibbon, roadLabelPoint } from "./restrictionModel.mjs";

const road = { id: "RST_0001", target_type: "road", target_id: "RD_060", target_name: "정문로", cause: "construction", access: "vehicles", message: "포장 공사", segments: [[[0, 0], [10, 0]]], affected_edges: 1 };
const building = { id: "RST_0002", target_type: "building", target_id: "BLD_C1", target_name: "도서관", cause: "event", access: null, message: "", segments: [], affected_edges: 0 };

test("the list keeps well-formed restrictions and survives any other response", () => {
  assert.deepEqual(parseRestrictions({ restrictions: [road, { id: 3 }, building] }).map((item) => item.id), ["RST_0001", "RST_0002"]);
  assert.deepEqual(parseRestrictions({ base_weather: null }), []);
  assert.deepEqual(parseRestrictions(null), []);
});

test("each restriction reads as a cause and what it means", () => {
  assert.deepEqual(describeRestriction(road), { title: "정문로", status: "공사 · 차량 통행 제한", detail: "포장 공사" });
  assert.deepEqual(describeRestriction({ ...road, cause: "event", access: "all", message: "" }), { title: "정문로", status: "행사 · 전면 통제", detail: "" });
  assert.equal(describeRestriction({ ...building, cause: "construction" }).status, "공사 중");
  assert.equal(describeRestriction(building).status, "행사 중");
});

test("a building notice matches the selected element and ignores roads", () => {
  assert.equal(buildingNotice([road, building], "BLD_C1").id, "RST_0002");
  assert.equal(buildingNotice([road, building], "RD_060"), null);
  assert.equal(buildingNotice([road], null), null);
});

test("the ribbon alternates stripes along the road at the requested width", () => {
  const ribbon = restrictionRibbon([[[0, 0], [10, 0]]], ([x, z]) => [x, 1, z], { halfWidth: 2, stripe: 2.5 });
  assert.equal(ribbon.stripes.length, 4);
  assert.deepEqual([...ribbon.stripes], [0, 1, 0, 1]);
  assert.equal(ribbon.positions.length, 4 * 4 * 3);
  assert.equal(ribbon.indices.length, 4 * 6);
  assert.deepEqual([...ribbon.positions.slice(0, 6)], [0, 1, 2, 0, 1, -2]);
});

test("the ribbon skips zero-length pieces and the label sits halfway along the road", () => {
  assert.equal(restrictionRibbon([[[1, 1], [1, 1]]], ([x, z]) => [x, 0, z]).indices.length, 0);
  assert.deepEqual(roadLabelPoint([[[0, 0], [10, 0]], [[10, 0], [10, 30]]]), [10, 10]);
  assert.equal(roadLabelPoint([]), null);
});
