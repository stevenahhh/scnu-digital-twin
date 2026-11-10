# D4 구현 인사이트: 공과대학 3호관(BLD_D4) 재구축 기록

이 문서는 공과대학 3호관(`BLD_D4`)을 실제 모습에 맞게 다시 만든 과정을 정리한다. 무엇을 조사했고 어떤 순서로 고쳤는지 적었다. 다른 캠퍼스 건물을 같은 방식으로 다룰 때 쓸 체크리스트도 마지막에 붙였다.

경로 표기 약속은 다음과 같다.

- `W/`는 `.omo/ulw-research/d4-gt/`를 뜻한다. 예를 들어 `W/waves/fix.md`는 `.omo/ulw-research/d4-gt/waves/fix.md`다.
- `[파일 항목]` 형식의 괄호는 근거 위치다. `[W/ISSUES.md D-05]`는 ISSUES.md의 D-05 항목을 가리킨다.
- 위치, 크기, 높이, 색은 별도 표시가 없어도 모두 추정값(추정)이다 [W/ISSUES.md "Items that can only be estimated"]. 실측값은 따로 실측이라고 적었다.

## 1. 실제로 쓸모 있었던 소스

충돌 규칙은 하나다. 해상도가 높고 더 최근인 소스를 우선한다 [W/SYNTHESIS.md 9행]. 아래 표는 기여도가 큰 순서로 늘어놓았다. 출처 id는 `W/SYNTHESIS.md` 1절 표를 따른다.

