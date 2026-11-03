import { FAR_GROUND_HEX } from "../ui/sceneTokens.mjs";

// 지평선 띠: 캠퍼스 가운데를 중심으로 한 큰 원판 하나를 가장 낮은 지형보다 조금 아래에 깐다. 지형이 있는 곳에서는 그 밑에
// 가려 보이지 않고, 바깥 지형(링)이 끝난 너머에서만 보여 땅이 안개 속 지평선까지 이어진다(장면이 딱 잘린 가장자리로 끝나지 않는다).
// 안개를 받는 재질이라 멀수록 하늘(안개)색으로 녹는다. 지형 데이터와 GLB는 건드리지 않는다.
const CAMPUS_CENTER = [250, -187]; // campus-v2 지형 격자(EXTENT 504 x 378)의 가운데(x, z)
const SKIRT_Y = 9; // campus-v2-height.json minY(11.9)보다 아래
const SKIRT_RADIUS = 2400; // 카메라 먼 평면(1000) 밖까지

export function HorizonSkirt() {
  return (
    <mesh position={[CAMPUS_CENTER[0], SKIRT_Y, CAMPUS_CENTER[1]]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={false} renderOrder={-1}>
      <circleGeometry args={[SKIRT_RADIUS, 96]} />
      <meshLambertMaterial color={FAR_GROUND_HEX} fog />
    </mesh>
  );
}
