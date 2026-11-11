import assert from "node:assert/strict";
import test from "node:test";
import {tmToScene,sceneToTm} from "../../../src/geo/epsg5186.mjs";
import {seedRoadMarkings} from "./roadMarkingsSeed.mjs";
import {detectedDashLine} from "./markingEvidenceFit.mjs";
import {roadMarkingPlan} from "../stages/roadMarkings.mjs";
import {SCENE_UNITS_PER_METRE as U} from "../lib/frame.mjs";
import {validate} from "../lib/schemas.mjs";
const context={segments:[{id:"RD_TEST",widthM:7,paths:[{line:[[243800,263800],[243900,263800]],lengthM:100}]}],nodes:["ND_TEST"],junctionPoints:[{id:"ND_TEST",point:[243900,263800]}]};
const model=()=>({lines:[],crossings:[],stops:[],symbols:[],areas:[]});
const origin=tmToScene(243820,263802);
const q=tmToScene(243821,263802),d=Math.hypot(q[0]-origin[0],q[1]-origin[1]);
const f=[(q[0]-origin[0])/d,(q[1]-origin[1])/d];
const at=s=>[origin[0]+f[0]*s*U,origin[1]+f[1]*s*U];
const metresPerModelMetre=Math.hypot(...sceneToTm(U,0).map((v,k)=>v-sceneToTm(0,0)[k]));
const fixture=()=>{const m=model();m.lines.push({path:[at(-3),at(3)],kind:"centre_line_yellow",colour:"yellow",widthM:0.2,dashed:false,refs:["fixture"],legacyId:"MK_TEST"});return m;};
const generate=docs=>roadMarkingPlan({...docs,context});

test("seeded centreline is driven by its actual section type and width",()=>{
  const docs=seedRoadMarkings(fixture(),[],context),s=docs.sections.RD_TEST.sections[0];
  assert.equal(s.centre.type,"yellow_solid");
  const base=generate(docs);
  assert.equal(base.pieces.length,1);assert.equal(base.pieces[0].id,"MK_TEST");
  const ring=base.pieces[0].rings[0];
  assert.ok(Math.abs(Math.hypot(ring[2][0]-ring[1][0],ring[2][1]-ring[1][1])/U-0.2)<1e-7);
  s.centre.type="none";assert.equal(generate(docs).pieces.length,0);
});

test("moving the canonical alignment moves its paint by the same seven metres",()=>{
  const docs=seedRoadMarkings(fixture(),[],context);
  for(const a of Object.values(docs.sections.RD_TEST.alignments)) a.line=a.line.map(([e,n])=>[e,n+7]);
  const points=generate(docs).pieces[0].rings[0].map(p=>sceneToTm(...p));
  const c=points.reduce((s,p)=>[s[0]+p[0]/4,s[1]+p[1]/4],[0,0]);
  assert.ok(Math.abs(c[0]-243820)<1e-7);assert.ok(Math.abs(c[1]-263809)<1e-7);
});

test("crossing omissions remain explicit while lane widths control the bar grid",()=>{
  const m=model();m.crossings.push({centre:origin,forward:f,refs:["crossing"],shape:{type:"crossing",lengthM:4.57,widthM:0.5,periodM:0.903,count:5,slots:[0,1,3,4]}});
  const docs=seedRoadMarkings(m,[],context),a=docs.junctions.ND_TEST.approaches[0];
  assert.equal(generate(docs).pieces.length,4);
  for(const l of docs.sections.RD_TEST.sections[0].lanes) l.widthM*=2;
  assert.equal(generate(docs).pieces.length,8);
  a.crossing=null;assert.equal(generate(docs).pieces.length,0);
});

