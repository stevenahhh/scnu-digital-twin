import assert from "node:assert/strict";
import test from "node:test";
import {
  IS_IDS, compareNameSets, controlBudgetLimit, countAtMost, cropImage, duplicateValues, hookMissing, hudPanelViolations, isLayoutTransition,
  kstDate, lineCount, loadingProblems, minimum, nearestSample, overlappingPairs, presentationExtras, rectsOverlap, regionDistance,
  stoppedAfterD4, tabsMatch, undersized,
} from "./ideal-eval.mjs";

const box = (l, t, r, b) => ({ l, t, r, b });

test("IS ids run IS-01..IS-40", () => {
  assert.equal(IS_IDS.length, 40);
  assert.equal(IS_IDS[0], "IS-01");
  assert.equal(IS_IDS[39], "IS-40");
});

test("a missing hook is a FAIL naming the hook, never a pass", () => {
  const v = hookMissing("[data-qa=more-menu]", "1 menu");
  assert.equal(v.pass, false);
  assert.equal(v.measured.measured, "hook missing");
  assert.equal(v.measured.hook, "[data-qa=more-menu]");
});

test("IS-01/IS-02 budgets: S17 (fixtures up) one control fewer than feeds down", () => {
  assert.equal(controlBudgetLimit("D", "up"), 15);
  assert.equal(controlBudgetLimit("D", "down"), 16);
  assert.equal(controlBudgetLimit("P", "up"), 7);
  assert.equal(controlBudgetLimit("P", "down"), 8);
  assert.equal(countAtMost(16, 16).pass, true);
  assert.equal(countAtMost(24, 16).pass, false);
  assert.equal(countAtMost(24, 16).measured.count, 24);
});

test("IS-03 compares the name sets in any order and lists the differences", () => {
  assert.equal(compareNameSets(["a", "b"], ["b", "a"]).same, true);
  const diff = compareNameSets(["a", "b"], ["a", "c", "d"]);
  assert.equal(diff.same, false);
  assert.deepEqual(diff.onlyLegacy, ["b"]);
  assert.deepEqual(diff.onlyVworld, ["c", "d"]);
});

test("IS-10 reports each repeated data source once with its count", () => {
  assert.deepEqual(duplicateValues(["weather", "traffic", "weather"]), [{ value: "weather", n: 2 }]);
  assert.deepEqual(duplicateValues(["weather", "traffic"]), []);
});

test("IS-11 needs the four tab names in order", () => {
  assert.equal(tabsMatch(["건물", "현황", "에너지", "시뮬레이션"]), true);
  assert.equal(tabsMatch(["기본 현황", "주차·안전", "에너지", "환경 시뮬"]), false);
  assert.equal(tabsMatch(["현황", "건물", "에너지", "시뮬레이션"]), false);
});

test("IS-12 counts wrapped lines, not subpixel offsets of spans on one line", () => {
  assert.equal(lineCount([100, 100.4, 101]), 1);
  assert.equal(lineCount([100, 118]), 2);
  assert.equal(lineCount([]), 0);
});

test("IS-17 overlap skips ancestor/descendant pairs and touching edges", () => {
  assert.equal(rectsOverlap(box(0, 0, 10, 10), box(10, 0, 20, 10)), false);
  assert.equal(rectsOverlap(box(0, 0, 10, 10), box(9, 9, 20, 20)), true);
  const items = [
    { name: "combobox", rect: box(0, 0, 100, 40), ancestors: [] },
    { name: "option", rect: box(10, 10, 50, 30), ancestors: [0] },
    { name: "button", rect: box(90, 0, 140, 40), ancestors: [] },
  ];
  assert.deepEqual(overlappingPairs(items), [["combobox", "button"]]);
});

test("IS-18/IS-19 target size: a slider is judged by its hit-area height only", () => {
  const items = [
    { name: "ok", w: 44, h: 44 },
    { name: "thin", w: 44, h: 32 },
    { name: "slider", w: 300, h: 44, slider: true },
    { name: "short slider", w: 300, h: 20, slider: true },
  ];
  assert.deepEqual(undersized(items, 44).map((item) => item.name), ["thin", "short slider"]);
  assert.deepEqual(undersized([{ name: "icon", w: 32, h: 32 }], 24), []);
});

