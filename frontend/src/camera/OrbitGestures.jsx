import { useEffect } from "react";
import { attachCameraGestures } from "./cameraGestures.mjs";
import { rotateBy, rotateDuringDrag, tiltBy, zoomBy } from "./cameraCommands.mjs";

// Legacy 캠퍼스 캔버스의 트랙패드·터치 제스처(cameraGestures.mjs). OrbitControls가 이미 하는 것(휠·핀치 확대, 한 손가락 궤도,
// 두 손가락 이동·핀치)은 그대로 두고, 두 손가락 가로 스와이프 회전, Option+세로 스와이프 기울이기, Safari 핀치·비틀기,
// 터치 화면의 두 손가락 비틀기 회전을 더한다. 캔버스를 감싼 요소의 캡처 단계에서 받아 OrbitControls보다 먼저 처리한다.
// OrbitControls 뒤에 렌더해야 한다: 그 effect가 캔버스에 연결(domElement)한 뒤라야 여기서 캔버스를 찾는다.
// 다시 그리기는 controls.update()가 보내는 change 이벤트로 drei가 맡는다.
const ORBIT_IDLE = -1;

export function OrbitGestures({ controlsRef }) {
  useEffect(() => {
    const canvas = controlsRef.current?.domElement;
    const host = canvas?.parentElement ?? canvas;
    const controls = () => controlsRef.current;
    return attachCameraGestures(host, {
      // ctrl wheel 핀치는 OrbitControls가 커서 쪽으로 확대한다(여기서 가로채지 않는다). Safari 핀치만 여기서 확대한다.
      wheelZoom: false,
      twist: true,
      zoom: (factor) => zoomBy(controls(), factor),
      rotate: (radians, { continuous }) => {
        const orbit = controls();
        // 터치 비틀기는 OrbitControls 두 손가락 끌기 도중이라 start/end를 다시 보내지 않는다.
        if (continuous && orbit && orbit.state !== undefined && orbit.state !== ORBIT_IDLE) rotateDuringDrag(orbit, radians);
        else rotateBy(orbit, radians);
      },
      tilt: (radians) => tiltBy(controls(), radians),
    });
  }, [controlsRef]);
  return null;
}
