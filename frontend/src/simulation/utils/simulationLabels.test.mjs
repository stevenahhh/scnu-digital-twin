import test from "node:test";
import assert from "node:assert/strict";
import { demandProfileLabel, interactionLabel, predictionModelLabel, safetyEventLabel, timelineTypeLabel } from "./simulationLabels.mjs";

test("risk engine enums read in Korean", () => {
  assert.equal(safetyEventLabel("TRAFFIC_CONFLICT"), "교통 상충");
  assert.equal(safetyEventLabel("NEAR_MISS"), "아차사고");
  assert.equal(safetyEventLabel("UNSAFE_CROSSING"), "위험 횡단");
  assert.equal(interactionLabel("CONFLICT"), "상충");
  assert.equal(interactionLabel("CROSSING"), "교차");
  assert.equal(predictionModelLabel("route_swept_envelope"), "경로 기반 예측");
  assert.equal(predictionModelLabel("linear_velocity_envelope"), "직선 속도 예측");
});

test("timeline types include trip events and safety events", () => {
  assert.equal(timelineTypeLabel("TRIP_START"), "이동 시작");
  assert.equal(timelineTypeLabel("TRIP_END"), "이동 완료");
  assert.equal(timelineTypeLabel("HARD_BRAKE"), "급제동");
  assert.equal(timelineTypeLabel("COLLISION"), "충돌");
});

test("demand profiles read in Korean", () => {
  assert.equal(demandProfileLabel("daytime"), "주간");
  assert.equal(demandProfileLabel("morning_arrival"), "오전 등교");
});

test("unknown values never print the raw engine string, missing values say so", () => {
  assert.equal(safetyEventLabel("SOMETHING_NEW"), "기타");
  assert.equal(interactionLabel(undefined), "알 수 없음");
  assert.equal(predictionModelLabel(""), "알 수 없음");
});
