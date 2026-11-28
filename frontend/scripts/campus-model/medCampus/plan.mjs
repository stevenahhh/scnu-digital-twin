// Master plan of the planned 국립순천대 의과대학 campus on the city land near the Suncheon drama set
// (조례동 산 13-3 일원, 151,719 m2), as built by med-campus.mjs. Positions are local metres round the estimated site
// centre (+x east, +z south). Only the area, the address and the programme (medical school, 500-bed teaching
// hospital, research, dormitory, support) are reported; the outline, the centre and every building are a design
// estimate (추정) laid out from the cited planning rules below.
//
// Planning rules and their sources:
// - Site: 조례동 산 13-3 일원 옛 군부대 시유지 15만1719㎡, behind the drama set at 비례골 on the foot of 왕의산 (서울신문
//   2026-08-31 https://v.daum.net/v/1QLDUdYCWq?f=p; 헤럴드경제 2026-09-01 https://biz.heraldcorp.com/article/10858652).
// - Programme: 의학과·간호학과, 부속 종합병원 500병상급, 연구동·기숙사·지원시설, 왕의산 산책길 (헤럴드경제, above);
//   2030 first intake (https://www.korea.kr/news/policyNewsView.do?newsId=148974975).
// - Zoning: 자연녹지지역 building coverage <= 20 %, floor-area ratio 50-100 % (국토계획법 시행령 제84조·제85조,
//   https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1034736223; the site's actual zoning is not
//   published, so the strictest green-zone limits are kept).
// - Hospital typology: a tower-on-a-base (탑상형) hospital, bed wards stacked on a diagnostic and surgical podium
//   (https://www.koreascience.or.kr/article/JAKO202127137857420.pdf; Perkins Eastman PMU hospital: "the podium
//   represents the diagnostic, treatment, and support-services powerhouse. The tower accommodates inpatient care",
//   https://www.perkinseastman.com/projects/prince-mohammad-bin-fahd-university-hospital/).
// - Podium floor height: operating-theatre slab to slab at least 5.1 m (공공병원 건축설계 가이드라인 2023, p. 292,
//   https://www.ppm.or.kr/); emergency and helipad reach each other directly (same guideline).
// - Healing landscape: courtyards and green views from wards (Ulrich 1984, Science 224:420,
//   https://doi.org/10.1126/science.6143402); an academic green spine joining school, research and hospital with
//   sky bridges, and separate emergency, service and visitor roads (academic medical centre master planning, e.g.
//   https://masterplan.vcu.edu/academic-medical-center-campus-master-plan-update/).

export const SITE = Object.freeze({
  areaM2: 151719,
  address: "전남 순천시 조례동 산 13-3 일원",
  // Estimated centre: between the 왕지 district and the drama set (OSM way 469956208, 34.9568 N 127.5382 E), on the
  // foot of 왕의산; the parcel boundary is not published.
  centre: Object.freeze({ latitude: 34.9605, longitude: 127.5345 }),
  dramaSet: Object.freeze({ latitude: 34.95676, longitude: 127.53825, widthM: 280, depthM: 175 }),
});

// Floor-to-floor heights (m). podium: the guideline's surgical slab to slab; the others are common design values.
export const FLOOR_HEIGHT = Object.freeze({ podium: 5.1, ward: 4.2, school: 3.9, lab: 4.2, dorm: 3.1, commons: 4.5, parking: 3.3, plant: 5.5 });

// Unscaled outline of the parcel (estimated), scaled by siteRing() to the reported area.
const OUTLINE = [[-262, 190], [60, 200], [222, 170], [252, 40], [232, -125], [146, -192], [-40, -206], [-206, -176], [-272, -40]];

export function polygonArea(ring) {
  let sum = 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  });
  return Math.abs(sum) / 2;
}

export function siteRing() {
  const k = Math.sqrt(SITE.areaM2 / polygonArea(OUTLINE));
  return OUTLINE.map(([x, z]) => [x * k, z * k]);
}

