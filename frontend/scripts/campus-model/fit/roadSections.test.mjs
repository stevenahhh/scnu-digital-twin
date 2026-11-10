import { test } from "node:test";
import assert from "node:assert/strict";
import { proposeRoad } from "./roadSections.mjs";
import { validate } from "../lib/schemas.mjs";

const road = { id: "RD_TEST", line: [[0, 0], [30, 0]], widthM: 7, lanes: 2 };
// Independent raster fixture: 30 m eastbound road, yellow centre 0.4 m to its left.
function photo({ double = false, hidden = false, share = 1, offset = 0.4 } = {}) {
  const w = 640, h = 200, gsdM = 0.05;
  const rgb = new Uint8Array(w * h * 3).fill(70);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const E = -1 + (x + 0.5) * gsdM;
    const N = 5 - (y + 0.5) * gsdM;
    const i = y * w + x;
    if (hidden || (E > 10 && E < 16)) mask[i] = 1;
    const on = double ? Math.abs(N - offset - 0.2) < 0.075 || Math.abs(N - offset + 0.2) < 0.075 : Math.abs(N - offset) < 0.075;
    if (E >= 0 && E < 30 * share && on) rgb.set([240, 210, 30], i * 3);
  }
  return { w, h, gsdM, origin: [-1, 5], rgb, mask };
}

test("two-lane proposal recovers signed centre offset while excluding hidden length", () => {
  const { sections: [section] } = proposeRoad(road, photo());
  assert.equal(section.centre.type, "yellow_solid");
  assert.ok(Math.abs(section.lateralOffsetM - 0.4) <= 0.05);
  assert.deepEqual(section.lanes, [{ dir: "fwd", widthM: 3.5 }, { dir: "bwd", widthM: 3.5 }]);
  assert.equal(section.evidence.photoSupport, 1);
  assert.equal(section.estimated, true); // road width is an input prior, not surveyed
});

test("two separated peaks in the one-metre profile propose a double centre line", () => {
  const { sections: [section] } = proposeRoad(road, photo({ double: true }));
  assert.equal(section.centre.type, "yellow_double");
  assert.ok(Math.abs(section.lateralOffsetM - 0.4) <= 0.05);
});

test("yellow coverage below sixty percent does not invent a centre line", () => {
  const { sections: [section] } = proposeRoad(road, photo({ share: 0.35 }));
  assert.equal(section.centre.type, "none");
  assert.ok(section.evidence.photoSupport < 0.6);
});

test("fully occluded road is an explicitly unmeasured T4 proposal", () => {
  const { sections: [section] } = proposeRoad(road, photo({ hidden: true }));
  assert.equal(section.centre.type, "none");
  assert.equal(section.evidence.tier, "T4");
  assert.equal(section.evidence.photoSupport, null);
  assert.equal(section.estimated, true);
  assert.ok(section.reason.length > 0);
});

test("reversing road orientation reverses lateral offset", () => {
  const { sections: [section] } = proposeRoad({ ...road, line: [...road.line].reverse() }, photo());
  assert.ok(Math.abs(section.lateralOffsetM + 0.4) <= 0.05);
});

test("arrow and text blobs are projected onto the nearest road leg without inventing their meaning", () => {
  const r = { id: "RD_TEST", line: [[0, 0], [15, 0], [15, 15]], widthM: 7, lanes: 2 };
  const result = proposeRoad(r, photo(), [
    { id: "ARROW_A", kind: "arrow", ring: [[13, 8], [14, 8], [14, 10], [13, 10]] },
    { id: "TEXT_B", kind: "text", ring: [[3, -2], [5, -2], [5, -1], [3, -1]] },
    { id: "REMOTE", kind: "arrow", ring: [[50, 50], [51, 50], [51, 51]] },
  ]);
  assert.deepEqual(result.markingCandidates, [
    { id: "ARROW_A", kind: "arrow", atM: 24, lateralOffsetM: 1.5, estimated: true },
    { id: "TEXT_B", kind: "text", atM: 4, lateralOffsetM: -1.5, estimated: true },
  ]);
});

