import { useEffect, useId, useRef, useState } from "react";
import { House, Minus, Move, Plus, RotateCcw, RotateCw } from "lucide-react";
import { ROTATE_STEP, ZOOM_STEP, rotateBy, zoomBy } from "../camera/cameraCommands.mjs";
import { Button } from "../ui/Button.jsx";
import { cx } from "../ui/cx.mjs";

// 지도 오른쪽 아래 카메라 단추: 확대·축소·왼쪽/오른쪽 회전·전체 보기. 마우스 없이도 장면을 움직일 수 있다.
// 툴팁과 aria-keyshortcuts에 지도에서 같은 일을 하는 키를 적는다(useCameraKeys와 같은 키).
// Legacy는 OrbitControls(controlsRef)를, VWorld는 onZoom(factor)·onRotate(radians)로 Cesium 카메라를 움직인다(같은 단계).
// collapsible(폰): `카메라 조작` 토글 하나만 보이고, 누르면 그 아래로 같은 다섯 단추가 펼쳐진다. 다시 누르거나 지도를 만지면 접힌다.
export function CameraControls({ controlsRef, onZoom, onRotate, onHome, collapsible = false, className = "", style }) {
  const [open, setOpen] = useState(false);
  const groupRef = useRef(null);
  const listId = useId();
  const zoom = onZoom ?? ((factor) => zoomBy(controlsRef?.current, factor));
  const rotate = onRotate ?? ((angle) => rotateBy(controlsRef?.current, angle));
  const actions = [
    { label: "확대", Icon: Plus, keys: "+", hint: "+", run: () => zoom(ZOOM_STEP) },
    { label: "축소", Icon: Minus, keys: "-", hint: "-", run: () => zoom(1 / ZOOM_STEP) },
    { label: "왼쪽으로 회전", Icon: RotateCcw, keys: "ArrowLeft", hint: "←", run: () => rotate(ROTATE_STEP) },
    { label: "오른쪽으로 회전", Icon: RotateCw, keys: "ArrowRight", hint: "→", run: () => rotate(-ROTATE_STEP) },
    { label: "전체 보기", Icon: House, keys: "H", hint: "H", qa: "camera-preset-overview", run: onHome },
  ];

  useEffect(() => {
    if (!collapsible || !open) return undefined;
    const closeOutside = (event) => {
      if (!groupRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [collapsible, open]);

  const shown = !collapsible || open;
  return (
    <div
      ref={groupRef}
      role="group"
      aria-label="카메라 조작"
      data-qa="camera-controls"
      className={cx("pointer-events-auto flex flex-col items-end gap-2", className)}
      style={style}
    >
      {collapsible && (
        <Button
          size="sm"
          iconOnly
          label="카메라 조작"
          data-qa="camera-controls-toggle"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          icon={<Move aria-hidden="true" className="h-4 w-4" />}
          onClick={() => setOpen((value) => !value)}
        />
      )}
      {shown && (
        <div id={listId} className="flex flex-col gap-1 rounded-card border border-hairline bg-surface-1 p-1 shadow-popover">
          {actions.map(({ label, Icon, keys, hint, qa, run }) => (
            <Button
              key={label}
              size="sm"
              variant="ghost"
              iconOnly
              label={label}
              title={`${label} (${hint})`}
              aria-keyshortcuts={keys}
              data-qa={qa}
              icon={<Icon aria-hidden="true" className="h-4 w-4" />}
              onClick={run}
            />
          ))}
        </div>
      )}
    </div>
  );
}
