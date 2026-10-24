import { Html, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import commonElements from "../../common/data/common_elemetns.json";
import { resolveBuildingMeta } from "./utils/buildingLabels.mjs";
import { isCampusLabelVisible } from "./utils/campusLabelVisibility.mjs";
import { campusModelCenter } from "./simulation/utils/campusTrafficCoordinates.mjs";
import { CAMPUS_MODEL_URL } from "./campusModelAsset.mjs";

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

// 색 전환은 선택/주야가 바뀐 뒤에만, 남은 차이가 이 값보다 작아질 때까지 돈다.
const MATERIAL_SETTLE_EPSILON = 1e-3;
const MATERIAL_EASE_RATE = 8;
const SELECTED_COLOR = new THREE.Color("#ffb8c6");
const NIGHT_TINT_COLOR = new THREE.Color("#c8d6e5");
// 프레임마다 새 객체를 만들지 않도록 재사용하는 스크래치 값.
const scratchColor = new THREE.Color();
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
  isNight = false,
  // D4 상세가 열려 있는 동안 켜진다. 투명한 상세 화면 뒤로 라벨이 비치지 않게 숨기되,
  // 상세를 연 라벨이 닫힌 뒤 포커스를 돌려받을 수 있도록 마운트는 유지한다.
  labelsHidden = false,
  // 열린 대시보드 패널 요소. 패널 밑으로 들어간 라벨은 숨겨 키보드 포커스가 보이지 않는 곳으로 가지 않게 한다.
  occluderRef,
  ...props
}) {
  const { scene } = useGLTF(CAMPUS_MODEL_URL);
  const { camera, gl } = useThree();
  const [targetPos, setTargetPos] = useState(null);
  const [labelScale, setLabelScale] = useState(1);
  const tintedMeshesRef = useRef([]);
  const materialTransitionRef = useRef(true);
  const traverseStatsRef = useRef(null);
  const closeElementIdRef = useRef(null);
  const isInsideD4Ref = useRef(false);
  const labelElementsRef = useRef(new Map());
  const labelsHiddenRef = useRef(labelsHidden);

  useLayoutEffect(() => {
    labelsHiddenRef.current = labelsHidden;
  }, [labelsHidden]);

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

    updateLabelScale();

    if (!controls) return;

    controls.addEventListener("change", updateLabelScale);
    return () => controls.removeEventListener("change", updateLabelScale);
  }, [camera, controlsRef]);

  useEffect(() => {
    if (!scene) return;

    const anisotropy = gl.capabilities.getMaxAnisotropy();
    const tintedMeshes = [];
    const nonCasterNames = [];
    scene.traverse((child) => {
      if (!child.isMesh) return;

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
        child.userData.nightColor = child.userData.originalColor
          .clone()
          .lerp(NIGHT_TINT_COLOR, 0.16);
        tintedMeshes.push(child);
      }
      // campus-v2.glb: sharper ground/facade textures at grazing angles, and window glow only at night.
      if (child.material.map) child.material.map.anisotropy = anisotropy;
      if (child.material.emissiveMap) {
        child.userData.hasWindowGlow = true;
        child.material.emissiveIntensity = 0;
      }
    });
    tintedMeshesRef.current = tintedMeshes;
    if (traverseStatsRef.current) traverseStatsRef.current.nonCasterNames = nonCasterNames;
    materialTransitionRef.current = true;
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
    const transitioning = materialTransitionRef.current;

    if (transitioning) {
      // 프레임 속도와 무관한 지수 감쇠. 탭 복귀 등 긴 프레임은 한 번에 끝까지 가도록 1로 수렴한다.
      const ease = 1 - Math.exp(-MATERIAL_EASE_RATE * Math.min(delta, 1));
      const glow = isNight ? 1 : 0;
      let maxDelta = 0;

      for (const child of tintedMeshesRef.current) {
        const { userData, material } = child;
        const isSelected =
          userData.selectableName === selectedId || child.name === selectedId;
        const targetColor = isSelected
          ? SELECTED_COLOR
          : isNight
            ? userData.nightColor
            : userData.originalColor;

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
          const glowRemaining = glow - material.emissiveIntensity;
          if (Math.abs(glowRemaining) < MATERIAL_SETTLE_EPSILON) {
            material.emissiveIntensity = glow;
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
  // visibility: hidden은 Tab 순서와 접근성 트리에서도 빠지므로 키보드 포커스가 보이지 않는 라벨로 가지 않는다.
  // D4 상세가 열린 동안(labelsHidden)은 모두 숨긴다. 위치를 모두 읽은 뒤에 쓰기를 해 레이아웃 계산을 한 번으로 줄인다.
  useFrame(() => {
    const labels = labelElementsRef.current;
    if (labels.size === 0) return;
    const area = gl.domElement.getBoundingClientRect();
    const occluder = occluderRef?.current?.getBoundingClientRect() ?? null;
    const hideAll = labelsHiddenRef.current;
    const decisions = [...labels.values()].map((element) => [
      element,
      !hideAll && isCampusLabelVisible(element.getBoundingClientRect(), area, occluder),
    ]);
    for (const [element, visible] of decisions) {
      const next = visible ? "" : "hidden";
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
    setIsAutoFocusing(true);
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
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
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
              }}
              data-qa="campus-label"
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
