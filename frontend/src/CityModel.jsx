import { useGLTF } from "@react-three/drei";
import { extendCampusLoader } from "./render/campusGltfLoader";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import commonElements from "../../common/data/common_elemetns.json";
import {
  CAMPUS_BLOCKED_ELEMENT_IDS,
  CAMPUS_BUILDING_MAP,
  resolveBuildingMeta,
  resolveProxyDataElementId,
} from "./utils/buildingLabels.mjs";
import { createPointerGuard, hasCameraMoved } from "./camera/pointerGuard.mjs";
import {
  GROUND_MESH_NAME,
  buildGroundGrid,
  clampOrbitAboveGround,
  sampleGroundGrid,
} from "./camera/terrainClearance.mjs";
import { createCameraArm, resolveArmLength } from "./camera/buildingClearance.mjs";
import { isAnchorOccludedByTerrain } from "./utils/campusLabelVisibility.mjs";
import { CAMERA_PRESETS, D4_CAMERA_OFFSET, focusViewFrom } from "./camera/cameraPresets.mjs";
import { useFlyTo } from "./camera/useFlyTo.mjs";
import { frameDampingFactor, isCameraStepEvent } from "./camera/cameraCommands.mjs";
import { CampusLabelLayer } from "./labels/CampusLabelLayer.jsx";
import { resolveLabelBand } from "./labels/labelBands.mjs";
import { SETTLE_MS, createMotionSettle } from "./labels/motionSettle.mjs";
import { ZONES, buildLabelRegistry } from "./labels/labelRegistry.mjs";
import { campusModelCenter } from "./simulation/utils/campusTrafficCoordinates.mjs";
import { CAMPUS_MODEL_URL, CAMPUS_MODEL_URLS } from "./campusModelAsset.mjs";
import { CAMPUS_HEIGHTFIELD_URLS, loadHeightfield } from "./terrain/heightfield.mjs";
import { HOVER_HEX, SELECTION_HEX, dimLinearChannel } from "./ui/sceneTokens.mjs";
import {
  AUTUMN_MATERIAL_NAMES,
  SCENE_MINUTE_KEY,
  SPECIES_AUTUMN_PALETTES,
  SUN_ALTITUDE_KEY,
  getAutumnInstanceColor,
  getAutumnProfile,
  getAutumnWeight,
  getNightWeight,
} from "./lighting/season.mjs";
import { windowGlowAt } from "./lighting/nightCurve.mjs";
import {
  CROWN_ALBEDO_SCALE,
  CROWN_MATERIAL_NAMES,
  calibrateCrownInstance,
  autumnSalt,
  calibrateCrownMaterial,
  crownMaterialName,
} from "./lighting/foliage.mjs";
import { WATER_ENV_INTENSITY, WATER_MATERIAL_NAME, patchWaterFresnel } from "./lighting/water.mjs";
import { clipPolygonAhead } from "./render/clipPolygon.mjs";
import { POINTER_EXCLUDED_LAYER } from "./render/canvasLifecycle.mjs";
import { CampusGrass } from "./render/CampusGrass";
import { E2Worksite } from "./render/E2Worksite";
import { ModelEditorScene } from "./editor/ModelEditorScene";
import { modelEditStore } from "./editor/modelEditsApi.mjs";

// 클릭하지 않아도 카메라가 이 거리 안으로 들어오면 "가까이 간" 것으로 본다.
// 클릭 시 자동으로 붙는 카메라 거리(D4_CAMERA_OFFSET 기준 약 94유닛)보다 살짝
// 넉넉하게 잡아서, 자동 포커스로 도착했을 때도 자연스럽게 이 범위 안에 들어오게 한다.
// 빠져나갈 때는 더 넉넉한 거리(EXIT)를 써서 경계선에서 들어왔다 나갔다 깜빡이지
// 않게 한다. 진입은 ENTER, 이미 가까운 상태를 유지하는 건 EXIT 기준으로 판단한다.
const PROXIMITY_ENTER_DISTANCE = 120;
const PROXIMITY_EXIT_DISTANCE = 170;

// D4는 근접만으로 "공간 탐색" 화면 자체를 열어버리는, 훨씬 더 무거운 전환이라
// 일반 미기후 근접(120)보다 확실히 더 가까이(줌인) 다가갔을 때만 반응하게 한다.
const D4_ENTER_DISTANCE = 55;
const D4_ELEMENT_ID = "BLD_D4";
// 라벨 지형 가림 판정에 쓰는 높이 사이드카는 campus-v2.glb와 함께 만들어진다. ?model=uni에는 없으므로 판정을 건너뛴다.
const LABEL_HEIGHTFIELD_URLS = CAMPUS_MODEL_URL === CAMPUS_MODEL_URLS.detailed ? CAMPUS_HEIGHTFIELD_URLS : null;


// 정문 구역은 건물이 아니라 정문 시점의 목표점(재중심화 뒤 장면 좌표)에 놓인다.
const SYNTHETIC_ZONE_IDS = new Set(ZONES.filter((zone) => zone.synthetic).map((zone) => zone.id));
const LABEL_HOST_STYLE = "position:absolute;inset:0;pointer-events:none;z-index:var(--layer-labels)";

// 인스턴싱된 줄기는 노드 자체가 메시가 되기도 하므로 자신과 부모 이름을 모두 본다.
// 지형(Ground)과 나무 줄기는 그림자를 드리울 필요가 없다: 지면은 스스로를 가리지 않고,
// 줄기는 수관 그림자에 묻힌다. 둘 다 그림자를 받는 것(receiveShadow)은 유지한다.
const NON_CASTER_MATERIAL_NAME = "Ground";
// Tree trunks, and the far off-campus context tiles (scripts/campus-model/stages/context.mjs) beyond the shadow camera.
const NON_CASTER_PARENT_PATTERN = /^(Trees_.*_trunk|Context_Far_)/;
// 그림자 카메라 밖의 먼 맥락 타일(건물·도로, Context_Far_*)은 그림자를 받아도 그려질 그림자가 없으므로 받지 않는다(셰이더 비용만 듦).
const NON_RECEIVER_PARENT_PATTERN = /^Context_Far_/;
// 연석(Kerb, 생성기 stages/kerbs.mjs)은 캠퍼스 전체에 걸친 4만 삼각형짜리 낮은 턱이고 고를 대상이 아니다. 포인터 판정에서 뺀다.
const KERB_MATERIAL_NAME = "Kerb";
// 지형(Topography_joined 10만, OuterTerrain 7만 삼각형)은 포인터·카메라 비행·교통 폴백이 레이캐스트한다. 삼각형을 하나씩
// 검사하면 포인터가 한 번 움직일 때 두 메시에만 약 9 ms가 들었다(측정). 경계 상자 트리(three-mesh-bvh)로 검사한다.
// indirect라 인덱스 버퍼 순서는 그대로다.
const BVH_MESH_PATTERN = /^(Topography_joined|OuterTerrain)/;
// 카메라가 뚫고 들어가면 안 되는 건물 메시(여러 프리미티브는 이 이름의 그룹 아래 메시다). 선택 대리 프리즘(pickProxy)은 실제 외관보다
// 크고 거친 상자라 빼고, 먼 맥락 타일(Context_Far_*)은 카메라가 가지 않는 곳이라 뺀다. 모두 합쳐 약 8만 삼각형이다.
const BUILDING_COLLIDER_PATTERN = /^(BLD_|CampusBuildings|Context_Buildings|FrontKit_)/;
// 카메라 뒤로 이 거리까지 보고 카메라가 건물 안에 들어가 있는지 판단한다(캐럼퍼스에서 가장 큰 건물보다 길다).
const ARM_EXIT_SEARCH = 300;

