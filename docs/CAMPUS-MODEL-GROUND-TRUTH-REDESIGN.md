# 캠퍼스 모델 재설계: 단일 기준 프레임과 파라메트릭 지면·입면

작성 2026-11-02. 대상: `frontend/scripts/campus-model/` 생성기와 그 입력 데이터.
상태: 2026-11-02에 작성한 설계안이다. PR #124(feature/gt-w0-frame)부터 PR #136(feature/gt-w7-f3-paint)까지의 PR로 구현했다.

## 0. 왜 다시 설계하는가

E3(사범대학 1호관) 앞을 NGII 2025 정사영상 위에 생성기 입력 벡터로 겹쳐 본 결과(`/tmp/e3-overlay.png`):

- 건물(BLD_E3)은 GIS 지적 발자국과 0.3 m 안에서 맞는다.
- 그 앞의 주차열 디바이더는 사진에 열 칸이 선명한데 모델에는 하나도 없다. 건물 그림자 때문에 페인트
  게이트(지지율 0.6)를 못 넘겼고 "열은 만들지 않는다" 규칙이 빈자리를 그대로 두었다.
- 파란 장애인 구역 셋은 손트레이스라 살아남아 혼자 떠 있고, 규칙화 단계가 사진에 없는 빗금 aisle을 덧붙였다.
- 출입구 캐노피 둘(`SD-E5-C1/C2`)은 VR 파노라마에서 눈대중으로 찍은 절대 좌표라 벽에서 5 m 떨어진 주차장 위에
  비스듬히 놓였다. 기록은 E5 건물의 것인데 E3 앞에 있다.
- 휠스톱 열(`SD-E3-W1`)은 방위 319°로 주차열을 가로지른다. 생울타리는 2~4 m씩 어긋난다.

즉 투영이 틀린 것이 아니라 **입력 데이터와 규칙**이 틀렸다. 지금 파이프라인은

1. 25 cm 항공사진의 픽셀 검출 조각을 기하의 원천으로 삼고,
2. VR 파노라마 눈대중을 절대 좌표로 기록하고,
3. 건물·노면·소품·입면을 따로 만든 뒤 중앙값 오프셋과 보정표(`ground-registration.json`,
   `a003-registration.json`, `OSM_SHIFT_M`, 게이트 리뷰 177건)로 끼워 맞춘다.

이 세 가지를 바꾸는 설계다.

## 1. 목표, 비목표, 성공 기준

목표

- 캠퍼스 안의 모든 지상 요소가 **하나의 기준 프레임(EPSG:5186)** 위에서, **출처 등급이 명시된** 데이터로,
  **파라메트릭 기하**(열·피치·개수, 벽 기준 상대 위치, 베이 그리드)로 생성된다.
- 사진과 VR은 **증거**(존재 여부, 파라미터 추정, 검증)로만 쓰고 기하를 직접 그리지 않는다.
- 생성 결과를 **맵 공간에서 사진과 다시 비교**해 객체별 잔차(m)를 보고한다.

비목표

- 렌더링 품질(그림자, 재질, LOD)은 이 설계의 범위가 아니다. `docs/OPTIMIZATION-FORMULA.md`가 맡는다.
- 교통 시뮬레이션 로직 변경은 범위 밖이다. 좌표 계약만 다룬다(§12).
- VWorld 대시보드는 지오 좌표를 직접 쓰므로 영향이 없다.

성공 기준(수치, E3 파일럿 → 캠퍼스 전체)

| 항목 | 기준 | 측정 |
|---|---|---|
| 건물 위치 | GIS 지적 발자국과 동일 (정의상 0) | §10 빌드 검사 |
| 주차 디바이더 | 가림 마스크 밖 디바이더의 사진 페인트 지지율 중앙값 ≥ 0.7, 열 축 잔차 ≤ 0.3 m | §10 맵 비교 |
| 장애인 구역 | 열 멤버로 그려지고 사진 파란 영역과 IoU ≥ 0.6 | §10 |
| 캐노피·출입구 | 벽에 붙어 있고(t ≤ 0.3 m) VR 방위 잔차 ≤ 1.5° | §10 VR 비교 |
| 차선·중앙선 | 세그먼트 단위 존재 판정 정확도 ≥ 0.95, 횡 오프셋 잔차 ≤ 0.25 m | §10 |
| 발명 금지 | 사진·VR·기록 어디에도 없는 요소는 `estimated` 없이 생성되지 않음 | 스키마 검사 |
| 결정성 | 같은 입력 → 바이트 동일 GLB | 기존 테스트 |

## 2. 원칙

1. **출처 등급(Tier)을 데이터에 적는다.** 모든 레코드에 `evidence: { tier, refs[] }`.
   - T0 측량·지적: GIS건물통합정보 발자국, NGII A003 보도 경계(국소 오차 있음), 도로 구역(`road_zones`).
   - T1 정사영상 측정: NGII 2025 25 cm(월드파일), 단 §3의 가림 마스크 밖에서만.
   - T2 VR 파노라마 측정: 리섹션된 station에서 잰 **방위·베이 카운트·상대 위치**. 절대 좌표는 T2가 아니다.
   - T3 법규 기본값: 주차장법 시행규칙, 교통노면표시 업무편람, 장애인등편의법 시행규칙.
   - T4 추정: 위 어느 것도 없을 때. 반드시 `estimated: true`와 이유.
   OSM은 **토폴로지와 속성**(어디에 주차장이 있다, 이 길이 간선이다)에만 쓰고 기하로 쓰지 않는다.
2. **기하와 증거를 분리한다.** 그리는 것은 파라메트릭 레코드다. 사진 검출(`markings.geojson`)은
   파라미터 추정기의 입력과 QA의 비교 대상으로 강등한다.
3. **건물에 붙는 것은 건물 기준으로 적는다.** 캐노피·출입구·휠스톱·벽 앞 생울타리·간판은 `(building, wall, s, t)`.
   발자국이 바뀌면 같이 움직인다.
4. **보정은 패치 파일이 아니라 큐레이션 레코드로 한다.** fetch 결과는 seed다. 사람이 고친 값은 id로 병합되는
   큐레이션 파일에 산다. per-vertex 보정표는 없앤다.
5. **그려진 결과를 검증한다.** 검출 조각의 존재가 아니라 최종 기하를 사진·VR과 비교한다.

## 3. 기준 프레임 (Frame v2)

현재: `tmToScene = D4_SCENE + local(E,N) × 0.6242 − SOURCE_MODEL_OFFSET`, 그 위에 `stages/buildings.mjs`가
건물에만 `footprintShift`(중앙값)를 더 얹고, 면적이 15 % 넘게 다른 BLD 노드는 `uni.glb` 윤곽을 그대로 쓴다.

