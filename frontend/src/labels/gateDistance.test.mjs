import assert from "node:assert/strict";
import test from "node:test";
import { GATE_ANCHOR, describeGateDistance, distanceAndBearingFromGate } from "./gateDistance.mjs";
import { SCENE_UNITS_PER_METRE } from "../geo/epsg5186.mjs";

const at = (east, north) => [east, 0, -north]; // 장면 좌표: +x 동, +z 남. 기준점 [0,0,0], 1 단위 = 1 m로 시험한다.
const fromOrigin = (point) => distanceAndBearingFromGate(point, [0, 0, 0], 1);

test("four cardinal bearings", () => {
  assert.deepEqual(fromOrigin(at(0, 100)), { metres: 100, bearing: "북" });
  assert.deepEqual(fromOrigin(at(100, 0)), { metres: 100, bearing: "동" });
  assert.deepEqual(fromOrigin(at(0, -100)), { metres: 100, bearing: "남" });
  assert.deepEqual(fromOrigin(at(-100, 0)), { metres: 100, bearing: "서" });
});

test("four diagonal bearings", () => {
  assert.equal(fromOrigin(at(70, 70)).bearing, "북동");
  assert.equal(fromOrigin(at(70, -70)).bearing, "남동");
  assert.equal(fromOrigin(at(-70, -70)).bearing, "남서");
  assert.equal(fromOrigin(at(-70, 70)).bearing, "북서");
});

test("zero distance has no bearing", () => {
  assert.deepEqual(fromOrigin(at(0, 0)), { metres: 0, bearing: null });
  assert.deepEqual(fromOrigin(at(3, 2)), { metres: 0, bearing: null });
  assert.equal(fromOrigin(at(3, 4)).metres, 10);
  assert.equal(describeGateDistance({ metres: 0, bearing: null }), "정문에서 추정 직선 거리 10 m 미만");
});

test("rounds to 10 m and converts scene units to metres", () => {
  assert.equal(fromOrigin(at(0, 104)).metres, 100);
  assert.equal(fromOrigin(at(0, 105)).metres, 110);
  const north250m = [GATE_ANCHOR[0], 0, GATE_ANCHOR[2] - 250 * SCENE_UNITS_PER_METRE];
  assert.deepEqual(distanceAndBearingFromGate(north250m), { metres: 250, bearing: "북" });
  assert.equal(describeGateDistance({ metres: 250, bearing: "북" }), "정문에서 추정 직선 거리 250 m · 북");
});
