import { test } from "node:test";
import assert from "node:assert/strict";
import { groundProposal, groundParcels, migrationErrors, roadParts, isSurveyedNonRoad } from "./roadGround.mjs";
import { ringArea } from "../lib/geometry.mjs";

function raster(hidden = false) {
  const w = 120, h = 120, gsdM = 0.25;
  const rgb = new Uint8Array(w * h * 3);
  const mask = new Uint8Array(w * h).fill(hidden ? 1 : 0);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const n = 15 - (y + 0.5) * gsdM;
    rgb.set(Math.abs(n) < 4 ? [65, 80, 85] : [70, 110, 50], (y * w + x) * 3);
  }
  return { w, h, origin: [-15, 15], gsdM, rgb, mask };
}
const seed = { id: "SECTION_A", parcelId: "PARCEL_A", class: "road", point: [0, 0], axis: [1, 0], lengthM: 12, widthM: 8, road: "RD_A", paint: ["PAINT_A"] };

test("an eye-corrected A003 boundary still blocks road proposals on its sidewalk", () => {
  assert.equal(isSurveyedNonRoad({ source: "NGII-A003", estimated: true, paintAllowed: false }), true);
  assert.equal(isSurveyedNonRoad({ source: "project-estimated", estimated: true, paintAllowed: false }), false);
  assert.equal(isSurveyedNonRoad({ source: "NGII-A003", estimated: true, paintAllowed: true }), false);
});

test("road ground proposal follows photo asphalt instead of a paint hull", () => {
  const r = groundProposal(seed, raster(), []);
  assert.equal(r.method, "photo-boundary");
  assert.ok(r.metrics.visibleShare > 0.9);
  const n = r.rings[0].map(p => p[1]);
  assert.ok(Math.max(...n) <= 4.5 && Math.min(...n) >= -4.5);
  assert.ok(Math.max(...n) - Math.min(...n) >= 7);
});
test("unseen road is an explicit dimensioned T4 section prior, not an absence claim", () => {
  const r = groundProposal(seed, raster(true), []);
  assert.equal(r.method, "section-prior");
  assert.equal(r.evidence.tier, "T4");
  assert.equal(r.estimated, true);
  assert.equal(r.metrics.visibleShare, 0);
  assert.equal(r.section.widthM, 8);
  assert.ok(r.reason.includes("0"));
});
test("road record produces a parcel and removal is caught by the migration gate", () => {
  const record = groundProposal(seed, raster(), []);
  const doc = { targets: ["OLD_A"], records: [{ ...record, replaces: ["OLD_A"] }] };
  const parcels = groundParcels(doc);
  assert.equal(parcels[0].roadRecord, "SECTION_A");
  assert.equal(parcels[0].source, "road-section");
  assert.deepEqual(migrationErrors(doc, parcels, []), []);
  assert.ok(migrationErrors(doc, [], []).some(e => e.includes("SECTION_A")));
  assert.ok(migrationErrors({ ...doc, records: [] }, [], []).some(e => e.includes("OLD_A")));
});
test("migration gate refuses a zero-width road even when its parcel exists", () => {
  const r = groundProposal(seed, raster(), []);
  r.section.widthM = 0;
  const doc = { targets: ["OLD_A"], records: [{ ...r, replaces: ["OLD_A"] }] };
  assert.ok(migrationErrors(doc, groundParcels(doc), []).some(e => e.includes("widthM")));
});
test("a road over an estimated apron is clipped away from surveyed sidewalk", () => {
  const r = { ...groundProposal(seed, raster(true), []), precedence: 6.2 };
  const parts = roadParts(r, [{ ring: [[0, -10], [20, -10], [20, 10], [0, 10]], holes: [] }]);
  assert.ok(parts.every(p => p.ring.every(q => q[0] <= 1e-9)));
  assert.ok(Math.abs(parts.reduce((s, p) => s + Math.abs(ringArea(p.ring)), 0) - 48) < 1e-6);
});
