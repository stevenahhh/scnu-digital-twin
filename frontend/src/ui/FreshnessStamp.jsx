import { RefreshCw } from "lucide-react";
import { Button } from "./Button.jsx";
import { cx } from "./cx.mjs";
import { formatHHmm } from "./format.mjs";

// `갱신 HH:mm` 또는 `갱신 없음`. 실패한 상태에서도 그대로 보이고, 새로 고침 버튼이 안에 있다.
// showLabel이면 앞에 피드 이름을 보이고, retry이면(피드가 끊겼고 다른 곳에 다시 시도가 보이지 않을 때) 버튼이 `다시 시도` 글자 버튼이 된다.
// note: 끊긴 피드의 원인과 확인 시각처럼 시각 뒤에 붙는 짧은 글.
export function FreshnessStamp({ at, feed, feedLabel, onRefresh, refreshing = false, showLabel = false, retry = false, note = null, className }) {
  const clock = formatHHmm(at);
  const stamp = clock ? `갱신 ${clock}` : "갱신 없음";
  return (
    <span data-qa="freshness-stamp" data-feed={feed} className={cx("inline-flex items-center gap-1 text-caption text-ink-muted", className)}>
      <span className="whitespace-nowrap tabular-nums">{showLabel && feedLabel ? `${feedLabel} ${stamp}` : stamp}</span>
      {note && <span className="whitespace-nowrap tabular-nums">{note}</span>}
      {onRefresh && retry && (
        <Button size="sm" variant="secondary" aria-label={`${feedLabel ?? "데이터"} 다시 시도`} loading={refreshing} onClick={onRefresh}>
          다시 시도
        </Button>
      )}
      {onRefresh && !retry && (
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