test("one fitted dashed run produces a repeated section pattern rather than saved rectangles",()=>{
  const m=model();m.lines.push({path:[at(0),at(16)],kind:"lane_line_dashed",colour:"white",widthM:0.125,dashed:true,pattern:[3,5],phaseM:0,refs:["dashes"]});
  const docs=seedRoadMarkings(m,[],context),s=docs.sections.RD_TEST.sections[0];
  assert.equal(s.lanes[0].line,"white_dashed");
  const result=generate(docs);
  assert.equal(result.pieces.length,2);
  for(const p of result.pieces){const r=p.rings[0];assert.ok(Math.abs(Math.hypot(r[1][0]-r[0][0],r[1][1]-r[0][1])/U-3)<1e-7);}
});

test("a line drawn as its photo dashes reaches the canonical sections dash for dash",()=>{
  const dashes=[[0.5,1.7],[3.9,5.1],[6.2,7.3],[13,14.1]];
  const m=model();m.lines.push({path:[at(0),at(16)],kind:"lane_line_dashed",colour:"white",widthM:0.125,dashed:true,refs:["ring"],
    ...detectedDashLine(dashes,16)});
  const pieces=generate(seedRoadMarkings(m,[],context)).pieces;
  assert.equal(pieces.length,4);
  const spans=pieces.map(p=>{const e=p.rings[0].map(q=>sceneToTm(...q)[0]-243820);return [Math.min(...e),Math.max(...e)];}).sort((a,b)=>a[0]-b[0]);
  dashes.forEach(([a,b],i)=>{assert.ok(Math.abs(spans[i][0]-a*metresPerModelMetre)<1e-6&&Math.abs(spans[i][1]-b*metresPerModelMetre)<1e-6,`dash ${i}: ${spans[i]}`);});
});

test("a line run on ground with no paint parcel stays out of the canonical sections",()=>{
  // the build refuses paint on natural ground (design 10.3); a photo dash there waits for its ground parcel
  const ctx={...context,parcels:[{id:"ROAD",ring:[[243819,263800],[243828,263800],[243828,263804],[243819,263804]],holes:[],paintAllowed:true,precedence:3}]};
  const m=model();m.lines.push({path:[at(0),at(16)],kind:"lane_line_dashed",colour:"white",widthM:0.125,dashed:true,refs:["ring"],
    ...detectedDashLine([[0.5,1.7],[3.9,5.1],[13,14.1]],16)});
  const docs=seedRoadMarkings(m,[],ctx);
  const pieces=roadMarkingPlan({...docs,context:ctx}).pieces;
  assert.equal(pieces.length,2);
  for(const p of pieces) for(const q of p.rings[0]) assert.ok(sceneToTm(...q)[0]<243828);
});

test("published schema rejects wrong line kinds, negative widths and missing alignments by section id",()=>{
  for(const mutate of [s=>{s.centre.type="purple";},s=>{s.lanes[0].widthM=-1;},s=>{s.alignment="MISSING";}]){
    const docs=seedRoadMarkings(fixture(),[],context),s=docs.sections.RD_TEST.sections[0];mutate(s);
    const result=validate("roadSections",docs.sections,context);
    assert.equal(result.ok,false);assert.ok(result.errors.some(e=>e.includes(s.id)));
  }
});

test("hump seed uses a canonical hump and the cross-section width, preserving its height",()=>{
  const docs=seedRoadMarkings(model(),[{id:"H_TEST",centre:origin,u:f,widthM:6,bands:0}],context);
  const s=docs.sections.RD_TEST.sections[0],plan=generate(docs);
  assert.equal(s.humps.length,1);assert.equal(plan.humps.length,1);
  assert.ok(Math.abs(plan.heightAt(...origin)-0.1)<1e-8);
  assert.ok(Math.abs(s.lanes[0].widthM-6*metresPerModelMetre)<1e-8);
  s.humps[0].heightM=0.2;assert.ok(Math.abs(generate(docs).heightAt(...origin)-0.2)<1e-8);
});

