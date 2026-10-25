# 최적화 공식 (보류 - 사용자 승인 후에만 실행)

> 이 문서는 공식만 정의한다. **최적화 작업은 사용자의 별도 승인 또는 프롬프트가 있을 때만 시작한다.** 현재 목표(Ultra high fidelity)에서는 파일 크기·로딩 시간·브라우저 측정값 제한을 두지 않는다.

## 상태
- 작성일 2026-10-25. 현재 목표(Ultra high fidelity 모델)에서는 최적화를 하지 않는다. 이 문서는 다음 단계의 계약서다.
- **runs only after user approval**: 사용자의 별도 승인 프롬프트가 있기 전에는 어떤 최적화 PR도 열지 않는다.

## 입력 (측정값, 측정 방법)
| 기호 | 뜻 | 측정 |
|---|---|---|
| B | campus-v2.glb 바이트 + 텍스처 바이트 | ls -l, gltf-transform inspect |
| D | 낮음 품질 드로우콜(초기/최소/평균) | frontend/scripts/campus-model/bake 또는 bench.mjs --quality low |
| T | 삼각형 수 | bench.mjs |
| X | GPU 텍스처 메모리(MB) | renderer.info.memory.textures × 해상도 합 |
| L | 첫 프레임까지 시간(TTI, 콜드 캐시, ms) | Performance API in appcheck |
| F | 1440x900 중간 줌 60초 평균 fps / 1% low | bench.mjs |
| Q | 시각 충실도(참조 대비 SSIM, 12타일 평균) | overhead blend 비교 스크립트 |

## 기준선 (2026-10-25, 8e68a7e)
B 4.84 MB · D 127/27/123 · T ≈1.04 M · L 미측정 · F 60 fps(Low) · Q 미측정(이번 목표에서 측정 시작)

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
