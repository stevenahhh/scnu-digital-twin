import assert from "node:assert/strict";
import test from "node:test";
import { rankLabelCandidates, resolveLabelBand } from "./labelBands.mjs";
import { EDGE_LEADER_PX, isAnchorBehindSelectedBox, layoutLabels } from "./labelLayout.mjs";

const area = { left: 0, top: 0, right: 1000, bottom: 800 };
const W = 60;
const H = 20;
const chip = (id, x, y, extra = {}) => ({ id, kind: "chip", anchor: { x, y }, width: W, height: H, ...extra });
const dot = (id, x, y) => ({ id, kind: "dot", anchor: { x, y }, width: 8, height: 8 });
const run = (candidates, opts = {}) => layoutLabels(candidates, { area, ...opts });
const byId = (result, id) => result.placed.find((p) => p.id === id);

test("a chip sits centred 6 px above its anchor (translate(-50%, -100% - 6px))", () => {
  const { placed } = run([chip("a", 300, 400)]);
  assert.deepEqual(placed[0].rect, { left: 270, top: 374, right: 330, bottom: 394 });
  assert.equal(placed[0].leader, null);
  assert.equal(placed[0].state, "default");
});

for (const [gap, left] of [[7, 8], [8, 8], [9, 9]]) {
  test(`left edge: a chip ${gap} px from the viewport edge is placed with its left side at ${left} px`, () => {
    const a = byId(run([chip("a", gap + W / 2, 400)]), "a");
    assert.equal(a.rect.left, left);
    // 1 px 밀린 칩은 여전히 앵커 위에 있어 연결선이 없다.
    assert.equal(a.leader, null);
  });
}

test("right, top and bottom edges also keep 8 px", () => {
  assert.equal(byId(run([chip("r", 1000 - 8 - W / 2, 400)]), "r").rect.right, 992);
  assert.equal(byId(run([chip("r", 1000 - 7 - W / 2, 400)]), "r").rect.right, 992);
  // 위 가장자리에 걸린 칩은 아래로 밀어 넣고(세로 이동이라 연결선), 여백을 지킨 칩은 제자리다.
  const top = byId(run([chip("t", 300, 7 + H + 6)]), "t");
  assert.equal(top.rect.top, 8);
  assert.ok(top.leader);
  assert.equal(byId(run([chip("t", 300, 8 + H + 6)]), "t").leader, null);
  // 아래 가장자리는 위로 올려 비킬 수 있다. 24 px로도 모자라면 숨긴다.
  assert.ok(byId(run([chip("b", 300, 800 - 7 + 6)]), "b").leader);
  assert.equal(run([chip("b", 300, 800 - 7 + 6 + 25)]).hiddenReasons.get("b"), "edge");
});

test("edge clamp: a chip whose anchor is 2 px from the left edge slides inward along the edge with a leader to its anchor", () => {
  const a = byId(run([chip("a", 2, 400)]), "a");
  assert.deepEqual(a.rect, { left: 8, top: 374, right: 8 + W, bottom: 394 });
  assert.ok(8 + W / 2 - 2 >= EDGE_LEADER_PX);
  assert.deepEqual(a.leader, { from: { x: 8 + W / 2, y: 394 }, to: { x: 2, y: 400 } });
  // 2 px 앵커 근처라도 자리는 남은 영역 안이고, 가장자리 여백 안이다.
  assert.equal(a.state, "default");
});

test("edge clamp: a chip whose anchor is off-screen is hidden, not pulled in", () => {
  const result = run([chip("a", -3, 400)]);
  assert.equal(result.placed.length, 0);
  assert.equal(result.hiddenReasons.get("a"), "edge");
});

test("edge clamp: a chip whose anchor is under the panel or a HUD rect is hidden, not pulled out", () => {
  const panel = { left: 0, top: 0, right: 40, bottom: 800 };
  assert.equal(run([chip("a", 20, 400)], { occluder: panel }).placed.length, 0);
  const hud = { left: 0, top: 300, right: 30, bottom: 500 };
  assert.equal(run([chip("b", 10, 400)], { chrome: [hud] }).placed.length, 0);
});

test("edge clamp: a clamped chip that would land on a higher-priority chip is hidden with reason collision", () => {
  // 'first' occupies the clamped spot (left 8..68) and every displacement up to 24 px.
  const first = chip("first", 8 + W / 2 + 10, 400);
  const result = run([first, chip("edge", 4, 400)]);
  assert.ok(byId(result, "first"));
  assert.equal(result.hiddenReasons.get("edge"), "collision");
});

