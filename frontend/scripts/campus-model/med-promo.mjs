// The 의대 유치 promo layer in campus-v2's frame (public/campus-med-promo.glb, shown by src/render/MedPromo.jsx):
// poster faces over both sides of the nine campus banner boards, an LED screen on two columns above the A19 gate
// letter sign, and three marchers walking a loop on the gate plaza, each waving a "의대 유치 성공!" picket.
// Placement comes from medPromo/layout.mjs on the furniture survey; the posters and the screen carry UVs and named
// materials (MP_Poster_<design>, MP_Screen) that the web layer paints with promoArt.mjs. Sizes and the route are
// estimates (추정). Run: bun scripts/campus-model/med-promo.mjs [output.glb]
import { readFileSync, writeFileSync } from "node:fs";
import { Euler, Quaternion } from "three";
import { PICKET_LINES, POSTER_DESIGNS } from "../../src/render/medPromo/promoArt.mjs";
import { parseHeightfield, sampleHeight } from "../../src/terrain/heightfield.mjs";
import { GlbBuilder } from "./lib/glb.mjs";
import { metres } from "./lib/frame.mjs";
import { signLetters } from "./lib/signLetters.mjs";
import { Kit, frame, local, rgb } from "./lib/solids.mjs";
import { ball, limb, part, soft } from "./lib/toyParts.mjs";
import { GATE_SIGN_ID, bannerPlacements, gateScreenPlacement, marcherRoute, marcherTracks } from "./medPromo/layout.mjs";
import { loadFurniture } from "./stages/furniture.mjs";

const M = metres;
const publicFile = (name) => new URL(`../../public/${name}`, import.meta.url);
const field = parseHeightfield(JSON.parse(readFileSync(publicFile("campus-v2-height.json"))), readFileSync(publicFile("campus-v2-height.bin")));
const ground = (x, z) => sampleHeight(field, x, z);
const output = process.argv[2] ?? publicFile("campus-med-promo.glb");
const { objects } = loadFurniture();
const glb = new GlbBuilder();
const painted = glb.addMaterial({ name: "MedPromo_Painted", pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.78 } });
const posterMaterials = POSTER_DESIGNS.map((d, i) => glb.addMaterial({
  name: `MP_Poster_${i}`, extras: { design: d.id }, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.62 },
}));
const screenMaterial = glb.addMaterial({ name: "MP_Screen", emissiveFactor: [0.2, 0.3, 0.6], pbrMetallicRoughness: { baseColorFactor: [0.02, 0.02, 0.03, 1], metallicFactor: 0, roughnessFactor: 0.35 } });
const rotation = (x, y, z) => new Quaternion().setFromEuler(new Euler(x, y, z));
const C = {
  frame: "#1c2330", steel: "#7d8894", navy: "#0f2a5c", gold: "#ffd34d", red: "#e2382f", white: "#f4f3ee",
  peach: "#f2c3a0", hair: "#2b211d", trousers: "#2f3a4f", shoe: "#2a2a2e", stick: "#c99a5b", board: "#ffffff", ink: "#0f2a5c",
};

// Textured quads: each face is two triangles with its own corners, normal and UVs (u along the reading direction as
// seen from the side the face points to, v up), so a canvas texture reads correctly on both sides of a board.
class Panels {
  constructor() {
    Object.assign(this, { positions: [], normals: [], uvs: [], indices: [] });
  }
  // (s, h) metres rectangle of frame f at offset t, facing +v (side 1) or -v (side -1).
  quad(f, [s0, s1], [h0, h1], t, side) {
    const base = this.positions.length / 3;
    const n = [f.v[0] * side, 0, f.v[1] * side];
    for (const [s, h, u, v] of [[s0, h0, 0, 0], [s1, h0, 1, 0], [s1, h1, 1, 1], [s0, h1, 0, 1]]) {
      this.positions.push(...local(f, s, t, h));
      this.normals.push(...n);
      this.uvs.push(side > 0 ? u : 1 - u, v);
    }
    // counter-clockwise seen from the face's side
    this.indices.push(...(side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]).map((i) => base + i));
  }
  primitive(material) {
    return { positions: Float32Array.from(this.positions), normals: Float32Array.from(this.normals), uvs: Float32Array.from(this.uvs), indices: this.indices, material };
  }
}
const meshNode = (name, primitives, props = {}) => glb.addNode({ name, mesh: glb.addMesh(name, primitives), ...props });