// 목표점(origin)에서 direction으로 최대 far까지 건물 면과의 교차를 거리순 [{ distance, entering }]로 돌려준다.
// 재질이 앞면만 그리더라도 건물 안팎을 가르려면 뒷면도 봐야 하므로 양면으로 검사하고, 면 법선으로 들어감·나감을 가른다.
const armRay = new THREE.Ray();
const armLocalRay = new THREE.Ray();
const armInverse = new THREE.Matrix4();
const armNormal = new THREE.Vector3();
function castBuildingHits(colliders, origin, direction, far) {
  armRay.set(origin, direction);
  const hits = [];
  for (const mesh of colliders) {
    armInverse.copy(mesh.matrixWorld).invert();
    armLocalRay.copy(armRay).applyMatrix4(armInverse);
    for (const hit of mesh.geometry.boundsTree.raycast(armLocalRay, THREE.DoubleSide)) {
      const distance = hit.point.applyMatrix4(mesh.matrixWorld).distanceTo(origin);
      if (distance > far || !hit.face) continue;
      armNormal.copy(hit.face.normal).transformDirection(mesh.matrixWorld);
      hits.push({ distance, entering: armNormal.dot(direction) < 0 });
    }
  }
  return hits.sort((a, b) => a.distance - b.distance);
}
// 노면 표시(Road_Marking, 생성기 stages/markings.mjs): 항공사진에서 찾은 도색을 그 아래의 온전한 포장면 위 6 mm에 얹은 얇은 메시다.
// 포장면은 도색 모양으로 뚫지 않으므로, 먼 거리의 깊이 정밀도에서도 겹치지 않도록 폴리곤 오프셋으로 늘 지면 앞에 그린다.
// 평평한 도색이라 그림자를 드리우지 않고, 캠퍼스 전체에 걸친 삼각형을 포인터가 움직일 때마다 검사하지 않도록 클릭 판정에서도 뺀다.
// 밤에는 다른 발광 재질처럼 emissiveMap으로 은은하게 빛난다(밝기는 GLB의 emissive strength).
const ROAD_MARKING_MATERIAL_NAME = "Road_Marking";
const ROAD_MARKING_POLYGON_OFFSET = Object.freeze({ factor: -1, units: -4 });
// 모델링한 지면 층(Ground_*, 생성기 stages/surfaces.mjs·kerbs.mjs): 아스팔트·보도블록·자전거도로·주차장·운동 표면 등을 지형 위
// 0.6-3.6 cm에 얹은 데칼 메시다. 지면처럼 그림자를 받기만 하고 드리우지 않으며, 캠퍼스 전체에 걸친 삼각형이라 클릭 판정에서 뺀다.
// 재질 extras.polygonOffsetRank(1-7, 높을수록 위 층) 순서로 폴리곤 오프셋을 주되, 가장 높은 층도 노면 표시(factor -1,
// units -4)보다 뒤에 그려지도록 한 단계를 작게 잡는다.
const GROUND_LAYER_PATTERN = /^Ground_/;
const GROUND_LAYER_OFFSET_STEP = Object.freeze({ factor: 0.12, units: 0.5 });
// 가로등(Lamp_*): 실제 조명 없이 밤에만 머리(Lamp_Head)가 빛나고 바닥 빛 웅덩이(Lamp_Pool)를 가산 합성으로 그린다.
// 그림자·클릭 대상에서 빼고, 웅덩이는 낮에는 숨겨 드로우콜을 쓰지 않는다. 가로등 위치는 항공사진 조사값이고,
// 사진으로 찾지 못한 캠퍼스 보행로 가로등은 규칙으로 놓은 추정값이다. 신호등 렌즈도 같은 머리 메시에 들어 있어 밤에 빛난다.
const LAMP_MATERIAL_PATTERN = /^Lamp_/;
const LAMP_POOL_MATERIAL_NAME = "Lamp_Pool";
const LAMP_POOL_STRENGTH = 1;
// 웅덩이는 반지름 1인 단위 원판 인스턴스다. GLB의 COLOR_0은 고리 4개짜리 선형 경사라 sRGB 화면에서는
// 평평한 원판처럼 보인다. 정점 색 대신 프래그먼트마다 원판 중심에서의 거리로 가우스 모양 감쇠를 계산하고,
// 가장자리는 0으로 부드럽게 닫는다(실측 조도 분포가 아니라 보기 위한 연출이다).
const LAMP_POOL_FALLOFF = 4.5;
// 평평한 원판이 경사진 지형·도로면 아래로 들어가 직선으로 잘려 보이지 않게, 시점 공간에서 카메라 쪽으로 조금(장면 단위, 약 0.8 m)
// 당겨 깊이 검사만 통과시킨다. 가산 합성이고 깊이를 쓰지 않으므로 다른 물체의 깊이에는 영향이 없다.
const LAMP_POOL_DEPTH_BIAS = 0.5;
// 야외 시설물(Furniture*, 생성기 stages/furniture.mjs): 벽·관람석·구령대·쉘터·퍼걸러·벤치 등을 재질마다 하나로 합친 메시다.
// 삼각형이 캠퍼스 전체에 퍼져 있어 포인터가 움직일 때마다 검사하지 않도록 클릭 판정에서 뺀다. 반투명 유리·그물
// (Furniture_Glass)은 그림자를 드리우지 않는다. 위치는 항공사진 조사값이고 모양·높이는 VR 투어를 보고 정한 추정값이다.
const FURNITURE_MATERIAL_PATTERN = /^Furniture/;
const FURNITURE_GLASS_MATERIAL_NAME = "Furniture_Glass";
// 환경(하늘) 반사는 빛날 수 있는 재질에만: 건물 유리를 품은 재질(정면 아틀라스·앞면 키트·반투명 유리)과 연못 물(lighting/water.mjs).
// 그 밖(지면·지붕·수관·시설물)은 환경맵의 반사(specular) 항만 끄고 확산(diffuse) 하늘빛은 그대로 받아 조명 균형이 바뀌지 않는다.
// 정면 아틀라스는 벽과 유리가 한 재질이라 벽 픽셀도 반사 항을 받지만 거칠기 0.6-0.95(lib/textures.mjs)라 흐릿하게 퍼질 뿐이다.
const GLASS_MATERIAL_PATTERN = /^(Facade_Atlas|Facade_FrontKit|Furniture_Glass)$/;
function disableEnvSpecular(material) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    // lights_fragment_maps가 환경맵에서 채운 radiance를 비우고 lights_fragment_end의 RE_IndirectSpecular에 넘긴다.
    // iblIrradiance(확산 하늘빛)는 그대로 둔다.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_fragment_end>",
      "radiance = vec3( 0.0 );\n  clearcoatRadiance = vec3( 0.0 );\n  #include <lights_fragment_end>",
    );
  };
  const key = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${key ? key.call(material) : ""}|campus-no-env-specular`;
  material.needsUpdate = true;
}
// 잔디 재질은 햇빛의 직접 반사(하이라이트)도 끄고 확산광만 받는다. 거칠기 맵(Grass004 ARM)의 낮은 값과 비스듬한 각의
// 프레넬 항이 잔디밭을 번들거리게 했다. 대상은 자연 지면(Ground), 운동장 잔디(Ground_Sports paint "pitch"), D4 잔디(Ground_Grass_*)다.
const isGrassMaterial = (material) =>
  material.name === NON_CASTER_MATERIAL_NAME ||
  /^Ground_Grass/.test(material.name) ||
  (material.name === "Ground_Sports" && material.userData?.paint === "pitch");
function disableSpecular(material) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_fragment_begin>",
      "material.specularColor = vec3( 0.0 );\n  material.specularColorBlended = vec3( 0.0 );\n  material.specularF90 = 0.0;\n  #include <lights_fragment_begin>",
    );
  };
  const key = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${key ? key.call(material) : ""}|campus-no-specular`;
  material.roughnessMap = null;
  material.metalnessMap = null;
  material.roughness = 1;
  material.metalness = 0;
  material.needsUpdate = true;
}
// 포인터 선택에서 빼는 메시(지면 층·노면 표시·시설물·가로등): 포인터 레이캐스트(render/canvasLifecycle.mjs가 raycaster.layers에서
// 이 레이어를 끈다)는 보지 않지만 메시의 raycast는 그대로라서 카메라 시점(useFlyTo)과 교통 폴백의 지면 높이 조회는 맞는다.
const skipPointer = (mesh) => mesh.layers.set(POINTER_EXCLUDED_LAYER);
function applyLampPoolFalloff(material) {
  material.vertexColors = false;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPoolOffset;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPoolOffset = position.xz;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        mvPosition.z += ${LAMP_POOL_DEPTH_BIAS.toFixed(2)};
        gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPoolOffset;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float poolR2 = min(dot(vPoolOffset, vPoolOffset), 1.0);
        diffuseColor.rgb *= exp(-${LAMP_POOL_FALLOFF.toFixed(2)} * poolR2) * (1.0 - smoothstep(0.2, 1.0, poolR2));`,
      );
  };
  material.customProgramCacheKey = () => "campus-lamp-pool-falloff";
  material.needsUpdate = true;
}

// 색 전환은 선택/주야가 바뀐 뒤에만, 남은 차이가 이 값보다 작아질 때까지 돈다.
const MATERIAL_SETTLE_EPSILON = 1e-3;
// 1/s. 150 ms(--motion-settle)에 약 95%까지 간다. 멈춘 화면에서는 프레임이 드물어 느린 감쇠는 300 ms 안에 거의 칠하지 못했다.
const MATERIAL_EASE_RATE = 20;
// 선택 강조: 보통·높음 단계는 후처리 외곽선(HighTierEffects의 Outline)이 맡고, 낮음 단계(후처리 없음)는 선택 건물 재질을
// 강조색 쪽으로 35% 옮기고 강조색 발광 0.15를 더한다. 어느 단계든 선택이 있으면 나머지 메시는 20% 어둡게 한다(DIM_ALPHA).
const SELECTION_COLOR = new THREE.Color(SELECTION_HEX);
const SELECTION_TINT_MIX = 0.35;
const SELECTION_EMISSIVE = new THREE.Color(SELECTION_HEX).multiplyScalar(0.15);
const NO_EMISSIVE = new THREE.Color(0, 0, 0);
const NIGHT_TINT_COLOR = new THREE.Color("#c8d6e5");
const NIGHT_TINT_MIX = 0.16;
// 가을 단풍(추정): 낙엽수 수관 인스턴스마다 물드는 시점과 색을 해시로 정해, 날짜 가중치가 바뀔 때만 인스턴스 색(instanceColor)을
// 다시 쓴다. 수종별 재질(생성기 stages/trees.mjs)마다 팔레트가 다르다: 활엽수(Tree_Crown)는 느티 적갈·벚 빨강·늦게 물드는 초록,
// 은행(Tree_Ginkgo)은 노랑, 메타세쿼이아(Tree_Metasequoia)는 적갈색이고, 소나무·상록 침엽수·생울타리는 그대로다.
// 재질에 팔레트가 없으면(예: uni.glb) 예전처럼 은행을 섞은 공통 팔레트를 쓴다.
// 수종 배정은 추정값이며 실제 수목 조사 결과가 아니다.
// 주야·계절 가중치가 이만큼 바뀌어야 재질을 다시 쓴다.
const RAMP_EPSILON = 1e-4;
// 마우스를 올린 건물은 평소 색을 호버 색 쪽으로 20% 옮긴다(은은하게, 선택 강조 35%보다 약하다).
// 재질은 메시마다 복제돼 있어 다른 건물로 번지지 않는다.
const HOVER_COLOR = new THREE.Color(HOVER_HEX);
const HOVER_TINT_MIX = 0.2;
// 프레임마다 새 객체를 만들지 않도록 재사용하는 스크래치 값.
const scratchColor = new THREE.Color();
const scratchHoverColor = new THREE.Color();
const scratchBaseColor = new THREE.Color();
const scratchEmissive = new THREE.Color();
const scratchProject = new THREE.Vector3();
const ELEMENT_NAME_MAP = new Map(
  commonElements.elements.map((element) => [element.element_id, element.name]),
);

function getSelectableMeta(object) {
  // 부모가 장면이거나 컬렉션 노드(생성기 lib/glb.mjs groupRoots, extras.collection)이면 그 객체 자신이 선택 단위다.
  const parent = object?.parent;
  const node = parent && parent.name !== "Scene" && !parent.userData?.collection ? parent : object;
  const rawName = node?.name;

  if (!rawName) return null;
  // 캠퍼스 건물 외관 노드(BLD_SCNU_*_Model)는 그리기만 한다. 선택은 같은 이름의 대리 프리즘(BLD_SCNU_*)이 받는다.
  if (isBuildingModelNode(node)) return null;

  const buildingMeta = resolveBuildingMeta(rawName, {
    elementNames: ELEMENT_NAME_MAP,
    buildingMap: CAMPUS_BUILDING_MAP,
    blockedIds: CAMPUS_BLOCKED_ELEMENT_IDS,
  });
  const lowerName = `${rawName}`.toLowerCase();

  if (
    lowerName.includes("학교") ||
    lowerName.includes("topography") ||
    lowerName.includes("terrain") ||
    lowerName.includes("ground") ||
    !buildingMeta
  ) {
    return null;
  }

  // 생성기의 BLD_SCNU_* 선택 대리 노드(pickProxy)는 공통 요소 목록에 없으므로 이름을 GLB extras.label에서 가져온다.
  const proxy = Boolean(node.userData?.pickProxy);
  return {
    name: rawName,
    elementId: buildingMeta.elementId,
    // 팝업·미기후 요청에 쓰는 요소 id. 대장 코드가 기존 요소와 같은 대리 노드는 그 요소(BLD_A6 등)를 쓴다.
    dataElementId:
      (proxy ? resolveProxyDataElementId(rawName, node.userData, ELEMENT_NAME_MAP) : null) ?? buildingMeta.elementId,
    label: (rawName === "BLD_SCNU_E2" && CAMPUS_MODEL_URL === CAMPUS_MODEL_URLS.detailed)
      ? `${node.userData.label} · 공사 중`
      : buildingMeta.label ?? (proxy ? node.userData.label ?? null : null),
    proxy,
    // 생성기가 GLB extras에 남긴 추정 계보(새 필드). 패널의 추정 표기만 읽는다.
    heightLineage: node.userData?.heightLineage ?? null,
    footprintEstimated: node.userData?.footprintEstimated === true,
    formEstimated: isFormEstimated(node.userData?.formEstimated),
    facadeEstimated: node.userData?.facadeEstimated === true,
  };
}

function isBuildingModelNode(node) {
  return /_Model$/.test(node?.name ?? "") && node.userData?.editable?.category === "building";
}

// extras.formEstimated는 추정한 항목 목록(문자열 배열)이거나 true다.
function isFormEstimated(value) {
  return value === true || (Array.isArray(value) && value.length > 0);
}

function estimateOf(meta) {
  return {
    heightLineage: meta.heightLineage,
    footprintEstimated: meta.footprintEstimated,
    formEstimated: meta.formEstimated,
    facadeEstimated: meta.facadeEstimated,
  };
}

function getSelectableRoot(object) {
  let cursor = object;
  let root = null;

  while (cursor && cursor.name !== "Scene") {
    if (getSelectableMeta(cursor)) {
      root = cursor;
    }
    cursor = cursor.parent;
  }

  return root || object;
}

// Anchors are in the model's own frame (before the recentring group's -center shift): boxes are taken in world space
// and moved back into the scene's frame, so the result does not depend on whether the shift was already applied when
// this runs (a recomputation after the shift used to return the shifted D4 anchor, so center collapsed to 0 and the
// default view opened off the campus).
function buildLabelAnchors(scene) {
  const anchors = new Map();
  scene.updateWorldMatrix(true, true);
  const toSceneFrame = scene.matrixWorld.clone().invert();

  scene.traverse((child) => {
    if (!child.isMesh) return;

    const root = getSelectableRoot(child);
    const meta = getSelectableMeta(root);
    if (!meta || anchors.has(meta.elementId)) return;

    const box = new THREE.Box3().setFromObject(root).applyMatrix4(toSceneFrame);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    anchors.set(meta.elementId, {
      name: meta.name,
      displayName: meta.label,
      elementId: meta.elementId,
      dataElementId: meta.dataElementId,
      proxy: meta.proxy,
      estimate: estimateOf(meta),
      position: [center.x, box.max.y + 6, center.z],
      box: [box.min.toArray(), box.max.toArray()],
    });
  });

  return Array.from(anchors.values());
}

export function CityModel({
  onSelect,
  selectedId,
  onBuildingClick,
  onBuildingProximity,
  onD4Enter,
  onCompare,
  controlsRef,
  // 태양 고도(라디안)를 주면 그 값으로, 아니면 CampusLighting이 루트 씬에 남긴 고도로 창문 불빛과 야간 색을
  // 연속으로 바꾼다. 둘 다 없을 때만 isNight로 켜고 끈다.
  isNight = false,
  sunAltitude,
  // 단풍 기준 날짜. 주지 않으면 현재 시계를 쓴다.
  date,
  // D4 상세가 열려 있는 동안 켜진다. 투명한 상세 화면 뒤로 라벨이 비치지 않게 숨기되,
  // 상세를 연 라벨이 닫힌 뒤 포커스를 돌려받을 수 있도록 마운트는 유지한다.
  labelsHidden = false,
  // 열린 대시보드 패널 요소. 패널 밑으로 들어간 라벨은 숨겨 키보드 포커스가 보이지 않는 곳으로 가지 않게 한다.
  occluderRef,
  // 지도 위 조작 UI(시점 버튼 줄·시간 슬라이더·패널 토글) ref 목록. 이 UI와 겹치는 라벨은 숨긴다.
  // data-label-chrome-layer가 붙은 요소는 통과용 레이어로 보고 자식 요소들의 사각형을 쓴다.
  chromeRefs,
  // 지금 눌린 카메라 시점 id. 지면 시점(정문)에서는 라벨이 거리(street) 단계가 된다.
  activePresetId = null,
  // 발표 모드: 라벨 상한을 절반으로 줄이고 점 표시를 끈다.
  presentation = false,
  // 마우스를 올린 칩에 붙일 대표 추정값(요소 id -> 문자열). 이미 받아 둔 팝업 데이터에서만 만든다.
  headlineById = null,
  // 패널이 고른 건물의 라벨 앵커 id(useSelectionState). 있으면 selectedId보다 먼저 쓴다.
  selectedElementId = null,
  // 보통·높음 단계: 선택 강조를 후처리 외곽선이 그린다. 낮음 단계(false)에서는 재질 색으로 강조한다.
  selectionOutline = false,
  // 라벨 레지스트리를 앱에 알린다(패널 제목이 같은 이름을 쓰도록).
  onLabelRegistry,
  // 사용자가 캔버스를 드래그해 카메라를 움직이기 시작했을 때(휠·시점 비행은 아님).
  onDragStart,
  // 렌더 품질 단계(낮음에서는 잔디 덤불을 심지 않는다).
  quality = "medium",
  ...props
}) {
  const { scene, asset } = useGLTF(CAMPUS_MODEL_URL, true, true, extendCampusLoader);
  // 관리자 모델 편집 중(editor/ModelEditorScene)에는 클릭을 편집기가 받는다. 건물 선택과 마우스오버 강조는 멈춘다.
  const editing = useSyncExternalStore(modelEditStore.subscribe, () => modelEditStore.getState().editing);
  // Frame v2 GLB는 asset.extras.frameVersion을 기록한다. 없으면 v1(uni.glb) 규칙으로 재중심화한다.
  const frameVersion = asset?.extras?.frameVersion;
  const { camera, gl, scene: rootScene, invalidate, setEvents } = useThree();
  // 건물·묶음 클릭 비행. 시점 버튼과 같은 시간 기반 비행(useFlyTo)이고, 사람의 조작이나 다른 비행이 끊는다.
  // focusFlightRef는 비행 중인지(근접 자동 열기 보류)를 렌더 없이 읽는다. 도착하거나 끊기면 내린다.
  const { flyTo: flyFocus } = useFlyTo({ controlsRef });
  const focusFlightRef = useRef(false);
  const tintedMeshesRef = useRef([]);
  const lampPoolsRef = useRef([]);
  const pickProxiesRef = useRef([]);
  const autumnCrownsRef = useRef([]);
  const materialTransitionRef = useRef(true);
  // 현재 재질에 반영된 단풍 혼합 비율과 야간 가중치. -1은 아직 한 번도 쓰지 않았다는 뜻.
  const rampRef = useRef({ autumn: -1, night: -1, window: -1 });
  const traverseStatsRef = useRef(null);
  const closeElementIdRef = useRef(null);
  const isInsideD4Ref = useRef(false);
  const labelsHiddenRef = useRef(labelsHidden);
  const hoveredNameRef = useRef(null);
  // 마우스를 올린 건물의 앵커 id(라벨 층의 호버 칩·건물 가림 근사에 쓴다).
  const hoveredIdRef = useRef(null);
  const wasDraggingRef = useRef(false);
  const activePresetIdRef = useRef(activePresetId);
  activePresetIdRef.current = activePresetId;
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;
  // 라벨 배치를 다시 해야 하는 남은 프레임 수. 칩 크기는 다시 그린 다음 프레임에야 바뀔 수 있어
  // 한 번 더 돌도록 2로 둔다. 캔버스·패널 사각형이 바뀌었는지는 매 프레임 비교한다.
  const labelPassFramesRef = useRef(2);
  const labelFrameKeyRef = useRef("");
  const labelHeightfieldRef = useRef(null);
  const labelForwardRef = useRef(new THREE.Vector3());
  // 라벨 층(캔버스 옆 DOM, 별도 React 루트)과 그 조작 손잡이.
  const labelRootRef = useRef(null);
  const labelControllerRef = useRef(null);
  // 카메라 움직임(사용자 조작·시점 비행) 동안 라벨 층을 흐리게 하고 배치를 멈춘다. 멈춘 뒤 --motion-settle만큼 지나고
  // 조용한 프레임이 3개 이어지면 한 번 다시 배치한다(labels/motionSettle.mjs). checkSettle은 시간이 됐는데 조용한 프레임이 모자랄 때
  // 프레임 루프가 다시 부르는 확인 함수다.
  const [motionSettle] = useState(() =>
    createMotionSettle({
      settleMs: () => {
        const token = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--motion-settle"));
        return Number.isFinite(token) ? token : SETTLE_MS;
      },
    }),
  );
  // dimPending: 조작이 시작됐지만 카메라가 아직 움직이지 않았다. 처음 움직인 프레임에서 라벨 층을 흐린다(누르기만 해서는 흐리지 않는다).
  const motionRef = useRef({ timer: null, awaitingFrames: false, checkSettle: null, dimPending: false });
  const touchRef = useRef(typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches === true);
  // 클릭/드래그 판별(메시와 라벨이 공유). 직전 프레임 카메라 자세로 카메라가 움직이는 중인지 알려 준다.
  const [pointerGuard] = useState(() => createPointerGuard());
  const cameraPoseRef = useRef(null);
  // 카메라 지면 충돌용 지면 격자(월드 좌표). 캠퍼스 지형과 바깥 산을 모두 덮는다.
  const groundGridRef = useRef(null);
  const groundEdgeRef = useRef(null);
  // 카메라 건물 충돌: BVH를 만든 건물 메시, 벽에 밀려도 사용자가 정한 거리를 기억하는 팔, 직전에 검사한 카메라·목표점.
  const buildingCollidersRef = useRef([]);
  const [cameraArm] = useState(() => createCameraArm());
  const armPoseRef = useRef({ position: new THREE.Vector3(NaN, NaN, NaN), target: new THREE.Vector3(NaN, NaN, NaN), offset: new THREE.Vector3() });

  // 누르기·놓기는 window 캡처 단계에서 먼저 기록한다. R3F의 pointerup과 라벨 click보다 앞서고, OrbitControls가
  // 포인터를 캡처해도 빠지지 않는다. 누른 곳이 캔버스인지, 라벨인지, 그 밖(패널 등)인지도 함께 남긴다.
  useEffect(() => {
    const canvas = gl.domElement;
    const originOf = (target) => {
      if (target === canvas) return "canvas";
      if (target instanceof Element && target.closest('[data-qa="campus-label"],[data-qa="campus-dot"]')) return "label";
      return "other";
    };
    // 드래그하는 동안에는 R3F의 포인터 레이캐스트를 끈다. 포인터가 움직일 때마다 장면을 검사해 프레임당 약 8 ms가 들었고(측정),
    // 드래그 중에는 마우스오버 강조와 클릭을 어차피 받지 않는다. 놓으면 다시 켠다.
    let raycastPaused = false;
    const pauseRaycast = (paused) => {
      if (raycastPaused === paused) return;
      raycastPaused = paused;
      setEvents({ enabled: !paused });
    };
    const listeners = {
      pointerdown: (event) => pointerGuard.pointerDown(event, originOf(event.target)),
      pointermove: (event) => {
        pointerGuard.pointerMove(event);
        if (pointerGuard.isDragging()) pauseRaycast(true);
      },
      pointerup: (event) => {
        pointerGuard.pointerUp(event);
        pauseRaycast(false);
      },
      pointercancel: () => {
        pointerGuard.pointerCancel();
        pauseRaycast(false);
      },
    };
    const options = { capture: true, passive: true };
    for (const [type, listener] of Object.entries(listeners)) window.addEventListener(type, listener, options);
    return () => {
      for (const [type, listener] of Object.entries(listeners)) window.removeEventListener(type, listener, options);
      pauseRaycast(false);
    };
  }, [gl, pointerGuard, setEvents]);

  // 높이 사이드카가 오면 라벨 패스를 한 번 더 돌려 언덕 뒤 라벨을 숨긴다(요청 루프라 invalidate로 프레임을 연다).
  useEffect(() => {
    if (!LABEL_HEIGHTFIELD_URLS) return undefined;
    let disposed = false;
    loadHeightfield(LABEL_HEIGHTFIELD_URLS).then((field) => {
      if (disposed || !field) return;
      labelHeightfieldRef.current = field;
      labelPassFramesRef.current = 2;
      invalidate();
    });
    return () => {
      disposed = true;
    };
  }, [invalidate]);

  // HUD 묶음이 패널을 따라 미끄러지는 동안(인라인 transform) 라벨은 그 자리를 피하지 않는다. 피하면 도중 자리에서 밀린 칩이
  // 배치 유지 규칙 때문에 묶음이 멈춘 뒤에도 그 자리에 남는다. 장면이 멈춰 있어도 HUD 스타일이 바뀌면 프레임을 열어
  // 멈춘 묶음 자리로 다시 배치한다.
  useEffect(() => {
    if (typeof MutationObserver !== "function") return undefined;
    const observer = new MutationObserver(() => invalidate());
    for (const ref of chromeRefs ?? []) {
      if (ref?.current) observer.observe(ref.current, { attributes: true, attributeFilter: ["style"], subtree: true });
    }
    return () => observer.disconnect();
  }, [chromeRefs, invalidate]);

  useLayoutEffect(() => {
    labelsHiddenRef.current = labelsHidden;
    labelPassFramesRef.current = 2;
    // D4 상세가 열리면 캠퍼스 루프가 멈춘다(frameloop "never", useDemandLoop). 라벨 패스가 돌지 않으므로
    // 여기서 바로 숨긴다. 다시 보이는 것은 루프가 돌아온 뒤 라벨 패스가 정한다.
    if (labelsHidden) labelControllerRef.current?.update({ hidden: true });
    invalidate();
  }, [labelsHidden, selectedId, invalidate]);

  useEffect(() => {
    materialTransitionRef.current = true;
  }, [selectedId, selectedElementId, selectionOutline, isNight]);

  // 개발 모드 전용: 유휴 프레임에서 scene.traverse가 몇 번 불리는지 센다(한 번만 로그).
  useEffect(() => {
    if (!import.meta.env.DEV || !scene) return undefined;
    const stats = { calls: 0, lastCalls: 0, idleFrames: 0, idleMax: 0, logged: false };
    traverseStatsRef.current = stats;
    const originalTraverse = scene.traverse;
    scene.traverse = function countedTraverse(...args) {
      stats.calls += 1;
      return originalTraverse.apply(this, args);
    };
    if (typeof window !== "undefined") window.__cityModelTraverseStats = stats;
    return () => {
      scene.traverse = originalTraverse;
      traverseStatsRef.current = null;
    };
  }, [scene]);

  // 카메라가 바뀌면 라벨 패스를 다시 연다. 조작·시점 비행의 start/end로 라벨 층의 움직임 상태(흐림, 배치 멈춤)를 켜고 끈다.
  // 흐림은 카메라가 실제로 움직인 첫 프레임부터다. 단추·키 한 단계 이동(step 표식)은 움직임 상태를 만들지 않고 한 번 다시 배치만 한다.
  useEffect(() => {
    const controls = controlsRef?.current;
    if (!controls) return undefined;
    const motion = motionRef.current;
    // end 뒤에도 OrbitControls 감쇠로 카메라가 더 움직인다. 마지막 움직임에서 settle만큼 지나고 조용한 프레임이 이어져야 끝난다.
    const settle = () => {
      motion.timer = null;
      motion.awaitingFrames = false;
      if (!motionSettle.isActive()) return;
      const result = motionSettle.poll();
      if (result.settled) {
        motion.dimPending = false;
        labelControllerRef.current?.setMotion(false);
        labelPassFramesRef.current = 2;
        invalidate();
        return;
      }
      if (result.waitMs) {
        motion.timer = setTimeout(settle, result.waitMs);
        return;
      }
      if (result.framesNeeded) {
        // 요청 렌더 루프는 카메라가 멈추면 프레임을 그리지 않는다. 프레임을 요청하고 프레임 루프에서 다시 본다.
        motion.awaitingFrames = true;
        invalidate();
      }
    };
    motion.checkSettle = settle;
    const handleChange = () => {
      labelPassFramesRef.current = 2;
    };
    const handleStart = (event) => {
      if (isCameraStepEvent(event)) return;
      motionSettle.start();
      if (motion.timer) clearTimeout(motion.timer);
      motion.timer = null;
      motion.awaitingFrames = false;
      motion.dimPending = true;
    };
    const handleEnd = (event) => {
      if (isCameraStepEvent(event) || !motionSettle.isActive()) return;
      motionSettle.end();
      if (!motion.timer && !motion.awaitingFrames) settle();
    };
    controls.addEventListener("change", handleChange);
    controls.addEventListener("start", handleStart);
    controls.addEventListener("end", handleEnd);
    return () => {
      controls.removeEventListener("change", handleChange);
      controls.removeEventListener("start", handleStart);
      controls.removeEventListener("end", handleEnd);
      if (motion.timer) clearTimeout(motion.timer);
      motion.timer = null;
      motion.awaitingFrames = false;
      motion.checkSettle = null;
    };
  }, [controlsRef, invalidate, motionSettle]);

  useEffect(() => {
    if (!scene) return;

    const anisotropy = gl.capabilities.getMaxAnisotropy();
    const tintedMeshes = [];
    const lampPools = [];
    const pickProxies = [];
    const autumnCrowns = [];
    const nonCasterNames = [];
    scene.traverse((child) => {
      if (!child.isMesh) return;

      if (LAMP_MATERIAL_PATTERN.test(child.material?.name ?? "")) {
        child.castShadow = false;
        skipPointer(child);
        if (child.material.name === LAMP_POOL_MATERIAL_NAME) {
          child.receiveShadow = false;
          child.material = child.material.clone();
          child.material.blending = THREE.AdditiveBlending;
          child.material.transparent = true;
          child.material.depthWrite = false;
          child.material.polygonOffset = true;
          child.material.polygonOffsetFactor = -2;
          child.material.opacity = 0;
          applyLampPoolFalloff(child.material);
          child.visible = false;
          lampPools.push(child);
          return;
        }
      }

      // 캠퍼스 건물 선택 대리 프리즘(BLD_SCNU_*): 평소에는 그리지 않고(레이캐스트는 visible과 무관하게 맞는다)
      // 선택·마우스오버 때만 반투명 강조로 보인다. 실제 외관은 병합된 CampusBuildings가 그린다.
      if (child.userData.pickProxy) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.visible = false;
        child.material = child.material.clone();
        child.material.transparent = true;
        child.material.depthWrite = false;
        child.material.polygonOffset = true;
        child.material.polygonOffsetFactor = -1;
        child.material.polygonOffsetUnits = -1;
        child.userData.selectableName = child.name;
        pickProxies.push(child);
        return;
      }

      const isRoadMarking = child.material?.name === ROAD_MARKING_MATERIAL_NAME;
      const isGroundLayer = GROUND_LAYER_PATTERN.test(child.material?.name ?? "");
      const isFurniture = FURNITURE_MATERIAL_PATTERN.test(child.material?.name ?? "");
      const isKerb = child.material?.name === KERB_MATERIAL_NAME;
      if (BVH_MESH_PATTERN.test(child.name) && !child.geometry.boundsTree) {
        child.geometry.boundsTree = new MeshBVH(child.geometry, { indirect: true });
        child.raycast = acceleratedRaycast;
      }
      const isNonCaster =
        isRoadMarking ||
        isGroundLayer ||
        child.material?.name === FURNITURE_GLASS_MATERIAL_NAME ||
        child.material?.name === WATER_MATERIAL_NAME ||
        child.material?.name === NON_CASTER_MATERIAL_NAME ||
        NON_CASTER_PARENT_PATTERN.test(child.parent?.name ?? "") ||
        NON_CASTER_PARENT_PATTERN.test(child.name);
      child.castShadow = !isNonCaster;
      if (isNonCaster) nonCasterNames.push(child.name);
      child.receiveShadow = !(NON_RECEIVER_PARENT_PATTERN.test(child.parent?.name ?? "") || NON_RECEIVER_PARENT_PATTERN.test(child.name));
      child.material = child.material.clone();
      if (isFurniture || isKerb || isBuildingModelNode(child) || isBuildingModelNode(child.parent)) skipPointer(child);
      // 연못 물(Furniture_Water): 하늘 환경맵을 비추고, 내려다보면 비치고 비스듬히 보면 거의 불투명(프레넬)
      if (child.material.name === WATER_MATERIAL_NAME) {
        child.material.onBeforeCompile = (shader) => patchWaterFresnel(shader);
        child.material.customProgramCacheKey = () => "campus-water-fresnel";
        child.material.envMapIntensity = WATER_ENV_INTENSITY;
        child.material.needsUpdate = true;
      }
      if (isRoadMarking) {
        skipPointer(child);
        child.material.polygonOffset = true;
        child.material.polygonOffsetFactor = ROAD_MARKING_POLYGON_OFFSET.factor;
        child.material.polygonOffsetUnits = ROAD_MARKING_POLYGON_OFFSET.units;
      }
      if (isGroundLayer) {
        const rank = child.material.userData?.polygonOffsetRank ?? 1;
        skipPointer(child);
        child.material.polygonOffset = true;
        child.material.polygonOffsetFactor = -rank * GROUND_LAYER_OFFSET_STEP.factor;
        child.material.polygonOffsetUnits = -rank * GROUND_LAYER_OFFSET_STEP.units;
      }
      const selectableMeta = getSelectableMeta(child);
      child.userData.selectableName = selectableMeta?.name ?? null;
      // 같은 건물의 여러 노드(BLD_C1, BLD_C1.001)가 한 앵커 id로 함께 강조되고, 외곽선(useSelectedMeshes)도 이 id로 메시를 찾는다.
      child.userData.selectableElementId = selectableMeta?.elementId ?? null;

      // 수관 색 보정(lighting/foliage.mjs): 재질 색은 정사영상의 어두운 수관 쪽으로 낮추고, 나무마다 다른 인스턴스 색은
      // 밝기 차이만 남기고 색조 차이를 줄인다. 한 번만 옮긴다.
      // 보정한 여름 색(crownSummer)을 남겨 두어 다시 마운트돼도 두 번 보정하지 않고, 단풍도 이 색에서 출발한다.
      if (child.isInstancedMesh && CROWN_MATERIAL_NAMES.has(crownMaterialName(child.material)) && !child.userData.crownSummer) {
        if (!child.instanceColor) {
          for (let i = 0; i < child.count; i += 1) child.setColorAt(i, new THREE.Color(1, 1, 1));
        }
        const raw = child.material.color;
        const calibratedMaterial = calibrateCrownMaterial([raw.r, raw.g, raw.b]);
        const instance = child.instanceColor.array;
        const summer = new Float32Array(child.count * 3);
        const tint = [0, 0, 0];
        for (let i = 0; i < child.count; i += 1) {
          calibrateCrownInstance([instance[i * 3], instance[i * 3 + 1], instance[i * 3 + 2]], tint);
          for (let c = 0; c < 3; c += 1) {
            instance[i * 3 + c] = tint[c];
            summer[i * 3 + c] = tint[c] * calibratedMaterial[c];
          }
        }
        child.material.color.setRGB(...calibratedMaterial);
        child.instanceColor.needsUpdate = true;
        child.userData.crownSummer = summer;
      }

      if (!child.userData.originalColor && child.material.color) {
        child.userData.originalColor = child.material.color.clone();
      }
      if (!child.userData.originalEmissive && child.material.emissive) {
        child.userData.originalEmissive = child.material.emissive.clone();
      }
      if (child.userData.originalColor) {
        tintedMeshes.push(child);
      }
      if (child.isInstancedMesh && AUTUMN_MATERIAL_NAMES.has(crownMaterialName(child.material))) {
        const salt = autumnSalt(child.name);
        // 여름 수관 색 = 보정한 재질 색 x 인스턴스 색(crownSummer). 단풍 색을 만든 뒤 다시 재질 색으로 나눠 인스턴스 색에 쓴다.
        // 단풍 팔레트도 수관과 같은 비율로 어둡게 해 초록 나무와 물든 나무의 밝기 관계를 그대로 둔다.
        const summer = child.userData.crownSummer;
        const profiles = [];
        let luminanceSum = 0;
        for (let i = 0; i < child.count; i += 1) {
          luminanceSum +=
            0.2126 * summer[i * 3] + 0.7152 * summer[i * 3 + 1] + 0.0722 * summer[i * 3 + 2];
          // per-tree colour read on the VR tour (generator extras.autumn: [group, shade, mix] or 0), else the hashed choice
          const vr = Array.isArray(child.userData.autumn) && child.userData.autumn[i] ? child.userData.autumn[i] : null;
          const profile = getAutumnProfile(salt + i, SPECIES_AUTUMN_PALETTES[crownMaterialName(child.material)], vr);
          profile.color = profile.color.map((value) => value * CROWN_ALBEDO_SCALE);
          profiles.push(profile);
        }
        autumnCrowns.push({
          mesh: child,
          summer,
          profiles,
          meanLuminance: luminanceSum / Math.max(child.count, 1),
        });
      }
      // 하늘 반사(specular 환경맵)는 유리와 물에만 남긴다(GLASS_MATERIAL_PATTERN).
      if (child.material.isMeshStandardMaterial && child.material.name !== WATER_MATERIAL_NAME && !GLASS_MATERIAL_PATTERN.test(child.material.name)) {
        disableEnvSpecular(child.material);
        if (isGrassMaterial(child.material)) disableSpecular(child.material);
      }
      // campus-v2.glb: sharper ground/facade textures at grazing angles, and window glow only at night.
      if (child.material.map) child.material.map.anisotropy = anisotropy;
      if (child.material.emissiveMap) {
        child.userData.hasWindowGlow = true;
        // 가로등 머리는 밤 내내 가득 켠다. 나머지 발광(창문)은 밤 시간대 곡선(nightCurve.windowGlowAt)을 곱한다.
        child.userData.isLampHead = child.material.name === "Lamp_Head";
        // 재질에 정해 둔 발광 세기(가로등 머리는 KHR_materials_emissive_strength)를 밤 가중치의 최댓값으로 쓴다.
        child.userData.glowScale = child.material.emissiveIntensity;
        child.material.emissiveIntensity = 0;
      }
    });
    tintedMeshesRef.current = tintedMeshes;
    lampPoolsRef.current = lampPools;
    pickProxiesRef.current = pickProxies;
    autumnCrownsRef.current = autumnCrowns;
    if (traverseStatsRef.current) traverseStatsRef.current.nonCasterNames = nonCasterNames;
    materialTransitionRef.current = true;
    rampRef.current = { autumn: -1, night: -1, window: -1 };
  }, [gl, scene]);

  const labelAnchors = useMemo(() => {
    if (!scene) return [];
    return buildLabelAnchors(scene);
  }, [scene]);

  // 교통 시뮬레이션(차량·보행자·위험 지점)은 BLD_D4 라벨 앵커가 교통 좌표 원점에 오는 화면 좌표계를 기준으로 보정됐다.
  // 라벨 평균으로 재중심화하면 라벨 규칙이 바뀔 때마다 모델만 움직여 둘이 어긋나므로, D4 앵커로 기준점을 정한다.
  const center = useMemo(() => {
    const d4Anchor = labelAnchors.find((anchor) => anchor.elementId === D4_ELEMENT_ID);
    if (!d4Anchor) return new THREE.Vector3(0, 0, 0);
    const { x, z } = campusModelCenter(d4Anchor.position, { frameVersion });
    return new THREE.Vector3(x, 0, z);
  }, [labelAnchors, frameVersion]);

  // 라벨 이름·계층·구역은 레지스트리 한 곳에서 온다. 위치는 재중심화 전 모델 좌표다(정문 구역만 장면 좌표라 되돌린다).
  const anchorById = useMemo(() => new Map(labelAnchors.map((anchor) => [anchor.elementId, anchor])), [labelAnchors]);
  const labelRegistry = useMemo(
    () => buildLabelRegistry({ elements: commonElements.elements, anchors: labelAnchors, presets: CAMERA_PRESETS }),
    [labelAnchors],
  );
  useEffect(() => {
    onLabelRegistry?.(labelRegistry);
  }, [labelRegistry, onLabelRegistry]);
  const labelEntries = useMemo(() => {
    return [...labelRegistry.values()]
      .filter((entry) => entry.displayName && entry.position)
      .map((entry) => ({
        ...entry,
        hasData: ELEMENT_NAME_MAP.has(entry.dataElementId),
        position: SYNTHETIC_ZONE_IDS.has(entry.elementId)
          ? [entry.position[0] + center.x, entry.position[1], entry.position[2] + center.z]
          : entry.position,
      }));
  }, [labelRegistry, center]);
  // 패널 제목·라벨 강조가 같은 건물을 가리키도록 selectedId(요소 id, GLB 노드 이름, 대리 노드 이름 중 하나)를 앵커 id로 바꾼다.
  const selectedAnchorId = useMemo(() => {
    if (selectedElementId && anchorById.has(selectedElementId)) return selectedElementId;
    if (!selectedId) return null;
    const anchor =
      anchorById.get(selectedId) ??
      labelAnchors.find((item) => item.name === selectedId || (item.proxy && item.displayName === selectedId));
    return anchor?.elementId ?? null;
  }, [anchorById, labelAnchors, selectedElementId, selectedId]);
  // 지금 강조한 건물(앵커 id)을 지도 층에 남긴다(data-selected-id, 화면 검사가 칩·제목과 같은 건물인지 본다).
  useEffect(() => {
    const layer = gl.domElement.closest?.("[data-qa=campus-map-layer]");
    if (!layer) return;
    if (selectedAnchorId) layer.dataset.selectedId = selectedAnchorId;
    else delete layer.dataset.selectedId;
  }, [gl, selectedAnchorId]);
  const selectedAnchorIdRef = useRef(selectedAnchorId);
  selectedAnchorIdRef.current = selectedAnchorId;

  // 모델이 재중심화 그룹에 붙은 뒤 지형 메시 삼각형을 월드 좌표로 옮겨 지면 격자를 한 번 만든다.
  useEffect(() => {
    if (!scene) return;
    scene.updateWorldMatrix(true, true);
    const sources = [];
    const point = new THREE.Vector3();
    scene.traverse((object) => {
      if (!object.isMesh || !GROUND_MESH_NAME.test(object.name)) return;
      const attribute = object.geometry?.attributes?.position;
      if (!attribute) return;
      const positions = new Float32Array(attribute.count * 3);
      for (let k = 0; k < attribute.count; k += 1) {
        point.fromBufferAttribute(attribute, k).applyMatrix4(object.matrixWorld);
        positions[k * 3] = point.x;
        positions[k * 3 + 1] = point.y;
        positions[k * 3 + 2] = point.z;
      }
      sources.push({ positions, index: object.geometry.index?.array ?? null });
    });
    groundGridRef.current = sources.length > 0 ? buildGroundGrid(sources) : null;
    const colliders = [];
    scene.traverse((object) => {
      if (!object.isMesh || object.isInstancedMesh || object.userData.pickProxy) return;
      if (!BUILDING_COLLIDER_PATTERN.test(object.name) && !BUILDING_COLLIDER_PATTERN.test(object.parent?.name ?? "")) return;
      if (object.parent?.userData?.pickProxy || !object.geometry?.attributes?.position) return;
      if (!object.geometry.boundsTree) object.geometry.boundsTree = new MeshBVH(object.geometry, { indirect: true });
      colliders.push(object);
    });
    buildingCollidersRef.current = colliders;
    // 지면 메시의 수평 범위(장면 좌표)와 평균 높이: 화면 검사(QA)가 모델 가장자리 안팎의 밝기를 잰다(data-model-edge).
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity; let sumY = 0; let n = 0;
    for (const { positions } of sources) {
      for (let k = 0; k < positions.length; k += 3) {
        minX = Math.min(minX, positions[k]); maxX = Math.max(maxX, positions[k]);
        minZ = Math.min(minZ, positions[k + 2]); maxZ = Math.max(maxZ, positions[k + 2]);
        sumY += positions[k + 1]; n += 1;
      }
    }
    groundEdgeRef.current = n > 0 ? { minX, maxX, minZ, maxZ, y: sumY / n } : null;
    invalidate();
  }, [scene, center, invalidate]);

  useFrame((_, delta) => {
    // 끌기 뒤 관성은 프레임 수가 아니라 시간으로 줄어든다(느린 화면에서도 60fps와 같은 시간 안에 멈춘다).
    const controls = controlsRef?.current;
    if (controls?.enableDamping) controls.dampingFactor = frameDampingFactor(delta);
    // 카메라가 이번 프레임에 움직였는지(시점 비행, OrbitControls 감쇠, 클릭 포커스) 기록해 그동안의 클릭을 무시한다.
    const pose = cameraPoseRef.current;
    const cameraMoved = hasCameraMoved(pose, camera);
    pointerGuard.noteCameraFrame(cameraMoved);
    motionSettle.noteFrame(cameraMoved);
    if (cameraMoved && motionRef.current.dimPending && motionSettle.isActive()) {
      motionRef.current.dimPending = false;
      labelControllerRef.current?.setMotion(true);
    }
    // 움직임 끝을 기다리며 프레임을 요청해 둔 상태면 이 프레임으로 다시 본다(그 안에서 다음 프레임을 또 요청한다).
    if (motionRef.current.awaitingFrames) motionRef.current.checkSettle?.();
    if (pose) {
      pose.position.copy(camera.position);
      pose.quaternion.copy(camera.quaternion);
    } else {
      cameraPoseRef.current = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
    }
    // 드래그가 시작되면 마우스오버 강조를 끈다. 드래그는 건물을 가리키는 동작이 아니다.
    const dragDriven = pointerGuard.isDragDriven();
    // 드래그가 시작된 프레임에 한 번 알린다(클릭으로 고른 건물에 대한 근접 자동 선택 보류를 푼다).
    const dragging = pointerGuard.isDragging();
    if (dragging && !wasDraggingRef.current) onDragStart?.();
    wasDraggingRef.current = dragging;
    if (dragDriven && hoveredNameRef.current !== null) {
      hoveredNameRef.current = null;
      hoveredIdRef.current = null;
      labelControllerRef.current?.setHovered(null);
      materialTransitionRef.current = true;
      document.body.style.cursor = "auto";
    }

    // 주야(태양 고도)와 계절(날짜) 가중치는 그 자체가 연속이라 바뀌면 곧바로 반영한다(감쇠 없음).
    const altitude = sunAltitude ?? rootScene.userData[SUN_ALTITUDE_KEY];
    const night = Number.isFinite(altitude) ? getNightWeight(altitude) : isNight ? 1 : 0;
    const sceneMinute = rootScene.userData[SCENE_MINUTE_KEY];
    const windowGlow = Number.isFinite(altitude) && Number.isFinite(sceneMinute) ? windowGlowAt(sceneMinute, altitude) : night;
    const autumn = getAutumnWeight(date ?? new Date());
    const ramp = rampRef.current;
    const rampChanged =
      Math.abs(night - ramp.night) > RAMP_EPSILON
      || Math.abs(autumn - ramp.autumn) > RAMP_EPSILON
      || Math.abs(windowGlow - ramp.window) > RAMP_EPSILON;
    if (rampChanged) {
      if (Math.abs(autumn - ramp.autumn) > RAMP_EPSILON) {
        const summerColor = [0, 0, 0];
        const autumnColor = [0, 0, 0];
        for (const { mesh, summer, profiles, meanLuminance } of autumnCrownsRef.current) {
          const material = mesh.userData.originalColor;
          const instance = mesh.instanceColor.array;
          for (let i = 0; i < profiles.length; i += 1) {
            summerColor[0] = summer[i * 3];
            summerColor[1] = summer[i * 3 + 1];
            summerColor[2] = summer[i * 3 + 2];
            getAutumnInstanceColor(summerColor, meanLuminance, profiles[i], autumn, autumnColor);
            instance[i * 3] = autumnColor[0] / material.r;
            instance[i * 3 + 1] = autumnColor[1] / material.g;
            instance[i * 3 + 2] = autumnColor[2] / material.b;
          }
          mesh.instanceColor.needsUpdate = true;
        }
      }
      ramp.night = night;
      ramp.autumn = autumn;
      ramp.window = windowGlow;
      for (const pool of lampPoolsRef.current) {
        pool.material.opacity = night * LAMP_POOL_STRENGTH;
        pool.visible = night > 0;
      }
    }
    const transitioning = materialTransitionRef.current || rampChanged;

    if (transitioning) {
      // 선택·마우스오버 전환은 프레임 속도와 무관한 지수 감쇠. 탭 복귀 등 긴 프레임은 한 번에 끝까지 가도록 1로 수렴한다.
      const ease = materialTransitionRef.current
        ? 1 - Math.exp(-MATERIAL_EASE_RATE * Math.min(delta, 1))
        : 1;
      const glow = ramp.night;
      let maxDelta = 0;
      const selectedAnchor = selectedAnchorIdRef.current;
      const hasSelection = Boolean(selectedAnchor || selectedId);

      for (const child of tintedMeshesRef.current) {
        const { userData, material } = child;
        const isSelected = selectedAnchor
          ? userData.selectableElementId === selectedAnchor
          : Boolean(selectedId) && (userData.selectableName === selectedId || child.name === selectedId);
        const isHovered =
          userData.selectableName !== null && userData.selectableName === hoveredNameRef.current;
        const baseColor = scratchBaseColor.copy(userData.originalColor);
        baseColor.lerp(NIGHT_TINT_COLOR, NIGHT_TINT_MIX * ramp.night);
        const targetColor = isSelected
          ? selectionOutline
            ? baseColor
            : scratchHoverColor.copy(baseColor).lerp(SELECTION_COLOR, SELECTION_TINT_MIX)
          : isHovered
            ? scratchHoverColor.copy(baseColor).lerp(HOVER_COLOR, HOVER_TINT_MIX)
            : hasSelection
              ? baseColor.setRGB(dimLinearChannel(baseColor.r), dimLinearChannel(baseColor.g), dimLinearChannel(baseColor.b))
              : baseColor;

        // 낮음 단계의 선택 건물은 강조색으로 은은하게 빛난다(창문 발광 지도가 있는 재질은 밤 불빛이 발광을 쓰므로 건드리지 않는다).
        if (userData.originalEmissive && !userData.hasWindowGlow) {
          const emissiveTarget =
            isSelected && !selectionOutline
              ? scratchEmissive.copy(userData.originalEmissive).add(SELECTION_EMISSIVE)
              : scratchEmissive.copy(userData.originalEmissive ?? NO_EMISSIVE);
          const emissive = material.emissive;
          const emissiveRemaining = Math.max(
            Math.abs(emissiveTarget.r - emissive.r),
            Math.abs(emissiveTarget.g - emissive.g),
            Math.abs(emissiveTarget.b - emissive.b),
          );
          if (emissiveRemaining < MATERIAL_SETTLE_EPSILON) emissive.copy(emissiveTarget);
          else {
            emissive.lerp(emissiveTarget, ease);
            maxDelta = Math.max(maxDelta, emissiveRemaining * (1 - ease));
          }
        }

        const color = material.color;
        const remaining = Math.max(
          Math.abs(targetColor.r - color.r),
          Math.abs(targetColor.g - color.g),
          Math.abs(targetColor.b - color.b),
        );
        if (remaining < MATERIAL_SETTLE_EPSILON) {
          color.copy(targetColor);
        } else {
          color.lerp(scratchColor.copy(targetColor), ease);
          maxDelta = Math.max(maxDelta, remaining * (1 - ease));
        }

        if (userData.hasWindowGlow) {
          const glowTarget = (userData.isLampHead ? glow : glow * ramp.window) * userData.glowScale;
          const glowRemaining = glowTarget - material.emissiveIntensity;
          if (Math.abs(glowRemaining) < MATERIAL_SETTLE_EPSILON) {
            material.emissiveIntensity = glowTarget;
          } else {
            material.emissiveIntensity += glowRemaining * ease;
            maxDelta = Math.max(maxDelta, Math.abs(glowRemaining) * (1 - ease));
          }
        }
      }

      // 대리 프리즘은 선택(앵커 id, 요소 id 또는 패널 제목으로 쓰인 라벨)·마우스오버된 것만 보인다.
      // GLB의 Pick_Proxy 재질 색(분홍)은 쓰지 않고 선택은 강조색, 마우스오버는 호버 색으로 칠한다.
      for (const proxy of pickProxiesRef.current) {
        const proxySelected = selectedAnchor
          ? proxy.name === selectedAnchor
          : Boolean(selectedId) && (proxy.name === selectedId || proxy.userData.label === selectedId);
        const proxyHovered = proxy.name === hoveredNameRef.current;
        proxy.visible = proxySelected || proxyHovered;
        if (proxy.visible) proxy.material.color.copy(proxySelected ? SELECTION_COLOR : HOVER_COLOR);
      }

      if (maxDelta < MATERIAL_SETTLE_EPSILON) {
        materialTransitionRef.current = false;
      } else {
        // 멈춘 화면(frameloop demand)에서도 색 전환이 끝까지 가도록 다음 프레임을 요청한다. 선택은 렌더 창이 따로 열리지만
        // 마우스오버 강조는 그렇지 않아, 전에는 한두 프레임만 돌고 거의 칠해지지 않았다.
        invalidate();
      }
    }

    const stats = traverseStatsRef.current;
    if (stats) {
      const callsThisFrame = stats.calls - stats.lastCalls;
      stats.lastCalls = stats.calls;
      if (!transitioning && !focusFlightRef.current) {
        stats.idleFrames += 1;
        stats.idleMax = Math.max(stats.idleMax, callsThisFrame);
        if (!stats.logged && stats.idleFrames >= 120) {
          stats.logged = true;
          console.info(
            `[CityModel] scene.traverse calls per idle frame: ${stats.idleMax} (over ${stats.idleFrames} frames)`,
          );
        }
      }
    }

    // 드래그가 움직인 카메라와 클릭 포커스 비행(focusFlightRef) 중에는 근접만으로 건물·D4를 열지 않는다. 비행이 지나가는
    // 이웃 건물이 방금 클릭한 건물의 패널을 빼앗거나 D4 상세를 여는 일을 막는다. 상태는 계속 따라가서 이후 휠 줌은 그대로 동작한다.
    const autoOpenBlocked = dragDriven || focusFlightRef.current;
    if ((onBuildingProximity || onD4Enter) && labelAnchors.length > 0) {
      let nearest = null;
      let nearestDistance = Infinity;
      let d4Distance = Infinity;
      for (const anchor of labelAnchors) {
        // 대리 노드(부속 시설 등)는 미기후 데이터가 없으므로 근접만으로 패널을 열지 않는다. 클릭하면 열린다.
        if (anchor.proxy) continue;
        // labelAnchors의 position은 재중심화 그룹(-center) 적용 전 좌표라서,
        // 카메라와 같은 월드 좌표계로 맞추려면 center를 빼줘야 한다.
        const worldX = anchor.position[0] - center.x;
        const worldY = anchor.position[1];
        const worldZ = anchor.position[2] - center.z;
        const dx = camera.position.x - worldX;
        const dy = camera.position.y - worldY;
        const dz = camera.position.z - worldZ;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = anchor;
        }
        if (anchor.elementId === D4_ELEMENT_ID) {
          d4Distance = distance;
        }
      }

      if (onBuildingProximity) {
        const threshold = closeElementIdRef.current ? PROXIMITY_EXIT_DISTANCE : PROXIMITY_ENTER_DISTANCE;
        const nextCloseElementId = nearest && nearestDistance < threshold ? nearest.elementId : null;
        if (nextCloseElementId !== closeElementIdRef.current) {
          closeElementIdRef.current = nextCloseElementId;
          // 드래그(놓은 뒤 감쇠 포함)로 다가간 건물은 자동으로 열지 않는다. 멀어져서 닫는 것은 그대로 한다.
          if (!(autoOpenBlocked && nextCloseElementId)) onBuildingProximity(nextCloseElementId ? nearest : null);
        }
      }

      if (onD4Enter) {
        const isInside = isInsideD4Ref.current;
        const nextIsInside = d4Distance < D4_ENTER_DISTANCE;
        if (nextIsInside && !isInside) {
          isInsideD4Ref.current = true;
          if (!autoOpenBlocked) onD4Enter();
        } else if (!nextIsInside && isInside && d4Distance > D4_ENTER_DISTANCE * 1.3) {
          // 다시 트리거될 수 있도록, 확실히 멀어졌을 때만 "안에 있음" 상태를 푼다.
          isInsideD4Ref.current = false;
        }
      }
    }
  });

  // 카메라(와 near 평면)를 지면 위에 둔다. OrbitControls(우선순위 -1)·시점 비행·클릭 포커스가 이번 프레임의
  // 자리를 정한 뒤, 그 자리가 지면 + 여유보다 낮으면 같은 거리에서 위로 돌려 올린다. 렌더 전에 고치므로
  // 땅속 프레임이 보이지 않고, 지면 격자가 연속이라 올라가는 움직임도 매끄럽다. 라벨 패스보다 앞에 둔다.
  // 그다음 목표점에서 카메라까지 건물 벽이 있으면 카메라를 벽 앞으로 당기고, 카메라가 건물 안에 들어갔으면 바깥으로 밀어낸다
  // (buildingClearance.mjs). 벽이 비켜나면 사용자가 정한 거리로 돌아간다. 카메라·목표점이 그대로면 다시 검사하지 않는다.
  useFrame(() => {
    const grid = groundGridRef.current;
    const controls = controlsRef?.current;
    const target = controls?.target ?? null;
    let moved = false;
    if (grid) {
      const position = [camera.position.x, camera.position.y, camera.position.z];
      const groundAt = (x, z) => sampleGroundGrid(grid, x, z);
      const next = target
        ? clampOrbitAboveGround(position, [target.x, target.y, target.z], groundAt, {
            minPolarAngle: controls.minPolarAngle ?? 0,
          })
        : clampOrbitAboveGround(position, position, groundAt);
      if (next) {
        camera.position.set(next[0], next[1], next[2]);
        moved = true;
      }
    }
    const colliders = buildingCollidersRef.current;
    const pose = armPoseRef.current;
    if (target && colliders.length > 0 && !(pose.position.equals(camera.position) && pose.target.equals(target))) {
      const offset = pose.offset.copy(camera.position).sub(target);
      const actual = offset.length();
      if (actual > 1e-6) {
        const desired = cameraArm.desired(actual);
        offset.divideScalar(actual);
        const length = resolveArmLength(castBuildingHits(colliders, target, offset, desired + ARM_EXIT_SEARCH), desired);
        cameraArm.placed(length);
        if (Math.abs(length - actual) > 1e-4) {
          camera.position.copy(target).addScaledVector(offset, length);
          moved = true;
        }
      }
      pose.position.copy(camera.position);
      pose.target.copy(target);
    }
    if (!moved) return;
    if (target) camera.lookAt(target);
    camera.updateMatrixWorld();
  });

  // 라벨 패스: 앵커를 화면에 투영해 라벨 층에 넘기면, 층이 줌 단계(band)·우선순위·충돌 규칙으로 보일 칩을 정해 위치를 쓴다.
  // 카메라 뒤 앵커와 언덕(높이 사이드카)에 가려진 앵커는 넘기지 않는다. 열린 패널·지도 조작 UI 밑으로 들어가는 칩은 층이 숨긴다.
  // 숨긴 칩은 visibility: hidden이라 Tab 순서와 접근성 트리에서도 빠진다. D4 상세가 열린 동안(labelsHidden)은 모두 숨긴다.
  // 카메라·선택·패널이 바뀐 뒤에만 돈다. 카메라가 움직이는 동안에는 보이던 칩 묶음을 그대로 두고 위치만 따라간다.
  useFrame(() => {
    const controller = labelControllerRef.current;
    if (!controller) return;
    const area = gl.domElement.getBoundingClientRect();
    // 닫힌 패널은 화면 밖으로 밀려나 있을 뿐 DOM에 남는다. 캔버스와 겹치지 않는 패널은 가리개가 아니다(그 여백 12 px이
    // 화면 오른쪽 가장자리를 막아 가장자리로 밀어 넣은 칩까지 숨긴다).
    const panelRect = occluderRef?.current?.getBoundingClientRect() ?? null;
    const occluder =
      panelRect &&
      panelRect.left < area.right && panelRect.right > area.left && panelRect.top < area.bottom && panelRect.bottom > area.top
        ? panelRect
        : null;
    const chrome = [];
    for (const ref of chromeRefs ?? []) {
      const element = ref?.current;
      if (!element) continue;
      const parts = element.hasAttribute("data-label-chrome-layer") ? element.children : [element];
      for (const part of parts) {
        if (part.style?.transform) continue;
        const rect = part.getBoundingClientRect();
        if (rect.right > rect.left && rect.bottom > rect.top) chrome.push(rect);
      }
    }
    const rectKey = (rect) => `${rect.left},${rect.top},${rect.right},${rect.bottom}`;
    const frameKey = `${rectKey(area)}|${occluder ? rectKey(occluder) : ""}|${chrome.map(rectKey).join(";")}`;
    if (frameKey !== labelFrameKeyRef.current) {
      labelFrameKeyRef.current = frameKey;
      labelPassFramesRef.current = 2;
    }
    if (labelPassFramesRef.current <= 0) return;
    labelPassFramesRef.current -= 1;

    if (labelsHiddenRef.current || area.width === 0 || area.height === 0) {
      controller.update({ hidden: true });
      return;
    }
    const motion = motionSettle.isActive();
    const heightfield = labelHeightfieldRef.current;
    // 앵커와 사이드카는 재중심화 전 모델 좌표다. 카메라를 같은 좌표로 옮긴다.
    const eye = [camera.position.x + center.x, camera.position.y, camera.position.z + center.z];
    const forward = camera.getWorldDirection(labelForwardRef.current);
    const toScreen = (x, y, z) => {
      scratchProject.set(x, y, z).project(camera);
      return { x: area.left + ((scratchProject.x + 1) / 2) * area.width, y: area.top + ((1 - scratchProject.y) / 2) * area.height };
    };
    const target = controlsRef?.current?.target ?? null;
    const distance = target ? camera.position.distanceTo(target) : camera.position.length();
    const offset = target ? camera.position.clone().sub(target) : camera.position.clone();
    const pitchDegrees = THREE.MathUtils.radToDeg(Math.atan2(offset.y, Math.hypot(offset.x, offset.z)));
    const band = resolveLabelBand({
      distance,
      pitchDegrees,
      presetFromGround: Boolean(CAMERA_PRESETS.find((preset) => preset.id === activePresetIdRef.current)?.fromGround),
      presentation: presentationRef.current,
      touch: touchRef.current,
    });
    // 거리(street) 단계는 지면 높이의 눈에서 캠퍼스 안쪽을 본다. 눈 바로 앞 120 단위에는 건물이 거의 없으므로(정문 시점), 가까움은
    // 바라보는 곳(OrbitControls 목표점)에서 앵커까지의 수평 거리로 잰다. 다른 단계는 카메라에서 앵커까지의 거리다.
    const streetOrigin = band.band === "street" && target ? target : null;
    const points = new Map();
    for (const entry of labelEntries) {
      const [ax, ay, az] = entry.position;
      const wx = ax - center.x;
      const wz = az - center.z;
      const dx = wx - camera.position.x;
      const dy = ay - camera.position.y;
      const dz = wz - camera.position.z;
      // 카메라 뒤 앵커는 투영하면 화면 안으로 뒤집혀 들어온다. 앞쪽에 있는 앵커만 쓴다.
      if (dx * forward.x + dy * forward.y + dz * forward.z <= camera.near) continue;
      // 지형 가림은 멈춘 화면에서만 다시 본다(움직이는 동안은 보이던 칩을 바꾸지 않는다).
      if (!motion && isAnchorOccludedByTerrain(heightfield, eye, entry.position)) continue;
      const screen = toScreen(wx, ay, wz);
      // 멈춘 화면에서는 화면 밖·열린 패널 밑으로 투영되는 앵커를 후보에서 뺀다. 그런 칩도 순위에 들면 보이지 않으면서 단계별
      // 개수 상한을 차지해, 화면 안 건물의 칩이 상한에 밀려 숨는다. 선택된 건물은 늘 남는다(배치가 화면 안으로 끌어들인다).
      // 움직이는 동안에는 보이던 칩이 화면 밖으로 미끄러져 나가게 둔다.
      if (!motion && entry.elementId !== selectedAnchorIdRef.current) {
        const outside = screen.x < area.left || screen.x > area.right || screen.y < area.top || screen.y > area.bottom;
        const underPanel =
          occluder && screen.x >= occluder.left && screen.x <= occluder.right && screen.y >= occluder.top && screen.y <= occluder.bottom;
        if (outside || underPanel) continue;
      }
      const depth = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const distance = streetOrigin ? Math.hypot(wx - streetOrigin.x, wz - streetOrigin.z) : depth;
      points.set(entry.elementId, { x: screen.x, y: screen.y, depth, distance });
    }

    // 선택·호버한 건물의 화면 경계 상자: 그 뒤(더 먼 쪽)로 들어간 칩은 흐리게 한다(건물 가림 근사).
    const focusBoxes = [];
    for (const id of new Set([selectedAnchorIdRef.current, hoveredIdRef.current])) {
      const anchor = id ? anchorById.get(id) : null;
      if (!anchor?.box || !points.has(id)) continue;
      const [min, max] = anchor.box;
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const x of [min[0], max[0]]) {
        for (const y of [min[1], max[1]]) {
          for (const z of [min[2], max[2]]) {
            const corner = toScreen(x - center.x, y, z - center.z);
            left = Math.min(left, corner.x);
            right = Math.max(right, corner.x);
            top = Math.min(top, corner.y);
            bottom = Math.max(bottom, corner.y);
          }
        }
      }
      focusBoxes.push({ id, left, top, right, bottom, depth: points.get(id).depth });
    }

    controller.update({ points, area, chrome, occluder, focusBoxes, band, now: performance.now(), motion });

    // 모델(지면) 경계 사각형을 카메라 앞쪽(가까운 면 안)으로 잘라 화면에 투영한 꼭짓점들(data-model-edge, 화면 검사용).
    const edge = groundEdgeRef.current;
    const layer = gl.domElement.closest?.("[data-qa=campus-map-layer]");
    if (layer) {
      let value = "";
      if (edge) {
        const corners = [[edge.minX, edge.y, edge.minZ], [edge.maxX, edge.y, edge.minZ], [edge.maxX, edge.y, edge.maxZ], [edge.minX, edge.y, edge.maxZ]];
        const ahead = (p) => (p[0] - camera.position.x) * forward.x + (p[1] - camera.position.y) * forward.y + (p[2] - camera.position.z) * forward.z - camera.near * 2;
        const clipped = clipPolygonAhead(corners, ahead);
        if (clipped.length >= 3) value = clipped.map(([x, y, z]) => { const p = toScreen(x, y, z); return `${Math.round(p.x)},${Math.round(p.y)}`; }).join(";");
      }
      if (layer.dataset.modelEdge !== value) layer.dataset.modelEdge = value;
    }
  });

  // 고른 건물·묶음 쪽으로 800ms 비행한다. 지금 카메라가 있는 방위에서 D4 시점과 같은 거리로 다가간다.
  const flyToFocus = (point) => {
    const view = focusViewFrom({ position: camera.position.toArray() }, point.toArray(), D4_CAMERA_OFFSET);
    focusFlightRef.current = true;
    const flown = flyFocus({ id: "focus", ...view }, {
      onFinish: () => { focusFlightRef.current = false; },
      onCancel: () => { focusFlightRef.current = false; },
    });
    if (!flown) focusFlightRef.current = false;
  };

  // R3F는 pointerup에 delta를 계산하지 않는다(항상 0). 클릭 여부는 pointerGuard가 누른 위치·시간으로 판단한다.
  // 캔버스에서 시작한 누르기만 받는다. 라벨을 누른 pointerup도 R3F 래퍼로 올라와 뒤 건물을 한 번 더 선택하기 때문이다.
  const handleClick = (e) => {
    if (editing) return;
    const root = getSelectableRoot(e.object);
    const meta = getSelectableMeta(root);
    if (!meta) return;

    e.stopPropagation();
    if (!pointerGuard.acceptClick({ pointerId: e.pointerId, origin: "canvas" })) return;

    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    flyToFocus(center);

    const size = new THREE.Vector3();
    box.getSize(size);
    const area = Math.max(1, Math.round(size.x * size.z));

    if (onSelect) {
      onSelect(meta.name, area, [center.x, box.max.y + 6, center.z], meta.elementId);
    }

    if (onBuildingClick) {
      onBuildingClick({
        name: meta.dataElementId,
        parent: { name: meta.dataElementId },
        // 대리 노드는 선택 표시에 요소 id 대신 실제 건물 이름을 쓴다. buildingLabel은 라벨과 같은 이름으로,
        // 팝업 API가 없을 때 패널 제목이 BLD_* id로 나오지 않게 한다.
        userData: {
          ...(meta.proxy && meta.label ? { buildingName: meta.label } : {}),
          ...(meta.label ? { buildingLabel: meta.label } : {}),
          estimate: estimateOf(meta),
        },
      });
    }
  };

  const handlePointerOver = (e) => {
    const meta = getSelectableMeta(e.object);
    if (!meta || editing) return;

    e.stopPropagation();
    if (pointerGuard.isDragDriven()) return;
    document.body.style.cursor = "pointer";
    if (hoveredNameRef.current !== meta.name) {
      hoveredNameRef.current = meta.name;
      hoveredIdRef.current = meta.elementId;
      labelControllerRef.current?.setHovered(meta.elementId);
      materialTransitionRef.current = true;
      invalidate();
    }
  };

  const handlePointerOut = (e) => {
    document.body.style.cursor = "auto";
    const meta = getSelectableMeta(e.object);
    if (meta && hoveredNameRef.current === meta.name) {
      hoveredNameRef.current = null;
      hoveredIdRef.current = null;
      labelControllerRef.current?.setHovered(null);
      materialTransitionRef.current = true;
      invalidate();
    }
  };

  // 드래그로 끝난 누르기, 캔버스에서 시작해 라벨 위에서 놓은 드래그, 카메라가 움직이는 동안의 클릭은 무시한다.
  // 키보드(Enter/Space)로 누른 라벨은 detail이 0이다.
  const handleLabelClick = (anchor, event) => {
    if (!pointerGuard.acceptClick({ origin: "label", keyboard: event.detail === 0 })) return;
    if (onSelect) {
      onSelect(anchor.name, 1200, anchor.position, anchor.elementId);
    }

    if (onBuildingClick) {
      onBuildingClick({
        name: anchor.dataElementId,
        parent: { name: anchor.dataElementId },
        userData: {
          ...(anchor.proxy && anchor.displayName ? { buildingName: anchor.displayName } : {}),
          ...(anchor.displayName ? { buildingLabel: anchor.displayName } : {}),
          estimate: anchor.estimate,
        },
      });
    }
  };

  // 묶음 칩(학생생활관 5동 등)을 누르면 그 묶음 쪽으로 다가간다. 가까워지면 묶음이 동별 칩으로 풀린다.
  const handleClusterClick = (slot, event) => {
    if (!pointerGuard.acceptClick({ origin: "label", keyboard: event.detail === 0 })) return;
    const members = (slot.members ?? []).map((id) => anchorById.get(id)).filter(Boolean);
    if (members.length === 0) return;
    const sum = members.reduce((acc, anchor) => acc.add(new THREE.Vector3(...anchor.position)), new THREE.Vector3());
    sum.divideScalar(members.length);
    flyToFocus(new THREE.Vector3(sum.x - center.x, sum.y - 6, sum.z - center.z));
  };

  // 라벨 층 콜백은 한 번만 만들고 최신 핸들러를 ref로 부른다(층의 노드 풀이 콜백 때문에 다시 그려지지 않게).
  const labelHandlersRef = useRef(null);
  labelHandlersRef.current = {
    onSelect: (slot, event) => {
      // Shift+클릭: 고르지 않고 비교 묶음에 넣는다(건물만).
      if (event?.shiftKey && onCompare && slot.id?.startsWith("BLD_")) {
        onCompare(slot.id);
        return;
      }
      const anchor = anchorById.get(slot.id);
      if (anchor) handleLabelClick(anchor, event);
    },
    onSelectCluster: handleClusterClick,
    onClear: () => onSelect?.(""),
  };
  const [labelCallbacks] = useState(() => ({
    onSelect: (slot, event) => labelHandlersRef.current.onSelect(slot, event),
    onSelectCluster: (slot, event) => labelHandlersRef.current.onSelectCluster(slot, event),
    onClear: () => labelHandlersRef.current.onClear(),
    onRequestPass: () => {
      labelPassFramesRef.current = 2;
      invalidate();
    },
  }));

  // 라벨 층은 R3F DOM 밖, 캔버스 옆에 붙는 한 장의 DOM이다(별도 React 루트). 캔버스와 같은 크기로 겹친다.
  useLayoutEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return undefined;
    const host = document.createElement("div");
    host.style.cssText = LABEL_HOST_STYLE;
    parent.appendChild(host);
    const root = createRoot(host);
    labelRootRef.current = root;
    return () => {
      labelRootRef.current = null;
      labelControllerRef.current = null;
      // 다른 루트가 커밋하는 도중에는 동기로 언마운트할 수 없다.
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
    };
  }, [gl]);

  useLayoutEffect(() => {
    labelRootRef.current?.render(
      <CampusLabelLayer
        entries={labelEntries}
        selectedId={selectedAnchorId}
        headlineById={headlineById}
        controllerRef={labelControllerRef}
        {...labelCallbacks}
      />,
    );
  });

  return (
    <>
      <group position={[-center.x, 0, -center.z]}>
        <primitive
          object={scene}
          {...props}
          onPointerUp={handleClick}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        />
        {CAMPUS_MODEL_URL === CAMPUS_MODEL_URLS.detailed && <CampusGrass scene={scene} quality={quality} />}
      {CAMPUS_MODEL_URL === CAMPUS_MODEL_URLS.detailed && <E2Worksite obscured={labelsHidden} controlsRef={controlsRef} />}
      </group>
      <ModelEditorScene scene={scene} controlsRef={controlsRef} />
    </>
  );
}

useGLTF.preload(CAMPUS_MODEL_URL, true, true, extendCampusLoader);
