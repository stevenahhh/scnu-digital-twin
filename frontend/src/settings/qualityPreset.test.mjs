import test from "node:test";
import assert from "node:assert/strict";
import { canvasDpr } from "../render/interactionDpr.mjs";
import {
  QUALITY_EFFECTS,
  QUALITY_RENDERER,
  capCanvasDpr,
  QUALITY_STORAGE_KEY,
  QUALITY_TIERS,
  parseQuality,
  pickDefaultQuality,
  readStoredQuality,
  resolveInitialQuality,
  writeStoredQuality,
} from "./qualityPreset.mjs";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

const throwingStorage = {
  getItem() { throw new Error("SecurityError"); },
  setItem() { throw new Error("QuotaExceededError"); },
};

test("only the three tiers parse; low mounts no post-processing", () => {
  assert.deepEqual(QUALITY_TIERS, ["low", "medium", "high"]);
  assert.equal(parseQuality("high"), "high");
  assert.equal(parseQuality("ultra"), null);
  assert.equal(parseQuality(null), null);
  assert.equal(QUALITY_EFFECTS.low, null);
  assert.equal(QUALITY_EFFECTS.medium.ao.halfRes, true);
  assert.equal(QUALITY_EFFECTS.medium.bloom, false);
  assert.equal(QUALITY_EFFECTS.high.ao.halfRes, false);
  assert.equal(QUALITY_EFFECTS.high.bloom, true);
});

test("tiers set the renderer cost: DPR cap and shadow map size", () => {
  assert.deepEqual(
    QUALITY_TIERS.map((tier) => [QUALITY_RENDERER[tier].maxDpr, QUALITY_RENDERER[tier].shadowMapSize]),
    [[1, 1024], [1.5, 2048], [2, 4096]],
  );
});

test("the tier DPR cap applies at rest and the drag regress still lowers DPR under it", () => {
  assert.deepEqual(capCanvasDpr(canvasDpr(false, 2), 1), [1, 1]);
  assert.deepEqual(capCanvasDpr(canvasDpr(false, 2), 1.5), [1, 1.5]);
  assert.deepEqual(capCanvasDpr(canvasDpr(false, 2), 2), [1, 2]);
  // Retina (2) dragging: High keeps 2 x 0.75, Medium caps the base at 1.5, Low at 1.
  assert.equal(capCanvasDpr(canvasDpr(true, 2), 2), 1.5);
  assert.equal(capCanvasDpr(canvasDpr(true, 2), 1.5), 1.125);
  assert.equal(capCanvasDpr(canvasDpr(true, 2), 1), 0.75);
  // A 1x display is already under every cap.
  assert.equal(capCanvasDpr(canvasDpr(true, 1), 1), 0.75);
  for (const tier of QUALITY_TIERS) {
    const { maxDpr } = QUALITY_RENDERER[tier];
    assert.ok(capCanvasDpr(canvasDpr(true, 3), maxDpr) < capCanvasDpr(canvasDpr(false, 3), maxDpr)[1]);
  }
});

test("default tier follows the GPU name and pixel ratio", () => {
  const apple = "ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)";
  assert.equal(pickDefaultQuality({ renderer: apple, devicePixelRatio: 2 }), "high");
  assert.equal(pickDefaultQuality({ renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)", devicePixelRatio: 3 }), "medium");
  assert.equal(pickDefaultQuality({ renderer: "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)", devicePixelRatio: 1 }), "medium");
  assert.equal(pickDefaultQuality({ renderer: "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)", devicePixelRatio: 2 }), "low");
  assert.equal(pickDefaultQuality({ renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))", devicePixelRatio: 1 }), "low");
  assert.equal(pickDefaultQuality({ renderer: "Apple GPU", devicePixelRatio: 3, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" }), "low");
  assert.equal(pickDefaultQuality(), "medium");
});

test("URL override beats the stored choice, and neither means auto-detect later", () => {
  const storage = memoryStorage({ [QUALITY_STORAGE_KEY]: "medium" });
  assert.deepEqual(resolveInitialQuality({ search: "?quality=high", storage }), { tier: "high", source: "url" });
  assert.deepEqual(resolveInitialQuality({ search: "?quality=bogus", storage }), { tier: "medium", source: "stored" });
  assert.deepEqual(resolveInitialQuality({ search: "", storage: memoryStorage() }), { tier: null, source: "auto" });
});

test("stored values round-trip and storage failures fall back instead of throwing", () => {
  const storage = memoryStorage();
  assert.equal(writeStoredQuality(storage, "high"), true);
  assert.equal(storage.values.get(QUALITY_STORAGE_KEY), "high");
  assert.equal(readStoredQuality(storage), "high");
  storage.setItem(QUALITY_STORAGE_KEY, "garbage");
  assert.equal(readStoredQuality(storage), null);
  assert.equal(readStoredQuality(throwingStorage), null);
  assert.equal(writeStoredQuality(throwingStorage, "low"), false);
  assert.deepEqual(resolveInitialQuality({ storage: throwingStorage }), { tier: null, source: "auto" });
});
