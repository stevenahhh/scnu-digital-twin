import { TriangleAlert } from "lucide-react";
import { Button } from "../../ui/Button.jsx";
import { cx } from "../../ui/cx.mjs";

// 데이터 피드가 하나라도 끊겼을 때만 HUD에 놓는 상태 칩 하나. 끊긴 개수를 글자로 쓰고, 누르면 현황 탭을 연다.
// 피드별 갱신 시각과 다시 시도는 현황 탭의 각 묶음 머리글에 있다.
export function FeedStatusChip({ count, onOpen, className }) {
  if (!(count > 0)) return null;
  return (
    <Button
      size="sm"
      data-qa="feed-status-chip"
      title="끊긴 데이터 연결을 현황 탭에서 확인합니다"
      icon={<TriangleAlert aria-hidden="true" className="h-4 w-4 text-warning" />}
      onClick={onOpen}
      className={cx("pointer-events-auto shrink-0 whitespace-nowrap", className)}
    >
      {`연결 끊김 ${count}`}
    </Button>
  );
}