test("IS-33 flags layout and background-color transitions longer than 10 ms only", () => {
  assert.equal(isLayoutTransition("right", "0.3s"), true);
  assert.equal(isLayoutTransition("background-color, color, filter", "0.12s, 0.12s, 0.12s"), true);
  assert.equal(isLayoutTransition("all", "0.2s"), true);
  assert.equal(isLayoutTransition("transform", "0.3s"), false);
  assert.equal(isLayoutTransition("opacity", "0.2s"), false);
  assert.equal(isLayoutTransition("right", "0s"), false);
  assert.equal(isLayoutTransition("border-right-color", "0.2s"), false);
});

test("cropImage and regionDistance compare one region of two frames", () => {
  const make = (fill) => {
    const width = 18;
    const height = 16;
    const pixels = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const v = fill(x, y);
      pixels.set([v, v, v], (y * width + x) * 3);
    }
    return { width, height, channels: 3, pixels };
  };
  const a = make((x) => x * 10);
  const sameLeft = make((x) => (x < 9 ? x * 10 : 255 - x * 10));
  const crop = cropImage(a, { x: 0, y: 0, w: 9, h: 16 });
  assert.equal(crop.width, 9);
  assert.equal(crop.height, 16);
  assert.equal(regionDistance(a, sameLeft, { x: 0, y: 0, w: 9, h: 16 }), 0);
  assert.ok(regionDistance(a, sameLeft, { x: 0, y: 0, w: 18, h: 16 }) > 2);
  assert.equal(cropImage(a, { x: 0, y: 0, w: 4.5, h: 8 }, 2).width, 9);
});

test("IS-34 flags any sample where the HUD reaches past the panel's left edge", () => {
  const samples = [{ t: 0, hudRight: 1000, panelLeft: 1040 }, { t: 100, hudRight: 1384, panelLeft: 1100 }, { t: 200, hudRight: null, panelLeft: 1200 }];
  assert.deepEqual(hudPanelViolations(samples).map((s) => s.t), [100, 200]);
  assert.equal(nearestSample([{ t: 0 }, { t: 96 }, { t: 160 }], 100).t, 96);
});

test("IS-29 accepts exactly 발표 모드 끝내기 and 투어 시작, plus tour dots while touring", () => {
  assert.deepEqual(presentationExtras(["발표 모드 끝내기", "투어 시작"]), { extras: [], missing: [] });
  assert.deepEqual(presentationExtras(["발표 모드 끝내기"]), { extras: [], missing: ["투어 시작"] });
  assert.deepEqual(presentationExtras(["발표 모드 끝내기", "투어 시작", "설정"]).extras, ["설정"]);
  assert.deepEqual(presentationExtras(["발표 모드 끝내기", "투어 멈춤", "투어 2/7"], { touring: true }), { extras: [], missing: [] });
});

test("IS-39 loading rules: no early spinner, one per card later, never spinner and skeleton together", () => {
  const clean = [{ t: 502, spinners: 0, cards: [{ card: "selection-inspector", spinners: 0, skeletons: 1 }] }, { t: 1503, spinners: 1, cards: [{ card: "selection-inspector", spinners: 1, skeletons: 0 }] }];
  assert.deepEqual(loadingProblems(clean), []);
  const bad = [{ t: 500, spinners: 1, cards: [{ card: "energy-dashboard", spinners: 1, skeletons: 2 }] }, { t: 1500, spinners: 2, cards: [{ card: "energy-dashboard", spinners: 2, skeletons: 0 }] }];
  const problems = loadingProblems(bad);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /at 500 ms/);
});

test("IS-38 minimum ignores missing readings; IS-40 needs a still slider and the tour off", () => {
  assert.equal(minimum([1, 0, 1, null]), 0);
  assert.equal(minimum([null]), null);
  assert.equal(stoppedAfterD4({ before: 1140, after: 1140, tourPressed: "false" }), true);
  assert.equal(stoppedAfterD4({ before: 1140, after: 1150, tourPressed: "false" }), false);
  assert.equal(stoppedAfterD4({ before: 1140, after: 1140, tourPressed: "true" }), false);
  assert.equal(stoppedAfterD4({ before: null, after: null, tourPressed: "false" }), false);
});

test("kstDate gives the scene date in KST", () => {
  assert.equal(kstDate("2026-10-25T19:00:00+09:00"), "2026-10-25");
  assert.equal(kstDate("2026-10-25T23:30:00+09:00"), "2026-10-25");
  assert.equal(kstDate("2026-10-25T16:00:00Z"), "2026-10-26");
  assert.equal(kstDate("not a date"), null);
});
