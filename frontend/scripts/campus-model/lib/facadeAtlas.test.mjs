// Checks for the window-module parameters of the facade atlas (lib/facadeAtlas.mjs): panes, transom, framePx, lintel.
import assert from "node:assert/strict";
import test from "node:test";
import { paintedTile } from "./facadeAtlas.mjs";

const base = { id: "T", pattern: "punched", texture: "brick", wall: "#a77b7a", glass: "#5c7579", frame: "#f2f2ef", windows: 1, windowWidth: 0.79, windowHeight: 0.47, sill: 0.06 };
const colour = (look) => Buffer.from(paintedTile(look));

test("explicit defaults draw the same tile as no parameters", () => {
  assert.ok(colour(base).equals(colour({ ...base, framePx: 1 })));
});

test("panes, transom, a heavier frame and a lintel each change the tile", () => {
  const plain = colour(base);
  for (const extra of [{ panes: 3 }, { transom: 0.5 }, { framePx: 2 }, { lintel: { colour: "#d9a6a8", height: 0.04 } }]) {
    assert.ok(!plain.equals(colour({ ...base, ...extra })), JSON.stringify(extra));
  }
});
