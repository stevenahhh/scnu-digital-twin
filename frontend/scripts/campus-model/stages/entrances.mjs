import { AnchorError, resolveAnchor } from "../lib/anchors.mjs";
import { Kit, rgb } from "../lib/solids.mjs";
import { metres } from "../lib/frame.mjs";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";

export function validateEntrances(records, footprints) {
  const seen = new Set();
  for (const r of records) {
    const fail = reason => { throw new AnchorError(r.id, r.anchor?.building, reason); };
    if (seen.has(r.id)) fail("duplicate entrance");
    seen.add(r.id);
    if (!Number.isFinite(r.widthM) || !(r.widthM > 0) || !["main","side","service","stair"].includes(r.type)) fail("entrance width/type required");
    if (!Number.isInteger(r.doors?.leaves) || r.doors.leaves < 1) fail("positive door count required");
    if (!/^#[0-9a-f]{6}$/i.test(r.doors.frame)) fail("door frame colour required");
    if (typeof r.doors.glazed !== "boolean") fail("door glazing must be boolean");
    if (!Array.isArray(r.evidence?.refs) || !r.evidence.refs.length || !/^T[0-4]$/.test(r.evidence.tier)) fail("evidence required");
    if (typeof r.estimated !== "boolean" || (r.evidence.tier === "T4" && !r.estimated)) fail("T4 requires estimated:true");
    if (!r.estimated && !["T0","T1","T2"].includes(r.evidence.tier)) fail("estimated:false requires T0-T2 evidence");
    if (!footprints[r.anchor?.building]?.walls) fail("saved wall snapshot required");
    resolveAnchor(r, footprints);
    if (r.steps && (!Number.isInteger(r.steps.risers) || r.steps.risers < 1 ||
      !(r.steps.treadM > 0) || !(r.steps.widthM > 0) ||
      (r.steps.riseM !== undefined && !(r.steps.riseM > 0)))) fail("invalid entrance steps");
    if (!r.canopy) continue;
    const c = r.canopy;
    if (!["cantilever","posted"].includes(c.form) || !["widthM","depthM","heightM","thicknessM"].every(k => Number.isFinite(c[k]) && c[k] > 0)
      || c.thicknessM >= c.heightM || !/^#[0-9a-f]{6}$/i.test(c.colour)) fail("invalid canopy dimensions or colour");
    if (!Array.isArray(c.posts) || c.posts.some(p => !Number.isFinite(p.sM) || !Number.isFinite(p.tM) || Math.abs(p.sM)>c.widthM/2 || p.tM<0 || p.tM>c.depthM)) fail("invalid canopy posts");
  }
}

export function entranceGeometry(record, footprints, stationPoints = []) {
  validateEntrances([record], footprints);
  const f = resolveAnchor(record, footprints);
  const at = (s,t) => f.origin.map((v,i) => v+f.a[i]*s+f.n[i]*t);
  const visible = stationPoints.some(p => (p[0]-f.origin[0])*f.n[0]+(p[1]-f.origin[1])*f.n[1]>0);
  const c = record.canopy;
  return { ...f, estimated: f.estimated || !visible,
    ring: c ? [[-c.widthM/2,0],[c.widthM/2,0],[c.widthM/2,c.depthM],[-c.widthM/2,c.depthM]].map(([s,t])=>at(s,t)) : [],
    posts: c ? c.posts.map(p=>at(p.sM,p.tM)) : [] };
}

export function buildEntrances({ glb, records, footprints, groundAt }) {
  validateEntrances(records, footprints);
  const material = glb.addMaterial({name:"Entrances",pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:0.7}});
  for (const r of records) {
    const f = entranceGeometry(r, footprints);
    const [x,z] = tmToScene(...f.origin);
    const y = groundAt(x,z);
    const point = (s,t) => tmToScene(...f.origin.map((v,i)=>v+f.a[i]*s+f.n[i]*t));
    const kit = new Kit();
    const c = r.canopy;
    if(c) {
      const ring = f.ring.map(p=>tmToScene(...p));
      kit.prism(ring,y+metres(c.heightM-c.thicknessM),y+metres(c.heightM),rgb(c.colour));
      for(const p of f.posts.map(p=>tmToScene(...p))) kit.pole(p,groundAt(...p)-metres(0.05),y+metres(c.heightM-c.thicknessM),0.15,0.15,rgb(c.postColour??c.colour));
      glb.addNode({name:r.id,mesh:glb.addMesh(r.id,[kit.toPrimitive(material)]),extras:{entranceId:r.id,building:r.anchor.building,estimated:f.estimated}}, {root:true});
    }
    const doors = new Kit();
    if (r.steps) {
      const step = r.steps;
      const rise = step.riseM ?? 0.15;
      for (let i=0;i<step.risers;i++) {
        const depth=(step.risers-i)*step.treadM;
        const ring=[[-step.widthM/2,0],[step.widthM/2,0],[step.widthM/2,depth],[-step.widthM/2,depth]].map(([s,t])=>point(s,t));
        doors.prism(ring,y+metres(i*rise),y+metres((i+1)*rise),rgb("#9d9f9b"));
      }
    }
    const doorBase=y+metres(r.steps ? r.steps.risers*(r.steps.riseM??0.15) : 0);
    for(let i=0;i<r.doors.leaves;i++) {
      const a=-r.widthM/2+r.widthM*i/r.doors.leaves, b=-r.widthM/2+r.widthM*(i+1)/r.doors.leaves;
      const ring=[[a,0.02],[b,0.02],[b,0.07],[a,0.07]].map(([s,t])=>point(s,t));
      doors.prism(ring,doorBase,doorBase+metres(2.2),rgb(r.doors.frame));
      const pane=[[a+0.06,0.071],[b-0.06,0.071],[b-0.06,0.08],[a+0.06,0.08]].map(([s,t])=>point(s,t));
      if(r.doors.glazed) doors.prism(pane,doorBase+metres(0.12),doorBase+metres(2.12),rgb("#52636a"));
    }
    glb.addNode({name:`${r.id}/doors`,mesh:glb.addMesh(`${r.id}/doors`,[doors.toPrimitive(material)]),extras:{estimated:true}}, {root:true});
  }
}