// 화면 세로 전체를 덮는 HUD 기둥이라 위·아래로 비켜도 피할 수 없다.
const pillar = { left: 500, top: 0, right: 600, bottom: 800 };
for (const [gap, visible] of [[11, false], [12, true], [13, true]]) {
  test(`chrome: a chip ${gap} px from a HUD rect is ${visible ? "placed" : "hidden"}`, () => {
    const result = run([chip("a", 500 - gap - W / 2, 400)], { chrome: [pillar] });
    assert.equal(result.placed.length === 1, visible);
    if (!visible) assert.equal(result.hiddenReasons.get("a"), "chrome");
  });
}

test("the open panel (occluder) keeps 12 px too and is never nudged around", () => {
  const panel = { left: 600, top: 0, right: 1000, bottom: 800 };
  assert.equal(run([chip("a", 600 - 12 - W / 2, 400)], { occluder: panel }).placed.length, 1);
  assert.equal(run([chip("a", 600 - 11 - W / 2, 400)], { occluder: panel }).hiddenReasons.get("a"), "chrome");
  const top = { left: 0, top: 0, right: 1000, bottom: 50 };
  assert.equal(run([chip("a", 300, 80)], { occluder: top }).hiddenReasons.get("a"), "chrome");
});

test("a chip under a HUD rect is nudged below it with a leader before it is hidden", () => {
  const hud = { left: 0, top: 0, right: 1000, bottom: 50 };
  const result = run([chip("a", 300, 80)], { chrome: [hud] });
  const placed = byId(result, "a");
  assert.ok(placed, "nudged, not hidden");
  assert.equal(placed.rect.top, 62);
  assert.deepEqual(placed.leader, { from: { x: 300, y: 62 }, to: { x: 300, y: 80 } });
});

test("a chip deeper than 24 px under a HUD rect is hidden, not clipped", () => {
  const hud = { left: 0, top: 0, right: 1000, bottom: 80 };
  const result = run([chip("a", 300, 80)], { chrome: [hud] });
  assert.equal(result.placed.length, 0);
  assert.equal(result.hiddenReasons.get("a"), "chrome");
});

test("a colliding chip is displaced up in 4 px steps and gets a leader to its anchor", () => {
  const result = run([chip("a", 300, 400), chip("b", 300, 392)]);
  const b = byId(result, "b");
  assert.equal(b.rect.bottom, 392 - 6 - 20);
  assert.deepEqual(b.leader, { from: { x: 300, y: 366 }, to: { x: 300, y: 392 } });
  assert.deepEqual(result.leaders, [{ id: "b", from: { x: 300, y: 366 }, to: { x: 300, y: 392 } }]);
});

test("displacement stops at exactly 24 px", () => {
  const b = byId(run([chip("a", 300, 400), chip("b", 300, 398)]), "b");
  assert.equal(b.rect.bottom, 398 - 6 - 24);
  assert.ok(b.leader);
});

test("a chip that needs 28 px of displacement is hidden with reason collision", () => {
  const result = run([chip("a", 300, 400), chip("b", 300, 402)]);
  assert.equal(byId(result, "b"), undefined);
  assert.equal(result.hidden.has("b"), true);
  assert.equal(result.hiddenReasons.get("b"), "collision");
  assert.deepEqual(result.placed.map((p) => p.id), ["a"]);
});

test("two overlapping equals keep the higher-ranked one", () => {
  const result = run([chip("first", 300, 400), chip("second", 300, 400)]);
  assert.deepEqual(result.placed.map((p) => p.id), ["first"]);
  assert.equal(result.hiddenReasons.get("second"), "collision");
});

test("kept chips stay at least 6 px apart", () => {
  const six = run([chip("a", 100, 400), chip("b", 100 + W + 6, 400)]);
  assert.equal(byId(six, "b").leader, null);
  const five = run([chip("a", 100, 400), chip("b", 100 + W + 5, 400)]);
  assert.equal(five.hidden.has("b"), true);
});

test("the selected chip wins every collision even when it ranks lower", () => {
  const result = run([chip("a", 300, 400), chip("s", 300, 400, { selected: true })]);
  assert.equal(byId(result, "s").state, "selected");
  assert.equal(result.hidden.has("a"), true);
});

test("a selected chip with no legal place is pulled inside the edge margin with a leader", () => {
  const result = run([chip("s", 10, 400, { selected: true })]);
  const s = byId(result, "s");
  assert.equal(s.rect.left, 8);
  assert.ok(s.leader);
});