변경

- **변환은 `src/geo/epsg5186.mjs`의 `tmToScene` 하나.** `SOURCE_MODEL_OFFSET`은 장면 원점 규약(상수 강체 변환)으로
  남겨도 무해하므로 유지한다. 대신 **`footprintShift`를 삭제**하고, **`uni.glb` 윤곽 대체(keepOutline)를 삭제**한다.
  모든 건물은 GIS 지적 발자국으로 그린다. `BLD_D4`도 예외가 아니다.
- `uni.glb`의 역할을 둘로 좁힌다. (a) `BLD_*` 노드 id ↔ GIS 레코드 매핑 테이블(`data/bld-node-map.json`,
  1회 생성 후 큐레이션), (b) 캠퍼스 내부 지형 높이(`Topography` 래스터). (b)는 후속으로 NGII 5 m DEM 또는
  LOD4 지면 높이로 대체할 수 있도록 입력 인터페이스(`heightAt`)만 유지한다.
- `D4_SCENE`은 GIS D4 발자국 bbox 중심으로 **재계산해 상수로 기록**한다(현재 값과 수 m 차이). GLB `asset.extras`에
  `frameVersion: 2`, `anchor: { epsg5186: [E,N], scene: [x,z] }`를 쓴다.
- 시뮬레이션 프레임(`tmToSimulation`, D4 앵커 기준 m)은 그대로다. 네트워크(`campus_transport_network.geojson`,
  `roads.json`)는 재생성한다(§12).
- 검사: `src/campusModelAsset.test.mjs`의 "BLD_D4가 움직이지 않았다"를 "BLD_D4 bbox 중심 = GIS 발자국 중심(±0.05 m)"로
  바꾼다.

## 4. 참조 영상과 건물 기울어짐(lean)

NGII 2025 정사영상은 메타데이터상 `사용수치표고 DEM`이다. DSM이 아니므로 건물 지붕이 발자국에서 밀려 찍힌다(true-ortho가
아님). E3에서 지붕 가장자리와 GIS 발자국이 1.5~2 m 어긋난다. 이 밀림 아래의 지면과 건물 그림자는 사진에 없다.

설계

- **건물별 lean 벡터 측정** `fit/buildingLean.mjs`: GIS 발자국 각 변에 대해 사진에서 지붕 가장자리(밝기 경계)를
  변 법선 방향 ±4 m 안에서 찾고, 변별 오프셋의 중앙값을 lean 벡터 `v_b`로 기록한다(`data/photo/building-lean.json`,
  건물별 `{ dE, dN, n, mad }`). 캠퍼스 전체에서 `v_b`는 하나의 nadir 점에서 바깥을 향해야 한다. 그 일관성(각도 잔차)을
  리포트해 잘못 잡힌 건물을 걸러낸다.
- **가림 마스크** `lib/occlusion.mjs`: 발자국 ∪ 발자국을 `v_b`만큼 쓸어낸 평행 영역 ∪ 그림자 영역(태양 방위 92.5°,
  고도 62°, 건물 높이 h → 그림자 길이 0.53 h, 발자국을 그 방향으로 쓸어낸 영역) ∪ 수관(CHM ≥ 3 m). 마스크 안의 픽셀은
  "증거 없음"이다. **거부 근거로 쓰지 않는다.** 지지율은 마스크 밖 면적으로만 계산한다.
- **보조 영상**: VWorld z19는 같은 사진이므로 독립 증거가 아니다. 순천시 GIS 12 cm 항공사진(다른 시점·다른 lean)을
  교차 검증용 T1'로 등록한다. 등록은 §9의 출처별 단일 변환으로 한다.

## 5. 지면 구획(Ground parcels): 하나의 벡터 지도

현재는 주차장 면이 OSM `amenity=parking`과 MCEE 토지피복에서, 페인트가 사진에서 와서 잔디 위에 주차선이 뜬다.

`data/ground/parcels.json` (큐레이션, id 안정)

```jsonc
{
  "parcels": [
    {
      "id": "PARCEL_LOT_E3_S",             // 안정 id. fetch가 바뀌어도 유지
      "class": "lot",                      // road | lot | sidewalk | plaza | lawn | planter | court | track | water
      "ring": [[E, N], ...],               // EPSG:5186, 시계방향, 홀은 holes[]
      "holes": [],
      "surface": "asphalt",                // asphalt | pavers:<pattern id> | concrete | turf | soil | rubber
      "kerb": { "exposedM": 0.15, "edges": [0, 1, 2] },   // 연석이 서는 변
      "evidence": { "tier": "T0", "refs": ["A003 100034702020A00310100000000047532", "road_zones 사범대1로"] },
      "estimated": false
    }
  ]
}
```

- **생성(seed)**: `network/surfaces.mjs`가 지금 만드는 클래스 폴리곤을 그대로 seed로 내보내되(`parcels.seed.json`,
  gitignore), 큐레이션 파일에 같은 id가 있으면 큐레이션이 이긴다. 병합 규칙은 id 단위 교체, 삭제는 `"status": "removed"`.
- **우선순위**: A003 연석 > 도로 구역 > 사진에서 잰 연석(T1, 가림 밖) > OSM 폴리곤(위치 아닌 존재만) > MCEE.
- **제약**: 주차 디바이더는 `class ∈ {lot, road}` 안에서만, 보도 포장은 `sidewalk|plaza`에서만, 생울타리는 `planter|lawn`
  또는 벽 앵커로만. 위반은 빌드 에러로 해당 id를 나열한다.
- 기존 `ground-registration.json`, `a003-registration.json`은 폐지한다. 그 보정값은 해당 parcel의 ring을 직접 고친
  큐레이션 레코드로 옮긴다(1회 마이그레이션 스크립트).
- `stages/ground.mjs`, `stages/kerbs.mjs`, `stages/surfaces.mjs`의 입력을 `parcels.json`으로 통일한다. 파티션
  (`lib/partition.mjs`)은 그대로 쓴다.

## 6. 주차장 파라메트릭 모델 (가장 먼저)

### 6.1 스키마 `data/ground/parking.json`

