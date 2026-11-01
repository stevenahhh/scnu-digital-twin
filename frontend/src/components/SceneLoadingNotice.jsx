import { forwardRef, useEffect, useRef, useState } from "react";
import { useProgress } from "@react-three/drei";
import { FileLoader } from "three";
import { LoaderCircle } from "lucide-react";
import { CAMPUS_MODEL_URL } from "../campusModelAsset.mjs";
import { Button } from "../ui/Button.jsx";

// 3D 모델 로딩이 이 시간을 넘기면 지연 안내와 다시 시도 버튼을 보여 준다.
export const SCENE_SLOW_AFTER_MS = 15000;
const MEGABYTE = 1024 * 1024;
const MODEL_FILE = CAMPUS_MODEL_URL.split("/").pop();

// 3D 모델의 바이트 진행률. drei의 useProgress는 항목 수만 세므로, 같은 URL을 FileLoader로 한 번 더 요청해 three가
// 진행 중인 요청에 콜백을 합치게 한다(중복 요청 없음). 항목이 하나라도 끝났거나(loaded > 0) 로딩 관리자가 쉬고 있으면
// 바이트 수신은 이미 끝난 뒤라 붙지 않는다. 안내가 떠 있는 동안(마운트된 동안)만 붙는다.
function useCampusModelProgress() {
  const { active: managerActive, loaded: itemsLoaded } = useProgress();
  const [bytes, setBytes] = useState(null);
  const tappedRef = useRef(false);

  useEffect(() => {
    if (tappedRef.current || !managerActive || itemsLoaded > 0) return undefined;
    tappedRef.current = true;
    let disposed = false;
    const loader = new FileLoader();
    loader.setResponseType("arraybuffer");
    loader.load(
      CAMPUS_MODEL_URL,
      () => {
        if (!disposed) setBytes((previous) => ({ loaded: previous?.total ?? 0, total: previous?.total ?? 0, done: true }));
      },
      (event) => {
        if (!disposed && event.lengthComputable) setBytes({ loaded: event.loaded, total: event.total, done: false });
      },
      () => {},
    );
    return () => {
      disposed = true;
    };
  }, [itemsLoaded, managerActive]);

  return bytes;
}

function formatModelProgress(bytes) {
  if (!bytes) return null;
  if (bytes.done) return `${MODEL_FILE} 100% · 모델 처리 중`;
  if (!(bytes.total > 0)) return null;
  const percent = Math.min(99, Math.floor((bytes.loaded / bytes.total) * 100));
  return `${MODEL_FILE} ${percent}% (${(bytes.loaded / MEGABYTE).toFixed(1)}/${(bytes.total / MEGABYTE).toFixed(1)} MB)`;
}

// 3D 캠퍼스 모델 로딩 안내. 열린 패널을 뺀 지도 영역 가운데(insetRight)에 놓인다.
// onRetry: 모델을 다시 받는다(페이지를 새로 읽지 않는다). 부르는 쪽이 key를 바꿔 지연 타이머도 처음부터 센다.
export const SceneLoadingNotice = forwardRef(function SceneLoadingNotice({ insetRight, onRetry }, ref) {
  const [slow, setSlow] = useState(false);
  const progress = formatModelProgress(useCampusModelProgress());

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SCENE_SLOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      ref={ref}
      role="status"
      className="pointer-events-none absolute inset-y-0 left-0 z-[5] flex items-center justify-center px-10 transition-[right] duration-300"
      style={{ right: insetRight }}
    >
      <div className="flex items-center gap-3 rounded-card border border-hairline bg-surface-1 px-4 py-3 text-body text-ink-muted shadow-popover">
        <LoaderCircle aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
        {slow ? (
          <>
            <span className="min-w-0 break-keep">3D 캠퍼스 모델 응답이 지연되고 있습니다. 네트워크를 확인하세요.</span>
            <Button className="pointer-events-auto" onClick={onRetry}>다시 시도</Button>
          </>
        ) : (
          <span className="min-w-0 break-keep">
            3D 캠퍼스 모델을 불러오는 중입니다
            {progress && (
              <span data-qa="scene-loading-progress" className="ml-2 tabular-nums text-ink-subtle">{progress}</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
});
