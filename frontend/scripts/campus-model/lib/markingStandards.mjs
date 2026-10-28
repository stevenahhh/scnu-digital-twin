// Standard road-marking templates (Korean statute and police manuals): one entry per marking the campus paints, with the
// dimensions every drawn instance must have and the page each value is read from. stages/markingsStandard.mjs places
// instances of these templates; scripts/qa/markings-audit.mjs checks every marking in the built GLB against them.
//
// Documents (copies and page renders under .omo/ulw-research/20261025-091647/final/markings-r6/standards/):
//   M19  경찰청 교통노면표시 설치·관리 매뉴얼, 2019.3 (PDF page = printed page + 16)
//        (H24: PDF page = printed page + 6)
//   H24  2024 교통노면표시 설치·관리 업무편람 (itskorea.kr FILE_000000000103037)
//   H23  2023 교통노면표시 설치·관리 업무편람 (itskorea.kr FILE_000000000079179)
//   B6   도로교통법 시행규칙 별표 6 (law.go.kr text download, version effective 2027-01-01): the 노면표시 table; its
//        drawings are images the text download does not carry
//   PK   주차장법 시행규칙 제3조 (주차단위구획: 일반형 2.5 x 5.0 m, 확장형 2.6 x 5.2 m, 장애인전용 3.3 x 5.0 m,
//        평행 2.0 x 6.0 m; white solid lines), cited by H24 p57 (PDF p63) ("주차구획의 색상 및 설치 기준은 주차장법 제6조를 준용")
// Where a document gives a range, the value used is named and the range kept; where it gives no number (arrow and
// symbol drawings of B6 are images), the template says so in `estimated` and takes its size from the photo median
// recorded in `sizeSource`.

export const DOCUMENTS = Object.freeze({
  M19: "경찰청 교통노면표시 설치·관리 매뉴얼 (2019.3)",
  H24: "교통노면표시 설치·관리 업무편람 (2024)",
  H23: "교통노면표시 설치·관리 업무편람 (2023)",
  B6: "도로교통법 시행규칙 별표 6 (2027-01-01 시행본 텍스트)",
  PK: "주차장법 시행규칙 제3조 (주차단위구획)",
  DN: "origin/dev-next 37fd445 traced paint (carried over unchanged where no standard graphic is in the set)",
});

// Line widths and dash patterns: M19 표 2-1 (printed p15, PDF p31) = H24 표 2-1 (printed p11, PDF p17), 도시부 column.
const T21 = { doc: "M19", page: "p15 (PDF p31) 표 2-1; H24 p11 (PDF p17) 표 2-1" };