```jsonc
{
  "lots": [
    {
      "id": "LOT_E3_S",
      "parcel": "PARCEL_LOT_E3_S",
      "rows": [
        {
          "id": "LOT_E3_S/R1",
          // 열의 뒷선(차 머리가 닿는 선). 절대 좌표이거나 벽 앵커(§7)
          "backLine": { "anchor": { "building": "BLD_SCNU_E3", "wall": "W03", "s0M": 2.0, "s1M": 32.0, "tM": 1.6 } },
          // 또는 "backLine": { "abs": [[E,N],[E,N]] }
          "side": -1,                    // 뒷선 법선 중 스톨이 뻗는 쪽 (+1 왼쪽, -1 오른쪽)
          "pitchM": 2.5,                 // 디바이더 간격. T1 추정 또는 T3 기본값
          "depthM": 5.0,
          "startOffsetM": 0.0,           // 첫 디바이더의 뒷선 시작점 기준 오프셋
          "count": 12,                   // 디바이더 수. null이면 floor((s1-s0-start)/pitch)+1
          "divider": { "style": "single", "widthM": 0.10, "colour": "white" },   // single | double | U | T
          "endCaps": true,
          "stalls": [                    // 예외 칸만 적는다. 나머지는 general
            { "index": 0, "kind": "accessible", "widthM": 3.3, "aisle": { "side": "start", "widthM": 1.2 }, "symbol": "wheelchair" },
            { "index": 11, "kind": "accessible", "widthM": 3.3, "aisle": null, "symbol": "wheelchair" }
          ],
          "wheelStops": { "offsetFromBackM": 0.7, "lengthM": 0.6, "colour": "#d9b43a", "every": 1 },
          "entryFrom": "aisle",          // 심볼·글자의 '위' 방향: aisle 쪽에서 진입하는 운전자 기준
          "evidence": {
            "tier": "T1",
            "refs": ["markings MX01676..MX01690 (detected dividers 7/12, rest under lean/shadow mask)", "VR scene_e3 r (wheel stops, 7 stalls visible)"],
            "photoSupport": 0.78
          },
          "estimated": false
        }
      ]
    }
  ]
}
```

- `kind` 폭과 길이의 T3 기본값: general 2.5 × 5.0, expanded 2.6 × 5.2, parallel 2.0 × 6.0(주차장법 시행규칙 제3조),
  accessible 3.3 × 5.0 또는 2.5 + aisle 1.2(장애인등편의법 시행규칙 별표 1). 레코드가 값을 주면 그 값이 이긴다.
- 장애인 구역은 **열의 멤버**다. 방향·위치가 열에서 따라 나오므로 비스듬히 홀로 놓일 수 없다. 파란 바닥·흰 테두리·
  휠체어 심볼은 `kind: accessible` 하나에서 생성한다. 빗금 aisle은 `aisle`이 있을 때만 그린다.
- 열 하나가 벽 앵커로 정의되면 휠스톱·디바이더 뒷선이 자동으로 벽과 평행해진다. `SD-E3-W1`처럼 방위를 따로 적지
  않는다.

### 6.2 추정기 `fit/parkingRows.mjs` (사진 → 열 가설)

입력: parcel(lot) ring, `markings.geojson`/`markings-extra.geojson`의 `parking_line`·`disabled_parking` 조각, 가림 마스크.
출력: `parking.proposals.json`(gitignore) + 칩 시트. 사람이 보고 `parking.json`에 옮긴다.

1. 조각을 지향 박스로 바꾸고 세장비 ≥ 8인 것만 디바이더 후보로 둔다(현 `stalls.mjs`와 같음).
2. 후보의 장축 각도를 히스토그램(2° 빈)으로 모아 주 방향 θ를 잡는다. θ에 수직인 축으로 후보 중심을 사영해 1차원 점열을
   만든다.
3. 점열의 자기상관으로 피치 p를 추정한다(탐색 2.0~6.5 m, 봉우리 0.05 m 분해능). 위상 φ는 점열을 p로 접어 원형 평균.
4. 뒷선: 디바이더의 뒷쪽 끝점(건물·연석에 가까운 쪽)들을 θ 방향 직선으로 Huber 적합. 깊이 d = 앞·뒷 끝점 중앙값 거리.
5. count: 뒷선 구간에서 p 간격으로 디바이더 위치를 놓고, 각 위치에서 **가림 밖** 사진 페인트 지지율을 잰다. 연속해서
   지지율이 0이고 가림 밖인 위치가 둘 이상 나오면 거기서 열을 끊는다(열 끝). 가림 안은 끊지 않는다.
6. 파란 조각이 있으면 가장 가까운 칸 index에 `accessible`을 제안하고, 파란 폭이 3.0 m 이상이면 폭 3.3, 아니면 2.5+aisle.
7. 제안마다 `photoSupport`(가림 밖 디바이더 지지율 중앙값)와 칩(사진 + 제안 오버레이)을 쓴다.

VR이 있는 열(`vr-stations.json`의 station이 20 m 안)은 §7.3의 방위 방법으로 뒷선의 벽 기준 `tM`과 보이는 칸 수를
교차 확인한다.

### 6.3 생성 `stages/parking.mjs`

- 뒷선 세그먼트를 해석(절대 또는 앵커)하고 `side` 법선 n, 축 a를 만든다.
- 디바이더 i: 중심 `P0 + a·(start + i·p)`에서 n 방향으로 길이 d, 폭 0.10의 사각형. `style`에 따라 U/T 꼬리 추가.
- `stalls[]` 예외 칸은 index 위치부터 폭을 바꿔 다음 디바이더를 밀어낸다(누적). accessible은 파란 채움(칸 안쪽 0.1 m 인셋),
  흰 테두리, 휠체어 템플릿(`lib/markingGlyphs.mjs`, 크기 1.2 m, 방향 `entryFrom`), aisle은 빗금 템플릿.
- 휠스톱: `Furniture` 메시에 칸마다 하나, 뒷선에서 `offsetFromBackM`.
- 출력은 기존 `Road_Markings` 메시 조각(`pieces`)으로 합류한다. 메시 이름·재질 계약은 그대로.
- 빌드 로그: lot별 열 수, 디바이더 수, 추정 칸 수, photoSupport. `parcels.json`에 없는 lot은 에러.

### 6.4 기존 코드의 운명

- `network/stalls.mjs`의 "빈칸 메우기"와 "열은 만들지 않는다"는 삭제. 과속방지턱 부분은 §8.2의 도로 단면으로 이동.
- `stages/markingsRegular.mjs`의 파란 구역 처리(1065행 aisle 자동 추가 포함)는 삭제. `parking_line`·`disabled_parking`
  종류는 더 이상 그리기 입력이 아니다.

## 7. 건물 앵커 좌표계 (wall-local)

### 7.1 벽 id

GIS 발자국 외곽 ring의 변 i를 `W%02d`로 번호 매긴다(시작 꼭짓점은 ring의 0번, 방향은 시계방향으로 정규화). 홀은
`H0/W%02d`. 변의 시작점 `A`, 끝점 `B`, 길이 L, 단위 접선 `a = (B−A)/L`, 바깥 법선 `n`. 발자국이 refetch로 바뀌면
`bld-node-map.json`의 벽 매핑 검사(변 길이·방위 ±0.5 m/±2°)가 실패하며 빌드가 멈춘다. 조용히 다른 벽에 붙지 않는다.