// ------------------------------------------------------------------------------------------------ banner posters
// The board panel of B.signboard spans t in [-0.03, 0.03]; each poster sits 4 mm proud of it, 2 cm inside its edges.
const bannerNodes = bannerPlacements(objects).map((b) => {
  const f = frame([b.centre[0], ground(...b.centre), b.centre[1]], b.u);
  const panels = new Panels();
  const s = [-b.widthM / 2 + 0.02, b.widthM / 2 - 0.02];
  const h = [b.clearanceM + 0.02, b.clearanceM + b.panelM - 0.02];
  panels.quad(f, s, h, 0.034, 1);
  panels.quad(f, s, h, -0.034, -1);
  return meshNode(`MP_Banner_${b.id}`, [panels.primitive(posterMaterials[b.design])], { extras: { board: b.id, design: POSTER_DESIGNS[b.design].id, widthM: b.widthM, panelM: b.panelM } });
});

// ------------------------------------------------------------------------------------------------ gate LED screen
const gate = objects.find((o) => o.id === GATE_SIGN_ID);
const screen = gateScreenPlacement(gate);
const gf = frame([screen.frame.o[0], ground(screen.frame.o[0], screen.frame.o[2]), screen.frame.o[2]], screen.frame.u);
const cabinet = new Kit();
const half = screen.widthM / 2;
const [b0, b1] = [screen.bottomM - screen.bezelM, screen.bottomM + screen.heightM + screen.bezelM];
const d = screen.depthM / 2;
cabinet.box(gf, [-half - screen.bezelM, half + screen.bezelM], [-d, d], [b0, b1], rgb(C.frame));
cabinet.box(gf, [-half - screen.bezelM - 0.02, half + screen.bezelM + 0.02], [-d - 0.03, d + 0.03], [b1, b1 + 0.22], rgb(C.navy));
cabinet.box(gf, [-half - screen.bezelM - 0.02, half + screen.bezelM + 0.02], [-d - 0.03, d + 0.03], [b0 - 0.1, b0], rgb(C.gold));
const back = -screen.front * screen.backM;
for (const s of [-half + 0.7, half - 0.7]) {
  const [cx, , cz] = local(gf, s, back, 0);
  const foot = ground(cx, cz) - gf.o[1];
  cabinet.box(gf, [s - screen.columnM / 2, s + screen.columnM / 2], [back - screen.columnM / 2, back + screen.columnM / 2], [foot / M(1) - 0.1, b1], rgb(C.steel));
  for (const hh of [b0 + 0.4, b1 - 0.4]) {
    cabinet.box(gf, [s - 0.08, s + 0.08], back < 0 ? [back, -d] : [d, back], [hh - 0.08, hh + 0.08], rgb(C.steel));
  }
}
const face = new Panels();
for (const side of [1, -1]) face.quad(gf, [-half, half], [screen.bottomM, screen.bottomM + screen.heightM], side * (d + 0.006), side * screen.front);
const screenNode = glb.addNode({
  name: "MP_GateScreen",
  extras: { sign: GATE_SIGN_ID, size: `${screen.widthM} x ${screen.heightM} m LED face, bottom ${screen.bottomM} m above the plaza (estimated)` },
  children: [meshNode("MP_GateScreen_Cabinet", [cabinet.toPrimitive(painted)]), meshNode("MP_GateScreen_Face", [face.primitive(screenMaterial)])],
});

