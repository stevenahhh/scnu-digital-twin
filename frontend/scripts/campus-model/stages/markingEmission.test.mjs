import assert from "node:assert/strict";
import test from "node:test";
import { GlbBuilder } from "../lib/glb.mjs";
import { buildMarkings } from "./markings.mjs";

test("mesh inventory records emitted crossing parts, not excluded or out-of-extent plans", async () => {
  const ids = ["JA_1111111111111111", "JA_2222222222222222", "JA_3333333333333333"];
  const pieces = [200, 210, 10000].map((x, i) => ({
    ownerId: ids[i], objectId: `${ids[i]}/crossing`, partId: `${ids[i]}/crossing/0/part/0`,
    record: `${ids[i]}/crossing/0`, kind: "zebra_bar", colour: "white", estimated: true,
    rings: [[[x, -200], [x + 4, -200], [x + 4, -198], [x, -198]]],
  }));
  const glb = new GlbBuilder();
  const result = await buildMarkings({
    glb, markings: { pieces, source: "test", pieceReport: { roadObjects: pieces.map(p => p.objectId) } },
    decimate: false, exclusions: [[[[209, -201], [215, -201], [215, -197], [209, -197]]]],
    surface: { grid: { step: 20, x0: 0, z0: 0 }, height: () => 0, normal: () => [0, 1, 0] },
  });
  assert.deepEqual(result.roadEmission.parts.map(p => p.partId), [pieces[0].partId]);
  assert.equal(result.roadEmission.parts[0].emittedAreaScene, 8);
  assert.deepEqual(result.roadEmission.dropped.map(p => [p.partId, p.reason]), [
    [pieces[1].partId, "no-emitted-triangles"], [pieces[2].partId, "outside-extent"],
  ]);
  const report = glb.json.nodes.find(n => n.name === "Road_Markings").extras.report;
  assert.deepEqual(report.emittedRoadObjects, [pieces[0].objectId]);
  assert.deepEqual(report.roadObjects, pieces.map(p => p.objectId), "legacy planned inventory remains additive");
});
