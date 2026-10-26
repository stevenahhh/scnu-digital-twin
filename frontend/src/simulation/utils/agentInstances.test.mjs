import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { EMERGENCY_HEX } from "../../ui/sceneTokens.mjs";
import { agentMatrix, createAgentParts, instanceCapacity, personBob, riskRingColor, RISK_RING_FALLBACK } from "./agentInstances.mjs";
import { RISK_COLORS } from "./riskColors.mjs";

const box = (geometry) => { geometry.computeBoundingBox(); return geometry.boundingBox; };

test("each agent type has the parts of its per-agent component, with their offsets baked in", () => {
  const parts = createAgentParts();
  assert.deepEqual(Object.fromEntries(Object.entries(parts).map(([type, list]) => [type, list.map((p) => p.name)])), {
    car: ["car-body", "car-cabin", "car-wheels", "car-light-bar"],
    person: ["person-body", "person-head"],
    scooter: ["scooter-deck", "scooter-frame", "scooter-wheels"],
  });
  const wheels = box(parts.car[2].geometry);
  // Four wheels at x ±0.72 (0.16 thick along x after the 90° roll), z -0.75 .. 0.78 (radius 0.25), centre height 0.25.
  assert.ok(Math.abs(wheels.min.x + 0.8) < 1e-6 && Math.abs(wheels.max.x - 0.8) < 1e-6);
  assert.ok(Math.abs(wheels.min.z + 1.0) < 1e-6 && Math.abs(wheels.max.z - 1.03) < 1e-6);
  assert.ok(Math.abs(wheels.min.y) < 1e-6 && Math.abs(wheels.max.y - 0.5) < 1e-6);
  const head = box(parts.person[1].geometry);
  assert.ok(Math.abs((head.min.y + head.max.y) / 2 - 1.45) < 1e-6);
});

test("part colours follow risk level and emergency state like the per-agent components", () => {
  const [body, cabin, , lightBar] = createAgentParts().car;
  assert.equal(body.color({ risk_level: "normal" }), "#25636b");
  assert.equal(body.color({ risk_level: "danger" }), RISK_COLORS.danger);
  assert.equal(body.color({ risk_level: "danger", state: "EMERGENCY" }), EMERGENCY_HEX);
  assert.equal(cabin.color({ state: "emergency" }), "#dbeafe");
  assert.equal(lightBar.only({ state: "moving" }), false);
  assert.equal(lightBar.only({ state: "emergency" }), true);
  const [deck] = createAgentParts().scooter;
  assert.equal(deck.color({ risk_level: "normal", state: "wrong_way" }), RISK_COLORS.danger);
  assert.equal(deck.color({ risk_level: "warning" }), RISK_COLORS.warning);
});

test("risk ring only for non-normal levels; unknown levels use the fallback", () => {
  assert.equal(riskRingColor({ risk_level: "normal" }), null);
  assert.equal(riskRingColor({ risk_level: "warning" }), RISK_COLORS.warning);
  assert.equal(riskRingColor({ risk_level: "caution" }), RISK_RING_FALLBACK);
});

test("agent matrix is translation (+ walking bob) times a Y rotation", () => {
  const m = agentMatrix(new THREE.Matrix4(), new THREE.Vector3(1, 2, 3), Math.PI / 2, 0.04);
  const p = new THREE.Vector3(0, 0, 1).applyMatrix4(m);
  assert.ok(p.distanceTo(new THREE.Vector3(2, 2.04, 3)) < 1e-9);
  assert.equal(personBob({ type: "person", speed: 0 }, 1), 0);
  assert.equal(personBob({ type: "car", speed: 5 }, 1), 0);
  assert.ok(Math.abs(personBob({ type: "person", speed: 1.2 }, 0.1) - Math.sin(0.7) * 0.045) < 1e-12);
});

test("instance capacity grows in powers of two and never shrinks", () => {
  assert.equal(instanceCapacity(0), 16);
  assert.equal(instanceCapacity(120), 128);
  assert.equal(instanceCapacity(100, 128), 128);
  assert.equal(instanceCapacity(129, 128), 256);
});