export const TEMPLATES = Object.freeze({
  // ---- lines (501, 503, 505, 516, 525, 530)
  centre_solid: { kind: "line", colour: "yellow", widthM: 0.15, range: "15~20 cm", source: T21, code: "501" },
  centre_double: { kind: "line", colour: "yellow", widthM: 0.15, gapM: 0.15, range: "너비 10~15 cm, 간격 10~15 cm", source: T21, code: "501" },
  centre_dashed: { kind: "line", colour: "yellow", widthM: 0.15, dashM: 3, gapM: 3, range: "L1 300 / L2 300 cm", source: T21, code: "501" },
  lane_solid: { kind: "line", colour: "white", widthM: 0.15, range: "10~15 cm", source: T21, code: "503" },
  lane_dashed: { kind: "line", colour: "white", widthM: 0.15, dashM: 3, gapM: 5, range: "도시부 L1 300 / L2 500 cm", source: T21, code: "503" },
  edge_line: { kind: "line", colour: "white", widthM: 0.15, range: "15~20 cm", source: T21, code: "505" },
  no_parking_line: { kind: "line", colour: "yellow", widthM: 0.15, range: "15~20 cm (길가장자리구역선 규격)", source: { doc: "H24", page: "p59 (PDF p65) 정차·주차금지(516); 표 2-1 길가장자리구역선 너비" }, code: "516" },
  guide_line: { kind: "line", colour: "white", widthM: 0.15, dashM: 0.5, gapM: 0.5, range: "L1 50~100 / L2 50~100, 너비 10~15 cm", source: T21, code: "525" },
  give_way_line: { kind: "line", colour: "white", widthM: 0.15, dashM: 0.5, gapM: 0.5, range: "유도선 규격 준용 (추정)", source: T21, code: "522", estimated: ["dash pattern: no own row in 표 2-1, guide-line values used"] },
  stop_line: { kind: "line", colour: "white", widthM: 0.4, range: "30~60 cm, 도심부 30~45 cm", source: { doc: "H24", page: "p73 (PDF p79) 정지선(530): 폭원은 30∼60㎝로, 도심부에서는 30∼45㎝" }, code: "530" },
  // ---- crossings (532) and hatching (531)
  crosswalk: {
    kind: "crosswalk", colour: "white", barM: 0.45, gapM: 0.45, lengthsM: [4, 6, 8], reducedLengthsM: [3],
    range: "L1 = S = 45~50 cm; 폭원 4 m 이상, 4 m 초과 시 2 m 단위 확폭; 부득이한 경우 다소 줄일 수 있다",
    source: { doc: "M19", page: "p100 (PDF p116) 그림 4-13; H24 p78 (PDF p84) 권장" }, code: "532",
  },
  safety_hatch: {
    kind: "hatch", colour: "yellow", outlineM: 0.15, stripeM: 0.45, pitchM: 1.35, angleDeg: 45,
    range: "l1 (빗금) 45~100 cm, l2 (테두리) 15~20 cm", source: { doc: "M19", page: "p73 (PDF p89) 그림 3-25" }, code: "531",
    estimated: ["stripe pitch 1.35 m (one stripe and two stripe widths of gap): the figure gives no pitch"],
  },
  safety_hatch_white: {
    kind: "hatch", colour: "white", outlineM: 0.15, stripeM: 0.45, pitchM: 1.35, angleDeg: 45,
    range: "as safety_hatch; white where it separates traffic of one direction", source: { doc: "M19", page: "p73 (PDF p89) 그림 3-25; H24 안전지대(531) 색: 흰색 (같은 방향)" }, code: "531",
    estimated: ["stripe pitch as safety_hatch"],
  },
  // ---- parking (523, PK)
  stall_normal: { kind: "stall", colour: "white", widthM: 2.5, depthM: 5.0, lineM: 0.15, source: { doc: "PK", page: "제3조 제1항 (일반형 2.5 x 5.0 m); M19 p80 (PDF p96) 직각주차 선폭 15~20 cm" }, code: "523" },
  stall_expanded: { kind: "stall", colour: "white", widthM: 2.6, depthM: 5.2, lineM: 0.15, source: { doc: "PK", page: "제3조 제1항 (확장형 2.6 x 5.2 m); M19 p80 (PDF p96) 선폭 15~20 cm" }, code: "523" },
  // 경사주차 (523): the general stall (2.5 x 5.0 m, 0.15 m white lines) set at the 주차형식 angle of the row, 45 or 60 deg
  // to the aisle, the angle fitted from the photo dividers
  stall_angled_45: { kind: "stall", colour: "white", widthM: 2.5, depthM: 5.0, lineM: 0.15, angleDeg: 45, source: { doc: "M19", page: "p81 (PDF p97) 경사주차 그림 4-3: 백색실선 15~20 cm, 세로 500 cm; PK 제3조 제1항 일반형 2.5 x 5.0 m; PK 제6조 제1항 주차형식 45도 대향주차" }, code: "523" },
  stall_angled_60: { kind: "stall", colour: "white", widthM: 2.5, depthM: 5.0, lineM: 0.15, angleDeg: 60, source: { doc: "M19", page: "p81 (PDF p97) 경사주차 그림 4-3: 백색실선 15~20 cm, 세로 500 cm; PK 제3조 제1항 일반형 2.5 x 5.0 m; PK 제6조 제1항 주차형식 60도 대향주차" }, code: "523" },
  // carried over unchanged from dev-next 37fd445 where no standard graphic is in the standards set: the striped hump
  // bands (국토교통부 과속방지턱 지침 not in standards/; M19 p114 (PDF p130) 그림 4-22 오르막경사면(544) is white triangles
  // on the slope, not the photo's yellow and white stripes)
  legacy_preserved: { kind: "legacy", colour: null, source: { doc: "DN", page: "frontend/public/campus-v2.glb at 37fd445, traced paint geometry unchanged (evidence id = trace id)" }, code: "-" },
  stall_accessible: {
    kind: "stall", colour: "white", widthM: 3.3, depthM: 5.0, lineM: 0.15, symbol: { colour: "blue", squareM: 1.6, wheelchairM: 1.3 },
    source: { doc: "PK", page: "제3조 제1항 (장애인전용 3.3 x 5.0 m); 장애인등편의법 시행규칙 별표 1 (바닥 표시)" }, code: "523",
    estimated: ["symbol square 1.6 m and wheelchair 1.3 m (ISO 7001 figure): sizes 추정"],
  },
  stall_parallel: { kind: "stall", colour: "white", widthM: 6.0, depthM: 2.0, lineM: 0.15, source: { doc: "PK", page: "제3조 제1항 (평행주차형 2.0 x 6.0 m)" }, code: "523" },
  bus_stop_box: {
    kind: "glyph", colour: "light_blue", lengthM: 12, widthM: 3, lineM: 0.15, source: { doc: "H24", page: "버스정차구획(523의2)" }, code: "523의2",
    estimated: ["read in the VR tour only (the photo predates it): box 12 x 3 m with two chevrons, 추정"],
  },
  // ---- symbols and text (529, 537-541, B6 문자)
  arrow_straight: { kind: "glyph", colour: "white", lengthM: 5.0, lengthsM: [5.0, 2.0], source: { doc: "M19", page: "p111 (PDF p127) 그림 4-19 (shape); B6 537" }, code: "537", estimated: ["B6 drawings are images: proportions of lib/markingGlyphs.mjs; lengths 5.0 m (road) and 2.0 m (lot and ramp arrows) = the medians of the two size groups of the photo arrows (4.7 m, 1.9 m)"] },
  arrow_left: { kind: "glyph", colour: "white", lengthM: 5.0, lengthsM: [5.0, 2.0], source: { doc: "M19", page: "p111 (PDF p127) 그림 4-19; B6 539" }, code: "539", estimated: ["as arrow_straight"] },
  arrow_right: { kind: "glyph", colour: "white", lengthM: 5.0, lengthsM: [5.0, 2.0], source: { doc: "M19", page: "p111 (PDF p127) 그림 4-19; B6 540" }, code: "540", estimated: ["as arrow_straight"] },
  arrow_straight_left: { kind: "glyph", colour: "white", lengthM: 5.0, lengthsM: [5.0, 2.0], source: { doc: "M19", page: "p111 (PDF p127) 그림 4-19; B6 538" }, code: "538", estimated: ["as arrow_straight"] },
  arrow_straight_right: { kind: "glyph", colour: "white", lengthM: 5.0, lengthsM: [5.0, 2.0], source: { doc: "M19", page: "p111 (PDF p127) 그림 4-19; B6 538의2" }, code: "538의2", estimated: ["as arrow_straight"] },
  arrow_uturn: { kind: "glyph", colour: "white", lengthM: 5.0, lengthsM: [5.0, 2.0], source: { doc: "M19", page: "p111 (PDF p127); B6 541" }, code: "541", estimated: ["as arrow_straight"] },
  crossing_ahead_diamond: { kind: "glyph", colour: "white", lengthM: 3.0, widthM: 1.5, lineM: 0.2, source: { doc: "B6", page: "529 횡단보도예고" }, code: "529", estimated: ["B6 drawing is an image: 3.0 x 1.5 m, 0.2 m line 추정"] },
  give_way_triangle: { kind: "glyph", colour: "white", lengthM: 3.0, widthM: 1.5, lineM: 0.2, source: { doc: "H24", page: "p55 (PDF p61) 양보(522)" }, code: "522", estimated: ["drawing is an image: 3.0 x 1.5 m, 0.2 m line 추정"] },
  give_way_triangle_yellow: { kind: "glyph", colour: "yellow", lengthM: 3.0, widthM: 1.5, lineM: 0.2, source: { doc: "H24", page: "p55 (PDF p61) 양보(522)" }, code: "522", estimated: ["yellow where the photo shows it (campus junction island)", "drawing is an image: 3.0 x 1.5 m, 0.2 m line 추정"] },
  chevron: { kind: "glyph", colour: "white", lengthM: 1.5, widthM: 3.0, lineM: 0.45, source: { doc: "H24", page: "p66 (PDF p72) 갈매기표지: 끝단 각도 45°, 도색 폭 45~50 cm" }, code: "526", estimated: ["arm span 3.0 m, depth 1.5 m 추정"] },
  chevron_yellow: { kind: "glyph", colour: "yellow", lengthM: 1.5, widthM: 3.0, lineM: 0.45, source: { doc: "H24", page: "p66 (PDF p72) 갈매기표지: 끝단 각도 45°, 도색 폭 45~50 cm" }, code: "526", estimated: ["yellow where the photo shows it: 도류화 between opposing traffic is yellow (H24 안전지대 색)", "arm span 3.0 m, depth 1.5 m 추정"] },
  road_text: {
    kind: "text", colour: "white", charWidthM: 0.75, charHeightM: 2.0, scaleRange: [0.5, 2],
    letterform: "Wanted Sans (OFL, public/fonts) outlines condensed to the 그림 2-2 proportions",
    source: { doc: "H24", page: "p13 (PDF p19) 그림 2-2 한글과 숫자의 형태; p11 (PDF p17) 문자의 크기 0.5~2배" }, code: "문자",
    estimated: ["basic size 0.75 x 2.0 m per syllable: the base size is in the B6 drawing, not its text"],
  },
});

export const templateOf = (id) => {
  const t = TEMPLATES[id];
  if (!t) throw new Error(`no marking template ${id}`);
  return t;
};

// The crosswalk length (bar length along the walk direction is the 폭원) a measured one is drawn at: the nearest standard
// length, the reduced 3 m only where the photo shows less than 3.5 m.
export function crosswalkLength(measuredM) {
  const t = TEMPLATES.crosswalk;
  const options = measuredM < 3.5 ? t.reducedLengthsM : t.lengthsM;
  return options.reduce((a, b) => (Math.abs(b - measuredM) < Math.abs(a - measuredM) ? b : a));
}