### 7.2 앵커 레코드

```jsonc
"anchor": { "building": "BLD_SCNU_E3", "wall": "W03", "sM": 14.2, "tM": 0.0, "yawDeg": 0 }
```

- 위치 = `A + a·s + n·t`. `yawDeg`는 벽 접선 기준 회전(기본 0 = 벽과 평행). 길이가 있는 요소는 `s0M/s1M`.
- `lib/anchors.mjs`: `resolveAnchor(record, footprints) → { origin:[E,N], a, n }`. 단위 테스트는 사각형 발자국에서
  네 벽 모두 검사.
- 적용 대상: 출입구와 캐노피(§7.4), 주차 뒷선(§6), 벽 앞 생울타리 띠와 화단(`planter` parcel 대신 벽 앵커 띠로),
  간판·현판, 외부 계단·경사로, 벽 붙은 벤치, 건물 옆 자전거 거치대, 에어컨 실외기 받침.
- 광장·잔디 소품(가로등, 벤치 열, 조형물)은 parcel 앵커 `{ parcel, uM, vM }`(parcel의 지향 박스 축 기준) 또는 절대
  좌표(T1, 가림 밖에서 사진에 보일 때만).

### 7.3 VR에서 s 읽기 (절대 좌표 대신 방위)

`scripts/perf/vr-stations.json`에 리섹션된 station 위치(`station_refined_x/z`, `yaw_refined_deg`)가 있다. 큐브 얼굴의
픽셀 열(col)은 방위로 바뀐다(`lib/vrCamera.mjs`). 그래서 VR에서 **직접 잴 수 있는 것은 방위**다.

`fit/vrWallHit.mjs`: `(scene, face, col) → bearing → station에서 그 방위로 광선 → 대상 건물 벽 평면과 교차 → (wall, s)`.
오차: 방위 0.5° × 거리 20 m ≈ 0.17 m, station 오차 ≈ 0.3 m → 합산 0.5 m급. 사진의 lean·그림자와 무관하다.
현재 `site-detail.geojson`의 "position from the station (about 3 m)" 220건을 이 방법으로 다시 읽는다. 레코드에는
`evidence.refs: ["VR scene_e3 r col 1210 → BLD_SCNU_E3/W03 s=14.2"]`처럼 측정 경로를 남긴다.

### 7.4 출입구 `data/buildings/entrances.json`

```jsonc
{
  "BLD_SCNU_E3": [
    {
      "id": "E3/ENT1",
      "anchor": { "wall": "W03", "sM": 14.2 },
      "widthM": 3.6, "type": "main",             // main | side | service | stair
      "doors": { "leaves": 2, "glazed": true, "frame": "#ef6a22" },
      "steps": { "risers": 3, "treadM": 0.3, "widthM": 5.0 },
      "canopy": { "form": "cantilever", "depthM": 3.0, "widthM": 6.0, "heightM": 4.4, "thicknessM": 0.25, "colour": "#ef6a22", "posts": [] },
      "evidence": { "tier": "T2", "refs": ["VR scene_e3 r cols 380-840 → W03 s 12.0-17.0"] },
      "estimated": true
    }
  ]
}
```

캐노피는 출입구의 속성이다. 출입구가 없는 캐노피는 스키마 위반. `site-detail.geojson`의 `entrance_canopy` 8건은 여기로
옮긴다. 입면(§8)의 `door` 셀도 이 파일에서 나온다. 하나의 출입구가 캐노피·문·계단·입면 셀을 모두 정한다.

### 7.5 scene ↔ 건물 매핑 정리

`E5` 캐노피가 `E3` 앞에 있는 문제는 이름으로 매핑해서 생겼다. 규칙: VR scene이 가리키는 건물은 **리섹션된 station
위치에서 해당 얼굴 방위로 쏜 광선이 처음 맞는 GIS 발자국**이다. `fit/vrSceneBuildings.mjs`가 scene·face별 피격 건물
표를 만들고, `scnu-facades.json`·`entrances.json`·`parking.json`의 `refs`에 적힌 scene이 그 표와 다르면 빌드가 경고한다.

## 8. 노면표시: 도로망 파생 모델

### 8.1 도로 단면 `data/ground/road-sections.json`

`roads.json`의 세그먼트(간선·연결로 `RD_*`)마다 단면을 적는다. 구간이 달라지면 세그먼트를 `splitAtM`으로 나눈다.

```jsonc
{
  "RD_014": {
    "sections": [
      {
        "fromM": 0, "toM": 86.5,
        "lanes": [{ "dir": "fwd", "widthM": 3.25 }, { "dir": "bwd", "widthM": 3.25 }],
        "centre": { "type": "yellow_solid", "widthM": 0.15 },      // none | yellow_solid | yellow_double | yellow_dashed
        "edges": { "left": "white_solid", "right": "none" },
        "lateralOffsetM": -0.3,                                     // 중심선이 기하 중심에서 벗어난 양(T1 측정)
        "kerbNoParking": { "left": false, "right": true },         // 노란 연석선
        "humps": [{ "atM": 41.2, "lengthM": 3.6, "heightM": 0.10, "bands": true }],
        "evidence": { "tier": "T1", "refs": ["markings MX0022x centre fragments 9/11 on paint"], "photoSupport": 0.82 }
      }
    ]
  }
}
```

노드(교차로)마다 `data/ground/junctions.json`: 접근로별 정지선 위치(`stopLineSetbackM`), 화살표(`arrows: ["straight","left"]`,
칸 위치는 정지선에서 `atM`), 노면 글자(`text: ["천천히"]`), 횡단보도(`crossing: { widthM: 4.57, offsetM, zebraPeriodM: 0.903 }`),
양보 삼각형, 유도선.

### 8.2 생성 `stages/roadMarkings.mjs`

- 세그먼트 중심선(`roads.json`, 시뮬레이션 프레임 → 5186)을 `lateralOffsetM`만큼 평행 이동한 곡선을 기준으로
  중앙선·차선·가장자리선을 오프셋 곡선으로 그린다. 대시는 법규 주기(3/5, 3/3)로 `fromM`부터 위상 0, 또는 레코드의
  `dashPhaseM`.
- 교차로 접근로: 정지선은 접근 차로 폭 전체, 횡단보도는 `crossing` 사각형 안에 0.903 m 주기 0.5 m 막대. 화살표·글자는
  `lib/markingGlyphs.mjs` 템플릿을 차로 중심에 `atM`으로 놓는다.
- 과속방지턱은 단면의 `humps`에서 생성(지면 높이 함수 포함, 현 `humpProfile` 재사용).
- 출력은 `Road_Markings` 메시 조각으로 합류.

