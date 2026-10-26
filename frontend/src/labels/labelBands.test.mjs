import assert from "node:assert/strict";
import test from "node:test";
import { CAMERA_PRESETS, D4_CAMERA_OFFSET, findCameraPreset } from "../camera/cameraPresets.mjs";
import { applyHysteresis, clusterGroups, rankLabelCandidates, resolveLabelBand } from "./labelBands.mjs";

const band = (distance, pitchDegrees = 45, extra = {}) => resolveLabelBand({ distance, pitchDegrees, ...extra });

// 시점 정의에서 카메라-목표점 거리와 내려다보는 각도를 구한다(CityModel·cameraPresets와 같은 식).
function presetView(position, target) {
  const [dx, dy, dz] = position.map((value, axis) => value - target[axis]);
  return { distance: Math.hypot(dx, dy, dz), pitchDegrees: (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI };
}

test("far / mid boundary: 301 is far, 300 and 299 are mid", () => {
  assert.equal(band(301).band, "far");
  assert.equal(band(300).band, "mid");
  assert.equal(band(299).band, "mid");
});

test("mid / near boundary: 150 is mid, 149 is near", () => {
  assert.equal(band(150).band, "mid");
  assert.equal(band(149).band, "near");
});

test("pitch 25 or below is street at any distance; just above 25 keeps the distance band", () => {
  assert.equal(band(400, 25).band, "street");
  assert.equal(band(100, 10).band, "street");
  assert.equal(band(100, 25.1).band, "near");
  assert.equal(band(400, 25.1).band, "far");
});

test("a fromGround preset is street regardless of distance and pitch", () => {
  assert.equal(band(500, 60, { presetFromGround: true }).band, "street");
});

test("AUDIT 5.5 reference views: overview far, 공과대 mid, 공대 3호관 near, 정문 street", () => {
  const view = (id) => {
    const preset = findCameraPreset(id);
    if (preset.offset) return presetView(preset.offset, [0, 0, 0]);
    return presetView(preset.position, preset.target);
  };
  const rows = [
    ["overview", 368, "far"],
    ["engineering", 212, "mid"],
    ["d4", 98, "near"],
  ];
  for (const [id, distance, expected] of rows) {
    const { distance: measured, pitchDegrees } = view(id);
    assert.equal(Math.round(measured), distance, id);
    assert.equal(band(measured, pitchDegrees).band, expected, id);
  }
  const gate = findCameraPreset("gate");
  const gateView = presetView(gate.position, gate.target);
  assert.equal(resolveLabelBand({ ...gateView, presetFromGround: gate.fromGround }).band, "street");
  assert.deepEqual(D4_CAMERA_OFFSET, [60, 50, 60]);
  assert.ok(CAMERA_PRESETS.length >= 4);
});

test("far: zones + landmarks, cap 6 zones + 8 landmarks, chip 12 px, zone 14 px, groups clustered", () => {
  const far = band(368);
  assert.deepEqual(far.tiersShown, [0, 1]);
  assert.equal(far.cap, 14);
  assert.deepEqual(far.tierCaps, { 0: 6, 1: 8 });
  assert.equal(far.chipPx, 12);
  assert.equal(far.zonePx, 14);
  assert.equal(far.clusterGroups, true);
});

test("mid: tiers 1+2, tier 3 as dots, groups clustered, cap 20", () => {
  const mid = band(212);
  assert.deepEqual(mid.tiersShown, [1, 2]);
  assert.deepEqual(mid.dotTiers, [3]);
  assert.equal(mid.clusterGroups, true);
  assert.equal(mid.cap, 20);
});

test("near: tiers 1+2+3, groups expanded, cap 30", () => {
  const near = band(98);
  assert.deepEqual(near.tiersShown, [1, 2, 3]);
  assert.equal(near.clusterGroups, false);
  assert.equal(near.cap, 30);
});

test("street: tiers 1+2, cap 8, chip 14 px, leader required, 120-unit radius", () => {
  const street = band(114, 17);
  assert.deepEqual(street.tiersShown, [1, 2]);
  assert.equal(street.cap, 8);
  assert.equal(street.chipPx, 14);
  assert.equal(street.leader, true);
  assert.equal(street.streetRadius, 120);
});

test("chips are never below 12 px and never above 14 px outside presentation", () => {
  for (const distance of [50, 149, 150, 300, 301, 900]) {
    for (const pitch of [10, 45]) {
      for (const touch of [false, true]) {
        const { chipPx } = band(distance, pitch, { touch });
        assert.ok(chipPx >= 12 && chipPx <= 14, `${distance}/${pitch}/${touch}: ${chipPx}`);
      }
    }
  }
});

test("touch raises chips to 14 px and halves caps (far 3 zones + 4 landmarks = 7)", () => {
  const far = band(368, 45, { touch: true });
  assert.equal(far.chipPx, 14);
  assert.equal(far.cap, 7);
  assert.deepEqual(far.tierCaps, { 0: 3, 1: 4 });
  assert.equal(band(212, 45, { touch: true }).cap, 10);
  assert.equal(band(98, 45, { touch: true }).cap, 15);
  assert.equal(band(98, 10, { touch: true }).cap, 4);
});

test("presentation halves caps, hides dots and multiplies chip px by 1.5", () => {
  const mid = band(212, 45, { presentation: true });
  assert.equal(mid.cap, 10);
  assert.deepEqual(mid.dotTiers, []);
  assert.equal(mid.chipPx, 19.5);
  assert.equal(band(368, 45, { presentation: true }).zonePx, 21);
});

const candidates = [
  { id: "BLD_E3", tier: 2, hasData: true, distance: 50 },
  { id: "BLD_C1", tier: 1, hasData: false, distance: 90 },
  { id: "BLD_D4", tier: 1, hasData: true, distance: 120 },
  { id: "BLD_A1", tier: 1, hasData: true, distance: 120 },
  { id: "BLD_SCNU_R1", tier: 3, hasData: false, distance: 10 },
  { id: "ZONE_engineering", tier: 0, hasData: false, distance: 200 },
];

test("priority: tier ascending, then hasData, then distance, ties by id", () => {
  const ranked = rankLabelCandidates(candidates, band(98));
  assert.deepEqual(ranked.map((c) => c.id), ["BLD_A1", "BLD_D4", "BLD_C1", "BLD_E3", "BLD_SCNU_R1"]);
});

test("priority: selected first, then hovered or focused", () => {
  const ranked = rankLabelCandidates(candidates, band(98), { selectedId: "BLD_SCNU_R1", hoveredId: "BLD_E3" });
  assert.deepEqual(ranked.slice(0, 2).map((c) => c.id), ["BLD_SCNU_R1", "BLD_E3"]);
  const focused = rankLabelCandidates(candidates, band(98), { focusedId: "BLD_C1" });
  assert.equal(focused[0].id, "BLD_C1");
});

test("band tiers decide chip / dot / dropped; selection is always a chip", () => {
  const far = rankLabelCandidates(candidates, band(368));
  assert.deepEqual(far.filter((c) => c.kind === "chip").map((c) => c.id), ["ZONE_engineering", "BLD_A1", "BLD_D4", "BLD_C1"]);
  assert.deepEqual(far.filter((c) => c.kind === "dot").map((c) => c.id), ["BLD_E3"]);
  const mid = rankLabelCandidates(candidates, band(212));
  assert.equal(mid.find((c) => c.id === "BLD_SCNU_R1").kind, "dot");
  assert.equal(mid.some((c) => c.id === "ZONE_engineering"), false);
  const selected = rankLabelCandidates(candidates, band(368), { selectedId: "BLD_SCNU_R1" });
  assert.equal(selected[0].kind, "chip");
});

test("street keeps only front-hemisphere chips within 120 units", () => {
  const street = band(114, 17);
  const ranked = rankLabelCandidates(
    [
      { id: "a", tier: 1, distance: 119, inFront: true },
      { id: "b", tier: 1, distance: 121, inFront: true },
      { id: "c", tier: 2, distance: 40, inFront: false },
      { id: "d", tier: 2, distance: 40 },
      { id: "e", tier: 3, distance: 10 },
    ],
    street,
  );
  assert.deepEqual(ranked.map((c) => c.id), ["a", "d"]);
});

test("ranking does not mutate its input", () => {
  const input = candidates.map((c) => ({ ...c }));
  const snapshot = JSON.stringify(input);
  rankLabelCandidates(input, band(98), { selectedId: "BLD_E3" });
  assert.equal(JSON.stringify(input), snapshot);
});

const many = (n, tier = 2) => Array.from({ length: n }, (_, i) => ({ id: `B${String(i).padStart(2, "0")}`, tier, distance: 10 + i }));

test("caps: the first frame shows at most the band cap, by rank", () => {
  const near = band(98);
  const { visible } = applyHysteresis({ ranked: rankLabelCandidates(many(40), near), now: 0, band: near });
  assert.equal(visible.length, 30);
  assert.equal(visible[0], "B00");
  assert.equal(visible.at(-1), "B29");
});

test("far caps zones at 6 and landmarks at 8", () => {
  const far = band(368);
  const ranked = rankLabelCandidates([...many(10, 0).map((c) => ({ ...c, id: `Z${c.id}` })), ...many(12, 1)], far);
  const { visible } = applyHysteresis({ ranked, now: 0, band: far });
  assert.equal(visible.filter((id) => id.startsWith("Z")).length, 6);
  assert.equal(visible.filter((id) => !id.startsWith("Z")).length, 8);
});

test("dots pass through without a cap or hysteresis", () => {
  const mid = band(212);
  const { dots } = applyHysteresis({ ranked: rankLabelCandidates(many(25, 3), mid), now: 0, band: mid });
  assert.equal(dots.length, 25);
});

// 상한 2인 street 단계로 시간 규칙을 본다: a, b가 보이다가 c가 b보다 앞서게 된다.
function hysteresisRun() {
  const street = band(100, 10);
  const tight = { ...street, cap: 2 };
  const rank = (list) => rankLabelCandidates(list, tight);
  const before = rank([
    { id: "a", tier: 1, distance: 10 },
    { id: "b", tier: 1, distance: 20 },
    { id: "c", tier: 2, distance: 30 },
  ]);
  const after = rank([
    { id: "a", tier: 1, distance: 10 },
    { id: "c", tier: 1, distance: 15 },
    { id: "b", tier: 1, distance: 20 },
  ]);
  const first = applyHysteresis({ ranked: before, now: 1000, band: tight });
  return { tight, after, first };
}

test("hysteresis: a chip outranked for 299 ms stays visible; at 300 ms it is released and the newcomer appears", () => {
  const { tight, after, first } = hysteresisRun();
  assert.deepEqual(first.visible, ["a", "b"]);
  const t0 = applyHysteresis({ ranked: after, previousVisible: first.state, now: 2000, band: tight });
  assert.deepEqual(t0.visible, ["a", "b"]);
  const t299 = applyHysteresis({ ranked: after, previousVisible: t0.state, now: 2299, band: tight });
  assert.deepEqual(t299.visible, ["a", "b"]);
  const t300 = applyHysteresis({ ranked: after, previousVisible: t299.state, now: 2300, band: tight });
  assert.deepEqual(t300.visible, ["a", "c"]);
});

test("hysteresis: a hidden chip needs a free slot for 300 ms before it appears", () => {
  const near = { ...band(98), cap: 3 };
  const two = rankLabelCandidates(many(2), near);
  const three = rankLabelCandidates(many(3), near);
  const first = applyHysteresis({ ranked: two, now: 0, band: near });
  const t0 = applyHysteresis({ ranked: three, previousVisible: first.state, now: 100, band: near });
  assert.deepEqual(t0.visible, ["B00", "B01"]);
  const t299 = applyHysteresis({ ranked: three, previousVisible: t0.state, now: 399, band: near });
  assert.deepEqual(t299.visible, ["B00", "B01"]);
  const t300 = applyHysteresis({ ranked: three, previousVisible: t299.state, now: 400, band: near });
  assert.deepEqual(t300.visible, ["B00", "B01", "B02"]);
});

test("hysteresis: a band change releases immediately", () => {
  const { tight, after, first } = hysteresisRun();
  const t0 = applyHysteresis({ ranked: after, previousVisible: first.state, now: 2000, band: tight });
  const near = { ...band(98), cap: 2 };
  const changed = applyHysteresis({ ranked: rankLabelCandidates(after, near), previousVisible: t0.state, now: 2001, band: near });
  assert.deepEqual(changed.visible, ["a", "c"]);
});

test("hysteresis: a selected chip appears at once and evicts the held chip", () => {
  const { tight, first } = hysteresisRun();
  const ranked = rankLabelCandidates(
    [
      { id: "a", tier: 1, distance: 10 },
      { id: "b", tier: 1, distance: 20 },
      { id: "c", tier: 2, distance: 30 },
    ],
    tight,
    { selectedId: "c" },
  );
  const next = applyHysteresis({ ranked, previousVisible: first.state, now: 1001, band: tight });
  assert.deepEqual(next.visible, ["c", "a"]);
});

test("hysteresis: a chip that leaves the candidate list goes at once", () => {
  const { tight, first } = hysteresisRun();
  const next = applyHysteresis({ ranked: rankLabelCandidates([{ id: "a", tier: 1, distance: 10 }], tight), previousVisible: first.state, now: 1001, band: tight });
  assert.deepEqual(next.visible, ["a"]);
});

const dorms = [1, 2, 3, 4, 5].map((n) => ({ id: `D${n}`, group: "dormitory", displayName: `학생생활관 ${n}동`, tier: 2, distance: 100 + n, position: [n * 2, 0, 0] }));

test("clusterGroups merges a group into one 학생생활관 5동 candidate at the centroid in far and mid", () => {
  const entries = [{ id: "BLD_C1", tier: 1, distance: 50, position: [0, 0, 0] }, ...dorms];
  for (const name of [368, 212]) {
    const out = clusterGroups(entries, band(name));
    assert.equal(out.length, 2);
    const cluster = out[1];
    assert.equal(cluster.id, "GROUP_dormitory");
    assert.equal(cluster.displayName, "학생생활관 5동");
    assert.deepEqual(cluster.position, [6, 0, 0]);
    assert.equal(cluster.distance, 101);
    assert.deepEqual(cluster.members, ["D1", "D2", "D3", "D4", "D5"]);
  }
});

test("clusterGroups keeps members separate in near and street", () => {
  assert.equal(clusterGroups(dorms, band(98)).length, 5);
  assert.equal(clusterGroups(dorms, band(100, 10)).length, 5);
});

test("clusterGroups leaves a one-member group as is and does not mutate input", () => {
  const input = [{ ...dorms[0] }, { id: "x", tier: 2, group: "solo", distance: 1 }];
  const snapshot = JSON.stringify(input);
  const out = clusterGroups(input, band(212));
  assert.equal(out.length, 2);
  assert.equal(out[1].id, "x");
  assert.equal(JSON.stringify(input), snapshot);
});
