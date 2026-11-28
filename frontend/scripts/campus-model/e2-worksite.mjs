// An editable, temporary site layer in campus-v2's coordinate frame. The building
// remains selectable and keeps its surveyed geometry during the renovation.
import { readFileSync, writeFileSync } from "node:fs";
import { Euler, Quaternion } from "three";
import { GlbBuilder } from "./lib/glb.mjs";
import { Kit, rgb } from "./lib/solids.mjs";
import { ball, box, limb, part, soft } from "./lib/toyParts.mjs";
import { signLetters } from "./lib/signLetters.mjs";
import { metres } from "./lib/frame.mjs";
import { parseHeightfield, sampleHeight } from "../../src/terrain/heightfield.mjs";

const publicFile = name => new URL(`../../public/${name}`, import.meta.url);
const field = parseHeightfield(JSON.parse(readFileSync(publicFile("campus-v2-height.json"))), readFileSync(publicFile("campus-v2-height.bin")));
const ground = (x, z) => sampleHeight(field, x, z);
const glb = new GlbBuilder();
// With an output argument export the full editable campus instead of the small
// live layer. Existing meshopt streams, KTX2 textures and pick IDs stay intact.
const output = process.argv[2] ?? publicFile("campus-e2-worksite.glb");
if (process.argv[2]) {
  const bytes = readFileSync(publicFile("campus-v2.glb"));
  const jsonEnd = 20 + bytes.readUInt32LE(12);
  glb.json = JSON.parse(bytes.subarray(20, jsonEnd));
  const binary = bytes.subarray(jsonEnd + 8);
  glb.chunks = [binary];
  glb.byteLength = binary.byteLength;
}
const material = glb.addMaterial({ name: "Worksite_Painted", pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.82 } });
const C = {
  ink: "#233a42", petrol: "#167475", sea: "#43aaa3", orange: "#e36429", lemon: "#ffcc48",
  cream: "#fff2d3", peach: "#f4b18c", blush: "#e99576", hair: "#51372e", sole: "#403731",
  boot: "#ad6940", wood: "#bf8552", endgrain: "#e7bc83", steel: "#81969b", iron: "#415863",
};
const rotation = (x, y, z) => new Quaternion().setFromEuler(new Euler(x, y, z));
function node(name, kit, props = {}) {
  return glb.addNode({ name, mesh: glb.addMesh(name, [kit.toPrimitive(material)]), ...props });
}

// Toy proportions: broad brim, squat work boots, bib pocket and a pencil behind
// the left ear. +Z faces the saw horse. Dimensions are local, before mascot scale.
const body = new Kit();
for (const x of [-.22, .22]) {
  part(body, soft, [x,.125,.083], [.36,.15,.52], C.sole);
  part(body, soft, [x,.23,.08], [.35,.25,.50], C.boot);
  part(body, soft, [x,.42,0], [.31,.38,.33], C.petrol);
}
part(body, ball, [0,.73,0], [.405,.44,.31], C.orange);
part(body, ball, [0,.62,.07], [.394,.32,.286], C.petrol);
part(body, soft, [0,.79,.276], [.46,.38,.09], C.sea);
part(body, soft, [0,.755,.331], [.245,.135,.025], C.petrol);
for (const x of [-.20,.20]) {
  limb(body,[x,.89,.29],[x,.99,.09],.048,C.sea);
  part(body,ball,[x,.90,.312],[.033,.033,.017],C.lemon);
}
part(body, ball, [0,1.35,.028], [.475,.431,.394], C.peach);
part(body, ball, [0,1.37,-.122], [.468,.40,.29], C.hair);
for (const x of [-.452,.452]) part(body,ball,[x,1.34,0],[.094,.124,.09],C.peach);
for (const x of [-.168,.168]) {
  part(body,ball,[x,1.38,.397],[.042,.064,.023],C.ink);
  part(body,ball,[x-.009,1.403,.416],[.013,.014,.008],C.cream);
  part(body,ball,[x*1.53,1.278,.342],[.055,.026,.015],C.blush);
}
part(body,ball,[0,1.298,.421],[.075,.058,.064],C.peach);
for(const side of [-1,1]) limb(body,[0,1.20,.396],[side*.067,1.218,.396],.015,C.hair);
part(body,ball,[0,1.635,.03],[.502,.32,.436],C.lemon);
part(body,ball,[0,1.615,.075],[.555,.065,.526],C.lemon);
part(body,soft,[0,1.858,.043],[.13,.17,.39],C.lemon);
part(body,soft,[0,1.718,.425],[.154,.118,.04],C.petrol);
part(body,soft,[0,1.719,.448],[.079,.033,.012],C.cream);
limb(body,[-.481,1.35,-.025],[-.472,1.54,-.13],.023,C.lemon);
limb(body,[-.34,.94,0],[-.48,.74,.10],.142,C.orange);
part(body,ball,[-.48,.675,.16],[.116,.137,.11],C.cream);

