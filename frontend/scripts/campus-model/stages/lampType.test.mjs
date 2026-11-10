import assert from "node:assert/strict";
import test from "node:test";
import { lampTypeFor } from "./lights.mjs";

test("a lamp is an arterial lamp where it stands by an arterial road, whatever list it comes from", () => {
  assert.equal(lampTypeFor({ nearArterial: true, nearRoad: true }), "arterial");
  // the city lamp list (data.go.kr) also holds lamps on campus roads and paths: they are not 8 m cobra heads
  assert.equal(lampTypeFor({ method: "data.go.kr", nearArterial: false, nearRoad: true }), "campusRoad");
  assert.equal(lampTypeFor({ method: "data.go.kr", nearArterial: false, nearRoad: false }), "path");
});

test("a surveyed type or an arterial lamp form wins over the position", () => {
  assert.equal(lampTypeFor({ declared: "path", nearArterial: true, nearRoad: true }), "path");
  assert.equal(lampTypeFor({ declared: "unknown", styleForm: "arterial cobra head", nearArterial: false, nearRoad: false }), "arterial");
});
