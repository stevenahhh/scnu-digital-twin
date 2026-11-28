// Placement of the 의대 유치 promo layer on the real furniture survey (stages/furniture.mjs loadFurniture): the nine
// campus banner boards, the LED screen over the A19 gate letter sign and the closed route of the picket marchers.
import assert from "node:assert/strict";
import test from "node:test";
import { metres } from "../lib/frame.mjs";
import { toLocal } from "../lib/solids.mjs";
import { loadFurniture } from "../stages/furniture.mjs";
import { BANNER_IDS, GATE_SCREEN, bannerPlacements, gateScreenPlacement, marcherRoute, marcherTracks } from "./layout.mjs";

const M = metres;
const { objects } = loadFurniture();
const gate = objects.find((o) => o.id === "RS-GATE-A19");

test("bannerPlacements: one poster per campus banner board, sized like the board", () => {
  const banners = bannerPlacements(objects);
  assert.deepEqual(banners.map((b) => b.id), BANNER_IDS);
  assert.equal(banners.length, 9);
  const e1 = banners.find((b) => b.id === "SD-E1-S2");
  assert.equal(e1.widthM, 5);
  assert.equal(e1.panelM, 1.6);
  assert.equal(e1.clearanceM, 0.3);
  assert.deepEqual(new Set(banners.map((b) => b.design)), new Set([0, 1, 2]));
  assert.throws(() => bannerPlacements(objects.filter((o) => o.id !== "SD-B1-S2")), /SD-B1-S2/);
});

test("gateScreenPlacement: the screen stands above the letters, as wide as them, facing the plaza", () => {
  const screen = gateScreenPlacement(gate);
  assert.ok(screen.bottomM >= gate.heightM + 0.5, `bottom ${screen.bottomM} over sign top ${gate.heightM}`);
  assert.ok(GATE_SCREEN.widthM >= gate.p.length_m, "screen as wide as the lettering");
  // the front of the frame points the way the letters face (bearing 8.5 deg: north, -z)
  const out = [screen.frame.v[0] * screen.front, screen.frame.v[1] * screen.front];
  assert.ok(out[1] < -0.9, `front normal ${out}`);
});

test("marcherRoute: a closed loop on the plaza in front of the sign", () => {
  const screen = gateScreenPlacement(gate);
  const route = marcherRoute(screen);
  assert.ok(route.length >= 40);
  for (const p of route) {
    const [, t] = toLocal(screen.frame, p);
    const ahead = t * screen.front;
    assert.ok(ahead > 5 && ahead < 15, `point ${ahead} m ahead of the letters`);
  }
  const lengthM = route.reduce((sum, p, i) => sum + Math.hypot(...p.map((v, k) => v - route[(i + 1) % route.length][k])), 0) / M(1);
  assert.ok(lengthM > 25 && lengthM < 60, `route ${lengthM} m`);
});

test("marcherTracks: three marchers a third of the loop apart, each loop closing on itself", () => {
  const screen = gateScreenPlacement(gate);
  const tracks = marcherTracks(marcherRoute(screen), { count: 3, speedMps: 1.1 });
  assert.equal(tracks.length, 3);
  const duration = tracks[0].times.at(-1);
  for (const track of tracks) {
    assert.equal(track.times.at(-1), duration);
    assert.deepEqual(track.points[0], track.points.at(-1));
    assert.ok(Math.abs(track.yaws[0] - track.yaws.at(-1)) < 1e-9);
  }
  const gap = Math.hypot(tracks[0].points[0][0] - tracks[1].points[0][0], tracks[0].points[0][1] - tracks[1].points[0][1]) / M(1);
  assert.ok(gap > 4, `marchers ${gap} m apart`);
});