export function pointInRing([x, z], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const rect = ([cx, cz], [w, d]) => [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];
const racetrackArea = ([w, d]) => (Math.max(w, d) - Math.min(w, d)) * Math.min(w, d) + Math.PI * (Math.min(w, d) / 2) ** 2;

function building(spec) {
  const footprint = rect(spec.centre, spec.size);
  const plateM2 = spec.shape === "racetrack" ? racetrackArea(spec.size) : spec.size[0] * spec.size[1];
  return Object.freeze({ baseM: 0, shape: "rect", ...spec, footprint, plateM2, heightM: (spec.baseM ?? 0) + spec.storeys * spec.floorM });
}

const PODIUM_STOREYS = 4;
export const BUILDINGS = Object.freeze([
  building({ id: "hospital-podium", name: "부속병원 진료부(저층부)", kind: "podium", centre: [-90, 40], size: [124, 80], storeys: PODIUM_STOREYS, floorM: FLOOR_HEIGHT.podium }),
  building({ id: "ward-west", name: "부속병원 병동(서)", kind: "bed-tower", shape: "racetrack", centre: [-122, 40], size: [24, 66], storeys: 10, floorM: FLOOR_HEIGHT.ward, baseM: PODIUM_STOREYS * FLOOR_HEIGHT.podium, bedsPerFloor: 26 }),
  building({ id: "ward-east", name: "부속병원 병동(동)", kind: "bed-tower", shape: "racetrack", centre: [-58, 40], size: [24, 66], storeys: 10, floorM: FLOOR_HEIGHT.ward, baseM: PODIUM_STOREYS * FLOOR_HEIGHT.podium, bedsPerFloor: 26, helipad: true, sign: "순천대학교병원" }),
  building({ id: "school-a", name: "의과대학 강의동", kind: "school", centre: [75, 30], size: [84, 22], storeys: 6, floorM: FLOOR_HEIGHT.school, sign: "국립순천대학교 의과대학" }),
  building({ id: "school-b", name: "의과대학 실습동", kind: "school", centre: [107, -16], size: [20, 70], storeys: 6, floorM: FLOOR_HEIGHT.school }),
  building({ id: "commons", name: "의학도서관·학생 커먼스", kind: "commons", centre: [18, -62], size: [46, 30], storeys: 3, floorM: FLOOR_HEIGHT.commons }),
  building({ id: "research", name: "의생명 연구동", kind: "lab", centre: [92, -96], size: [64, 24], storeys: 8, floorM: FLOOR_HEIGHT.lab }),
  building({ id: "dorm-1", name: "의대 기숙사 1동", kind: "dorm", centre: [-70, -100], size: [60, 16], storeys: 12, floorM: FLOOR_HEIGHT.dorm }),
  building({ id: "dorm-2", name: "의대 기숙사 2동", kind: "dorm", centre: [-70, -138], size: [60, 16], storeys: 12, floorM: FLOOR_HEIGHT.dorm }),
  building({ id: "parking", name: "주차빌딩", kind: "parking", centre: [-118, 140], size: [86, 46], storeys: 4, floorM: FLOOR_HEIGHT.parking }),
  building({ id: "energy", name: "에너지센터", kind: "plant", centre: [150, 118], size: [42, 28], storeys: 2, floorM: FLOOR_HEIGHT.plant }),
]);

// Ground coverage counts what stands on the ground; the wards stand on the podium.
export const coverage = () => BUILDINGS.filter((b) => b.baseM === 0).reduce((sum, b) => sum + b.plateM2, 0) / SITE.areaM2;
export const floorAreaRatio = () => BUILDINGS.reduce((sum, b) => sum + b.plateM2 * b.storeys, 0) / SITE.areaM2;

// Glazed sky bridges between buildings (plan end points, deck height above the ground).
export const BRIDGES = Object.freeze([
  { id: "podium-school", a: [-28, 30], b: [33, 30], baseM: 2 * FLOOR_HEIGHT.podium, widthM: 5, heightM: 4 },
  { id: "school-research", a: [107, -51], b: [107, -84], baseM: 2 * FLOOR_HEIGHT.school, widthM: 4, heightM: 3.6 },
  { id: "parking-podium", a: [-118, 117], b: [-118, 80], baseM: 2 * FLOOR_HEIGHT.parking, widthM: 4, heightM: 3.4 },
]);

// Roads (centre lines, width m): the visitor boulevard from the south, the campus ring road, the separate emergency
// access to the podium's west side and the service spur to the energy centre.
export const ROADS = Object.freeze([
  { id: "boulevard", widthM: 16, line: [[0, 215], [0, 112]] },
  { id: "ring", widthM: 9, closed: true, line: [[-182, 96], [-182, -60], [-128, -176], [60, -182], [176, -142], [200, 0], [192, 96], [120, 150], [0, 168], [-120, 176]] },
  { id: "emergency", widthM: 9, line: [[-182, 40], [-153, 40]] },
  { id: "service", widthM: 7, line: [[192, 96], [172, 118]] },
]);

// Landscape: the entrance plaza with its drop-off, the green academic spine and the healing garden by the wards.
export const PLAZAS = Object.freeze([
  { id: "entrance", kind: "paving", centre: [0, 110], radiusM: 26 },
]);
export const GREENS = Object.freeze([
  { id: "spine", ring: rect([12, 32], [44, 136]) },
  { id: "healing-garden", ring: rect([-90, 100], [70, 22]) },
  { id: "school-court", ring: rect([72, -12], [44, 40]) },
]);
