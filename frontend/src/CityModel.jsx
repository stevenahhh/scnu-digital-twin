import { Html, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import commonElements from "../../common/data/common_elemetns.json";
import { resolveBuildingMeta } from "./utils/buildingLabels.mjs";
import { isAnchorOccludedByTerrain, selectVisibleCampusLabels } from "./utils/campusLabelVisibility.mjs";
import { campusModelCenter } from "./simulation/utils/campusTrafficCoordinates.mjs";
import { CAMPUS_MODEL_URL, CAMPUS_MODEL_URLS } from "./campusModelAsset.mjs";
import { CAMPUS_HEIGHTFIELD_URLS, loadHeightfield } from "./terrain/heightfield.mjs";
import {
  AUTUMN_MATERIAL_NAMES,
  SUN_ALTITUDE_KEY,
  getAutumnInstanceColor,
  getAutumnProfile,
  getAutumnWeight,
  getNightWeight,
} from "./lighting/season.mjs";

// 클릭하지 않아도 카메라가 이 거리 안으로 들어오면 "가까이 간" 것으로 본다.
// 클릭 시 자동으로 붙는 카메라 거리(FOCUS_CAMERA_OFFSET 기준 약 94유닛)보다 살짝
// 넉넉하게 잡아서, 자동 포커스로 도착했을 때도 자연스럽게 이 범위 안에 들어오게 한다.
// 빠져나갈 때는 더 넉넉한 거리(EXIT)를 써서 경계선에서 들어왔다 나갔다 깜빡이지
// 않게 한다 — 진입은 ENTER, 이미 가까운 상태를 유지하는 건 EXIT 기준으로 판단.
const PROXIMITY_ENTER_DISTANCE = 120;
const PROXIMITY_EXIT_DISTANCE = 170;

// D4는 근접만으로 "공간 탐색" 화면 자체를 열어버리는, 훨씬 더 무거운 전환이라
// 일반 미기후 근접(120)보다 확실히 더 가까이(줌인) 다가갔을 때만 반응하게 한다.
const D4_ENTER_DISTANCE = 55;
const D4_ELEMENT_ID = "BLD_D4";
// 라벨 지형 가림 판정에 쓰는 높이 사이드카는 campus-v2.glb와 함께 만들어진다. ?model=uni에는 없으므로 판정을 건너뛴다.
const LABEL_HEIGHTFIELD_URLS = CAMPUS_MODEL_URL === CAMPUS_MODEL_URLS.detailed ? CAMPUS_HEIGHTFIELD_URLS : null;

const BLOCKED_ELEMENT_IDS = new Set(["BLD_C1001"]);
const BUILDING_MAP = {
  대학본부: "BLD_A1",
  약학대학: "BLD_A2",
  천연물신약연구소: "BLD_A3",
  생활관: "BLD_A4",
  박물관: "BLD_B1",
  "70주년기념관": "BLD_B2",
  생명대: "BLD_B3",
  도서관: "BLD_C1",
  학생회관: "BLD_E1",
  사범대: "BLD_E2",
  창업보육센터: "BLD_D1",
  공과대1호: "BLD_D2",
  공과대2호: "BLD_D3",
  공과대3호: "BLD_D4",
};

const FOCUS_CAMERA_OFFSET = new THREE.Vector3(60, 50, 60);

// 인스턴싱된 줄기는 노드 자체가 메시가 되기도 하므로 자신과 부모 이름을 모두 본다.
// 지형(Ground)과 나무 줄기는 그림자를 드리울 필요가 없다: 지면은 스스로를 가리지 않고,
// 줄기는 수관 그림자에 묻힌다. 둘 다 그림자를 받는 것(receiveShadow)은 유지한다.
const NON_CASTER_MATERIAL_NAME = "Ground";
const NON_CASTER_PARENT_PATTERN = /^Trees_.*_trunk/;
// 가로등(Lamp_*): 실제 조명 없이 밤에만 머리(Lamp_Head)가 빛나고 바닥 빛 웅덩이(Lamp_Pool)를 가산 합성으로 그린다.
// 그림자·클릭 대상에서 빼고, 웅덩이는 낮에는 숨겨 드로우콜을 쓰지 않는다. 캠퍼스 안쪽 가로등 위치는 추정값이다.
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
const MATERIAL_EASE_RATE = 8;
const SELECTED_COLOR = new THREE.Color("#ffb8c6");
const NIGHT_TINT_COLOR = new THREE.Color("#c8d6e5");
const NIGHT_TINT_MIX = 0.16;
// 가을 단풍(추정): 활엽수 수관(Tree_Crown) 인스턴스마다 수종 비슷한 색(은행 노랑, 느티 적갈, 벚 빨강, 늦게 물드는 초록)과
// 물드는 시점을 해시로 정해, 날짜 가중치가 바뀔 때만 인스턴스 색(instanceColor)을 다시 쓴다. 소나무(Tree_Pine)는 그대로.
// 수종 배정은 추정값이며 실제 수목 조사 결과가 아니다.
// 주야·계절 가중치가 이만큼 바뀌어야 재질을 다시 쓴다.
const RAMP_EPSILON = 1e-4;
// 마우스를 올린 건물은 평소 색을 선택 색 쪽으로 조금만 옮긴다. 선택(색 전체 교체)보다 약하다.
// 재질은 메시마다 복제돼 있어 다른 건물로 번지지 않는다.
const HOVER_TINT_COLOR = new THREE.Color("#ffe0e8");
const HOVER_TINT_MIX = 0.3;
// 프레임마다 새 객체를 만들지 않도록 재사용하는 스크래치 값.
const scratchColor = new THREE.Color();
const scratchHoverColor = new THREE.Color();
const scratchBaseColor = new THREE.Color();
const scratchCamPos = new THREE.Vector3();
const ELEMENT_NAME_MAP = new Map(
  commonElements.elements.map((element) => [element.element_id, element.name]),
);

function getSelectableMeta(object) {
  const rawName =
    object?.parent && object.parent.name !== "Scene"
      ? object.parent.name
      : object?.name;

  if (!rawName) return null;

  const buildingMeta = resolveBuildingMeta(rawName, {
    elementNames: ELEMENT_NAME_MAP,
    buildingMap: BUILDING_MAP,
    blockedIds: BLOCKED_ELEMENT_IDS,
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

  return {
    name: rawName,
    elementId: buildingMeta.elementId,
    label: buildingMeta.label,
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

function buildLabelAnchors(scene) {
  const anchors = new Map();

  scene.traverse((child) => {
    if (!child.isMesh) return;

    const root = getSelectableRoot(child);
    const meta = getSelectableMeta(root);
    if (!meta || anchors.has(meta.elementId)) return;

    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    anchors.set(meta.elementId, {
      name: meta.name,
      displayName: meta.label,
      elementId: meta.elementId,
      position: [center.x, box.max.y + 6, center.z],
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
  ...props
}) {
  const { scene } = useGLTF(CAMPUS_MODEL_URL);
  const { camera, gl, scene: rootScene, invalidate } = useThree();
  const [targetPos, setTargetPos] = useState(null);
  const [labelScale, setLabelScale] = useState(1);
  const tintedMeshesRef = useRef([]);
  const lampPoolsRef = useRef([]);
  const autumnCrownsRef = useRef([]);
  const materialTransitionRef = useRef(true);
  // 현재 재질에 반영된 단풍 혼합 비율과 야간 가중치. -1은 아직 한 번도 쓰지 않았다는 뜻.
  const rampRef = useRef({ autumn: -1, night: -1 });
  const traverseStatsRef = useRef(null);
  const closeElementIdRef = useRef(null);
  const isInsideD4Ref = useRef(false);
  const labelElementsRef = useRef(new Map());
  const labelsHiddenRef = useRef(labelsHidden);
  const selectedIdRef = useRef(selectedId);
  const hoveredNameRef = useRef(null);
  // 라벨 위치를 다시 읽어야 하는 남은 프레임 수. drei Html이 같은 프레임의 뒤쪽에서 위치를 옮길 수 있어
  // 한 번 더 읽도록 2로 둔다. 캔버스·패널 사각형이 바뀌었는지는 매 프레임 비교한다.
  const labelPassFramesRef = useRef(2);
  const labelFrameKeyRef = useRef("");
  const labelHeightfieldRef = useRef(null);

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

  useLayoutEffect(() => {
    labelsHiddenRef.current = labelsHidden;
    selectedIdRef.current = selectedId;
    labelPassFramesRef.current = 2;
  }, [labelsHidden, selectedId, labelScale]);

  useEffect(() => {
    const controls = controlsRef?.current;
    if (!controls) return;

    // 사용자가 직접 조작을 시작하면 자동 포커스 비행을 즉시 취소한다.
    const handleInteraction = () => {
      setTargetPos(null);
    };

    controls.addEventListener("start", handleInteraction);
    return () => controls.removeEventListener("start", handleInteraction);
  }, [controlsRef]);

  useEffect(() => {
    materialTransitionRef.current = true;
  }, [selectedId, isNight]);

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

  useEffect(() => {
    const controls = controlsRef?.current;

    const updateLabelScale = () => {
      const distance = controls
        ? camera.position.distanceTo(controls.target)
        : camera.position.length();
      const nextScale = THREE.MathUtils.clamp(165 / Math.max(distance, 1), 0.72, 1.45);

      setLabelScale((current) =>
        Math.abs(current - nextScale) < 0.02 ? current : nextScale,
      );
    };

    const handleChange = () => {
      labelPassFramesRef.current = 2;
      updateLabelScale();
    };

    updateLabelScale();

    if (!controls) return;

    controls.addEventListener("change", handleChange);
    return () => controls.removeEventListener("change", handleChange);
  }, [camera, controlsRef]);

  useEffect(() => {
    if (!scene) return;

    const anisotropy = gl.capabilities.getMaxAnisotropy();
    const tintedMeshes = [];
    const lampPools = [];
    const autumnCrowns = [];
    let autumnIndex = 0;
    const nonCasterNames = [];
    scene.traverse((child) => {
      if (!child.isMesh) return;

      if (LAMP_MATERIAL_PATTERN.test(child.material?.name ?? "")) {
        child.castShadow = false;
        child.raycast = () => {};
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

      const isNonCaster =
        child.material?.name === NON_CASTER_MATERIAL_NAME ||
        NON_CASTER_PARENT_PATTERN.test(child.parent?.name ?? "") ||
        NON_CASTER_PARENT_PATTERN.test(child.name);
      child.castShadow = !isNonCaster;
      if (isNonCaster) nonCasterNames.push(child.name);
      child.receiveShadow = true;
      child.material = child.material.clone();
      child.userData.selectableName = getSelectableMeta(child)?.name ?? null;

      if (!child.userData.originalColor && child.material.color) {
        child.userData.originalColor = child.material.color.clone();
      }
      if (child.userData.originalColor) {
        tintedMeshes.push(child);
      }
      if (child.isInstancedMesh && AUTUMN_MATERIAL_NAMES.has(child.material.name)) {
        if (!child.instanceColor) {
          for (let i = 0; i < child.count; i += 1) child.setColorAt(i, new THREE.Color(1, 1, 1));
        }
        const material = child.userData.originalColor;
        const instance = child.instanceColor.array;
        // 여름 수관 색 = 재질 색 x 인스턴스 색. 단풍 색을 만든 뒤 다시 재질 색으로 나눠 인스턴스 색에 쓴다.
        const summer = new Float32Array(child.count * 3);
        const profiles = [];
        let luminanceSum = 0;
        for (let i = 0; i < child.count; i += 1) {
          summer[i * 3] = instance[i * 3] * material.r;
          summer[i * 3 + 1] = instance[i * 3 + 1] * material.g;
          summer[i * 3 + 2] = instance[i * 3 + 2] * material.b;
          luminanceSum +=
            0.2126 * summer[i * 3] + 0.7152 * summer[i * 3 + 1] + 0.0722 * summer[i * 3 + 2];
          profiles.push(getAutumnProfile(autumnIndex));
          autumnIndex += 1;
        }
        autumnCrowns.push({
          mesh: child,
          summer,
          profiles,
          meanLuminance: luminanceSum / Math.max(child.count, 1),
        });
      }
      // campus-v2.glb: sharper ground/facade textures at grazing angles, and window glow only at night.
      if (child.material.map) child.material.map.anisotropy = anisotropy;
      if (child.material.emissiveMap) {
        child.userData.hasWindowGlow = true;
        // 재질에 정해 둔 발광 세기(가로등 머리는 KHR_materials_emissive_strength)를 밤 가중치의 최댓값으로 쓴다.
        child.userData.glowScale = child.material.emissiveIntensity;
        child.material.emissiveIntensity = 0;
      }
    });
    tintedMeshesRef.current = tintedMeshes;
    lampPoolsRef.current = lampPools;
    autumnCrownsRef.current = autumnCrowns;
    if (traverseStatsRef.current) traverseStatsRef.current.nonCasterNames = nonCasterNames;
    materialTransitionRef.current = true;
    rampRef.current = { autumn: -1, night: -1 };
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
    const { x, z } = campusModelCenter(d4Anchor.position);
    return new THREE.Vector3(x, 0, z);
  }, [labelAnchors]);

  useFrame((_, delta) => {
    const controls = controlsRef?.current;

    // 주야(태양 고도)와 계절(날짜) 가중치는 그 자체가 연속이라 바뀌면 곧바로 반영한다(감쇠 없음).
    const altitude = sunAltitude ?? rootScene.userData[SUN_ALTITUDE_KEY];
    const night = Number.isFinite(altitude) ? getNightWeight(altitude) : isNight ? 1 : 0;
    const autumn = getAutumnWeight(date ?? new Date());
    const ramp = rampRef.current;
    const rampChanged =
      Math.abs(night - ramp.night) > RAMP_EPSILON || Math.abs(autumn - ramp.autumn) > RAMP_EPSILON;
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

      for (const child of tintedMeshesRef.current) {
        const { userData, material } = child;
        const isSelected =
          userData.selectableName === selectedId || child.name === selectedId;
        const isHovered =
          userData.selectableName !== null && userData.selectableName === hoveredNameRef.current;
        const baseColor = scratchBaseColor.copy(userData.originalColor);
        baseColor.lerp(NIGHT_TINT_COLOR, NIGHT_TINT_MIX * ramp.night);
        const targetColor = isSelected
          ? SELECTED_COLOR
          : isHovered
            ? scratchHoverColor.copy(baseColor).lerp(HOVER_TINT_COLOR, HOVER_TINT_MIX)
            : baseColor;

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
          const glowTarget = glow * userData.glowScale;
          const glowRemaining = glowTarget - material.emissiveIntensity;
          if (Math.abs(glowRemaining) < MATERIAL_SETTLE_EPSILON) {
            material.emissiveIntensity = glowTarget;
          } else {
            material.emissiveIntensity += glowRemaining * ease;
            maxDelta = Math.max(maxDelta, Math.abs(glowRemaining) * (1 - ease));
          }
        }
      }

      if (maxDelta < MATERIAL_SETTLE_EPSILON) {
        materialTransitionRef.current = false;
      }
    }

    if (targetPos && controls) {
      controls.target.lerp(targetPos, 0.08);
      const desiredCamPos = scratchCamPos.copy(targetPos).add(FOCUS_CAMERA_OFFSET);
      camera.position.lerp(desiredCamPos, 0.04);
      controls.update();
    }

    const stats = traverseStatsRef.current;
    if (stats) {
      const callsThisFrame = stats.calls - stats.lastCalls;
      stats.lastCalls = stats.calls;
      if (!transitioning && !targetPos) {
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

    if ((onBuildingProximity || onD4Enter) && labelAnchors.length > 0) {
      let nearest = null;
      let nearestDistance = Infinity;
      let d4Distance = Infinity;
      for (const anchor of labelAnchors) {
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
          onBuildingProximity(nextCloseElementId ? nearest : null);
        }
      }

      if (onD4Enter) {
        const isInside = isInsideD4Ref.current;
        const nextIsInside = d4Distance < D4_ENTER_DISTANCE;
        if (nextIsInside && !isInside) {
          isInsideD4Ref.current = true;
          onD4Enter();
        } else if (!nextIsInside && isInside && d4Distance > D4_ENTER_DISTANCE * 1.3) {
          // 다시 트리거될 수 있도록, 확실히 멀어졌을 때만 "안에 있음" 상태를 푼다.
          isInsideD4Ref.current = false;
        }
      }
    }
  });

  // 라벨은 가운데 점이 캔버스 안에 있고 열린 대시보드 패널 밑에 있지 않을 때만 보인다.
  // 서로 겹치면 선택된 라벨, 팝업 데이터가 있는 BLD_* 라벨, 카메라에 가까운 라벨 순으로 남기고 나머지는 숨긴다.
  // visibility: hidden은 Tab 순서와 접근성 트리에서도 빠지므로 키보드 포커스가 보이지 않는 라벨로 가지 않는다.
  // 카메라에서 앵커로 가는 시선이 언덕(높이 사이드카)에 막히는 라벨도 하늘에 떠 보이지 않게 숨긴다.
  // D4 상세가 열린 동안(labelsHidden)은 모두 숨긴다. 라벨 사각형은 카메라·선택·패널이 바뀐 뒤에만 읽고,
  // 위치를 모두 읽은 뒤에 쓰기를 해 레이아웃 계산을 한 번으로 줄인다.
  useFrame(() => {
    const labels = labelElementsRef.current;
    if (labels.size === 0) return;
    const area = gl.domElement.getBoundingClientRect();
    const occluder = occluderRef?.current?.getBoundingClientRect() ?? null;
    const frameKey = `${area.left},${area.top},${area.right},${area.bottom}|${
      occluder ? `${occluder.left},${occluder.top},${occluder.right},${occluder.bottom}` : ""
    }`;
    if (frameKey !== labelFrameKeyRef.current) {
      labelFrameKeyRef.current = frameKey;
      labelPassFramesRef.current = 2;
    }
    if (labelPassFramesRef.current <= 0) return;
    labelPassFramesRef.current -= 1;

    const hideAll = labelsHiddenRef.current;
    let visibleIds = null;
    if (!hideAll) {
      const selected = selectedIdRef.current;
      const heightfield = labelHeightfieldRef.current;
      // 앵커와 사이드카는 재중심화 전 모델 좌표다. 카메라를 같은 좌표로 옮긴다.
      const eye = [camera.position.x + center.x, camera.position.y, camera.position.z + center.z];
      const candidates = [];
      for (const anchor of labelAnchors) {
        const element = labels.get(anchor.elementId);
        if (!element) continue;
        if (isAnchorOccludedByTerrain(heightfield, eye, anchor.position)) continue;
        const dx = camera.position.x - (anchor.position[0] - center.x);
        const dy = camera.position.y - anchor.position[1];
        const dz = camera.position.z - (anchor.position[2] - center.z);
        candidates.push({
          id: anchor.elementId,
          rect: element.getBoundingClientRect(),
          selected: anchor.name === selected,
          hasPopup: anchor.elementId.startsWith("BLD_") && ELEMENT_NAME_MAP.has(anchor.elementId),
          distance: dx * dx + dy * dy + dz * dz,
        });
      }
      visibleIds = selectVisibleCampusLabels(candidates, area, occluder);
    }
    for (const [elementId, element] of labels) {
      const next = visibleIds?.has(elementId) ? "" : "hidden";
      if (element.style.visibility !== next) element.style.visibility = next;
    }
  });

  const handleClick = (e) => {
    if (e.delta > 2) return;

    const root = getSelectableRoot(e.object);
    const meta = getSelectableMeta(root);
    if (!meta) return;

    e.stopPropagation();

    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    setTargetPos(center);

    const size = new THREE.Vector3();
    box.getSize(size);
    const area = Math.max(1, Math.round(size.x * size.z));

    if (onSelect) {
      onSelect(meta.name, area, [center.x, box.max.y + 6, center.z]);
    }

    if (onBuildingClick) {
      onBuildingClick({
        name: meta.elementId,
        parent: { name: meta.elementId },
      });
    }
  };

  const handlePointerOver = (e) => {
    const meta = getSelectableMeta(e.object);
    if (!meta) return;

    e.stopPropagation();
    document.body.style.cursor = "pointer";
    if (hoveredNameRef.current !== meta.name) {
      hoveredNameRef.current = meta.name;
      materialTransitionRef.current = true;
    }
  };

  const handlePointerOut = (e) => {
    document.body.style.cursor = "auto";
    const meta = getSelectableMeta(e.object);
    if (meta && hoveredNameRef.current === meta.name) {
      hoveredNameRef.current = null;
      materialTransitionRef.current = true;
    }
  };

  const handleLabelClick = (anchor) => {
    if (onSelect) {
      onSelect(anchor.name, 1200, anchor.position);
    }

    if (onBuildingClick) {
      onBuildingClick({
        name: anchor.elementId,
        parent: { name: anchor.elementId },
      });
    }
  };

  return (
    <group position={[-center.x, 0, -center.z]}>
      <primitive
        object={scene}
        {...props}
        onPointerUp={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      />

      {labelAnchors.map((anchor) => {
        const isSelected = anchor.name === selectedId;

        return (
          <Html
            key={anchor.elementId}
            position={anchor.position}
            zIndexRange={[120, 0]}
          >
            <div
              ref={(element) => {
                if (element) labelElementsRef.current.set(anchor.elementId, element);
                else labelElementsRef.current.delete(anchor.elementId);
                labelPassFramesRef.current = 2;
              }}
              data-qa="campus-label"
              data-element-id={anchor.elementId}
              className="pointer-events-auto flex flex-col items-center whitespace-nowrap"
              style={{
                transform: `translate(-50%, calc(-100% - 4px)) scale(${labelScale})`,
                transformOrigin: "bottom center",
              }}
            >
              <button
                type="button"
                onClick={() => handleLabelClick(anchor)}
                className={`rounded-[10px] border px-3 py-1 text-[11px] font-black whitespace-nowrap shadow-[0_10px_24px_rgba(15,23,42,0.35)] ${
                  isSelected
                    ? "border-[var(--colors-primary)] bg-[var(--colors-surface-1)] text-[var(--colors-primary)]"
                    : "border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] text-[var(--colors-ink)]"
                }`}
              >
                {anchor.displayName}
              </button>
            </div>
          </Html>
        );
      })}
    </group>
  );
}

useGLTF.preload(CAMPUS_MODEL_URL);
