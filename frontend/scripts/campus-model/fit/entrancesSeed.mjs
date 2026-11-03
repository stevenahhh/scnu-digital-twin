// Reproducible migration of reference-only legacy canopy outlines and simulation entrance hints.
import { readFileSync, writeFileSync } from "node:fs";
import { loadTmFootprints } from "../lib/footprints.mjs";
import { wallsOf, wallCoordinates, resolveAnchor } from "../lib/anchors.mjs";
import { firstBuildingHit } from "./vrSceneBuildings.mjs";
import { validateEntrances } from "../stages/entrances.mjs";
import { wgs84ToTm, simulationToTm, tmToSimulation } from "../../../src/geo/epsg5186.mjs";

const data = name => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
const seed = data("buildings/entrances-seed.json");
const footprints = await loadTmFootprints();
const walls = Object.entries(footprints).flatMap(([id, fp]) => wallsOf(id,fp));
const buildings = Object.entries(footprints).map(([id,fp])=>({id,walls:wallsOf(id,fp).map(w=>({id:w.id,a:w.A,b:w.B}))}));
const stations = JSON.parse(readFileSync(new URL("../../perf/vr-stations.json",import.meta.url),"utf8"));
const bearings = data("vr-bearings.json");
const nearest = (p, building) => walls.filter(w=>!building||w.id.startsWith(`${building}/`)).map(w=>{
  const q=wallCoordinates(p,w), sM=Math.max(0,Math.min(w.lengthM,q.sM));
  const point=w.A.map((v,i)=>v+w.a[i]*sM);
  return {w,sM,distance:Math.hypot(point[0]-p[0],point[1]-p[1])};
}).sort((a,b)=>a.distance-b.distance)[0];
const records = seed.canopies.map(feature=>{
  const p=feature.properties;
  const ring=feature.geometry.coordinates[0].slice(0,-1).map(q=>wgs84ToTm(...q));
  const centre=ring.reduce((s,q)=>s.map((v,i)=>v+q[i]/ring.length),[0,0]);
  const measurement=bearings.records.find(r=>r.id===p.id);
  const columns=/cols (\d+)-(\d+)/.exec(p.note);
  const col=columns?(Number(columns[1])+Number(columns[2]))/2:null;
  const hit=col===null?null:firstBuildingHit(stations.find(s=>s.scene===p.vr_scene),{face:p.vr_face,col},buildings);
  const legacy=nearest(centre);
  const consistent=hit?.point && hit.building===legacy.w.id.split("/")[0];
  const matched=measurement?{w:walls.find(w=>w.id===`${measurement.anchor.building}/${measurement.anchor.wall}`),sM:measurement.anchor.sM}:
    consistent?{w:walls.find(w=>w.id===hit.wall),sM:hit.sM}:legacy;
  const {w,sM}=matched;
  const lengths=ring.map((q,i)=>Math.hypot(q[0]-ring[(i+1)%ring.length][0],q[1]-ring[(i+1)%ring.length][1]));
  const widthM=Math.max(...lengths), depthM=Math.min(...lengths);
  const refs=measurement?.evidence.refs??(consistent?[`VR ${p.vr_scene} ${p.vr_face} col ${col} -> ${w.id}`]:[`Legacy canopy ${p.id}: nearest wall projection; no corroborated column reading`]);
  return {id:p.id,anchor:{building:w.id.split("/")[0],wall:w.wall,sM,tM:0},widthM:Math.min(3.6,widthM),type:"main",
    doors:{leaves:2,glazed:true,frame:p.colour},
    canopy:{form:p.posts?.length?"posted":"cantilever",widthM,depthM,heightM:p.height_m,thicknessM:0.25,colour:p.colour,
      postColour:p.postColour??p.colour,posts:(p.posts??[]).map((_,i)=>({sM:(i===0?-1:1)*(widthM/2-0.15),tM:depthM-0.15}))},
    estimated:true,evidence:{tier:measurement||consistent?"T2":"T4",refs,
      note:`Dimensions and door leaves estimated from legacy reference. ${p.note}`,
      ...(!measurement&&!consistent&&hit?.point?{mappingDisagreement:{legacyBuilding:legacy.w.id.split("/")[0],firstHitBuilding:hit.building,scene:p.vr_scene,face:p.vr_face,col}}:{})}};
});
const simulation=structuredClone(seed.simulation);
for(const building of simulation.buildings) for(const entry of building.entrances) {
  let record=records.find(r=>r.anchor.building===building.building_id);
  if(!record) {
    const [x,,z]=entry.position;
    const pick=nearest(simulationToTm({x,z}),building.building_id);
    if(!pick) throw new Error(`${entry.entrance_id}: missing building footprint`);
    record={id:entry.entrance_id,anchor:{building:building.building_id,wall:pick.w.wall,sM:pick.sM,tM:0},widthM:2,type:"main",
      doors:{leaves:2,glazed:true,frame:"#eeeeea"},estimated:true,evidence:{tier:"T4",refs:[`Legacy simulation hint projected to ${pick.w.id}; not surveyed`]}};
    records.push(record);
  }
  const resolved=resolveAnchor(record,footprints);
  const position=tmToSimulation(...resolved.origin);
  entry.position=[position.x,entry.position[1],position.z];
  entry.anchor_record_id=record.id;
  entry.estimated=true;
  building.source="derived from buildings/entrances.json wall anchor (estimated)";
}
validateEntrances(records,footprints);
writeFileSync(new URL("../data/buildings/entrances.json",import.meta.url),`${JSON.stringify({frameVersion:2,records},null,2)}\n`);
writeFileSync(new URL("../../../../backend/simulation/data/building_entrances.json",import.meta.url),`${JSON.stringify(simulation,null,2)}\n`);
console.log(`ENTRANCES records=${records.length} canopies=${records.filter(r=>r.canopy).length}; all estimated`);
