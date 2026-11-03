import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sceneToTm } from "../../../src/geo/epsg5186.mjs";
import { roadMarkingPlan } from "./roadMarkings.mjs";

const sections = JSON.parse(readFileSync(new URL("../data/ground/road-sections.json", import.meta.url), "utf8"));
const junctions = JSON.parse(readFileSync(new URL("../data/ground/junctions.json", import.meta.url), "utf8"));
const sectionList = doc => Object.values(doc).flatMap(r => r.sections);
const approachList = doc => Object.values(doc).flatMap(j => j.approaches);
const geometry = pieces => pieces.map(p => ({ kind: p.kind, colour: p.colour, rings: p.rings }));
const centre = p => p.rings[0].map(([x,z]) => sceneToTm(x,z))
  .reduce((s,q) => [s[0]+q[0]/p.rings[0].length,s[1]+q[1]/p.rings[0].length],[0,0]);
const base = roadMarkingPlan({ sections, junctions });
const longitudinal = p => ["centre_line_yellow","lane_line_solid","lane_line_dashed","edge_line","kerb_no_parking"].includes(p.kind);
const junctionPaint = p => p.kind.startsWith("arrow") || ["text","stop_line","zebra_bar"].includes(p.kind);

test("shipped paint changes when actual lane widths double and kerb offsets move three metres", () => {
  const changed = structuredClone(sections);
  for (const s of sectionList(changed)) {
    for (const lane of s.lanes) lane.widthM *= 2;
    s.kerbOffsetsM.left += 3;
    s.kerbOffsetsM.right += 3;
  }
  const result = roadMarkingPlan({ sections: changed, junctions });
  assert.notDeepEqual(geometry(result.pieces), geometry(base.pieces));
});

test("an actual straight kerb moves three metres when its section kerb offset changes", () => {
  const original = base.pieces.find(p => p.kind === "kerb_no_parking" && p.rings[0].length === 4);
  assert.ok(original, "shipped straight kerb must exist");
  const changed = structuredClone(sections);
  for (const s of sectionList(changed)) {
    s.kerbOffsetsM.left += 3;
    s.kerbOffsetsM.right += 3;
  }
  const moved = roadMarkingPlan({ sections: changed, junctions }).pieces.find(p => p.record === original.record);
  assert.ok(moved, original.record);
  const a=centre(original), b=centre(moved);
  assert.ok(Math.abs(Math.hypot(b[0]-a[0],b[1]-a[1])-3) < 1e-6, `${original.record}: actual shift must be 3 m`);
});

test("setting every shipped longitudinal control to none removes all longitudinal paint", () => {
  assert.ok(base.pieces.some(longitudinal), "baseline must contain longitudinal paint");
  const changed = structuredClone(sections);
  for (const s of sectionList(changed)) {
    s.centre.type = "none";
    s.edges = { left: "none", right: "none" };
    s.kerbNoParking = { left: false, right: false };
    for (const lane of s.lanes) lane.line = "none";
  }
  assert.equal(roadMarkingPlan({ sections: changed, junctions }).pieces.filter(longitudinal).length, 0);
});

test("actual crossing bar counts follow their approach lane widths, including a width doubling", () => {
  const records = approachList(junctions).filter(a => a.crossing !== null);
  assert.ok(records.length > 0, "shipped canonical crossings must exist");
  for (const multiplier of [1,2]) {
    const changed = structuredClone(sections);
    for (const s of sectionList(changed)) for (const lane of s.lanes) lane.widthM *= multiplier;
    const result = roadMarkingPlan({ sections: changed, junctions });
    for (const a of records) {
      const s = changed[a.segment].sections.find(s => s.id === a.section);
      assert.ok(s, `${a.id}: canonical section reference`);
      const width = s.lanes.reduce((n,l) => n+l.widthM,0);
      const count = Math.max(0,Math.floor((width-a.crossing.barWidthM)/a.crossing.zebraPeriodM+1e-9)+1);
      const expected = count-(a.crossing.omittedBars ?? []).filter(k => k<count).length;
      assert.equal(result.pieces.filter(p => p.record.startsWith(`${a.id}/crossing/`)).length, expected, `${a.id} width x${multiplier}`);
    }
  }
});

test("clearing actual junction controls removes crossings, stops, arrows and text", () => {
  assert.ok(base.pieces.some(junctionPaint), "baseline must contain junction paint");
  const changed = structuredClone(junctions);
  for (const a of approachList(changed)) {
    a.crossing=null;
    a.stopLineSetbackM=null;
    a.arrows=[];
    a.text=[];
  }
  assert.equal(roadMarkingPlan({ sections, junctions: changed }).pieces.filter(junctionPaint).length,0);
});

test("a shipped crossing follows its offset control by half a metre", () => {
  const changed = structuredClone(junctions);
  const a = approachList(changed).find(a => a.crossing !== null);
  assert.ok(a, "shipped canonical crossing must exist");
  const original = base.pieces.find(p => p.record.startsWith(`${a.id}/crossing/`));
  assert.ok(original,a.id);
  a.crossing.offsetM += 0.5;
  const moved = roadMarkingPlan({ sections, junctions:changed }).pieces.find(p => p.record === original.record);
  assert.ok(moved,original.record);
  const p=centre(original),q=centre(moved);
  assert.ok(Math.abs(Math.hypot(q[0]-p[0],q[1]-p[1])-0.5)<1e-6);
});

test("removing obsolete details does not remove any shipped paint or humps", () => {
  const s=structuredClone(sections),j=structuredClone(junctions);
  for(const r of sectionList(s)) delete r.details;
  for(const a of approachList(j)) delete a.details;
  const result=roadMarkingPlan({sections:s,junctions:j});
  assert.deepEqual(geometry(result.pieces),geometry(base.pieces));
  assert.deepEqual(result.humps,base.humps);
});
