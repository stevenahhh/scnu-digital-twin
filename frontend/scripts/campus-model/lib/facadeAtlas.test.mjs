// Checks for the window-module parameters of the facade atlas (lib/facadeAtlas.mjs): panes, transom, framePx, lintel.
import assert from "node:assert/strict";
import test from "node:test";
import { buildFacadeAtlas, paintedTile } from "./facadeAtlas.mjs";
import { decodePng } from "./png.mjs";

const base = { id: "T", pattern: "punched", texture: "brick", wall: "#a77b7a", glass: "#5c7579", frame: "#f2f2ef", windows: 1, windowWidth: 0.79, windowHeight: 0.47, sill: 0.06 };
const colour = (look) => Buffer.from(paintedTile(look));

test("more than eighty curated looks fit without exceeding a 4096 pixel texture edge", async () => {
  const looks = Array.from({ length: 81 }, (_, i) => ({ ...base, id: `curated-${i}`, texture: "metal" }));
  const atlas = await buildFacadeAtlas(looks);
  assert.equal(atlas.width, 4096);
  assert.equal(atlas.height, 1200);
  assert.equal(atlas.tiles.size, 81);
  const image = decodePng(atlas.color), normal = decodePng(atlas.normal);
  assert.equal(image.width, atlas.width);
  assert.equal(image.height, atlas.height);
  assert.equal(normal.width, atlas.width / 2);
  assert.equal(normal.height, atlas.height / 2);
  const last = atlas.tiles.get("curated-80");
  const at = ((last.y + 20) * image.width + last.x + 28) * 3;
  const expected = colour(looks[80]), tileAt = (20 * 224 + 28) * 3;
  assert.deepEqual([...image.pixels.subarray(at, at + 3)], [...expected.subarray(tileAt, tileAt + 3)]);
});

test("an atlas that cannot fit inside 4096 by 4096 still fails before allocation", async () => {
  const looks = Array.from({ length: 290 }, (_, i) => ({ ...base, id: `too-many-${i}` }));
  await assert.rejects(() => buildFacadeAtlas(looks), Error);
});

test("explicit defaults draw the same tile as no parameters", () => {
  assert.ok(colour(base).equals(colour({ ...base, framePx: 1 })));
});

test("panes, transom, a heavier frame and a lintel each change the tile", () => {
  const plain = colour(base);
  for (const extra of [{ panes: 3 }, { transom: 0.5 }, { framePx: 2 }, { lintel: { colour: "#d9a6a8", height: 0.04 } }]) {
    assert.ok(!plain.equals(colour({ ...base, ...extra })), JSON.stringify(extra));
  }
});

test("cell tiles draw single-bay doors and distinct blank, glazing, louver, stair and vent patterns", () => {
  const kinds = ["window", "blank", "door", "glazing", "louver", "stair", "vent"];
  const tiles = kinds.map(cell => colour({ ...base, cell }));
  assert.equal(new Set(tiles.map(t => t.toString("base64"))).size, kinds.length);
  const door = tiles[2], blank = tiles[1];
  // A cell door opens to the floor in bay zero, unlike the legacy tile's middle-pair entrance.
  const pixel = (t, x, y) => [...t.subarray((y * 224 + x) * 3, (y * 224 + x) * 3 + 3)];
  assert.notDeepEqual(pixel(door, 24, 53), pixel(blank, 24, 53));
});

test("cell accents, piers and bands affect their own regions without changing other cells", () => {
  const look = { ...base, cell: "window" };
  const plain = colour(look);
  for (const extra of [
    { accent: { colour: "#ef6a22", bays: [0, 1, 2, 3], kind: "frame" } },
    { piers: { every: 1, width: 0.1, colour: "#ef6a22" } },
    { band: { height: 0.1, colour: "#ef6a22" } },
  ]) assert.ok(!plain.equals(colour({ ...look, ...extra })), JSON.stringify(extra));
});
