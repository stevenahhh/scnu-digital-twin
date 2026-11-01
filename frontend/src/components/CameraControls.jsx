import { Minus, Plus, RotateCcw, RotateCw, Undo2 } from "lucide-react";
import { ROTATE_STEP, ZOOM_STEP, rotateBy, zoomBy } from "../camera/cameraCommands.mjs";
import { Button } from "../ui/Button.jsx";
import { cx } from "../ui/cx.mjs";

// 지도 오른쪽 아래 카메라 단추: 확대·축소·왼쪽/오른쪽 회전·처음 시점. 마우스 없이도 장면을 움직일 수 있다.
// Legacy는 OrbitControls(controlsRef)를, VWorld는 onZoom(factor)·onRotate(radians)로 Cesium 카메라를 움직인다(같은 단계).
export function CameraControls({ controlsRef, onZoom, onRotate, onHome, className = "" }) {
  const zoom = onZoom ?? ((factor) => zoomBy(controlsRef.current, factor));
  const rotate = onRotate ?? ((angle) => rotateBy(controlsRef.current, angle));
  const actions = [
    ["확대", Plus, () => zoom(ZOOM_STEP)],
    ["축소", Minus, () => zoom(1 / ZOOM_STEP)],
    ["왼쪽으로 회전", RotateCcw, () => rotate(ROTATE_STEP)],
    ["오른쪽으로 회전", RotateCw, () => rotate(-ROTATE_STEP)],
    ["처음 시점", Undo2, onHome],
  ];
  return (
    <div
      role="group"
      aria-label="카메라 조작"
      data-qa="camera-controls"
      className={cx("pointer-events-auto flex flex-col gap-1 rounded-card border border-hairline bg-surface-1 p-1 shadow-popover", className)}
    >
      {actions.map(([label, Icon, run]) => (
        <Button key={label} size="sm" variant="ghost" iconOnly label={label} icon={<Icon aria-hidden="true" className="h-4 w-4" />} onClick={run} />
      ))}
    </div>
  );
}