test("dots hide under chips but never cull each other", () => {
  const result = run([chip("a", 300, 400), dot("under", 300, 384), dot("d1", 500, 500), dot("d2", 502, 501)]);
  assert.equal(result.hiddenReasons.get("under"), "collision");
  assert.ok(byId(result, "d1"));
  assert.ok(byId(result, "d2"));
  assert.equal(byId(result, "d1").state, "dot");
});

test("dots respect the edge margin", () => {
  assert.equal(run([dot("d", 5, 400)]).hiddenReasons.get("d"), "edge");
});

test("the fingerprint is stable across identical inputs and changes when a chip moves", () => {
  const input = () => [chip("a", 300, 400), chip("b", 300, 392), dot("d", 600, 600)];
  assert.equal(run(input()).fingerprint, run(input()).fingerprint);
  assert.notEqual(run(input()).fingerprint, run([chip("a", 301, 400), chip("b", 300, 392)]).fingerprint);
  assert.match(run(input()).fingerprint, /^a:270,374,330,394:default\|b:/);
});

test("a chip whose anchor projects inside a nearer selected building box is faded as occluded", () => {
  const box = { id: "BLD_C1", left: 200, top: 300, right: 400, bottom: 500, depth: 100 };
  const behind = chip("far", 300, 450, { anchor: { x: 300, y: 450, depth: 150 } });
  const front = chip("near", 700, 450, { anchor: { x: 700, y: 450, depth: 50 } });
  const self = chip("BLD_C1", 300, 320, { anchor: { x: 300, y: 320, depth: 120 } });
  const result = run([behind, front, self], { focusBoxes: [box] });
  assert.equal(byId(result, "far").state, "occluded");
  assert.equal(byId(result, "near").state, "default");
  assert.equal(byId(result, "BLD_C1").state, "default");
});

test("isAnchorBehindSelectedBox: inside and farther only", () => {
  const box = { left: 0, top: 0, right: 100, bottom: 100, depth: 50 };
  assert.equal(isAnchorBehindSelectedBox({ x: 50, y: 50, depth: 60 }, box), true);
  assert.equal(isAnchorBehindSelectedBox({ x: 50, y: 50, depth: 40 }, box), false);
  assert.equal(isAnchorBehindSelectedBox({ x: 150, y: 50, depth: 60 }, box), false);
  assert.equal(isAnchorBehindSelectedBox(null, box), false);
  assert.equal(isAnchorBehindSelectedBox({ x: 50, y: 50, depth: 60 }, null), false);
});

test("layout does not mutate its inputs", () => {
  const candidates = [chip("a", 300, 400), chip("b", 300, 392), dot("d", 10, 10)];
  const chrome = [{ left: 0, top: 0, right: 1000, bottom: 50 }];
  const snapshot = JSON.stringify({ candidates, chrome, area });
  run(candidates, { chrome });
  assert.equal(JSON.stringify({ candidates, chrome, area }), snapshot);
});

test("with a band, chips over the cap are hidden with reason cap", () => {
  const band = { ...resolveLabelBand({ distance: 98, pitchDegrees: 45 }), cap: 1 };
  const ranked = rankLabelCandidates([{ id: "a", tier: 1, distance: 1 }, { id: "b", tier: 2, distance: 1 }], band).map((c, i) => ({ ...c, anchor: { x: 200 + i * 300, y: 400 }, width: W, height: H }));
  const result = run(ranked, { band, now: 0 });
  assert.deepEqual(result.placed.map((p) => p.id), ["a"]);
  assert.equal(result.hiddenReasons.get("b"), "cap");
});

test("with a band, the 300 ms hysteresis is keyed on the previous layout", () => {
  const band = { ...resolveLabelBand({ distance: 98, pitchDegrees: 45 }), cap: 1 };
  const place = (list) => rankLabelCandidates(list, band).map((c, i) => ({ ...c, anchor: { x: 200 + i * 300, y: 400 }, width: W, height: H }));
  const first = run(place([{ id: "a", tier: 1, distance: 1 }, { id: "b", tier: 2, distance: 1 }]), { band, now: 0 });
  const swapped = place([{ id: "b", tier: 1, distance: 1 }, { id: "a", tier: 2, distance: 1 }]);
  const t0 = run(swapped, { band, now: 1000, previous: first });
  const t299 = run(swapped, { band, now: 1299, previous: t0 });
  const t300 = run(swapped, { band, now: 1300, previous: t299 });
  assert.deepEqual(t299.placed.map((p) => p.id), ["a"]);
  assert.deepEqual(t300.placed.map((p) => p.id), ["b"]);
});

