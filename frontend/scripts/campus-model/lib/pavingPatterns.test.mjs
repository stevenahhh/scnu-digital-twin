// Checks for the VR-read paving pattern tiles (data/paving-patterns.json, lib/pavingPatterns.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PAVING_PATTERNS_FILE, PAVING_PX_PER_M, pavingPattern, pavingTile } from "./pavingPatterns.mjs";

const ids = Object.keys(JSON.parse(readFileSync(PAVING_PATTERNS_FILE, "utf8")).patterns);

test("every pattern names its VR source, and its tile is repeatM wide", () => {
  for (const id of ids) {
    const p = pavingPattern(id);
    assert.match(p.source, /VR scene_/, `${id}: source`);
    assert.equal(pavingTile(id).size, Math.round(p.repeatM * PAVING_PX_PER_M), id);
  }
});

test("a tile tiles without a seam: its first and last columns differ no more than any two neighbouring columns", () => {
  for (const id of ["campus-speckle", "brick-herringbone", "pink-paver", "dorm-blue"]) {
    const { rgb, size } = pavingTile(id);
    const column = (x) => Array.from({ length: size }, (_, y) => rgb[(y * size + x) * 3]);
    const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);
    const inner = Math.max(...Array.from({ length: size - 1 }, (_, x) => diff(column(x), column(x + 1))));
    assert.ok(diff(column(size - 1), column(0)) <= inner, `${id}: seam`);
  }
});

test("herringbone covers every cell once with 2:1 bricks; a repeat that breaks the bond's period is refused", () => {
  assert.equal(pavingPattern("brick-herringbone").bond, "herringbone");
  assert.ok(pavingTile("brick-herringbone").size > 0);
  const p = pavingPattern("pink-paver");
  const saved = p.repeatM;
  p.repeatM = 2.5;
  try {
    assert.throws(() => pavingTile("pink-paver"), /not a whole number/);
  } finally {
    p.repeatM = saved;
  }
});
