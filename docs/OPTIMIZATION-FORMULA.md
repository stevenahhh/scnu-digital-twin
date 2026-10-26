# 최적화 공식 (2026-10-26 승인, 실행 중)

> 이 문서는 공식만 정의한다. **최적화 작업은 사용자의 별도 승인 또는 프롬프트가 있을 때만 시작한다.** 현재 목표(Ultra high fidelity)에서는 파일 크기·로딩 시간·브라우저 측정값 제한을 두지 않는다.

## 상태
- 작성일 2026-10-25. 이 문서는 최적화 단계의 계약서다.
- **2026-10-26 사용자 승인("지금부터는 최적화도 같이 하면 될 듯"), 최적화 패스 실행 중** (브랜치 `feature/optimisation-pass`, dev-next 기준).
  범위는 생성기 단계 뒤(pack 후처리, GLB 로더, 그림자·후처리 밖의 렌더 설정, 측정 스크립트)다.
- 측정: `frontend/scripts/perf/formula.mjs`가 아래 입력을 한 번에 잰다(`bench.mjs` low 5회·medium/high 1회, `--orbit 60` 궤도,
  `overhead-blend.mjs --campus-only` + `fidelity.mjs`).
- 점수 해석: 아래 식 그대로(`literal`)는 max(0, ·) 때문에 B·D·T·L이 줄어도 점수가 오르지 않는다. 이번 패스는 같은 λ로
  감소에도 같은 크기의 가점을 주는 `signed` 점수(max(0, ·)를 뺀 식)로 후보를 고르고, 두 값을 모두 기록한다(`fidelityCore.mjs` `score`).

## 입력 (측정값, 측정 방법)
| 기호 | 뜻 | 측정 |
|---|---|---|
| B | campus-v2.glb 바이트 + 텍스처 바이트 | ls -l, gltf-transform inspect |
| D | 낮음 품질 드로우콜(초기/최소/평균) | frontend/scripts/campus-model/bake 또는 bench.mjs --quality low |
| T | 삼각형 수 | bench.mjs |
| X | GPU 텍스처 메모리(MB) | renderer.info.memory.textures × 해상도 합 |
| L | 첫 프레임까지 시간(TTI, 콜드 캐시, ms) | Performance API in appcheck |
| F | 1440x900 중간 줌 60초 평균 fps / 1% low | bench.mjs |
| Q | 시각 충실도(참조 대비 SSIM, 12타일 평균) | `overhead-blend.mjs --campus-only` 타일 중 사진 에지 비율 상위 12개, 렌더 대 NGII 사진 휘도 SSIM(8 x 8 창, 4 px 간격) 평균: `fidelity.mjs` |

## 기준선 (2026-10-25, 8e68a7e)
B 4.84 MB · D 127/27/123 · T ≈1.04 M · L 미측정 · F 60 fps(Low) · Q 미측정(이번 목표에서 측정 시작)

## 2026-10-26 패스 결과 (feature/optimisation-pass)
측정: `frontend/scripts/perf/formula.mjs`(M5 Pro, 헤드리스 Chrome Metal, 1440 x 900·390 x 844, 백엔드 404 고정, 시계 2026-10-24 15:00 KST).
F는 헤드리스 Chrome의 60 fps 상한에 걸린다. X는 장면 텍스처를 RGBA8 + 밉으로 셈한 추정치(추정)다. L의 실행 간 편차는 약 ±20 %라
수십 ms 차이는 결과로 보지 않는다. Q의 같은 빌드 반복 편차는 약 0.0015(움직이는 교통 시뮬레이션 차량 때문)다.

| 빌드 | B | D low (overview/d4/oblique) | D medium/high (overview) | T | X (추정) | L 중앙값 | F 1440 low / high / 390 low (평균, 1 % low) | Q | score literal / signed |
|---|---:|---|---|---:|---:|---:|---|---:|---|
| dev-next d7adbd4 (기준선) | 75,860,132 B | 855/59/833 | 859/1019 | 3,046,726 | 244.8 MB | 1,687 ms | 60/59.5, 60/59.5, 60/57.9 | 0.2415 | 0.2415 / 0.2415 |
| 최종 (meshopt + 팔면체 법선) | 23,122,984 B | 855/59/833 | 859/1019 | 3,046,726 | 244.8 MB | 1,609 ms | 60/59.5, 60/59.5, 60/59.5 | 0.2416 | 0.2416 / 0.3574 |

