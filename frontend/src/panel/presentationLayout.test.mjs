import assert from "node:assert/strict";
import test from "node:test";
import { capturePresentationLayout, isTypingTarget, restorePresentationLayout, tourPosition } from "./presentationLayout.mjs";

test("capture and restore return the exact layout from before presentation mode", () => {
  const snapshot = capturePresentationLayout({ panelOpen: true, detent: "half", activeTab: "energy" });
  assert.deepEqual(snapshot, { panelOpen: true, detent: "half", activeTab: "energy" });
  assert.ok(Object.isFrozen(snapshot));
  const calls = [];
  const restored = restorePresentationLayout(snapshot, {
    setPanelOpen: (value) => calls.push(["open", value]),
    setDetent: (value) => calls.push(["detent", value]),
    setActiveTab: (value) => calls.push(["tab", value]),
  });
  assert.equal(restored, true);
  assert.deepEqual(calls, [["open", true], ["detent", "half"], ["tab", "energy"]]);
});

test("restore without a snapshot changes nothing", () => {
  const touched = [];
  const setters = { setPanelOpen: () => touched.push(1), setDetent: () => touched.push(1), setActiveTab: () => touched.push(1) };
  assert.equal(restorePresentationLayout(null, setters), false);
  assert.equal(touched.length, 0);
});

test("defaults fill a partial layout", () => {
  assert.deepEqual(capturePresentationLayout({}), { panelOpen: false, detent: "peek", activeTab: "dashboard" });
});

test("typing targets do not trigger the P key", () => {
  assert.equal(isTypingTarget({ tagName: "INPUT" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
  assert.equal(isTypingTarget(null), false);
});

test("tourPosition is 1-based and null outside the list", () => {
  const presets = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(tourPosition(presets, "b"), { current: 2, total: 3 });
  assert.equal(tourPosition(presets, "zzz"), null);
});