// The moving mesh has its origin at the shoulder. At zero rotation the
// striking face is exactly on the stock: .96 + .045 - .18 / 2 = .915.
const arm = new Kit();
limb(arm,[0,0,0],[.07,-.12,.24],.126,C.orange);
limb(arm,[.07,-.12,.24],[.045,-.077,.405],.097,C.cream);
part(arm,soft,[.046,-.044,.53],[.082,.082,.63],C.boot,rotation(-.30,0,0));
part(arm,soft,[.046,.045,.812],[.20,.18,.29],C.iron);
part(arm,box,[.046,-.038,.813],[.204,.018,.292],C.steel);
const shoulder = node("E2_HammerArm",arm,{ translation:[.34,.96,.03] });
const mascot = node("E2_Builder",body,{children:[shoulder]});
const bench = new Kit();
for (const x of [-.21,.84]) for (const z of [.69,1.00]) {
  limb(bench,[x,.07,z+(z<.8?-.11:.11)],[x,.72,z],.057,C.wood);
}
part(bench,soft,[.31,.75,.846],[1.45,.12,.50],C.iron);
part(bench,soft,[.31,.858,.846],[1.56,.114,.39],C.endgrain);
for (const x of [-.28,-.09,.71,.98]) part(bench,box,[x,.916,.89],[.08,.002,.009],C.wood);
const anchor = [209,ground(209,-117.8),-117.8];
const scale = 1.25;
const station = glb.addNode({ name:"E2_Workbench", translation:anchor, rotation:rotation(0,.46,0).toArray(), scale:[scale,scale,scale], children:[mascot,node("E2_Sawhorse",bench)] });

// Construction boundary, fitted to the E2 wings in GIS record 85392. Long
// bays follow the terrain independently. Keep the south work bay inside the
// paved apron; no props are placed on the adjoining through road.
const fence = new Kit();
const corners = [[174.5,-116],[178.4,-128.4],[189.8,-125.6],[213.3,-139.4],[215.7,-151.1],
  [231.0,-147.3],[227.6,-130.1],[224.3,-124.5],[221.7,-127.6],[212.4,-123.05],[210.25,-121.8],
  [209.45,-121.1],[211.65,-117.2],[209.4,-115.6],[207.3,-117.95],[206.6,-118.12],[202.15,-115.5],
  [200.7,-114.85],[200.75,-112.9],[198.5,-111.7],[195.3,-113.1],[191.7,-111.4],[174.5,-116]];
for(let i=0;i<corners.length-1;i++){
  const [x,z]=corners[i], [nx,nz]=corners[i+1], dx=nx-x,dz=nz-z;
  const length=Math.hypot(dx,dz), n=Math.ceil(length/2.75), u=[dx/length,dz/length];
  const yaw=rotation(0,Math.atan2(-u[1],u[0]),0);
  for(let j=0;j<n;j++){
    const t=j/n, x0=x+dx*t,z0=z+dz*t, y=ground(x0,z0);
    part(fence,box,[x0,y+.07,z0],[.32,.16,.42],C.ink,yaw);
    part(fence,box,[x0,y+.54,z0],[.10,1.05,.10],C.orange,yaw);
    const t1=(j+1)/n,x1=x+dx*t1,z1=z+dz*t1,y1=ground(x1,z1);
    for(const [h,depth,col] of [[.88,.29,C.cream],[.43,.13,C.orange]]){
      fence.beam([x0,y+h,z0],[x1,y1+h,z1],.19,depth/metres(1),rgb(col));
    }
    // Diagonal bands are solid prisms that wrap both sides of the rail.
    for(const along of [.24,.56,.86]){
      const p=[x0+(x1-x0)*along,y+(y1-y)*along+.88,z0+(z1-z0)*along];
      part(fence,box,p,[.32,.25,.13],C.orange,yaw.clone().multiply(rotation(0,0,-.36)));
    }
  }
}
const sign = new Kit();
part(sign,soft,[0,1.18,0],[2.65,1.02,.12],C.ink);
for(const x of [-.96,.96]) part(sign,box,[x,.52,0],[.09,1.04,.09],C.iron);
part(sign,soft,[-1.05,1.18,.08],[.26,.76,.035],C.lemon);
const signFrame={o:[-.80,1.00,.071],u:[1,0],v:[0,1]};
for(const glyph of signLetters("공사 중",{lengthM:2.93,heightM:.69})){
  for(const {outer,holes} of glyph.shapes) sign.extrusion(signFrame,outer,holes,[0,.02],rgb(C.cream));
}
const signNode=node("E2_ConstructionSign", sign,{translation:[206.9,ground(206.9,-119.35),-119.35],rotation:rotation(0,.55,0).toArray()});
glb.addNode({name:"E2_Construction",extras:{ building:"BLD_SCNU_E2", status:"공사 중", source:"SCNU SUB, 2026-04-30, notice 281309304: basic education hall renovation and extension; target December 2027.", placementSource:"E2 GIS footprint record 85392 and campus-v2 heightfield; barrier footprint, sign and mascot are illustrative (estimated)" },children:[node("E2_Barriers",fence),signNode,station]}, {root:true});
const beats=[[0,-.34],[.23,-.56],[.41,-.64],[.52,0],[.56,0],[.67,-.44],[.76,-.54],[.85,0],[.90,0],[1.09,-.29],[1.42,-.34]];
(glb.json.animations ??= []).push({name:"E2_HammerDoubleTap",samplers:[{
  input:glb.addAccessor(Float32Array.from(beats,([t])=>t),"SCALAR",{target:null,minMax:true}),
  output:glb.addAccessor(Float32Array.from(beats.flatMap(([,angle])=>rotation(angle,0,0).toArray())),"VEC4",{target:null}),interpolation:"LINEAR"
}],channels:[{sampler:0,target:{node:shoulder,path:"rotation"}}]});
writeFileSync(output,glb.toBuffer());