| 순위 | 소스 | 해상도 | 무엇을 정했나 | 근거 |
|---:|---|---|---|---|
| 1 | SCNU 360 VR `scene_d4` 큐브 면 6장 (V1, https://vr.scnu.ac.kr/360vr/tour.html?startscene=scene_d4) | 면당 2048 px, 화각 90도, 초점거리 1024 px. 천저 부근 약 0.10 m/px(추정) | 연결교, 하부 통로, 출입문 뱅크, 계단, 포장, 기단, PM 주차칸, 도로 도색. 형태와 디테일의 1차 근거 | [W/SYNTHESIS.md V1], [W/waves/c-bridge.md 방법], [W/waves/h-scnu-vr.md] |
| 2 | NGII 정사영상 2025 도엽 34702020 (O1) | 0.25 m GSD | 모든 평면 위치: 교차로, 주차구획, 연석, 포장 띠 | [W/SYNTHESIS.md O1], [W/waves/l-ortho-hires.md] |
| 3 | VWorld LOD4 모델 SC090095 (L1) | 메시, bbox 안 613개 삼각형 | 지붕, 파라펫, 코어, 광정, 연결교 블록의 높이 | [W/SYNTHESIS.md L1], [W/waves/l-lod4.md F1] |
| 4 | GIS건물통합정보 레코드 133154 (G1, https://www.data.go.kr/data/15083092/fileData.do) | 벡터 | 외곽선 9개 꼭짓점, 2568 m2, 지상 6층 지하 1층, 29.3 m, RC | [W/SYNTHESIS.md G1], [W/waves/l-gis.md] |
| 5 | 카카오 로드뷰 2026-01, panoid 1205149408 (R1) | 화면 캡처 | 서쪽 옹벽, 서쪽 식재대와 분홍 석재 걸레받이, 사선 주차. 서쪽만 다룬다 | [W/SYNTHESIS.md R1], [W/waves/c-bridge.md 08] |
| 6 | 학교 공지의 드론 사진 2023 (B1) | 5464 x 3070 | 연결교와 북쪽 끝, 옥상 사인 | [W/SYNTHESIS.md B1] |
| 7 | 출입구 번호 CAD 도면 2022 (F1, https://www.scnu.ac.kr/images/web/SCNU/sub/door_2022.png) | 1586 x 1121 | D4 출입구 5개 | [W/SYNTHESIS.md F1], [W/waves/h-floorplan.md] |
| 낮음 | 블로그 (B3) | 썸네일 | 서쪽 유리면과 쌍구 가로등 하나 정도. 그 밖에는 쓸 것이 없었다 | [W/SYNTHESIS.md B3], [W/waves/h-blog.md] |
| 낮음 | 유튜브 브이로그 6편 (Y1) | 320 x 180/240 프레임 | D4가 확실히 찍힌 프레임이 없어 값에 쓰지 않았다 | [W/SYNTHESIS.md Y1], [W/waves/h-vlog.md] |
| 실패 | 카카오맵, 네이버지도, 구글맵 장소 사진 | 없음 | 정적 fetch로 사진 목록을 얻지 못했고 저장한 이미지는 0장이다 | [W/waves/h-photos-place.md] |
| 실패 | 로드뷰 과거 시점, 인스타그램, 에브리타임, 다음 카페, 세움터 | 없음 | 렌더 실패나 로그인 벽에 막혔다 | [W/SYNTHESIS.md R2, "Not usable"] |

참고로 알아 둘 점이 둘 있다. 순천시 12 cm 항공사진(O4)은 격자가 E 243575에서 시작해 D4를 덮지 않는다. 그래서 D4에서는 아무것도 정하지 못했다 [W/SYNTHESIS.md O4]. Esri 영상(O3)은 2020년 촬영이고 명시 정확도가 10.16 m라 위치에는 쓰지 않았다 [W/SYNTHESIS.md O3].

## 2. 작업 흐름

순서는 아래와 같다. 각 단계는 앞 단계 산출물을 입력으로 쓴다.

1. **고정 포즈 before 캡처.** 현재 GLB를 정해 둔 카메라 포즈로 렌더해 `refs/c-capture/before-*.png`로 저장했다 [W/waves/c-capture.md].
2. **번호 붙인 결함 목록.** 결함마다 D-번호, 분류, 근거 PNG, 실제 모습, 모델 상태, 책임 파일, 수정 방법, 레인을 적었다. 근거 이미지가 없는 항목은 올리지 않았다 [W/ISSUES.md 11행].
3. **소스와 모델의 같은 포즈 쌍.** VR 큐브 면과 같은 위치, 같은 방위, 화각 90도로 모델을 2048 x 2048로 렌더한 뒤 같은 픽셀 상자로 잘랐다 [W/waves/c-bridge.md 12행]. 맞는 사진이 없는 쌍은 그 사실을 표에 표시했다 [W/waves/c-bridge.md 14행].
4. **시드 파일 단위로 레인 분할.** 레인 8개가 서로 겹치지 않는 시드 파일을 맡았다. 매스와 지붕, 파사드와 문, 지면과 포장, 주차, 도로, 교차로, 독립 구조물, 지형과 나무와 재질로 나눴다 [W/ISSUES.md "Per lane"].
5. **통합자.** `stages/*.mjs`, `lib/*`, `qa/*`를 건드리는 항목은 통합자 한 명이 처리했다. 데이터와 코드가 섞인 항목은 데이터는 레인에, 코드는 통합자에게 나눴다 [W/ISSUES.md "Per lane" 아래 문단], [W/waves/integrate.md].
6. **재빌드.** 무거운 명령은 `scnu-heavy` 래퍼로 하나씩 돌렸다. `model:build`, D4 QA, 지면 겹침 검사, 테스트, 두 프런트엔드 빌드 순서다 [W/waves/fix.md "Final VERIFY table"].
7. **같은 포즈 after 캡처.** before와 같은 포즈로 다시 렌더해 비교한다. 결과는 아래 결과 절에 채운다.

## 3. 결함 유형과 근본 원인 수정 패턴

결과물 JSON을 손으로 고치지 않고 원인 시드나 스테이지를 고치는 것이 공통 원칙이다.

| 유형 | 관찰 | 근본 원인 | 수정 패턴 | 근거 |
|---|---|---|---|---|
| 지면 매몰 | 파사드 하단이 광장보다 약 1.5 m 아래로 묻혔다(추정). 최저 꼭짓점 y 35.92, 지면 36.86 | 매스 기준고를 지형 최솟값에서 잡고 `baseMetres: 0`을 썼다 | 매스마다 국지 마감면에 기단을 둔다. LOD4 높이에서 데이텀 오프셋 3.0 m(추정)를 뺀다 | [W/ISSUES.md D-05, D-68] |
| 출입구 기록 모순 | `ENT_D4_MAIN`은 서쪽 벽, `entranceBearing`은 180, 아틀라스 문은 남쪽 블록 동면에 있었다 | 세 데이터가 각자 출입구를 주장했다 | CAD와 VR을 채택해 출입구 5개 목록으로 정리하고 서쪽 문을 지웠다. `entranceMode: records-only`로 가장 긴 변에 문을 추론하는 동작을 막았다 | [W/ISSUES.md D-08, D-09, 30행], [W/waves/integrate.md 25행] |
| LOD4와 사진의 충돌 | 연결교 하부 높이가 LOD4와 모델에서는 22.74 m, 사진에서는 약 9 m(추정. 드론 8.8 m, VR 9.1 m) | LOD4가 위쪽 유리 블록만 담았다 | 서로 독립인 사진 두 장이 일치하면 사진을 따른다. 목표는 9 ± 1.5 m(추정)다. 남쪽 블록 높이처럼 사진 신뢰도가 낮을 때는 실측 메시인 LOD4를 유지한다 | [W/SYNTHESIS.md C1], [W/waves/c-bridge.md D-37], [W/ISSUES.md 28, 33행] |
| 낮은 텍셀 밀도 | 근거리에서 파사드가 흐리고 깍두기처럼 보였다. 건물 재질이 200 px/m에 못 미쳤다 | 공용 아틀라스로 다시 축소됐다 | D4 전용 재질 세트를 쓰고 2K/4K CC0 맵을 실제 타일 크기로 붙였다 | [W/ISSUES.md D-04, D-49], [W/waves/l8-terrain.md 93행] |
| 미할당 지면 위 도색 | `Paint area on unassigned ground does not allow paint` 오류 | 주차 도색 다각형이 소유자 없는 지면이나 다른 필지에 걸쳤다 | 도색을 담은 필지를 시드에서 할당하거나 도색 다각형을 필지 안으로 줄인다. bbox 밖 레코드는 건드리지 않는다 | [W/waves/fix.md "Newly reached acceptance failures"] |
| 단순화가 분할 격자를 넘음 | 실제와 대응하지 않는 날카로운 분할 조각 | `lib/partition.mjs`와 `lib/conform.mjs`의 분할 결과. 이 줄의 "단순화" 원인은 작업 지시에서 나온 내용이다. wave 파일에서 decimation 기록은 찾지 못했다 | 분할 경계를 지키는 단순화만 허용하고 `check-ground-overlap.mjs`로 확인한다 | [W/ISSUES.md 178-179행] |
| 부속물이 bbox를 넓힘 | 실외기 받침대, 창대 띠, 계단 발코니를 붙인 뒤 BLD_D4 bbox 중심이 동쪽으로 1.39 밀렸다. overhead 정합이 36개 타일에서 실패했다 | 매스 밖으로 튀어나온 부속물이 건물 노드에 들어갔다 | 매스 범위를 벗어나는 부속물은 같은 형상과 재질로 CampusBuildings에 그린다(`stages/buildings.mjs`의 `attachmentLeavesExtent`). fixture에서 중심 차이 0.0000043, 벽 이동 0 | `stages/buildingsD4.fixture.mjs` |
| 앞마당 번호 밀림 | `parcelsSeed.test.mjs` 동기화 검사가 기준선에서는 통과하고 이 브랜치에서는 786건 차이로 실패했다 | D4 별관 매스 7, 9가 `drawnBy`로 빠지면서 건물 외곽선과 그 둘레 앞마당(apron)이 31개에서 30개로 줄었다. `PARCEL_PAVING_BUILDING_<n>` 번호는 순번이라 뒤쪽 번호가 모두 밀린다 | 건물 외곽선을 바꾸면 `fit/parcelsSeed.mjs --write`로 parcels.json을 다시 만들고, 번호를 참조하는 시드도 함께 검사한다 | `fit/parcelsSeed.mjs` `seedParcels` |
| parcel 번호를 참조하는 앵커 | 재시드 뒤 D4 밖 가로등이 5~6 m 어긋났다(`qa/freeStanding.mjs`, OB0029 6.48 m) | `free-standing-anchors.json`과 `site-detail-anchors.json`은 parcel id에 대한 상대 좌표(uM, vM)로 위치를 저장한다. 번호가 밀리면 다른 필지를 기준으로 풀린다. curation의 `remove` id도 같은 문제를 갖는다 | 재시드 전후 형상이 같은 parcel끼리 id를 대응시켜 참조만 바꾼다(앵커 17건, unresolved 11건, curation remove 1건). 생성기를 다시 돌리면 D4 밖 물체가 1~7 cm 움직여서 쓰지 않았다. 다시 푼 위치 차이는 0이다 | `fit/objectAnchorsSeed.mjs`, `lib/anchors.mjs` `resolveAnchor` |
| 외곽 지형의 안쪽 스커트 | D4 QA에서 겹침 559건, 모두 OuterTerrain/Ground 대 Topography/Ground | `stages/outerTerrain.mjs`가 일부러 0.25 scene unit 안쪽 스커트를 낸다 | 소유 귀속까지만 확인했다. 형상 토글 시험이나 수정은 아직 하지 않았다. 내부와 외곽이 같은 높이 샘플러와 경계를 공유하게 고친다 | [W/waves/fix.md 68행], [W/waves/l8-terrain.md 87행] |

## 4. 지켜야 할 계약

- **Frame v2.** 지면 접촉선은 GIS 외곽선을 쓴다(`src/geo/epsg5186.mjs`). 지붕에서 뽑은 외곽선은 동쪽으로 밀린다 [W/waves/l-ortho-hires.md 96행].
- **BLD_D4 bbox 중심.** 대시보드는 BLD_D4 노드의 bbox를 기준으로 캠퍼스 전체를 다시 배치한다(`src/simulation/utils/campusTrafficCoordinates.mjs`). 그래서 이 bbox 중심은 기준선 dev-next의 GIS 발자국 중심 `[46.1857, -266.5969]`에 머물러야 한다(`qa/d4Integration.mjs`의 `FRAME_V2_D4_CENTRE`, 허용 0.05). 예전 `D4_SCENE_ANCHOR` 주변에 삼각형을 다시 넣는 방식은 overhead QA에서 캠퍼스 전체를 약 2.8 m 밀었다. 전역 EXTENT나 앵커를 바꾸지 않는다 [W/waves/l8-terrain.md 86행].
- **시드 우선 수정.** 생성 결과는 시드에서 고친다. 재시드하면 같은 변경이 다시 나와야 한다. 책임 시드는 결함마다 `Responsible` 줄에 적혀 있다 [W/ISSUES.md 각 항목].
- **근거 문자열.** 새 생성기 레코드 값마다 source 또는 evidence 문자열을 단다. 추정값이면 끝에 `(estimated)`를 붙인다. 높이 메모가 실제 형상과 어긋난 D-12가 이 규칙을 어긴 예다 [W/ISSUES.md D-12].

## 5. CC0 텍스처와 텍셀 밀도

모든 텍스처는 CC0 자산에서 골랐다. ambientCG(https://docs.ambientcg.com/license/)와 Poly Haven(https://polyhaven.com/license)을 썼다 [W/waves/h-textures.md 1-2행]. 각 URL은 2026-11-05에 HTTP 200을 확인했다 [W/SYNTHESIS.md 249행].

텍셀 밀도는 맵 픽셀 수를 실제 타일 크기로 나눠 계산한다 [W/SYNTHESIS.md 249행]. 근거리에서 보는 벽, 지붕, 기단은 최소 200 px/m가 필요하다 [W/ISSUES.md D-49]. 예시는 다음과 같다.

- 광장 포장: Poly Haven `square_concrete_pavers`, 2K, 타일 1.8 m, 약 1138 px/m. 정사영상 샘플색 #ced6cb로 틴트한다 [W/ISSUES.md D-14].
- 기존 지면 맵은 1024 px여도 200 px/m를 넘는다. 아스팔트 341 px/m, 연석 931 px/m, 잔디 731 px/m다 [W/SYNTHESIS.md 284행].
- 13 m 크기 Facade018A는 4K를 쓴다 [W/waves/l8-terrain.md 93행].

VR JPEG는 파란 색조가 강하다. 그래서 색상 힌트로만 쓰고 정사영상 샘플을 기본값으로 둔다 [W/ISSUES.md D-14, "Items that can only be estimated"].

## 6. 정확도의 한계

- 절대 위치 오차는 약 0.5 m 이상(추정)이다. D4 위 최고 해상도 영상이 0.25 m/px인 NGII 2025이고 독립 기준점이 없다. 반 픽셀 모호성 0.125 m도 더해진다 [W/waves/l-ortho-hires.md 25행], [W/ISSUES.md 671행].
- GIS 외곽선 자체가 실제 벽과 0.3 m에서 0.5 m 어긋난다(추정) [W/SYNTHESIS.md 66행].
- VR로 등록한 현장 디테일은 6점 맞춤 기준 0.6 m에서 1.6 m 오차다(추정) [W/SYNTHESIS.md 361행].
- 요청받은 0.5 mm 정확도는 검증할 수 없다. 이 수준을 확인할 소스가 없다 [W/ISSUES.md Appendix A 마지막 항목].
- NGII 1:1,000 등고선은 로그인이 필요해서 받지 못했다. 그래서 지면 단차는 모델 레이캐스트와 30 m DSM, 눈으로 읽은 사진에 기댄다 [W/SYNTHESIS.md T3], [W/ISSUES.md "Items that can only be estimated"].

## 7. 다음 건물을 위한 체크리스트

- [ ] 학교 VR 투어에서 그 건물 장면을 찾고 큐브 면을 캐시한다(`tour.xml`에서 scene id 확인) [W/SYNTHESIS.md V1].
- [ ] NGII 최신 정사영상 도엽이 건물을 덮는지 확인한다. 순천시 12 cm 항공사진도 범위를 먼저 확인한다 [W/SYNTHESIS.md O1, O4].
- [ ] LOD4 메시를 디코딩하고 데이텀 오프셋을 기록한다 [W/waves/l-lod4.md], [W/ISSUES.md D-68].
- [ ] GIS 레코드에서 외곽선, 층수, 높이, 구조를 가져온다. `curated` 상태를 확인한다 [W/ISSUES.md Appendix A B1].
- [ ] 출입구는 공식 CAD 도면과 VR로 하나의 목록을 만든다. 다른 출처의 출입구 기록은 지운다 [W/ISSUES.md D-08].
- [ ] 블로그, 브이로그, 지도 장소 사진에는 시간을 많이 쓰지 않는다 [W/waves/h-blog.md], [W/waves/h-vlog.md], [W/waves/h-photos-place.md].
- [ ] 고정 포즈 before 캡처를 먼저 남긴다 [W/waves/c-capture.md].
- [ ] 결함마다 근거 PNG와 책임 시드가 붙은 번호 목록을 만든다 [W/ISSUES.md].
- [ ] 소스와 같은 포즈로 모델을 렌더해 쌍으로 비교한다 [W/waves/c-bridge.md].
- [ ] 소스가 충돌하면 해상도와 최신성으로 고르고, 사진 두 장이 일치하는지 본다 [W/SYNTHESIS.md 9행, C1].
- [ ] 기단이 마감 지면에 닿는지, 지면 아래로 묻히지 않았는지 확인한다 [W/ISSUES.md D-05].
- [ ] 레인은 서로 겹치지 않는 시드 파일로 나누고, 코드 변경은 통합자에게 모은다 [W/ISSUES.md "Per lane"].
- [ ] 근거리 재질은 CC0이고 200 px/m 이상인지 계산해 둔다 [W/ISSUES.md D-49].
- [ ] 도색 다각형이 할당된 필지 안에 있는지 확인한다 [W/waves/fix.md].
- [ ] 외곽 지형과 내부 지면의 겹침을 확인한다 [W/waves/fix.md 68행].
- [ ] 앵커와 `BLD_*` id가 그대로인지 확인한다 [W/waves/fix.md 65행].
- [ ] 같은 포즈 after 캡처로 마무리하고, 추정값과 검증 불가 항목을 문서에 적는다.

## 결과

최종 후보는 `candidate-T5K2Op`이다. `campus-v2.glb`는 93.4 MB이고 sha256은 `721c3431…`이다.

| 게이트 | 결과 |
|---|---|
| `model:build` 수용 여부 | 거부(`accepted=false`). 기준선 dev-next(497fb952)도 같은 이유로 거부된다. 정책 오류는 기준선 15건, 후보 12건이다. 새로 생긴 오류는 0건이고 남은 12건은 모두 D4 밖이다. overhead 정합 실패 26/63 타일과 VR 방위 실패 13행도 기준선과 같다. visible 판정은 통과(42/63, 1 px 초과 0)했다 |
| D4 bbox 중심 차이 (허용 0.05) | 0.0000043. 기준선 GIS 발자국 중심 `[46.1857, -266.5969]` 대비 |
| D4 연결교 하부 높이 (목표 9 ± 1.5 m, 추정) | 9.0 m |
| D4 QA 지면 겹침/빈틈 샘플 수 | 226,205 샘플 중 겹침 0, 빈틈 0 |
| `check-ground-overlap.mjs` | D4 영역 겹침 0. 캠퍼스 전체에서는 3,048,192 샘플 중 5개(0.0002 %)가 겹치며 모두 D4 밖이다 |
| `bun run --cwd frontend test` (node/vitest) | Mac에서 실행했다. node 1,577개 통과, 실패 0, 건너뜀 0. vitest 51개 파일, 295개 통과 |
| `build` / `build:vworld` | 둘 다 종료 코드 0 |

| 결함 집계 | 개수 |
|---|---:|
| 수정 완료 | 28 |
| 부분 수정 | 27 |
| 미해결(gap) | 18 |

집계 대상은 ISSUES.md의 D-01~D-73이다. 부록 A의 5건까지 더하면 수정 28, 부분 28, gap 22가 된다. 항목별 근거와 gap 사유는 ISSUES.md "Status after rebuild" 절에 있다.

수정 후 촬영은 `W/refs/after/`(33장)에 있고, 수정 전 | 수정 후 | 참조 비교 이미지는 `W/refs/compare/`(33장)에 있다. 위에서 내려다본 사진에서 D4 서쪽 가장자리가 갈색 계단 모양으로 보인다. 정사영상을 확인하니 그 자리는 실제로 흙이 드러난 개간지였다. 그래서 흙 재질을 유지했다. 풀로 바꿨던 커밋(218be1e8)은 되돌렸다. 계단 모양은 토지피복 래스터 해상도 때문에 생긴다.