test("hump seed keeps the measured painted length, band pitch, phase and lean to the left of travel",()=>{
  const lean=14*Math.PI/180,v=[-f[1],f[0]];
  const stripe=[f[0]*Math.cos(lean)-v[0]*Math.sin(lean),f[1]*Math.cos(lean)-v[1]*Math.sin(lean)];
  const docs=seedRoadMarkings(model(),[{id:"H_LEAN",centre:origin,u:f,widthM:6,lengthM:3.1,bands:13,stripe,
    bandWidthM:0.5,bandOffsetM:0.2,bandStartColour:"white"}],context);
  const h=docs.sections.RD_TEST.sections[0].humps[0];
  assert.ok(Math.abs(h.bandAngleDeg-14)<1e-6,`lean ${h.bandAngleDeg}`);
  assert.ok(Math.abs(h.lengthM-3.1*metresPerModelMetre)<1e-9);
  assert.ok(Math.abs(h.bandWidthM-0.5*metresPerModelMetre)<1e-9&&Math.abs(h.bandOffsetM-0.2*metresPerModelMetre)<1e-9);
  assert.equal(h.bandStartColour,"white");
  const pieces=generate(docs).pieces.map(p=>p.rings[0].map(q=>sceneToTm(...q)));
  const area=pieces.reduce((n,r)=>n+Math.abs(r.reduce((s,p,i)=>s+p[0]*r[(i+1)%r.length][1]-r[(i+1)%r.length][0]*p[1],0))/2,0);
  assert.ok(Math.abs(area-3.1*6*metresPerModelMetre**2)<1e-6,`painted area ${area}`);
});

test("inserting unrelated evidence does not renumber an existing canonical section or alignment",()=>{
  const original=seedRoadMarkings(fixture(),[],context).sections.RD_TEST.sections[0];
  const m=fixture();
  m.lines.unshift({...m.lines[0],refs:["OTHER"],path:[at(10),at(12)]});
  const result=seedRoadMarkings(m,[],context).sections.RD_TEST.sections.find(s=>s.evidence.refs.includes("fixture"));
  assert.equal(result.id,original.id);
  assert.equal(result.alignment,original.alignment);
});

test("crossing logical object identity survives a bar-count change while part ids are unique",()=>{
  const m=model();m.crossings.push({centre:origin,forward:f,refs:["crossing"],shape:{type:"crossing",lengthM:4.57,widthM:0.5,periodM:0.903,count:5,slots:[0,1,2,3,4]}});
  const docs=seedRoadMarkings(m,[],context),a=docs.junctions.ND_TEST.approaches[0];
  const before=generate(docs).pieces;
  for(const l of docs.sections.RD_TEST.sections[0].lanes)l.widthM*=2;
  const after=generate(docs).pieces;
  assert.deepEqual([...new Set(before.map(p=>p.objectId))],[a.id+"/crossing"]);
  assert.deepEqual([...new Set(after.map(p=>p.objectId))],[a.id+"/crossing"]);
  assert.equal(new Set(after.map(p=>p.partId)).size,after.length);
});

test("hump paint uses the carriageway cross-section without shrinking the preserved raised body",()=>{
  const ctx={...context,parcels:[{id:"ROAD",ring:[[243810,263801],[243830,263801],[243830,263805],[243810,263805]],
    holes:[],paintAllowed:true,precedence:3}]};
  const docs=seedRoadMarkings(model(),[{id:"H_EDGE",centre:origin,u:f,widthM:6,bands:12}],ctx);
  const s=docs.sections.RD_TEST.sections[0];
  assert.ok(Math.abs(s.lanes[0].widthM-4)<0.001);
  const plan=roadMarkingPlan({...docs,context:ctx});
  assert.ok(Math.abs(plan.heightAt(...tmToScene(243820,263799.5))-0.1)<1e-8);
  for(const p of plan.pieces) for(const q of p.rings[0]) assert.ok(sceneToTm(...q)[1]>=263801-1e-6);
});
