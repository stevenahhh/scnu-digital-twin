import test from "node:test";
import assert from "node:assert/strict";
import { simulationDebugEnabled } from "./simulationDebug.mjs";

test("developer tools stay hidden without the debug query or env flag", () => {
  assert.equal(simulationDebugEnabled({ search: "", env: undefined }), false);
  assert.equal(simulationDebugEnabled({ search: "?model=uni", env: "false" }), false);
  assert.equal(simulationDebugEnabled({ search: "?debug=0", env: "" }), false);
});

test("?debug=1 or ?debug=true opens them", () => {
  assert.equal(simulationDebugEnabled({ search: "?debug=1", env: undefined }), true);
  assert.equal(simulationDebugEnabled({ search: "?model=uni&debug=true", env: undefined }), true);
});

test("VITE_SIMULATION_DEBUG=true opens them without a query", () => {
  assert.equal(simulationDebugEnabled({ search: "", env: "true" }), true);
  assert.equal(simulationDebugEnabled({ search: "", env: "TRUE" }), true);
});
