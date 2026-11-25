import { Alert } from "../ui/Alert.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { FEED_LABELS, describeFeedStatus, isFeedDown } from "../hooks/feedStatusModel.mjs";

// 끊긴 피드 하나의 알림: 원인, 마지막 정상 값의 시각과 다음 동작, `다시 시도` 하나. 모달은 쓰지 않는다.
export function FeedAlert({ feed, status, onRetry, title, className }) {
  const text = describeFeedStatus(feed, status);
  return (
    <Alert
      tone={status.status === "paused" ? "warning" : "danger"}
      source={feed}
      title={title ?? text.title}
      message={text.detail}
      actions={onRetry ? [{ label: "다시 시도", onClick: onRetry }] : []}
      className={className}
    />
  );
}

// 피드 하나의 상태 줄(현황 탭 묶음 머리글 아래). 정상이면 배지와 갱신 시각, 끊기면 그 줄이 곧 알림(원인·시각·다시 시도)이다.
export function FeedStatusRow({ feed, status, onRetry, liveText, liveTone }) {
  const qa = feed === "weather" ? "weather-status" : `${feed}-feed-status`;
  if (isFeedDown(status)) {
    return (
      <div data-qa={qa} data-feed={feed}>
        <FeedAlert feed={feed} status={status} onRetry={onRetry} />
      </div>
    );
  }
  const text = describeFeedStatus(feed, status);
  return (
    <div data-qa={qa} data-feed={feed} className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-caption text-ink-muted">{FEED_LABELS[feed]}</span>
      <span className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-right">
        <StatusBadge tone={liveTone ?? (status.status === "live" ? "success" : "neutral")} className="text-caption">
          {liveText ?? text.title}
        </StatusBadge>
        {text.detail && <span className="text-caption tabular-nums text-ink-muted">{text.detail}</span>}
      </span>
    </div>
  );
}
