import assert from "node:assert/strict";
import test from "node:test";
import { RISK_COLORS, riskColor } from "./riskColors.mjs";
import { EMERGENCY_HEX, RISK_DANGER_HEX, RISK_WARNING_HEX } from "../../ui/sceneTokens.mjs";

test("risk levels map to the scene risk tokens and other levels keep the entity colour", () => {
  assert.equal(riskColor("danger", "#000000"), RISK_DANGER_HEX);
  assert.equal(riskColor("warning", "#000000"), RISK_WARNING_HEX);
  for (const level of ["normal", "caution", undefined, "unknown"]) assert.equal(riskColor(level, "#25636b"), "#25636b");
});

test("the danger colour is never the emergency-vehicle colour", () => {
  assert.notEqual(RISK_COLORS.danger.toLowerCase(), EMERGENCY_HEX.toLowerCase());
  assert.ok(Object.isFrozen(RISK_COLORS));
});
