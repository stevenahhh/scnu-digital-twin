import { Canvas, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { formatRoomNumber } from "../utils/d4BuildingData.mjs";
import { D4_SCENE, SELECTION_HEX } from "../ui/sceneTokens.mjs";
import { D4_SCENE_LABEL } from "./d4Shared.mjs";
import { cx } from "../ui/cx.mjs";
import { SceneLabel } from "../ui/SceneLabel.jsx";

// 상자 색: 설비실, 선택한 강의실, 나머지 순서로 정한다.
function roomColor({ isUtility, isSelected }) {
  if (isUtility) return D4_SCENE.roomUtility;
  return isSelected ? SELECTION_HEX : D4_SCENE.roomIdle;
}
const UNIT = 1.35;
const ROW_DEPTH = 1.7;
const BOX_HEIGHT = 0.5;
const GAP = 0.12;

function RoomBox({ room, x, z, width, isSelected, isInUse, onSelect }) {
  const boxWidth = width * UNIT - GAP;
  const isUtility = !room.isSelectable;

  return (
    <group
      position={[x, 0, z]}
      onPointerUp={
        isUtility
          ? undefined
          : (event) => {
              event.stopPropagation();
              onSelect(room.id);
            }
      }
    >
      <mesh castShadow={!isUtility} receiveShadow>
        <boxGeometry args={[boxWidth, isUtility ? BOX_HEIGHT * 0.6 : BOX_HEIGHT, ROW_DEPTH - GAP]} />
        <meshStandardMaterial color={roomColor({ isUtility, isSelected })} />
      </mesh>
      <Html position={[0, (isUtility ? BOX_HEIGHT * 0.3 : BOX_HEIGHT / 2) + 0.06, 0]} center>
        {isUtility ? (
          <div className={cx("pointer-events-none flex flex-col items-center gap-1 whitespace-nowrap", D4_SCENE_LABEL)}>
            {room.roomNumber}
          </div>
        ) : (
          // 캠퍼스 이름표와 같은 장면 라벨(SceneLabel, 작은 단계). 사용 중 표시는 칩 아래 한 줄.
          <div className="flex flex-col items-center gap-1">
            <SceneLabel
              size="sm"
              tier={3}
              state={isSelected ? "selected" : "idle"}
              name={formatRoomNumber(room.roomNumber)}
              data-qa="d4-room-label"
              aria-label={`${room.roomNumber} 강의실 상세`}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(room.id);
              }}
              className="pointer-events-auto"
              style={{ maxWidth: `${Math.max(70, boxWidth * 34)}px`, whiteSpace: boxWidth > 1.6 ? "nowrap" : "normal" }}
            />
            {isInUse && (
              <span className="pointer-events-none inline-flex items-center gap-1 rounded-control bg-[var(--colors-label-bg)] px-1 text-micro text-ink-muted">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-pill bg-primary" />
                사용 중
              </span>
            )}
          </div>
        )}
      </Html>
    </group>
  );
}

// 콘텐츠 크기(줄 수 · 최대 폭)와 캔버스 비율에 맞춰 카메라 거리를 매번 다시 계산해서
// 방이 많은 줄도 화면 밖으로 잘리지 않도록 한다.
function FitCamera({ contentWidth, contentDepth }) {
  const { camera, size, invalidate } = useThree();

  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    const distanceForWidth = (contentWidth / 2) / Math.tan(hFov / 2);
    const distanceForDepth = (contentDepth / 1.15) / Math.tan(vFov / 2);
    const distance = Math.max(distanceForWidth, distanceForDepth, 5);

    camera.position.set(0, distance * 0.62, distance * 0.82);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size, contentWidth, contentDepth, invalidate]);

  return null;
}

export function D4RoomGridScene({ rooms, roomUsageById, selectedRoomId, onSelectRoom }) {
  const rowCount = useMemo(() => Math.max(1, ...rooms.map((r) => r.row + 1)), [rooms]);
  const rowTotalWidth = useMemo(() => {
    const totals = {};
    rooms.forEach((room) => {
      totals[room.row] = Math.max(totals[room.row] ?? 0, room.colOffset + room.colWidth);
    });
    return totals;
  }, [rooms]);
  const maxRowWidth = Math.max(1, ...Object.values(rowTotalWidth));
  const contentWidth = maxRowWidth * UNIT + 1.2;
  const contentDepth = rowCount * ROW_DEPTH + 1.6;

  return (
    <Canvas camera={{ fov: 26 }} shadows="percentage" gl={{ alpha: true }} frameloop="demand">
      <FitCamera contentWidth={contentWidth} contentDepth={contentDepth} />
      <ambientLight intensity={1.2} />
      <directionalLight position={[5, 8, 6]} intensity={1.3} castShadow />
      <group position={[0, -1, -((rowCount - 1) * ROW_DEPTH) / 2]}>
        {rooms.map((room) => {
          const rowWidth = rowTotalWidth[room.row] ?? maxRowWidth;
          const rowStartX = -(rowWidth * UNIT) / 2 + ((maxRowWidth - rowWidth) * UNIT) / 2;
          const x = rowStartX + (room.colOffset + room.colWidth / 2) * UNIT;
          const z = room.row * ROW_DEPTH;
          return (
            <RoomBox
              key={room.id}
              room={room}
              x={x}
              z={z}
              width={room.colWidth}
              isSelected={room.id === selectedRoomId}
              isInUse={roomUsageById?.get(room.id) ?? false}
              onSelect={onSelectRoom}
            />
          );
        })}
      </group>
    </Canvas>
  );
}
