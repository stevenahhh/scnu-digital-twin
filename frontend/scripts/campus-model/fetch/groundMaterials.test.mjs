import assert from "node:assert/strict";
import test from "node:test";

import { GROUND_ASSETS, assetInfo, physicalSize, validateManifest } from "./groundMaterials.mjs";

test("physical size: Poly Haven mm and ambientCG cm convert to metres; missing dimensions fall back as estimated", () => {
  assert.deepEqual(physicalSize("polyhaven", { dimensions: [3000.000238418579, 3000] }, 9), {
    physicalSizeM: 3, physicalSizeSource: "Poly Haven info dimensions (mm) / 1000", estimated: false,
  });
  assert.equal(physicalSize("ambientcg", { dimensionX: 110, dimensionY: 55 }, 9).physicalSizeM, 1.1);
  assert.equal(physicalSize("ambientcg", { dimensionX: 90 }, 9).physicalSizeM, 0.9);
  const missing = physicalSize("ambientcg", { dimensionX: 0 }, 2.5);
  assert.equal(missing.physicalSizeM, 2.5);
  assert.equal(missing.estimated, true);
});

test("seven classes, each from Poly Haven or ambientCG", () => {
  assert.deepEqual(GROUND_ASSETS.map((a) => a.cls), ["asphalt", "pavers", "concrete", "grass", "soil", "asphalt-red", "lot"]);
  assert.ok(GROUND_ASSETS.every((a) => a.provider === "polyhaven" || a.provider === "ambientcg"));
});

test("manifest schema: complete entries pass, gaps are reported", () => {
  const good = {
    cls: "pavers", asset: "PavingStones150", source_url: "https://ambientcg.com/get?file=PavingStones150_1K-JPG.zip",
    licence: "CC0 1.0", md5: "0123456789abcdef0123456789abcdef", physicalSizeM: 0.9,
    files: { col: "ground-pavers-col.webp", nor: "ground-pavers-nor.webp", arm: "ground-pavers-arm.webp" },
  };
  assert.deepEqual(validateManifest({ materials: [good] }), []);
  const bad = { ...good, md5: "", physicalSizeM: 7, licence: "CC-BY" };
  const problems = validateManifest({ materials: [bad] });
  assert.ok(problems.some((p) => /md5 missing/.test(p)));
  assert.ok(problems.some((p) => /physicalSizeM 7/.test(p)));
  assert.ok(problems.some((p) => /licence CC-BY/.test(p)));
  assert.deepEqual(validateManifest({}), ["materials is not an array"]);
});

test("asset metadata comes through the injected fetch (no network)", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("api/v2/full_json")) return Response.json({ foundAssets: [{ assetId: "Grass004", dimensionX: 140, dimensionY: 140 }] });
    if (url.includes("/info/")) return Response.json({ dimensions: [3000, 3000], authors: { "Rob Tuytel": "All" } });
    if (url.includes("/files/")) {
      const jpg = (name) => ({ "1k": { jpg: { url: `https://dl.example/${name}.jpg`, md5: "x" } } });
      return Response.json({ Diffuse: jpg("diff"), nor_gl: jpg("nor"), arm: jpg("arm") });
    }
    return new Response("missing", { status: 404 });
  };
  const grass = await assetInfo(GROUND_ASSETS.find((a) => a.cls === "grass"), fetchImpl);
  assert.equal(grass.info.dimensionX, 140);
  assert.match(grass.zip, /get\?file=Grass004_1K-JPG\.zip$/);
  const asphalt = await assetInfo(GROUND_ASSETS.find((a) => a.cls === "asphalt"), fetchImpl);
  assert.equal(asphalt.authors, "Rob Tuytel");
  assert.equal(asphalt.maps.nor.url, "https://dl.example/nor.jpg");
  assert.equal(calls.length, 3);
  const failing = async () => new Response("gone", { status: 503 });
  await assert.rejects(assetInfo(GROUND_ASSETS[1], failing), /PavingStones150: .*HTTP 503/);
});
