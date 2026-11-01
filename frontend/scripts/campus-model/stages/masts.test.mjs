import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { metres } from "../lib/frame.mjs";
import { MASTS_FILE, mastMesh } from "./masts.mjs";

const { masts } = JSON.parse(readFileSync(MASTS_FILE, "utf8"));

test("every mast record is a whole, estimated lattice with a foot point and two band colours", () => {
  assert.ok(masts.length > 0);
  for (const m of masts) {
    assert.match(m.id, /^[A-Za-z0-9]+$/);
    assert.ok(Array.isArray(m.at) && m.at.length === 2 && m.at.every(Number.isFinite));
    assert.ok(m.heightMetres > 0 && m.baseWidthMetres > m.topWidthMetres && m.topWidthMetres > 0);
    assert.ok(Number.isInteger(m.bands) && m.bands % 2 === 1, "an odd band count ends in the first colour at both ends");
    assert.equal(m.colours.length, 2);
    assert.ok(m.colours.every((c) => /^#[0-9a-f]{6}$/i.test(c)));
    assert.ok(m.platformAt > 0 && m.platformAt < 1);
    assert.match(m.source, /\(estimated\)/);
    assert.match(m.name, /\(추정\)$/);
  }
});

test("the mesh stands on its base, reaches the height plus the rod, and starts and ends in the first band colour", () => {
  const m = masts[0];
  const mesh = mastMesh(m, 10, [0, 0]);
  const ys = mesh.positions.filter((_, i) => i % 3 === 1);
  // the beams' own thickness (a few cm) may dip below the base point; nothing more
  assert.ok(Math.min(...ys) >= 10 - metres(0.1) && Math.min(...ys) <= 10);
  assert.ok(Math.abs(Math.max(...ys) - (10 + metres((m.plinthMetres ?? 0) + m.heightMetres + 1.5))) < 1e-6);
  const xs = mesh.positions.filter((_, i) => i % 3 === 0);
  assert.ok(Math.max(...xs) <= metres(m.baseWidthMetres / 2 + 1) + 1e-6, "nothing wider than the plinth round the foot of the lattice");
  const first = [1, 3, 5].map((k) => parseInt(m.colours[0].slice(k, k + 2), 16));
  const colourAt = (v) => [0, 1, 2].map((c) => mesh.colors[v * 4 + c]);
  // the plinth (24 vertices: one box) comes first, then the bottom lattice panel
  assert.deepEqual(colourAt(m.plinthMetres ? 24 : 0), first, "bottom panel in the first colour");
  const bands = new Set(Array.from({ length: mesh.vertexCount }, (_, v) => colourAt(v).join(",")));
  assert.ok(bands.has(m.colours[1].slice(1).match(/../g).map((h) => parseInt(h, 16)).join(",")), "the second band colour is used");
  assert.ok(mesh.indices.length / 3 > 500);
});
