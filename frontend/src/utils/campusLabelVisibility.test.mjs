import assert from "node:assert/strict";
import test from "node:test";
import { isCampusLabelVisible } from "./campusLabelVisibility.mjs";

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });
const canvas = rect(0, 0, 1440, 900);
const openPanel = rect(1000, 0, 440, 900);
const closedPanel = rect(1440, 0, 440, 900);

test("a label inside the canvas and left of the open panel is visible", () => {
  assert.equal(isCampusLabelVisible(rect(100, 100, 80, 20), canvas, openPanel), true);
});

test("a label wholly under the open panel is hidden", () => {
  assert.equal(isCampusLabelVisible(rect(1100, 300, 80, 20), canvas, openPanel), false);
});

test("a label whose centre is left of the panel edge stays visible", () => {
  assert.equal(isCampusLabelVisible(rect(950, 300, 80, 20), canvas, openPanel), true);
});

test("a label whose centre is under the panel is hidden even though its left edge shows", () => {
  assert.equal(isCampusLabelVisible(rect(980, 300, 80, 20), canvas, openPanel), false);
});

test("a label outside the canvas is hidden", () => {
  assert.equal(isCampusLabelVisible(rect(1460, 300, 80, 20), canvas, null), false);
  assert.equal(isCampusLabelVisible(rect(-120, 300, 80, 20), canvas, null), false);
  assert.equal(isCampusLabelVisible(rect(300, 920, 80, 20), canvas, null), false);
});

test("a label hanging over the canvas edge with its centre inside stays visible", () => {
  assert.equal(isCampusLabelVisible(rect(1380, 300, 80, 20), canvas, null), true);
});

test("an open panel that spans a phone screen hides every label", () => {
  const phone = rect(0, 0, 390, 844);
  assert.equal(isCampusLabelVisible(rect(100, 300, 80, 20), phone, rect(0, 0, 390, 844)), false);
});

test("a closed panel parked off to the right hides nothing", () => {
  assert.equal(isCampusLabelVisible(rect(1300, 300, 80, 20), canvas, closedPanel), true);
});

test("a label with no size, as drei leaves one behind the camera, is hidden", () => {
  assert.equal(isCampusLabelVisible(rect(100, 100, 0, 0), canvas, null), false);
});
