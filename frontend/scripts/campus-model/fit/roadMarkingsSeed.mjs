// Evidence fits -> canonical road cross-sections and junction controls.
// No emitted polygon, arbitrary region, or generic detail is a build input.
import { sceneToTm, tmToScene } from "../../../src/geo/epsg5186.mjs";
import { EXTENT, SCENE_UNITS_PER_METRE as U } from "../lib/frame.mjs";
import { add, dot, norm, offsetPath, polylineLength, projectArc, scale, slicePath, sub, unit } from "../lib/markingFit.mjs";
import { frameAt } from "../stages/roadMarkings.mjs";
import { createHash } from "node:crypto";
import { topParcelAt } from "../lib/parcels.mjs";
import { applyRoadCuration, applyRoadReferenceReviews } from "./roadCuration.mjs";

const tm = p => sceneToTm(...p);
const K = norm(sub(tm([U,0]),tm([0,0])));
const left = p => [-p[1],p[0]];
const proof = (refs,tier="T1") => ({ evidence:{tier,refs},estimated:true,
  reason:"Evidence-fit seed; inferred road centreline and association require todo 24 curation." });

export function seedRoadMarkings(model, humpRecords, context) {
  const sections={}, junctions={};
  const identities=new Map();
  const nearest = point => {
    let best=null;
    for(const segment of context.segments) for(const [pathIndex,path] of segment.paths.entries()) {
      const atM=Math.min(projectArc(path.line,point),path.lengthM);
      const f=frameAt(path.line,atM,segment.id),distance=norm(sub(point,f.centre));
      if(!best || distance<best.distance) best={segment,pathIndex,distance};
    }
    if(!best) throw new Error("road seed: no reference roads");
    return best;
  };
  const section = (line,widthM,refs,owner=null,role="road") => {
    const middle=frameAt(line,polylineLength(line)/2,"seed").centre;
    const n=owner??nearest(middle),road=n.segment;
    const sourceKey=JSON.stringify([role,[...refs].sort()]);
    const component=identities.get(sourceKey)??0;
    identities.set(sourceKey,component+1);
    const suffix=createHash("sha256").update(sourceKey+":"+component).digest("hex").slice(0,16);
    const alignment="RA_"+suffix,id="RS_"+suffix;
    sections[road.id]??={alignments:{},sections:[]};
    sections[road.id].alignments[alignment]={line,...proof(refs),
      role:"inferred-road-centreline",seedIdentity:{role,refs,component},association:{verified:false,distanceM:n.distance}};
    const s={id,alignment,pathIndex:n.pathIndex,fromM:0,toM:polylineLength(line),
      lanes:[{dir:"fwd",widthM}],centre:{type:"none",widthM:0.15},
      edges:{left:"none",right:"none"},lateralOffsetM:0,
      kerbOffsetsM:{left:widthM/2,right:widthM/2},kerbNoParking:{left:false,right:false},humps:[],...proof(refs)};
    sections[road.id].sections.push(s);
    return {segment:road.id,s,line};
  };
  const stationSection = (centreScene,forwardScene,widthM,refs,role) => {
    const p=tm(centreScene),f=unit(sub(tm(add(centreScene,scale(forwardScene,U))),p));
    const line=[add(p,scale(f,-15*K)),add(p,scale(f,15*K))];
    return {...section(line,widthM,refs,null,role),atM:15*K};
  };
  const approach = r => {
    const p=frameAt(r.line,r.atM??polylineLength(r.line)/2,r.s.id).centre;
    const node=[...context.junctionPoints].sort((a,b)=>norm(sub(a.point,p))-norm(sub(b.point,p)))[0];
    if(!node) throw new Error(r.s.id+": no junction node");
    const a={id:"JA_"+r.s.id.slice(3),segment:r.segment,section:r.s.id,alignment:r.s.alignment,pathIndex:r.s.pathIndex,end:"to",
      stopLineSetbackM:null,crossing:null,arrows:[],text:[],humps:[],signalArms:[],yieldTriangles:[],guideLines:[],symbols:[],areas:[],...proof(r.s.evidence.refs)};
    junctions[node.id]??={approaches:[]}; junctions[node.id].approaches.push(a);
    return a;
  };
  // paint only where the ground allows it (design 10.3: the build refuses a paint piece whose centre is not on a paint
  // parcel): a photo dash drawn as detected (one run per dash, fit/markingEvidenceFit.mjs detectedDashLine) whose centre
  // lies inside EXTENT off every paint parcel (a road the parcel map does not cover yet) is left out until its ground
  // parcel exists; paint beyond EXTENT lies on the context ground and is not checked here
  const paintGround=context.parcels?topParcelAt(context.parcels):null;
  const offGround=part=>{
    if(!paintGround) return false;
    // its two ends count as well: a run that overhangs the parcel edge still paints unassigned ground (design 10.3)
    return [part[0],frameAt(part,polylineLength(part)/2,"run").centre,part.at(-1)].some(p=>{
      const [x,z]=tmToScene(...p);
      return x>=EXTENT.minX&&x<=EXTENT.maxX&&z>=EXTENT.minZ&&z<=EXTENT.maxZ&&!paintGround(p)?.paintAllowed;
    });
  };
  for(const l of model.lines) {
    const painted=l.path.map(tm),owner=nearest(painted[Math.floor(painted.length/2)]);
    const width=owner.segment.widthM||6.5;
    const spans=l.runs??[[0,polylineLength(l.path)/U]];
    for(const [start,end] of spans) {
      const from=Math.max(start,l.paintRange?.[0]??start),to=Math.min(end,l.paintRange?.[1]??end);
      if(to<=from) continue;
      const part=slicePath(painted,from*K,Math.min(to*K,polylineLength(painted)));
      if(part.length<2 || polylineLength(part)<0.05) continue;
      if(l.dashRuns&&offGround(part)) { context.log?.(`road seed: ${l.kind} ${l.refs.join(",")} run ${from.toFixed(2)}-${to.toFixed(2)} m left out (no paint parcel under it)`); continue; }
      const edge=l.kind==="kerb_no_parking"||l.kind==="edge_line";
      let axis=part,side="left";
      if(edge) {
        const choices=[1,-1].map(sign=>{
          const line=offsetPath(part,-sign*width/2),back=offsetPath(line,sign*width/2);
          return {line,sign,error:Math.max(...back.map((p,i)=>norm(sub(p,part[i]))))};
        }).sort((a,b)=>a.error-b.error);
        axis=choices[0].line;side=choices[0].sign===1?"left":"right";
      }
      const r=section(axis,width,l.refs,owner,"line:"+l.kind),s=r.s;
      if(l.legacyId) s.legacyId=l.legacyId;
      s.dashPhaseM=l.pattern?((l.phaseM??0)+from)%(l.pattern[0]+l.pattern[1])*K:0;
      if(l.pattern) s.dashPattern={dashM:l.pattern[0]*K,gapM:l.pattern[1]*K};
      const lineWidth=(l.widthM??0.15)*K;
      switch(l.kind) {
        case "centre_line_yellow":
          s.lanes=[{dir:"fwd",widthM:width/2},{dir:"bwd",widthM:width/2}];
          s.centre={type:l.double?"yellow_double":l.dashed?"yellow_dashed":"yellow_solid",widthM:lineWidth};break;
        case "kerb_no_parking": s.kerbNoParking[side]=true;s.kerbWidthM=lineWidth;break;
        case "edge_line": s.edges[side]=(l.colour==="yellow"?"yellow":"white")+(l.dashed?"_dashed":"_solid");s.edgeWidthsM={[side]:lineWidth};break;
        case "lane_line_solid": case "lane_line_dashed":
          s.lanes=[{dir:"fwd",widthM:width/2,line:l.dashed?"white_dashed":"white_solid",lineWidthM:lineWidth},{dir:"fwd",widthM:width/2}];break;
        case "give_way_line": {
          const a=approach(r);a.guideLines.push({points:part,widthM:lineWidth,colour:l.colour,
            ...(s.dashPattern?{dashPattern:s.dashPattern,dashPhaseM:s.dashPhaseM}:{})});break;
        }
        default: throw new Error("unsupported longitudinal kind "+l.kind);
      }
    }
  }
  for(const c of model.crossings) {
    const g=c.shape,walk=[-c.forward[1],c.forward[0]];
    const centre=add(c.centre,scale(walk,(g.count-1)*g.periodM*U/2));
    const owner=nearest(tm(centre));
    let count=g.count;
    // Isolated observed bars do not imply half-metre road lanes. Keep an
    // estimated full carriageway and mark its unobserved slots explicitly.
    if(count<4) { count=Math.max(4,Math.round(((owner.segment.widthM||6.5)/K-g.widthM)/g.periodM)+1); if((count-g.count)%2) count++; }
    const padding=(count-g.count)/2,kept=new Set(g.slots.map(k=>padding+g.count-1-k));
    const width=((count-1)*g.periodM+g.widthM)*K;
    const r=stationSection(centre,c.forward,width,c.refs,"crossing"),a=approach(r);
    r.s.lanes=[{dir:"fwd",widthM:width/2},{dir:"bwd",widthM:width/2}];
    a.crossing={offsetM:polylineLength(r.line)-r.atM,widthM:g.lengthM*K,barWidthM:g.widthM*K,zebraPeriodM:g.periodM*K,
      omittedBars:Array.from({length:count},(_,k)=>k).filter(k=>!kept.has(k))};
    if(g.count<4) a.reason+=" Partial observed crossing; omitted slots are unobserved, not proved absent.";
  }
  for(const p of model.stops) {
    const r=stationSection(p.centre,p.forward,p.lengthM*K,p.refs,"stop"),a=approach(r);
    a.stopLineSetbackM=polylineLength(r.line)-r.atM;a.stopLineWidthM=p.widthM*K;
    if(p.legacyId) a.legacyId=p.legacyId;
  }
  for(const p of model.symbols) {
    const shape=p.shape,args=shape.args;
    const forward=shape.template==="chevron"&&args[0]<0?scale(p.forward,-1):p.forward;
    const r=stationSection(p.centre,forward,Math.max(3.25,shape.template==="text"?args[1]*K:3.25),p.refs,"symbol:"+shape.template),a=approach(r);
    const atM=polylineLength(r.line)-r.atM,common={atM,lane:0,colour:p.colour,centered:shape.centered};
    switch(shape.template) {
      case "arrow": a.arrows.push({...common,type:args[0].replace(/^arrow_/,""),lengthM:args[1]*K,widthM:args[2]*K});break;
      case "text": a.text.push({...common,text:args[0].join("\n"),widthM:args[1]*K,lengthM:args[2]*K,
        ...(args[3]?.charHeight?{charHeightM:args[3].charHeight*K}:{})});break;
      case "bus_stop_box": case "hatched_median":
        a.areas.push({...common,style:shape.template,lengthM:args[0]*K,widthM:args[1]*K,...(args[2]?{pattern:args[2]}:{})});break;
      case "diamond": case "triangle": case "chevron": case "bicycle":
        a.symbols.push({...common,type:shape.template,lengthM:Math.abs(args[0])*K,widthM:Math.abs(args[1])*K,lineWidthM:(args[2]??0.15)*K});break;
      default: throw new Error("unsupported symbol "+shape.template);
    }
  }
  for(const p of model.areas) {
    const r=stationSection(p.centre,p.forward,Math.max(3.25,p.widthM*K),p.refs,"area:"+p.style),a=approach(r);
    a.areas.push({atM:polylineLength(r.line)-r.atM,lane:0,style:p.style==="chevron"?"stripe":p.style,
      lengthM:p.lengthM*K,widthM:p.widthM*K,colour:p.colour});
  }
  for(const [i,h] of humpRecords.entries()) {
    const r=stationSection(h.centre,h.u,h.widthM*K,["photo/evidence/markings-extra.geojson "+h.id],"hump");
    // a striped hump keeps the painted length its bands measure (fit/humpEvidence.mjs); an outline the statute 3.6 m
    const bodyWidth=h.widthM*K,lengthM=(h.lengthM??3.6)*K;
    if(h.bands && context.parcels) {
      const {centre,forward}=frameAt(r.line,r.atM,r.s.id),side=left(forward);
      const radius=bodyWidth/2+lengthM/2;
      const nearby=context.parcels.filter(p=>{
        const xs=p.ring.map(q=>q[0]),ys=p.ring.map(q=>q[1]);
        return Math.max(...xs)>=centre[0]-radius&&Math.min(...xs)<=centre[0]+radius
          &&Math.max(...ys)>=centre[1]-radius&&Math.min(...ys)<=centre[1]+radius;
      });
      const at=topParcelAt(nearby);
      const allowed=t=>Array.from({length:9},(_,k)=>k).every(k=>
        at(add(centre,add(scale(side,t),scale(forward,(k/8-0.5)*lengthM))))?.paintAllowed);
      const steps=Math.ceil(bodyWidth/0.05),step=bodyWidth/steps;
      let start=null,best=null;
      for(let k=0;k<=steps+1;k++) {
        const t=-bodyWidth/2+k*step,ok=k<=steps&&allowed(t);
        if(ok&&start===null) start=k;
        if(!ok&&start!==null) {
          if(!best||k-start>best[1]-best[0]) best=[start,k-1];
          start=null;
        }
      }
      if(!best) throw new Error(h.id+": no paintable carriageway across hump");
      let low=-bodyWidth/2+best[0]*step,high=-bodyWidth/2+best[1]*step;
      for(const sign of [-1,1]) {
        let inside=sign<0?low:high,outside=Math.max(-bodyWidth/2,Math.min(bodyWidth/2,inside+sign*step));
        if(allowed(outside)) inside=outside;
        else for(let k=0;k<20;k++){const mid=(inside+outside)/2;if(allowed(mid))inside=mid;else outside=mid;}
        if(sign<0)low=inside;else high=inside;
      }
      r.s.lanes[0].widthM=high-low;
      r.s.lateralOffsetM=(low+high)/2;
      r.s.kerbOffsetsM={left:(high-low)/2,right:(high-low)/2};
    }
    // measured bands lean to the left of travel by the angle their axis makes with the section's forward direction
    let lean=null;
    if(h.bands&&h.stripe) {
      const {forward}=frameAt(r.line,r.atM,r.s.id),p=tm(h.centre),st=unit(sub(tm(add(h.centre,scale(h.stripe,U))),p));
      lean=Math.atan2(forward[0]*st[1]-forward[1]*st[0],dot(forward,st))*180/Math.PI;
    }
    r.s.humps.push({id:h.id,order:i,atM:r.atM,lengthM,heightM:0.1,bands:Boolean(h.bands),
      widthM:bodyWidth,lateralOffsetM:-r.s.lateralOffsetM,
      ...(h.bands?{bandAxis:"travel",bandWidthM:(h.bandWidthM??h.widthM/h.bands)*K,bandStartColour:h.bandStartColour??"yellow",
        ...(lean===null?{}:{bandAngleDeg:lean,bandOffsetM:(h.bandOffsetM??0)*K})}:{})});
  }
  return {sections,junctions};
}

