// Checks for the window-module parameters of the facade atlas (lib/facadeAtlas.mjs): panes, transom, framePx, lintel.
import assert from "node:assert/strict";
import test from "node:test";
import { buildFacadeAtlas, paintedTile } from "./facadeAtlas.mjs";
import { decodePng } from "./png.mjs";
import * as facade from "./facadeAtlas.mjs";
import { readFileSync } from "node:fs";
import { compileFacadeGrid } from "./facadeGrid.mjs";

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

test("D4 atlas paints cells at native 200 px/m in colour and detail maps", async () => {
  const atlas = await facade.buildD4FacadeAtlas([
    { ...base, id: "D4-window", cell: "window", bay: 1.5, texture: "stone" },
    { ...base, id: "D4-blank", cell: "blank", bay: 2.1, texture: "stone" },
  ], { maxStoreyM: 2.3, maxBayM: 2.1 });
  for (const [id, bay] of [["D4-window", 1.5], ["D4-blank", 2.1]]) {
    const tile = atlas.tiles.get(id);
    const a = facade.tileUv(tile, 0, 0, 0), b = facade.tileUv(tile, 0, 1, 1);
    for (const map of ["color", "normal", "arm", "emissive"]) {
      const image = decodePng(atlas[map]);
      assert.ok((b[0] - a[0]) * image.width / bay >= 200 - 1e-8, `${id} ${map} horizontal`);
      assert.ok((a[1] - b[1]) * image.height / 2.3 >= 200 - 1e-8, `${id} ${map} vertical`);
    }
  }
  const image = decodePng(atlas.color), tile = atlas.tiles.get("D4-window");
  const pixel = (x, y) => [...image.pixels.subarray(((tile.y+y)*image.width+tile.x+x)*3,((tile.y+y)*image.width+tile.x+x)*3+3)];
  assert.notDeepEqual(pixel(150, 230), pixel(5, 5), "window and cladding remain distinct");
});

test("every real D4 wall cell fits the pack limit at 200 px/m", async () => {
  const read = file => JSON.parse(readFileSync(new URL(`../data/${file}`,import.meta.url),"utf8"));
  const doc=read("buildings/facades/BLD_D4.json");
  const node=read("bld-node-map.json").entries.find(e=>e.nodeId==="BLD_D4");
  const grid=compileFacadeGrid(doc,{polygons:[[node.walls.map(w=>w.A)]],walls:node.walls},read("buildings/entrances.json").records);
  const legacy=read("scnu-facades.json").looks.find(l=>l.id==="D4");
  const atlas=await facade.buildD4FacadeAtlas([legacy,...grid.looks.values()],{
    maxStoreyM:Math.max(...doc.storeys.map(s=>s.hM)),maxBayM:4.5,
  });
  assert.ok(atlas.width<=4096 && atlas.height<=4096,`${atlas.width} x ${atlas.height} would be downsampled by pack.mjs`);
  for(const wall of grid.walls.values()) for(const cell of wall.cells) {
    if(cell.legacy) continue;
    const tile=atlas.tiles.get(cell.tileId);
    const u0=cell.uv0??0, u1=cell.uv1??1;
    const densityX=tile.bayPx*(u1-u0)/(cell.s1M-cell.s0M);
    const densityY=tile.rowPx/(cell.h1M-cell.h0M);
    assert.ok(densityX>=200-1e-8,`${wall.wall}/${cell.bay}/${cell.storey}: ${densityX} px/m`);
    assert.ok(densityY>=200-1e-8,`${wall.wall}/${cell.bay}/${cell.storey}: ${densityY} px/m`);
  }
});
