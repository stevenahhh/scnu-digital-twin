import { RefreshCw } from "lucide-react";
import { Button } from "./Button.jsx";
import { cx } from "./cx.mjs";
import { formatHHmm } from "./format.mjs";

// `갱신 HH:mm` 또는 `갱신 없음`. 실패한 상태에서도 그대로 보이고, 새로 고침 버튼이 안에 있다.
export function FreshnessStamp({ at, feed, feedLabel, onRefresh, refreshing = false, className }) {
  const clock = formatHHmm(at);
  return (
    <span data-qa="freshness-stamp" data-feed={feed} className={cx("inline-flex items-center gap-1 text-caption text-ink-muted", className)}>
      <span className="tabular-nums">{clock ? `갱신 ${clock}` : "갱신 없음"}</span>
      {onRefresh && (
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          label={`${feedLabel ?? "데이터"} 새로고침`}
          icon={<RefreshCw aria-hidden="true" className="h-4 w-4" />}
          loading={refreshing}
          onClick={onRefresh}
        />
      )}
    </span>
  );
}