if(import.meta.main) {
  const {readFileSync,writeFileSync}=await import("node:fs");
  const {loadInputs}=await import("../stages/sources.mjs");
  const {buildBuildings}=await import("../stages/buildings.mjs");
  const {loadFurnitureSurvey}=await import("../stages/furniture.mjs");
  const {buildGround}=await import("../stages/ground.mjs");
  const {GlbBuilder}=await import("../lib/glb.mjs");
  const {loadMarkings}=await import("./markingEvidence.mjs");
  const {buildHumps,loadSpeedBumps}=await import("./humpEvidence.mjs");
  const {roadContext}=await import("../lib/roadSections.mjs");
  const {EXTENT}=await import("../lib/frame.mjs");
  const {SURFACE_CLASS}=await import("../lib/surfaceClass.mjs");
  const inputs=await loadInputs(),glb=new GlbBuilder();
  const {selectableBuildings,campusBuildings}=await buildBuildings({glb,inputs,detailedStructures:loadFurnitureSurvey().detailedStructures});
  const evidence=await loadMarkings({inputs,buildings:[...selectableBuildings,...campusBuildings]});
  const {groundInfo,surfaces}=await buildGround({glb,inputs});
  const humps=buildHumps({features:await loadSpeedBumps(),onRoad:([x,z])=>{
    const i=Math.floor((x-EXTENT.minX)*groundInfo.px),j=Math.floor((z-EXTENT.minZ)*groundInfo.px);
    return i>=0&&j>=0&&i<groundInfo.width&&j<groundInfo.height&&[SURFACE_CLASS.ASPHALT,SURFACE_CLASS.LOT].includes(groundInfo.labels[j*groundInfo.width+i]);
  }});
  const context=roadContext();
  const curation=JSON.parse(readFileSync(new URL("../data/ground/road-curation.json",import.meta.url),"utf8"));
  const docs=applyRoadCuration(seedRoadMarkings(evidence.model,humps.humps,{...context,parcels:surfaces.parcels,log:m=>console.log(m)}),curation,context);
  const referencePath=new URL("../data/photo/evidence/road-reference.json",import.meta.url);
  const reference=applyRoadReferenceReviews(JSON.parse(readFileSync(referencePath,"utf8")),curation.referenceReviews??{});
  for(const [name,doc] of [["ground/road-sections",docs.sections],["ground/junctions",docs.junctions],["photo/evidence/road-reference",reference]]) {
    const file=new URL("../data/"+name+".json",import.meta.url),text=JSON.stringify(doc,null,2)+"\n";
    if(process.argv.includes("--check")) {if(readFileSync(file,"utf8")!==text) throw new Error(name+": seed is stale");}
    else if(process.argv.includes("--write")) writeFileSync(file,text);
    else throw new Error("pass --write or --check");
  }
  console.log("CANONICAL_SEED "+JSON.stringify({fits:Object.fromEntries(Object.entries(evidence.model).map(([k,v])=>[k,v.length])),
    sections:Object.values(docs.sections).flatMap(r=>r.sections).length,approaches:Object.values(docs.junctions).flatMap(j=>j.approaches).length,humps:humps.humps.length}));
}
