import { Canvas, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { Check } from "lucide-react";
import { ACCENT_HEX, D4_SCENE } from "../ui/sceneTokens.mjs";
import { D4_SCENE_LABEL } from "./d4Shared.mjs";
import { cx } from "../ui/cx.mjs";
import { SceneLabel } from "../ui/SceneLabel.jsx";

const ACTIVE_COLOR = ACCENT_HEX;
const IDLE_COLOR = D4_SCENE.floorIdle;
const FLOOR_STEP = 1.0;
const BOX_HEIGHT = 0.82;
const BOX_WIDTH = 2.1;
const BOX_DEPTH = 1.6;

function Tower({ wing, x, isActive, onSelectFloor }) {
  const levels = useMemo(() => {
    const floors = Array.from({ length: wing.floors }, (_, i) => i + 1);
    return wing.hasBasement ? [0, ...floors] : floors;
  }, [wing.floors, wing.hasBasement]);

  return (
    <group position={[x, 0, 0]}>
      <Html position={[0, (levels[levels.length - 1] + 1) * FLOOR_STEP + 0.15, 0]} center style={{ pointerEvents: "none" }}>
        <div
          // 고른 동은 강조색 글자 대신 체크 표시로 알린다(강조색은 선택 표시와 주 동작에만 쓴다, V-Q-21).
          className={cx("pointer-events-none inline-flex items-center gap-1 whitespace-nowrap", D4_SCENE_LABEL, "text-body")}
        >
          {isActive && <Check aria-hidden="true" className="h-3 w-3 shrink-0" />}
          {wing.label}
        </div>
      </Html>
      {levels.map((floor) => {
        const y = floor * FLOOR_STEP;
        return (
          <group key={floor} position={[0, y, 0]}>
            <mesh
              onPointerUp={(event) => {
                event.stopPropagation();
                onSelectFloor(wing.id, floor);
              }}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[BOX_WIDTH, BOX_HEIGHT, BOX_DEPTH]} />
              <meshStandardMaterial color={isActive ? ACTIVE_COLOR : IDLE_COLOR} transparent opacity={0.88} />
            </mesh>
            <Html position={[0, 0, BOX_DEPTH / 2 + 0.02]} center>
              {/* 캠퍼스 이름표와 같은 장면 라벨(SceneLabel, 작은 단계). */}
              <SceneLabel
                size="sm"
                tier={3}
                name={floor === 0 ? "B1" : `${floor}F`}
                data-qa="d4-floor-label"
                aria-label={`${floor === 0 ? "지하 1" : floor}층 선택`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectFloor(wing.id, floor);
                }}
                hit="compact"
                className="pointer-events-auto [@media(pointer:coarse)]:hidden max-[639px]:hidden"
              />
              {/* 터치·폰: 층 간격이 44px 누름 영역보다 좁아 이름표는 보이기만 하고, 층은 장면 아래 버튼 목록으로 고른다. */}
              <span
                aria-hidden="true"
                className={cx("pointer-events-none hidden whitespace-nowrap border border-hairline [@media(pointer:coarse)]:inline-block max-[639px]:inline-block", D4_SCENE_LABEL)}
              >
                {floor === 0 ? "B1" : `${floor}F`}
              </span>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function BridgeConnector({ floor }) {
  const y = floor * FLOOR_STEP;
  return (
    <group position={[0, y, 0]}>
      <mesh castShadow>
        <boxGeometry args={[2.6, 0.16, 0.7]} />
        <meshStandardMaterial color={ACTIVE_COLOR} transparent opacity={0.75} />
      </mesh>
      <Html position={[0, 0.42, 0]} center style={{ pointerEvents: "none" }}>
        <div className={cx("pointer-events-none whitespace-nowrap border border-hairline", D4_SCENE_LABEL)}>
          구름다리 ({floor}F)
        </div>
      </Html>
    </group>
  );
}

// 콘텐츠 크기(층 수 · 타워 폭)와 캔버스 비율에 맞춰 카메라 거리를 매번 다시 계산해서
// 층이 많은 동도 화면 밖으로 잘리지 않도록 한다.
function FitCamera({ contentWidth, contentHeight, centerY }) {
  const { camera, size, invalidate } = useThree();

  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    const distanceForWidth = (contentWidth / 2) / Math.tan(hFov / 2);
    const distanceForHeight = (contentHeight / 2) / Math.tan(vFov / 2);
    const distance = Math.max(distanceForWidth, distanceForHeight, 5);

    camera.position.set(0, centerY + distance * 0.56, distance * 0.86);
    camera.lookAt(0, centerY, 0);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size, contentWidth, contentHeight, centerY, invalidate]);

  return null;
}

const GROUP_Y_OFFSET = -2.6;

export function D4WingFloorScene({ building, activeWingId, onSelectFloor }) {
  const bridgeFloors = building.bridges.map((b) => b.floor);
  const towerOffset = 2.55;
  const maxFloors = Math.max(...building.wings.map((w) => w.floors + (w.hasBasement ? 1 : 0)));
  const contentWidth = towerOffset * 2 + BOX_WIDTH + 0.8;
  const contentHeight = maxFloors * FLOOR_STEP + 0.9;
  const centerY = GROUP_Y_OFFSET + ((maxFloors - 1) * FLOOR_STEP) / 2;

  return (
    <Canvas camera={{ fov: 24 }} shadows="percentage" gl={{ alpha: true }} frameloop="demand">
      <FitCamera contentWidth={contentWidth} contentHeight={contentHeight} centerY={centerY} />
      <ambientLight intensity={1.15} />
      <directionalLight position={[6, 9, 6]} intensity={1.35} castShadow />
      <group position={[0, GROUP_Y_OFFSET, 0]}>
        {building.wings.map((wing) => (
          <Tower
            key={wing.id}
            wing={wing}
            x={wing.id === "right" ? towerOffset : -towerOffset}
            isActive={activeWingId === wing.id}
            onSelectFloor={onSelectFloor}
          />
        ))}
        {bridgeFloors.map((floor) => (
          <BridgeConnector key={floor} floor={floor} />
        ))}
      </group>
    </Canvas>
  );
}