test("short yellow object with a wide footprint cannot become a centre line", () => {
  const win = photo();
  win.rgb.fill(180);
  for (let i = 0; i < win.w * win.h; i += 1) win.rgb.set([220, 200, 30], i * 3);
  assert.equal(proposeRoad(road, win).sections[0].centre.type, "none");
});

const context = { segments: [{ id: "RD_TEST", lengthM: 30 }], nodes: ["ND_TEST"] };
const section = () => ({
  fromM: 0, toM: 30, lanes: [{ dir: "fwd", widthM: 3.5 }, { dir: "bwd", widthM: 3.5 }],
  centre: { type: "yellow_solid", widthM: 0.15 }, edges: { left: "white_solid", right: "none" },
  lateralOffsetM: 0, kerbOffsetsM: { left: 3.5, right: 3.5 },
  kerbNoParking: { left: false, right: false }, humps: [],
  evidence: { tier: "T1", refs: ["synthetic photo"], photoSupport: 1 }, estimated: true,
});

test("road section schema accepts the design contract", () => {
  assert.deepEqual(validate("roadSections", { RD_TEST: { sections: [section()] } }, context), { ok: true, errors: [] });
});

test("malformed split sections return segment-named errors rather than throwing", () => {
  const result = validate("roadSections", { RD_TEST: { splitAtM: [10], sections: [null] } }, context);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith("RD_TEST/sections[0]:")));
});

for (const [name, mutate, field] of [
  ["unknown segment", (doc) => { doc.RD_MISSING = doc.RD_TEST; delete doc.RD_TEST; }, "RD_MISSING"],
  ["unknown centre type", (doc) => { doc.RD_TEST.sections[0].centre.type = "purple"; }, "centre"],
  ["negative lane width", (doc) => { doc.RD_TEST.sections[0].lanes[0].widthM = -1; }, "lanes"],
  ["out of range station", (doc) => { doc.RD_TEST.sections[0].toM = 31; }, "toM"],
  ["overlapping intervals", (doc) => { doc.RD_TEST.sections.push(section()); }, "overlap"],
  ["unreferenced measurement", (doc) => { doc.RD_TEST.sections[0].estimated = false; doc.RD_TEST.sections[0].evidence.refs = []; }, "evidence"],
  ["invalid split station", (doc) => { doc.RD_TEST.splitAtM = [40]; }, "splitAtM"],
]) test(`road section schema rejects ${name} naming the segment`, () => {
  const doc = { RD_TEST: { sections: [section()] } };
  mutate(doc);
  const result = validate("roadSections", doc, context);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith(name === "unknown segment" ? "RD_MISSING:" : "RD_TEST/") && e.includes(field)), result.errors.join("\n"));
});

const junction = () => ({
  ND_TEST: { approaches: [{
    segment: "RD_TEST", end: "to", stopLineSetbackM: 2,
    crossing: { widthM: 4.57, offsetM: 5, zebraPeriodM: 0.903, barWidthM: 0.5 },
    arrows: [{ type: "straight", lane: 0, atM: 4 }], text: [{ text: "천천히", lane: 0, atM: 8 }],
    humps: [], signalArms: [{ bearingDeg: 90, lengthM: 5 }], yieldTriangles: [], guideLines: [],
    evidence: { tier: "T2", refs: ["synthetic VR"] }, estimated: true,
  }] },
});
test("junction schema keeps crossing, arrow, text and signal-arm records", () => {
  assert.deepEqual(validate("junctions", junction(), context), { ok: true, errors: [] });
});
test("junction schema names the approach with an unknown segment or impossible zebra period", () => {
  const doc = junction();
  doc.ND_TEST.approaches[0].segment = "RD_MISSING";
  doc.ND_TEST.approaches[0].crossing.zebraPeriodM = 0.1;
  const { errors, ok } = validate("junctions", doc, context);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.startsWith("ND_TEST/RD_MISSING:") && e.includes("segment")));
  assert.ok(errors.some((e) => e.includes("zebraPeriodM")));
});
