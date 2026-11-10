import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildEntrances, entranceGeometry, validateEntrances } from "./entrances.mjs";
import { GlbBuilder } from "../lib/glb.mjs";
import { metres } from "../lib/frame.mjs";
import { wallsOf } from "../lib/anchors.mjs";

const fp = { polygons: [[[[0,0],[0,10],[20,10],[20,0]]]] };
const footprints = { BLD_TEST: { ...fp, walls: wallsOf("BLD_TEST", fp) } };
const entry = () => ({ id:"ENT",anchor:{building:"BLD_TEST",wall:"W00",sM:5,tM:0},widthM:2,type:"main",
  doors:{leaves:2,glazed:true,frame:"#eeeeee"},canopy:{form:"cantilever",widthM:4,depthM:3,heightM:3.2,thicknessM:0.25,colour:"#ee6622",posts:[{sM:-1.5,tM:2.7}]},
  estimated:true,evidence:{tier:"T4",refs:["fixture"]} });
test("shipped entrances retain curated anchors and accepted/rejected observation lineage", () => {
  const read = file => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8"));
  const curated = read("vr-bearings.json").records;
  const shipped = read("buildings/entrances.json").records;
  for (const source of curated) {
    const target = shipped.find(r => r.id === source.id);
    assert.ok(target, source.id);
    assert.equal(target.anchor.sM, source.anchor.sM, source.id);
    assert.deepEqual(target.evidence.refs, source.evidence.refs, source.id);
    assert.deepEqual(target.evidence.rejectedRefs, source.evidence.rejectedRefs, source.id);
    assert.deepEqual(target.evidence.poseAudit, source.evidence.poseAudit, source.id);
  }
});
test("canopy back edge touches its anchor wall and extends outdoors with its declared dimensions", () => {
  const g = entranceGeometry(entry(), footprints);
  assert.deepEqual(g.ring, [[0,3],[0,7],[-3,7],[-3,3]]);
  assert.deepEqual(g.posts, [[-2.7,3.5]]);
});
test("an entrance on a wall facing away from every station stays estimated", () => {
  const r = {...entry(),estimated:false,evidence:{tier:"T2",refs:["fixture"]}};
  assert.equal(entranceGeometry(r, footprints, [[10,5]]).estimated,true);
  assert.equal(entranceGeometry(r, footprints, [[-10,5]]).estimated,false);
});
test("a curated door bank reaches its transom height without generating separate steps", () => {
  const r = { ...entry(), canopy: null, bankHeightM: 4.2,
    doors: { ...entry().doors, heightM: 2.2, frameWidthM: 0.06, glass: "#5aa9ab" },
    stepsRef: "shared-passage" };
  const glb = new GlbBuilder();
  buildEntrances({ glb, records: [r], footprints, groundAt: () => 7 });
  const node = glb.json.nodes.find(n => n.name === "ENT/doors");
  const position = glb.json.accessors[glb.json.meshes[node.mesh].primitives[0].attributes.POSITION];
  assert.ok(Math.abs(position.max[1] - (7 + metres(4.2))) < 1e-5);
  assert.equal(position.min[1], 7);
});
test("orphan canopy, invalid door count, missing snapshot and out-of-wall anchors fail", () => {
  const invalid = [
    {...entry(),widthM:undefined},
    {...entry(),doors:{leaves:0}},
    {...entry(),anchor:{...entry().anchor,sM:11}},
    {...entry(),canopy:{...entry().canopy,depthM:-1}},
    {...entry(),steps:{risers:-1,treadM:0.3,widthM:3}},
    {...entry(),widthM:Infinity},
    {...entry(),estimated:false,evidence:{tier:"T3",refs:["fixture"]}},
    {...entry(),doors:{...entry().doors,glazed:"yes"}},
  ];
  for(const r of invalid) assert.throws(()=>validateEntrances([r],footprints),/ENT/);
  assert.throws(()=>validateEntrances([entry()],{BLD_TEST:fp}),/ENT.*snapshot/);
});