// ------------------------------------------------------------------------------------------------ picket marchers
// A 1.7 m toy figure in metres, feet at y = 0 and facing +z, under a node scaled to scene units: red rally headband,
// legs on hip pivots and a right arm on a shoulder pivot raising the picket; its letters face both ways.
const SHIRTS = ["#1d4e9e", "#e2382f", "#14a39a"];
const SHOULDER = [0.27, 1.42, 0.02];
const HIP = 0.9;
const BOARD = { widthM: 0.9, heightM: 0.62, centre: [0.05, 1.12, 0.06] };

function picketLetters() {
  const kit = new Kit();
  const [w, h] = [BOARD.widthM - 0.12, (BOARD.heightM - 0.16) / 2];
  for (const [u, sideT] of [[[1, 0], 1], [[-1, 0], 1]]) {
    const f = frame([0, 0, 0], u);
    PICKET_LINES.lines.forEach((text, row) => {
      const h0 = BOARD.heightM / 2 - 0.06 - (row + 1) * h - row * 0.04;
      for (const letter of signLetters(text, { lengthM: w, heightM: h })) {
        for (const { outer, holes } of letter.shapes) {
          const place = ([s, hh]) => [s - w / 2, h0 + hh];
          kit.extrusion(f, outer.map(place), holes.map((ring) => ring.map(place)), [0.018 * sideT, 0.03 * sideT], rgb(row === 1 ? C.red : C.ink));
        }
      }
    });
  }
  return kit;
}

function marcher(index) {
  const body = new Kit();
  const shirt = SHIRTS[index];
  part(body, ball, [0, 1.2, 0], [0.24, 0.3, 0.16], shirt);
  part(body, soft, [0, 0.95, 0], [0.4, 0.16, 0.26], C.trousers);
  part(body, ball, [0, 1.6, 0.01], [0.135, 0.15, 0.135], C.peach);
  part(body, ball, [0, 1.65, -0.02], [0.14, 0.12, 0.13], C.hair);
  part(body, ball, [0, 1.655, 0.005], [0.142, 0.028, 0.142], C.red);
  part(body, soft, [0.1, 1.68, -0.13], [0.06, 0.05, 0.08], C.red);
  for (const x of [-0.05, 0.05]) part(body, ball, [x, 1.61, 0.128], [0.016, 0.022, 0.01], C.hair);
  limb(body, [-SHOULDER[0], SHOULDER[1], 0], [-0.32, 1.0, 0.06], 0.055, shirt);
  part(body, ball, [-0.32, 0.97, 0.06], [0.05, 0.055, 0.05], C.peach);
  const legs = [-0.1, 0.1].map((x, k) => {
    const leg = new Kit();
    limb(leg, [0, 0, 0], [0, -HIP + 0.12, 0], 0.075, C.trousers);
    part(leg, soft, [0, -HIP + 0.05, 0.04], [0.13, 0.1, 0.26], C.shoe);
    return meshNode(`MP_Marcher_${index + 1}_Leg${k ? "R" : "L"}`, [leg.toPrimitive(painted)], { translation: [x, HIP, 0] });
  });
  const arm = new Kit();
  limb(arm, [0, 0, 0], [0.05, 0.4, 0.05], 0.055, shirt);
  part(arm, ball, [0.05, 0.43, 0.05], [0.05, 0.055, 0.05], C.peach);
  limb(arm, [0.05, 0.3, 0.06], [0.05, BOARD.centre[1] + BOARD.heightM / 2 - 0.02, 0.06], 0.016, C.stick);
  part(arm, soft, BOARD.centre, [BOARD.widthM, BOARD.heightM, 0.03], C.board);
  part(arm, soft, [BOARD.centre[0], BOARD.centre[1] + BOARD.heightM / 2 + 0.02, BOARD.centre[2]], [BOARD.widthM + 0.02, 0.05, 0.035], C.red);
  const letters = glb.addNode({
    name: `MP_Marcher_${index + 1}_PicketText`, mesh: glb.addMesh(`MP_Marcher_${index + 1}_PicketText`, [picketLetters().toPrimitive(painted)]),
    translation: BOARD.centre, scale: [1 / M(1), 1 / M(1), 1 / M(1)],
  });
  const armNode = meshNode(`MP_Marcher_${index + 1}_Arm`, [arm.toPrimitive(painted)], { translation: SHOULDER, children: [letters] });
  const figure = meshNode(`MP_Marcher_${index + 1}_Body`, [body.toPrimitive(painted)], { scale: [M(1), M(1), M(1)], children: [...legs, armNode] });
  const root = glb.addNode({ name: `MP_Marcher_${index + 1}`, children: [figure] });
  return { root, legs, arm: armNode };
}