### 8.3 추정기 `fit/roadSections.mjs`

세그먼트마다 사진 검출 조각을 종류별로 모아 (a) 존재 판정: 가림 밖 길이의 60 % 이상이 노란 페인트면 `centre: yellow_*`,
이중선은 1 m 폭 프로파일의 봉우리 둘; (b) 횡 오프셋: 노란 조각 중심의 중심선 기준 부호 거리 중앙값; (c) 화살표·글자는
blob 중심의 along-lane 좌표. 제안 파일과 칩 시트를 쓰고 사람이 확정한다. VR이 사진보다 새 페인트를 보여주는 곳
(`markings-vr.json`)은 T2로 기록.

### 8.4 기존 데이터의 운명

`markings.geojson`, `markings-extra.geojson`, `markings-gate.json`은 `data/photo/evidence/`로 옮기고 추정기와 QA만
읽는다. `stages/markings.mjs`의 게이트·중복 제거·맥락 규칙은 추정기의 지지율 계산 함수로만 남긴다.

## 9. 등록(registration) 정책

- 출처별 **단일 변환**과 **잔차표** `data/registration.json`:

  | 출처 | 변환 | 잔차(사진 대비, 가림 밖) | 비고 |
  |---|---|---|---|
  | GIS 발자국 | 항등(5186) | 측정하지 않음(기준) | lean 때문에 사진과 비교 불가 |
  | NGII A003 | 항등 | 연석 중앙값 dE/dN, MAD | 국소 오차는 parcel 큐레이션으로 |
  | NGII 2025 사진 | 월드파일 | 0 | 정의상 T1 기준 |
  | 순천시 12 cm 항공 | 측정한 유사변환 | GCP 잔차 | 교차 검증 전용 |
  | OSM | 없음 | 기록만 | 기하로 쓰지 않음 |
  | VR station | 리섹션 결과 | 제어점 잔차 | `vr-stations.json` 유지 |

- per-vertex 보정 파일 폐지(§5). `OSM_SHIFT_M`, 반픽셀 보정 상수, 템플릿 매칭 이동값은 모두 삭제한다. 정문 횡단보도처럼
  "다른 곳의 기하를 옮겨 붙인" 레코드는 §8.1 교차로 레코드로 직접 적는다.

## 10. 검증(QA) 설계

### 10.1 맵 공간 비교 `qa/mapCompare.mjs`

1. 생성된 GLB를 헤드리스로 **정사 투영 top-down 0.1 m/px**로 렌더한다. 조명 없음, 클래스별 플랫 컬러(머티리얼 id → 색).
   `Road_Markings`는 흰/노랑/파랑 그대로.
2. 사진에서 페인트 마스크(흰·노랑·파랑 top-hat, 현 `bake/markings-gate.mjs` 방법)와 가림 마스크를 만든다.
3. 객체별 비교(레코드 id 단위로 렌더 마스크를 분리하기 위해 두 번째 렌더에서 id를 색으로 인코딩):
   - 디바이더·선: 렌더 중심선과 사진 페인트 능선의 수직 거리 중앙값(m), 지지율(가림 밖).
   - 파란 구역·횡단보도·빗금: IoU.
   - 캐노피·소품: 사진에서는 lean 때문에 검증하지 않고 VR(§10.2)로.
4. 리포트 `qa/report/map-compare.json` + 객체별 칩(사진 | 렌더 | 겹침). 허용치를 넘는 객체는 빌드 경고(에러는 아님: 사진이
   틀릴 수 있다). 허용치 표:

   | 클래스 | 잔차 허용 | 지지율/IoU 허용 |
   |---|---|---|
   | 주차 디바이더 | 0.30 m | 0.5(가림 밖) |
   | 중앙선·차선 | 0.25 m | 0.6 |
   | 횡단보도 막대 | 0.20 m | IoU 0.6 |
   | 파란 구역 | - | IoU 0.6 |
   | 연석(parcel 경계) | 0.30 m | - |

### 10.2 VR 비교 확장 `scripts/perf/compare-vr.mjs`

이미 station별로 렌더와 VR 얼굴을 나란히 놓는다. 추가: 레코드 `evidence.refs`에 적힌 `(scene, face, col)`마다 렌더에서
같은 객체(id 색 인코딩)의 중심 col을 찾아 **방위 잔차(°)**를 계산한다. 허용 1.5°. 이것이 캐노피·출입구·간판·휠스톱의
위치 검증이다.

### 10.3 빌드 시 불변 검사(에러)

- 모든 BLD 노드 bbox 중심 = GIS 발자국 중심 ±0.05 m.
- 모든 앵커가 해석된다(벽 id 존재, s ∈ [0, L]).
- 페인트는 허용 parcel class 위에만 있다.
- `estimated: false`인 레코드는 T0~T2 ref가 하나 이상 있다.
- 결정성: 두 번 빌드해 해시 동일.

### 10.4 테스트

- 스키마 검사(`lib/schemas.mjs` + 각 `*.test.mjs`): 필수 필드, 등급, 참조 무결성.
- `lib/anchors.test.mjs`: 사각형·L자 발자국에서 네 벽 해석, refetch로 변이 바뀌면 실패.
- `fit/parkingRows.test.mjs`: 합성 디바이더 점열(결측 30 %, 잡음 0.1 m)에서 피치·위상·count 복원.
- `stages/parking.test.mjs`: accessible 칸 삽입 시 누적 밀림, aisle 유무, 심볼 방향.
- `stages/roadMarkings.test.mjs`: 대시 위상, 이중선 간격, 정지선 폭.
- 기존 `campusModelAsset.test.mjs`를 Frame v2 기준으로 갱신.

## 11. 파일·모듈 변경표

신규

| 경로 | 역할 |
|---|---|
| `data/bld-node-map.json` | `BLD_*` 노드 ↔ GIS 레코드 ↔ 벽 id 검증값 |
| `data/ground/parcels.json` | 지면 구획 큐레이션(§5) |
| `data/ground/parking.json` | 주차장 파라메트릭(§6) |
| `data/ground/road-sections.json`, `junctions.json` | 도로 단면·교차로(§8) |
| `data/buildings/entrances.json` | 출입구·캐노피(§7.4) |
| `data/buildings/facades/*.json` | 입면 셀 그리드(§13) |
| `data/photo/building-lean.json` | 건물별 lean 벡터(§4) |
| `data/registration.json` | 출처별 변환·잔차(§9) |
| `lib/anchors.mjs`, `lib/occlusion.mjs`, `lib/schemas.mjs` | 앵커 해석, 가림 마스크, 스키마 |
| `fit/buildingLean.mjs`, `fit/parkingRows.mjs`, `fit/roadSections.mjs`, `fit/vrWallHit.mjs`, `fit/vrSceneBuildings.mjs` | 추정기(제안 파일 생성) |
| `stages/parking.mjs`, `stages/roadMarkings.mjs`, `stages/entrances.mjs` | 생성 |
| `qa/mapCompare.mjs` | 맵 공간 비교(§10.1) |

