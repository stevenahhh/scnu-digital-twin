// The planned 순천대 의대 campus (plan.mjs): the estimated site outline keeps the reported 151,719 m2, every building
// stands inside it, the plan stays within the 자연녹지 limits (building coverage 20 %, floor-area ratio 100 %), the
// hospital podium keeps the surgical floor height of the public-hospital design guideline and the programme holds
// about 500 beds.
import assert from "node:assert/strict";
import test from "node:test";
import { BUILDINGS, FLOOR_HEIGHT, SITE, coverage, floorAreaRatio, pointInRing, polygonArea, siteRing } from "./plan.mjs";

test("site outline: the reported area within 2 %", () => {
  const area = polygonArea(siteRing());
  assert.ok(Math.abs(area - SITE.areaM2) / SITE.areaM2 < 0.02, `site ${area.toFixed(0)} m2`);
});

test("every building footprint lies inside the site", () => {
  const ring = siteRing();
  for (const b of BUILDINGS) {
    for (const corner of b.footprint) assert.ok(pointInRing(corner, ring), `${b.id} corner ${corner} outside`);
  }
});

test("coverage and floor-area ratio stay within the 자연녹지 limits", () => {
  const bcr = coverage();
  const far = floorAreaRatio();
  assert.ok(bcr > 0.1 && bcr <= 0.2, `building coverage ${bcr}`);
  assert.ok(far > 0.5 && far <= 1.0, `floor-area ratio ${far}`);
});

test("hospital: podium floors at the surgical slab-to-slab height, bed towers for about 500 beds", () => {
  assert.equal(FLOOR_HEIGHT.podium, 5.1);
  const podium = BUILDINGS.find((b) => b.id === "hospital-podium");
  assert.equal(podium.floorM, FLOOR_HEIGHT.podium);
  const towers = BUILDINGS.filter((b) => b.kind === "bed-tower");
  assert.equal(towers.length, 2);
  const beds = towers.reduce((sum, t) => sum + t.storeys * t.bedsPerFloor, 0);
  assert.ok(beds >= 480 && beds <= 560, `${beds} beds`);
  for (const t of towers) assert.equal(t.baseM, podium.storeys * podium.floorM);
  assert.ok(BUILDINGS.some((b) => b.helipad), "a helipad on a bed tower");
});