후보(적용 순서, 각 후보는 직전 채택 상태와 비교. 후보 측정은 c85e30c 생성 결과, 기준선 B 67,157,312 B·Q 0.2495):
- 채택: meshopt 무손실(위치 양자화 없음, `compress.mjs`) 67.2 MB -> 25.9 MB, 프리미티브별 삼각형 집합이 원본과 비트 단위로 같음, signed 0.2495 -> 0.3242.
- 채택: 법선 8비트 팔면체(meshopt FILTER, `KHR_mesh_quantization`) 25.9 MB -> 20.8 MB, Q 0.2442(기준선 대비 손실 0.0053), signed 0.3723.
- 기각: Draco. 위치를 양자화해 6 mm·3 mm 지면 층이 겹치고(pack.mjs의 14비트 사례), drei의 Draco 디코더는 외부 CDN에서 받는다.
- 기각: KTX2. UASTC(법선·AO·금속성) + ETC1S(색)은 20.8 -> 33.3 MB. 모두 ETC1S는 GLB 21.5 MB + 트랜스코더 0.58 MB, X 244.8 -> 30.6 MB(추정)이지만
  signed 0.3723 -> 0.3453, 렌더 대비 SSIM 0.9855. 공식에 X가 없어 점수가 내려간다(모바일 메모리를 중시하면 다시 볼 후보).
- 기각: Ground_Hump_* 14개 병합(D -13). signed 0.3295로 내려갔고, 바뀐 화소는 움직이는 차량뿐이라 L·Q 차이는 잡음이다. 이득(D -1.5 %)이 측정 잡음보다 작다.
- 해당 없음: 인스턴싱. 여러 노드가 쓰는 메시가 0개이고 나무·가로등 풀은 이미 EXT_mesh_gpu_instancing, 벤치·가로등은 생성기가 한 프리미티브로 합친다.
- 기각: 거리 LOD·소품 숨김. 소품은 캠퍼스 전체에 걸친 단일 프리미티브라 통째로만 숨길 수 있고, 상한 이득 T -1.9 %·D -0.35 %(signed +0.0026 이하)에 개요 화면 손실.
- 기각: GLB 분할 스트리밍. 압축 뒤 GLB 전송은 L의 약 1/3이고 L 편차가 기대 이득보다 크며, 장면을 읽는 소비자 3곳을 바꿔야 한다.
- 변경 없음: 단계별 DPR 상한(low 1, medium 1.5, high 2)은 이미 있고 DPR 2·3에서도 60 fps(1 % low 59.5)라 더 낮출 이득이 없다.
- 다음 후보(이 패스 범위 밖): low 단계 드로우콜 855개 중 약 690개가 교통 시뮬레이션 개체(차량 1대 6메시)다. `src/simulation` 인스턴싱이 D를 가장 크게 줄인다.
  유휴 상태에서도 캔버스가 계속 그려지는 점(측정 하네스의 idleDrawCalls2s)도 따로 볼 일이다.

## 점수
score = Q_norm − λ_B·max(0,(B−B0)/B0) − λ_D·max(0,(D−D0)/D0) − λ_T·max(0,(T−T0)/T0) − λ_L·max(0,(L−L0)/L0) + λ_F·min(0,(F−60)/60)
- Q_norm = SSIM 평균(0..1). 충실도가 1순위이므로 λ_B=0.15, λ_D=0.20, λ_T=0.10, λ_L=0.25, λ_F=0.30 (ASSUMED, 승인 시 재협의).
- 최적화 후보 하나는 "Q 손실 ≤ 0.01" 제약 아래에서 score를 가장 많이 올리는 것부터 적용한다.

## 후보 기법 (적용 순서 제안)
1. 텍스처: KTX2/Basis 압축, 아틀라스 통합, 밉맵 LOD별 해상도 상한.
2. 지오메트리: meshopt 압축, 노면 표시 decal 병합, 인스턴싱(가로등·벤치·나무).
3. 로딩: GLB 분할(지형/건물/소품) + 우선순위 스트리밍, Draco/meshopt.
4. 렌더: 거리별 LOD, 그림자 캐스케이드 축소, 품질 티어별 DPR.

## 종료 조건 (승인 후)
Q 손실 ≤ 0.01, L ≤ 기준선, F ≥ 60fps(Low)/30fps(High) 유지, 회귀 테스트·두 빌드 녹색.