변경

| 경로 | 변경 |
|---|---|
| `src/geo/epsg5186.mjs` | `D4_SCENE` 재계산, `frameVersion` 상수 |
| `stages/buildings.mjs` | `footprintShift`·`keepOutline` 삭제, 입면 셀 그리드 입력, 출입구 셀 |
| `stages/ground.mjs`, `kerbs.mjs`, `surfaces.mjs` | 입력을 `parcels.json`으로 |
| `stages/furniture.mjs` | 앵커 레코드 해석(`lib/anchors.mjs`), `entrance_canopy` 제거 |
| `stages/trees.mjs` | 생울타리 띠를 벽 앵커/parcel 앵커로 |
| `stages/markings.mjs`, `markingsRegular.mjs` | 추정기용 지지율 함수만 남김 |
| `network/stalls.mjs` | 삭제(과속방지턱은 §8.2로) |
| `scripts/perf/compare-vr.mjs` | 방위 잔차 출력 |
| `build-campus-model.mjs` | 스테이지 순서: sources → parcels → buildings → entrances → parking → roadMarkings → kerbs/tactile → surfaces → furniture → trees → lights → QA 불변 검사 |

폐지

`data/photo/ground-registration.json`, `a003-registration.json`, `markings-bays.json`, `site-detail.geojson`의
`entrance_canopy`/`stall_row`, `stages/markings.mjs`의 `OSM_SHIFT_M`·`CROSSING_WIDTH_M` 상수, `network/stalls.mjs`.
`markings*.geojson`·`markings-gate.json`은 `data/photo/evidence/`로 이동(삭제 아님).

## 12. 소비자 영향과 호환 계약

- **유지**: `BLD_*` 노드 이름과 선택 계약, 팝업 필드, `Road_Markings` 메시·재질 이름, 컬렉션 구조, 높이 사이드카
  포맷(`campus-v2-height.bin/.json`), `heightLineage`·`footprintEstimated`·`formEstimated` extras.
- **변경(재생성 필요)**: 시뮬레이션 네트워크(`backend/simulation/data/campus_transport_network.geojson`, `roads.json`,
  `road_segments.geojson`)는 Frame v2 D4 앵커로 다시 만든다. `src/simulation/utils/campusTrafficCoordinates.mjs`와
  `coordinateTransform.js`는 상수만 바뀐다. `CityModel.jsx` recentering은 `frameVersion`을 읽어 v1 자산(`?model=uni`)과
  v2를 구분한다.
- **D4 세부 뷰**(`BuildingSectionView`, D4 방/층 장면)는 D4 로컬 좌표라 영향 없음. 단 `D4_SCENE` 상수를 쓰는 곳이
  `sceneTokens.mjs`의 동명 색상 토큰과 이름만 같으니 혼동하지 않도록 `D4_SCENE_ANCHOR`로 바꾼다.
- VWorld 대시보드: 영향 없음.

## 13. 입면(facade elevation) 모델

### 13.1 스키마 `data/buildings/facades/BLD_SCNU_E3.json`

```jsonc
{
  "building": "BLD_SCNU_E3",
  "storeys": [{ "hM": 4.2, "kind": "ground" }, { "hM": 3.6 }, { "hM": 3.6 }, { "hM": 3.6 }],
  "parapet": { "hM": 0.9, "colour": "#3f8f78", "eaves": { "depthM": 0.6, "tile": "green" } },
  "walls": {
    "W03": {
      "bays": { "pitchM": 3.6, "count": 9, "offsetM": 1.2 },      // 벽 시작점에서 첫 베이까지
      "cells": [                                                   // [storey][bay], 생략 시 default
        ["door","window","window","window","window","window","window","window","stair"],
        null, null, null
      ],
      "default": "window",
      "accents": { "piers": { "bays": [0, 4, 8], "widthM": 0.4, "colour": "#ef6a22" }, "frames": { "bays": [1, 2], "colour": "#ef6a22" }, "band": { "hM": 0.1, "colour": "#ef6a22" } },
      "materials": { "wall": "brick:#9b7070", "glass": "#5d7276", "frame": "#e8e8e4" },
      "evidence": { "tier": "T2", "refs": ["LOD4 unrolled W03 column periodicity 3.62 m (n=9)", "VR scene_e3 r bay count 9, door at bay 0"] }
    }
  }
}
```

- `cell` 종류: `window | blank | door | glazing(커튼월) | louver | stair(계단실 수직창) | vent`. `door`는 `entrances.json`의
  출입구와 일치해야 한다(교차 검사).
- 창 크기는 `cells`가 아니라 벽 단위 `window: { wM, hM, sillM }`로 두고, 베이별 예외는 `overrides`.

### 13.2 출처와 추정기 `fit/facadeBays.mjs`

- VWorld LOD4 b3dm은 사진 텍스처가 입혀진 벽 삼각형이고 `fetch/lod4Facades.mjs --debug`가 이미 벽별 **펼친 입면
  이미지(0.25 m/px)** 를 만든다. 벽별 이미지의 열 합(column sum) 자기상관으로 베이 피치와 count를, 행 프로파일로 층
  높이를 추정한다. LOD4 슬라이스가 4 m 어긋난 사례(E4)가 있으므로 **위치는 GIS, 패턴만 LOD4**에서 가져온다.
- VR 얼굴에서 베이 수와 출입구 베이 index를 세어 교차 확인(§7.3 방법으로 코너 방위 → 벽 길이 검산).
- 층수는 GIS/VR(현 `heightOf` 규칙 유지). 층고는 LOD4 벽 높이 ÷ 층수.
- 제안 파일 + 칩 시트(LOD4 펼친 입면 위에 베이 그리드 오버레이) → 사람이 확정.

### 13.3 생성

`lib/facadeAtlas.mjs`의 look 타일링을 "벽 × 셀 그리드" 입력으로 바꾼다. 셀 종류별 아틀라스 타일을 그대로 쓰되 배치가
레코드를 따른다. 입면 파일이 없는 건물은 현 look으로 그리고 `formEstimated: true`에 더해 `facadeEstimated: true`를 extras에
쓴다(대시보드 캡션 "입면 추정").

## 14. 단계와 수락 기준

E3와 그 앞 주차장(LOT_E3_S), 사범대 1로 한 구간을 파일럿으로 삼는다. 각 단계는 PR 하나, 머지 커밋.

