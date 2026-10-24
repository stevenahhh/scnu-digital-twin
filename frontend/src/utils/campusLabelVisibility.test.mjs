import assert from "node:assert/strict";
import test from "node:test";
import {
  campusLabelRectsOverlap,
  isCampusLabelVisible,
  selectVisibleCampusLabels,
} from "./campusLabelVisibility.mjs";

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });
const canvas = rect(0, 0, 1440, 900);
const openPanel = rect(1000, 0, 440, 900);
const closedPanel = rect(1440, 0, 440, 900);

test("a label inside the canvas and left of the open panel is visible", () => {
  assert.equal(isCampusLabelVisible(rect(100, 100, 80, 20), canvas, openPanel), true);
});

test("a label wholly under the open panel is hidden", () => {
  assert.equal(isCampusLabelVisible(rect(1100, 300, 80, 20), canvas, openPanel), false);
});

test("a label whose centre is left of the panel edge stays visible", () => {
  assert.equal(isCampusLabelVisible(rect(950, 300, 80, 20), canvas, openPanel), true);
});

test("a label whose centre is under the panel is hidden even though its left edge shows", () => {
  assert.equal(isCampusLabelVisible(rect(980, 300, 80, 20), canvas, openPanel), false);
});

test("a label outside the canvas is hidden", () => {
  assert.equal(isCampusLabelVisible(rect(1460, 300, 80, 20), canvas, null), false);
  assert.equal(isCampusLabelVisible(rect(-120, 300, 80, 20), canvas, null), false);
  assert.equal(isCampusLabelVisible(rect(300, 920, 80, 20), canvas, null), false);
});

test("a label hanging over the canvas edge with its centre inside stays visible", () => {
  assert.equal(isCampusLabelVisible(rect(1380, 300, 80, 20), canvas, null), true);
});

test("an open panel that spans a phone screen hides every label", () => {
  const phone = rect(0, 0, 390, 844);
  assert.equal(isCampusLabelVisible(rect(100, 300, 80, 20), phone, rect(0, 0, 390, 844)), false);
});

test("a closed panel parked off to the right hides nothing", () => {
  assert.equal(isCampusLabelVisible(rect(1300, 300, 80, 20), canvas, closedPanel), true);
});

test("a label with no size, as drei leaves one behind the camera, is hidden", () => {
  assert.equal(isCampusLabelVisible(rect(100, 100, 0, 0), canvas, null), false);
});

// 1440 x 900, 카메라 [0,120,420], 패널 닫힘. 변경 전 화면에서 잰 라벨 사각형 (left, top, right, bottom).
const DESKTOP_LABELS = [
  ["사범대학 3호관", 427.7, 334.7, 494.6, 353.7],
  ["학생회관", 632.5, 337.6, 678.4, 356.7],
  ["학생생활관 부속동", 730.7, 398.5, 805.7, 417.6],
  ["실습관", 629.2, 287.7, 668.3, 306.8],
  ["도서관", 584.7, 311.3, 623.8, 330.4],
  ["학생생활관", 714.6, 437.2, 767.4, 456.3],
  ["사범대학 1호관", 476.8, 318.9, 543.6, 338],
  ["공과대학 1호관", 456.2, 296.9, 523.1, 316],
  ["창업보육센터", 556.6, 297, 616.1, 316.1],
  ["산학협력관", 976, 295.4, 1028.8, 314.5],
  ["박물관", 1021.7, 339.6, 1060.9, 358.7],
  ["우정원", 1305.8, 423.1, 1344.9, 442.2],
  ["공과대학 3호관", 280.7, 267.1, 347.6, 286.1],
  ["인문예술대학", 291, 300.4, 350.5, 319.5],
  ["공과대학 2호관", 369, 300.4, 435.8, 319.5],
  ["미래창조관", 461.8, 377.6, 514.6, 396.7],
  ["인재관", 611.5, 422.2, 650.7, 441.3],
  ["사회과학대학", 298.3, 348, 357.9, 367.1],
  ["생명산업과학대학 2호관", 789.4, 322.7, 883.5, 341.8],
  ["대학본부", 802.4, 338.4, 848.4, 357.5],
  ["생명산업과학대학 1호관", 876.2, 317.2, 970.3, 336.3],
  ["학생생활관", 847.8, 397, 900.6, 416],
  ["학생생활관", 827.5, 435.4, 880.2, 454.5],
  ["생명산업과학대학 온실", 799.2, 331.9, 887.9, 351],
  ["학생생활관", 900.4, 424.7, 953.2, 443.8],
  ["70주년기념관", 906.3, 337.5, 970, 356.5],
  ["학생생활관", 994, 410.1, 1046.8, 429.2],
];
const DESKTOP_AREA = { left: 0, top: 0, right: 1440, bottom: 900 };