const STRIDE_S = 1.0;
const WAVE_S = 0.8;
const tracks = marcherTracks(marcherRoute(screen), { count: 3, speedMps: 1.1, stepS: 0.1 });
const duration = tracks[0].times.at(-1);
const cycles = (period) => Math.max(1, Math.round(duration / period));
const marchers = tracks.map((track, m) => {
  const nodes = marcher(m);
  const stride = (2 * Math.PI * cycles(STRIDE_S)) / duration;
  const wave = (2 * Math.PI * cycles(WAVE_S)) / duration;
  const phase = (m * 2 * Math.PI) / 3;
  const times = Float32Array.from(track.times);
  const input = glb.addAccessor(times, "SCALAR", { target: null, minMax: true });
  const vec = (fn, type) => glb.addAccessor(Float32Array.from(track.times.flatMap(fn)), type, { target: null });
  const translation = vec((t, i) => {
    const [x, z] = track.points[i];
    return [x, ground(x, z) + M(0.035 * Math.abs(Math.sin(stride * t + phase))), z];
  }, "VEC3");
  const yaw = vec((t, i) => rotation(0, track.yaws[i], 0).toArray(), "VEC4");
  const legL = vec((t) => rotation(0.42 * Math.sin(stride * t + phase), 0, 0).toArray(), "VEC4");
  const legR = vec((t) => rotation(-0.42 * Math.sin(stride * t + phase), 0, 0).toArray(), "VEC4");
  const armWave = vec((t) => rotation(0.12 * Math.sin(wave * t * 2 + phase), 0, -0.38 * Math.sin(wave * t + phase)).toArray(), "VEC4");
  const samplers = [translation, yaw, legL, legR, armWave].map((output) => ({ input, output, interpolation: "LINEAR" }));
  (glb.json.animations ??= []).push({
    name: `MP_March_${m + 1}`,
    samplers,
    channels: [
      { sampler: 0, target: { node: nodes.root, path: "translation" } },
      { sampler: 1, target: { node: nodes.root, path: "rotation" } },
      { sampler: 2, target: { node: nodes.legs[0], path: "rotation" } },
      { sampler: 3, target: { node: nodes.legs[1], path: "rotation" } },
      { sampler: 4, target: { node: nodes.arm, path: "rotation" } },
    ],
  });
  return nodes.root;
});

glb.addNode({
  name: "MedPromo",
  extras: {
    topic: "국립순천대 의과대학 유치 홍보물(2026-11-04 신설 확정)",
    sources: "copy and sources: src/render/medPromo/promoArt.mjs (PROMO_SOURCES)",
    placementSource: "banner boards and the A19 gate sign of stages/furniture.mjs (data/photo/site-detail.geojson, rest-spaces.geojson); screen size, marchers and route are illustrative (estimated)",
  },
  children: [
    glb.addNode({ name: "MP_Banners", children: bannerNodes }),
    screenNode,
    glb.addNode({ name: "MP_Marchers", children: marchers }),
  ],
}, { root: true });
writeFileSync(output, glb.toBuffer());
console.log(`med-promo: ${bannerNodes.length} banners, screen over ${GATE_SIGN_ID}, ${marchers.length} marchers (${duration.toFixed(1)} s loop) -> ${output}`);