| 단계 | 내용 | 수락 기준 |
|---|---|---|
| P0 Frame v2 | §3, `bld-node-map.json`, 테스트 갱신, 시뮬레이션 네트워크 재생성 | 모든 BLD bbox 중심 = GIS ±0.05 m; 시뮬 에이전트가 도로 위를 달림(기존 QA) |
| P1 Parcels | §5 seed → 큐레이션, 보정표 마이그레이션, class 제약 | 잔디 위 페인트 0건(§10.3); 기존 지면 스크린샷 대비 회귀 없음 |
| P2 Parking | §4 lean·가림, §6 추정기·생성, E3 lot 먼저 → 캠퍼스 전 lot | E3: 디바이더 12개, accessible 2칸 열 멤버, 지지율 ≥ 0.7; 전체: §1 기준 |
| P3 Anchors | §7 앵커 라이브러리, 출입구, VR 방위 읽기, 캐노피·휠스톱·생울타리 이관, scene 매핑 표 | E3 캐노피 t ≤ 0.3 m, VR 방위 잔차 ≤ 1.5°; `site-detail` 220건 중 벽 인접 항목 전부 이관 |
| P4 Road markings | §8 단면·교차로, 추정기, 생성; `markings*` evidence로 강등 | 세그먼트 존재 판정 ≥ 0.95, 횡 잔차 ≤ 0.25 m; 횡단보도 IoU ≥ 0.6 |
| P5 Facades | §13 E3·E5부터, scene 매핑 확정 | E3 출입구 셀이 캐노피 위치와 일치; LOD4 대비 베이 수 일치 |
| P6 QA | §10 맵 비교·VR 방위 잔차를 빌드에 연결 | 리포트가 매 빌드 생성, 허용치 초과 목록 0 또는 사유 기록 |

P0~P2가 사용자가 지적한 증상(주차선·장애인 구역·캐노피)의 대부분을 없앤다. P3는 캐노피를 완결하고, P4·P5는 차선과
파사드다.

## 16. 건물 매스, 옥상 코어, 지붕

현재 `data/building-forms.json`은 VWorld LOD4 메시 슬라이스로 날개·코어·부속동을 만든다(E3: main 15.5 m, core 17.85 m ×2,
wing ×3, annex ×2). LOD4 슬라이스가 4 m 어긋난 사례(E4)가 README에 적혀 있고, 지붕 색은 사진의 발자국 안 픽셀을
중앙값으로 샘플한다. 둘 다 §3·§4 원칙을 적용한다.

- **위치는 GIS, 형태는 LOD4.** LOD4 슬라이스 전체를 GIS 발자국에 **강체 정합**(ICP, 외곽 윤곽 ↔ 발자국, 회전 ±3° 이내)한
  뒤에 슬라이스를 자른다. 정합 잔차(m)를 `building-forms.json`의 레코드에 `lod4Residual`로 기록하고 1 m를 넘으면 경고.
  현재의 "발자국으로 클립"만으로는 4 m 밀린 코어가 엉뚱한 자리에 남는다.
- **옥상 코어·설비는 발자국 기준 상대 좌표.** 코어 ring을 §7의 벽 앵커(`wall, s, t`) 또는 발자국 지향 박스 축 기준
  `(u, v)`로 적는다. refetch로 발자국이 바뀌어도 코어가 지붕 위에 남는다. 사진에서 보이는 옥상 박스는 lean 벡터만큼
  되돌려(§4 `v_b`에 코어 높이 비율을 곱해) 위치를 교차 확인한다.
- **지붕 색·태양광 샘플링은 lean 보정 후.** 발자국을 `v_b`만큼 옮긴 영역에서 샘플한다. 지금은 발자국 안을 그대로
  샘플하므로 NE 날개처럼 1.5~2 m 밀린 곳은 지면 픽셀이 섞인다. 태양광 패널 사각형도 같은 보정을 거쳐 지붕 좌표로
  되돌린다.
- 파라펫·처마·지붕 재질은 §13 입면 파일의 `parapet`에서 읽는다(현 `scnu-facades.json`의 `parapet` 필드 이관).

## 17. 자립 객체: 광장 가구, 쉼터·정자, 가로등, 신호등, 정문 구조물

벽에 붙지 않는 객체는 §7 앵커를 쓸 수 없다. 현재 `objects-campus.geojson` 175건은 사진에서 눈으로(`by-eye-photo` 130건),
`rest-spaces.geojson`·`site-detail.geojson`은 VR 눈대중으로 놓였다.

- **위치 증거 규칙(모든 자립 객체 공통)**
  1. 사진에서 **가림 마스크 밖**에 보이면 T1. 지면에 닿은 점(그림자 뿌리, 기둥 밑동)을 찍는다. 높이가 있는 객체의
     꼭대기(가로등 머리, 정자 지붕)는 lean을 받으므로 찍지 않는다. 현 `lib/poleShadow.mjs`의 그림자 뿌리 방법은 유지.
  2. 사진에 없거나 가림 안이면 **VR 두 station 교차**: 리섹션된 station 둘에서 같은 객체의 방위를 읽어 광선 교차점을
     위치로 한다(`fit/vrIntersect.mjs`). 교차각이 20° 미만이면 T4로 떨어뜨린다. station 하나뿐이면 방위 + 지면 높이로
     거리(눈높이와 객체 밑동의 픽셀 행에서)를 구하되 T2 하한, 잔차를 적는다.
  3. 어느 것도 없으면 T4 + `estimated: true`. 지금처럼 "about 3 m"로 뭉뚱그리지 않고 방법과 수치를 `evidence.refs`에
     적는다.
- **좌표는 parcel 앵커** `{ parcel, uM, vM, yawDeg }`(parcel 지향 박스 축 기준)로 저장한다. parcel ring을 고치면 그 위의
  가구가 같이 움직인다. 열을 이루는 가구(벤치 열, 볼라드 열, 자전거 거치대)는 §6과 같은 `{ line, pitch, count }`
  파라메트릭 열로 적는다.
- **가로등·신호등**: `pole-roots.json`(그림자 뿌리, T1)은 유지하고 §17 규칙 2로 VR 교차 확인을 추가한다. 신호등 팔
  방향은 교차로 레코드(§8.1)의 접근로에서 나온다.
- **정문 구조물·쉼터·정자·관람석·분수**: 사진 외곽선(T1, 가림 밖)이 있으면 그대로, 없으면 VR 교차 + 카탈로그 치수
  (`rest-space-catalogue.json` 유지). 생성 코드(`stages/furniture.mjs`의 빌더들)는 바꾸지 않고 **입력 좌표의 출처와
  앵커만** 바꾼다.