// 390 x 844, 카메라 [0,120,420], 패널 닫힘. 변경 전 화면에서 잰 라벨 사각형 (left, top, right, bottom).
const PHONE_LABELS = [
  ["사범대학 3호관", -81.2, 312.4, -14.3, 331.5],
  ["학생회관", 111.5, 315.2, 157.4, 334.3],
  ["학생생활관 부속동", 202.7, 372.3, 277.7, 391.4],
  ["실습관", 108.6, 268.3, 147.8, 287.4],
  ["도서관", 66.9, 290.5, 106, 309.6],
  ["학생생활관", 188.3, 408.6, 241.1, 427.7],
  ["사범대학 1호관", -35.2, 297.6, 31.7, 316.7],
  ["공과대학 1호관", -54.5, 277, 12.4, 296.1],
  ["창업보육센터", 39.9, 277.1, 99.5, 296.2],
  ["산학협력관", 433.5, 275.6, 486.2, 294.7],
  ["박물관", 476.8, 317, 515.9, 336.1],
  ["우정원", 743.1, 395.3, 782.3, 414.4],
  ["공과대학 3호관", -219, 249, -152.2, 268.1],
  ["인문예술대학", -209.2, 280.3, -149.6, 299.4],
  ["공과대학 2호관", -136.2, 280.3, -69.4, 299.4],
  ["미래창조관", -48.7, 352.6, 4, 371.7],
  ["인재관", 92, 394.5, 131.2, 413.5],
  ["사회과학대학", -202.3, 324.9, -142.7, 344],
  ["생명산업과학대학 2호관", 257.1, 301.2, 351.2, 320.3],
  ["대학본부", 270.9, 315.9, 316.8, 335],
  ["생명산업과학대학 1호관", 338.6, 296.1, 432.6, 315.1],
  ["학생생활관", 313.2, 370.8, 366, 389.9],
  ["학생생활관", 294.1, 406.9, 346.9, 425.9],
  ["생명산업과학대학 온실", 266.5, 309.8, 355.2, 328.9],
  ["학생생활관", 362.6, 396.9, 415.4, 415.9],
  ["70주년기념관", 367.8, 315, 431.4, 334.1],
  ["학생생활관", 450.3, 383.2, 503.1, 402.3],
];
const PHONE_AREA = { left: 0, top: 0, right: 390, bottom: 844 };

// 화면 아래쪽 라벨이 카메라에 더 가깝다(비스듬한 시점). 이름이 같은 라벨이 있어 id는 순번으로 붙인다.
const toLabels = (rows, area) =>
  rows.map(([name, left, top, right, bottom], index) => ({
    id: `${index}:${name}`,
    rect: { left, top, right, bottom },
    selected: false,
    hasPopup: true,
    distance: area.bottom - bottom,
  }));

function overlappingPairs(labels, visible) {
  const shown = labels.filter((label) => visible.has(label.id));
  const pairs = [];
  for (let i = 0; i < shown.length; i += 1) {
    for (let j = i + 1; j < shown.length; j += 1) {
      if (campusLabelRectsOverlap(shown[i].rect, shown[j].rect)) pairs.push([shown[i].id, shown[j].id]);
    }
  }
  return pairs;
}

for (const [name, rows, area, pairsBefore] of [
  ["1440 x 900", DESKTOP_LABELS, DESKTOP_AREA, 7],
  ["390 x 844", PHONE_LABELS, PHONE_AREA, 6],
]) {
  test(`at ${name} the greedy pass leaves no visible labels overlapping`, () => {
    const labels = toLabels(rows, area);
    const onScreen = labels.filter((label) => isCampusLabelVisible(label.rect, area));
    assert.equal(overlappingPairs(labels, new Set(onScreen.map((label) => label.id))).length, pairsBefore);

    const visible = selectVisibleCampusLabels(labels, area);
    assert.deepEqual(overlappingPairs(labels, visible), []);
    // 겹치지 않는 라벨은 하나도 잃지 않는다: 숨긴 라벨마다 남은 라벨과 겹치는 게 있다.
    for (const label of onScreen) {
      if (visible.has(label.id)) continue;
      assert.ok(
        labels.some((other) => visible.has(other.id) && campusLabelRectsOverlap(other.rect, label.rect)),
        label.id,
      );
    }
  });
}

test("edges that only touch do not count as overlap", () => {
  assert.equal(campusLabelRectsOverlap(rect(0, 0, 10, 10), rect(10, 0, 10, 10)), false);
  assert.equal(campusLabelRectsOverlap(rect(0, 0, 10, 10), rect(9, 9, 10, 10)), true);
});

test("the selected label wins over a closer label with popup data", () => {
  const labels = [
    { id: "near", rect: rect(100, 100, 80, 20), selected: false, hasPopup: true, distance: 10 },
    { id: "chosen", rect: rect(120, 105, 80, 20), selected: true, hasPopup: false, distance: 300 },
  ];
  assert.deepEqual([...selectVisibleCampusLabels(labels, canvas)], ["chosen"]);
});

test("a label with popup data wins over a closer label without it", () => {
  const labels = [
    { id: "near", rect: rect(100, 100, 80, 20), selected: false, hasPopup: false, distance: 10 },
    { id: "popup", rect: rect(120, 105, 80, 20), selected: false, hasPopup: true, distance: 300 },
  ];
  assert.deepEqual([...selectVisibleCampusLabels(labels, canvas)], ["popup"]);
});

test("between equal labels the closer one stays", () => {
  const labels = [
    { id: "far", rect: rect(100, 100, 80, 20), selected: false, hasPopup: true, distance: 300 },
    { id: "near", rect: rect(120, 105, 80, 20), selected: false, hasPopup: true, distance: 10 },
  ];
  assert.deepEqual([...selectVisibleCampusLabels(labels, canvas)], ["near"]);
});

test("a label hidden by the panel does not push an overlapping label off screen", () => {
  const labels = [
    { id: "under-panel", rect: rect(990, 300, 80, 20), selected: true, hasPopup: true, distance: 1 },
    { id: "beside", rect: rect(940, 305, 80, 20), selected: false, hasPopup: true, distance: 50 },
  ];
  assert.deepEqual([...selectVisibleCampusLabels(labels, canvas, openPanel)], ["beside"]);
});