// 결정적인 의사 난수(mulberry32)로 200개의 후보 묶음을 만든다.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const grow = (r, by) => ({ left: r.left - by, top: r.top - by, right: r.right + by, bottom: r.bottom + by });

test("property: 200 random sets never overlap, keep margins, draw leaders and keep the selected chip", () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const random = rng(seed);
    const between = (lo, hi) => lo + random() * (hi - lo);
    const view = { left: 0, top: 0, right: Math.round(between(390, 1440)), bottom: Math.round(between(700, 900)) };
    const chrome = Array.from({ length: Math.floor(between(0, 4)) }, () => {
      const left = between(0, view.right - 120);
      const top = random() < 0.5 ? 0 : view.bottom - 60;
      return { left, top, right: left + between(40, 120), bottom: top + 60 };
    });
    const occluder = random() < 0.5 ? { left: view.right * 0.7, top: 0, right: view.right, bottom: view.bottom } : null;
    const blockers = [...chrome, ...(occluder ? [occluder] : [])].map((r) => grow(r, 12));
    const safe = grow(view, -8);
    const candidates = Array.from({ length: Math.floor(between(5, 41)) }, (_, i) => {
      const width = Math.round(between(30, 140));
      const height = Math.round(between(20, 28));
      const anchor = { x: between(-50, view.right + 50), y: between(-50, view.bottom + 50) };
      return { id: `c${i}`, kind: random() < 0.2 ? "dot" : "chip", anchor, width, height };
    });
    // 선택 칩은 제자리가 여백 규칙을 지키는 곳에 둔다(그래야 '늘 남는다'와 '여백'을 함께 따질 수 있다).
    let selected = null;
    while (!selected) {
      const width = 80;
      const anchor = { x: between(0, view.right), y: between(0, view.bottom) };
      const rect = { left: anchor.x - width / 2, top: anchor.y - 6 - 24, right: anchor.x + width / 2, bottom: anchor.y - 6 };
      const legal = rect.left >= safe.left && rect.top >= safe.top && rect.right <= safe.right && rect.bottom <= safe.bottom && !blockers.some((b) => overlaps(b, rect));
      if (legal) selected = { id: "selected", kind: "chip", selected: true, anchor, width, height: 24 };
    }
    candidates.splice(Math.floor(between(0, candidates.length)), 0, selected);

    const result = layoutLabels(candidates, { area: view, chrome, occluder, edgeMargin: 8, chromeMargin: 12, spacing: 6, maxDisplacement: 24 });
    const chips = result.placed.filter((p) => p.kind === "chip");
    for (let i = 0; i < chips.length; i += 1) {
      for (let j = i + 1; j < chips.length; j += 1) {
        assert.equal(overlaps(grow(chips[i].rect, 6), chips[j].rect), false, `seed ${seed}: ${chips[i].id} vs ${chips[j].id}`);
      }
      for (const d of result.placed.filter((p) => p.kind === "dot")) assert.equal(overlaps(chips[i].rect, d.rect), false, `seed ${seed}: dot ${d.id}`);
    }
    for (const p of result.placed) {
      const r = p.rect;
      assert.ok(r.left >= safe.left && r.top >= safe.top && r.right <= safe.right && r.bottom <= safe.bottom, `seed ${seed}: ${p.id} edge`);
      assert.equal(blockers.some((b) => overlaps(b, r)), false, `seed ${seed}: ${p.id} chrome`);
    }
    for (const p of chips) {
      const c = candidates.find((x) => x.id === p.id);
      const natural = { left: c.anchor.x - c.width / 2, top: c.anchor.y - 6 - c.height, right: c.anchor.x + c.width / 2, bottom: c.anchor.y - 6 };
      // 세로로 옮겼거나 가로로 EDGE_LEADER_PX 이상 밀렸으면 연결선이 있다.
      const moved = Math.abs(natural.top - p.rect.top) > 1e-9 || Math.abs(natural.left - p.rect.left) >= EDGE_LEADER_PX;
      assert.equal(Boolean(p.leader), moved, `seed ${seed}: ${p.id} leader`);
    }
    assert.ok(chips.some((p) => p.id === "selected" && p.state === "selected"), `seed ${seed}: selected missing`);
    assert.equal(result.placed.length + result.hidden.size, candidates.length, `seed ${seed}: every candidate accounted for`);
  }
});