- 검증은 §10.2 VR 방위 잔차(허용 1.5°)와, 사진에 보이는 것은 §10.1 밑동 위치 잔차(허용 0.5 m).

## 18. 수목과 생울타리

- 수목 위치는 CHM 수관 + 사진 수관 중심(`treeInventory.mjs`, `tree-vr-fit.json`)이다. 수관은 지면보다 높으므로 lean을
  받는다. 수관 높이 h_t에 캠퍼스 lean 비율(`v_b / h_b`의 중앙값, §4)을 곱해 수관 중심을 **되돌린 점**을 줄기 위치로
  한다. 10 m 나무면 약 1 m 차이다. `tree-vr-manual.json`의 눈대중 보정은 §17 규칙 2(VR 교차)로 다시 읽는다.
- 벽 앞 생울타리 띠는 §7 벽 앵커(`s0, s1, t, 폭, 높이`), 화단·잔디 위 다듬은 관목은 parcel 앵커. `site-detail.geojson`의
  `hedge` 35건·`planter` 24건이 대상.
- 수종·높이는 현 규칙 유지. 배치 금지 구역(주차장·코트·도로)은 §5 parcel class에서 나온다.

## 19. 범위 밖: 지형 높이, 캠퍼스 밖 컨텍스트

- **지형 높이**: `uni.glb` Topography 래스터(1 scene unit ≈ 1.6 m)를 그대로 쓴다. 보도 단차·경사로·과속방지턱은
  §5·§8의 파라메트릭 값으로 올린다. DEM 교체는 별도 설계(§21).
- **캠퍼스 밖**(`Context_*`, `OuterTerrain`, 격자 철탑): 위치 정확도 요구가 없으므로 이번 설계에서 바꾸지 않는다. 다만
  Frame v2로 좌표가 수 m 움직이므로 재생성은 한다.

## 20. 모델 구성 요소별 담당 절

`scripts/campus-model/README.md` "What the model contains" 기준.

| 모델 요소 | 현재 출처 | 이 설계에서 | 절 | 단계 |
|---|---|---|---|---|
| `BLD_*` 위치·발자국 | GIS + `uni.glb` 윤곽 혼용 + 중앙값 시프트 | GIS 단일, 시프트 제거 | §3 | P0 |
| `BLD_*` 매스·날개·코어 | LOD4 슬라이스(4 m 오차 사례) | LOD4를 GIS에 강체 정합, 코어는 발자국 상대 좌표 | §16 | P0·P5 |
| 지붕 색·태양광 | 사진 발자국 안 샘플 | lean 보정 후 샘플 | §16 | P2 |
| 입면(창·출입구·악센트) | look 한 줄 타일링 | 벽별 베이 셀 그리드(LOD4 패턴 + VR 카운트) | §13 | P5 |
| 출입구·캐노피 | VR 눈대중 절대 좌표 | `entrances.json`, 벽 앵커, VR 방위 | §7 | P3 |
| `Topography` | `uni.glb` 높이 | 유지 | §19 | - |
| `Ground_*` 지면 클래스 | OSM/MCEE/A003 혼합 | `parcels.json` 단일 큐레이션 | §5 | P1 |
| `Kerbs`, 촉지, 단차 | A003 + 보정표 | parcel 경계에서 파생, 보정표 폐지 | §5·§9 | P1 |
| 주차 디바이더·장애인 구역·휠스톱 | 사진 조각 + 게이트 + 빈칸 메우기 | 열 파라메트릭, 추정기, 가림 마스크 | §4·§6 | P2 |
| 차선·중앙선·가장자리선·연석선 | 사진 조각 체인 적합 | 도로 단면 레코드에서 오프셋 곡선 | §8 | P4 |
| 정지선·횡단보도·화살표·글자·과속방지턱 | 사진 조각 + 템플릿 | 교차로·단면 레코드 | §8 | P4 |
| 광장 가구·쉼터·정자·정문 구조물·관람석 | 사진 눈대중 / VR 눈대중 | 위치 증거 규칙 + parcel 앵커 + 파라메트릭 열 | §17 | P3 |
| 가로등·신호등 | 그림자 뿌리(T1) | 유지 + VR 교차 확인, 팔 방향은 교차로 레코드 | §17·§8 | P3·P4 |
| 수목 | CHM/사진 수관 중심 | lean 되돌림, VR 보정은 교차법으로 | §18 | P2 |
| 생울타리·화단 | VR 눈대중 점 | 벽 앵커 띠 / parcel 앵커 | §7·§18 | P3 |
| 간판·현판·LED | VR 눈대중 | 벽 앵커 | §7 | P3 |
| 캠퍼스 밖 건물·도로·외곽 지형 | OSM/COP30 | 재생성만 | §19 | P0 |
| 교통 네트워크 좌표 | D4 앵커 시뮬 프레임 | Frame v2로 재생성 | §12 | P0 |

빈 칸 없음: README가 나열하는 요소마다 담당 절과 단계가 있다. "유지"로 표시된 것은 이번 설계가 바꾸지 않기로 한 것이다.

## 21. 리스크와 열린 질문

- **지형 높이**는 여전히 `uni.glb` Topography다. 1 scene unit(1.6 m) 래스터라 보도 단차·경사로는 추정이다. NGII 5 m DEM
  또는 LOD4 지면 높이로 바꾸는 것은 별도 설계.
- **GIS 발자국의 국소 오차**: 지적 발자국이 실제 벽과 0.3~0.5 m 다를 수 있다. 기준으로 삼되, LOD4 벽 위치와의 잔차를
  §9 표에 기록해 두고 넘어간다.
- **VR station 리섹션 품질**이 §7.3의 정밀도를 정한다. 제어점이 적은 station은 `station_refined`가 없으므로 그 scene의
  측정은 T4로 떨어진다.
- **사진 시점(2025-04)과 현재 페인트**가 다를 수 있다. 추정기는 사진을 따르고, VR이 더 새것일 때만 T2로 덮어쓴다. 어느
  쪽이 현재인지 모르면 `estimated: true`.
- **큐레이션 비용**: lot 30여 곳, 세그먼트 수십, 건물 40여 동의 입면. 추정기가 제안을 만들고 사람은 칩 시트에서 승인만
  하도록 도구를 먼저 만든다. 승인 없는 제안은 `estimated: true`로 빌드에 들어간다.
- **결정 필요**: (1) `SOURCE_MODEL_OFFSET`을 유지할지 0으로 할지(유지 권장: 상수 강체 변환이라 무해하고 v1 자산 비교가
  쉬움). (2) 순천시 12 cm 항공사진을 교차 검증에 쓸지(권장). (3) 입면 추정을 P2 뒤에 둘지 P4와 병행할지.
