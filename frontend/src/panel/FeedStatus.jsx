import { Alert } from "../ui/Alert.jsx";
import { FreshnessStamp } from "../ui/FreshnessStamp.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { FEED_LABELS, describeFeedStatus, isFeedDown } from "../hooks/feedStatusModel.mjs";
import { formatClockTime } from "../hooks/feedStatus.mjs";

export const STAMPED_FEEDS = Object.freeze(["weather", "traffic", "energy"]);
// 패널에서 피드 상태를 보여 주는 탭: 기본 현황(시스템 상태, 셋 모두)과 그 피드의 탭.
const FEED_TAB = Object.freeze({ weather: "dashboard", traffic: "parking_safety", energy: "energy" });

// 끊긴 피드의 `다시 시도`는 화면에 한 곳만 보인다: 그 피드의 상태가 열린 패널에 보이면 패널에, 아니면 HUD 갱신 표시에.
export function feedShownInPanel(feed, { expanded, activeTab }) {
  return Boolean(expanded) && (activeTab === "dashboard" || FEED_TAB[feed] === activeTab);
}

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

// 기본 현황의 시스템 상태: 피드마다 한 줄. 정상이면 배지와 갱신 시각, 끊기면 그 줄이 곧 알림(원인·시각·다시 시도)이다.
export function FeedStatusRows({ feeds, retry, liveText = {}, liveTone = {} }) {
  return (
    <section aria-label="시스템 상태" className="flex flex-col gap-2">
      <h3 className="text-caption text-ink-muted">시스템 상태</h3>
      {STAMPED_FEEDS.map((feed) => {
        const status = feeds[feed];
        const qa = feed === "weather" ? "weather-status" : `${feed}-feed-status`;
        if (isFeedDown(status)) {
          return (
            <div key={feed} data-qa={qa} data-feed={feed}>
              <FeedAlert feed={feed} status={status} onRetry={retry[feed]} />
            </div>
          );
        }
        const text = describeFeedStatus(feed, status);
        return (
          <div key={feed} data-qa={qa} data-feed={feed} className="flex items-center justify-between gap-3 rounded-card border border-hairline bg-surface-2 px-4 py-3">
            <span className="shrink-0 text-caption text-ink-muted">{FEED_LABELS[feed]}</span>
            <span className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-right">
              <StatusBadge tone={liveTone[feed] ?? (status.status === "live" ? "success" : "neutral")} className="text-caption">
                {liveText[feed] ?? text.title}
              </StatusBadge>
              {text.detail && <span className="text-caption tabular-nums text-ink-muted">{text.detail}</span>}
            </span>
          </div>
        );
      })}
    </section>
  );
}

// HUD(데스크톱)·시트 머리(폰)의 갱신 표시 셋. compact(폰)이면 새로 고침은 늘 아이콘 버튼이다.
// 끊긴 피드의 상태가 열린 패널에 보이지 않으면, 그 표시가 곧 상태 줄이다: 원인·확인 시각·다시 시도가 한 요소 안에 있다
// (기상은 data-qa="weather-status"를 이쪽이 맡는다).
export function FeedStamps({ feeds, retry, placement, compact = false }) {
  return (
    <span data-qa="feed-stamps" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {STAMPED_FEEDS.map((feed) => {
        const status = feeds[feed];
        const carries = !compact && isFeedDown(status) && !feedShownInPanel(feed, placement);
        const checked = formatClockTime(status.checkedAt);
        const note = carries ? [status.status === "paused" ? "오프라인" : null, checked && `확인 ${checked}`].filter(Boolean).join(" · ") : null;
        return (
          <span key={feed} data-qa={carries ? "feed-alert" : undefined} data-feed={feed} role={carries ? "alert" : undefined} className="inline-flex">
            <span data-qa={carries && feed === "weather" ? "weather-status" : undefined} className="inline-flex">
              <FreshnessStamp
                feed={feed}
                feedLabel={FEED_LABELS[feed]}
                showLabel
                at={status.lastGoodAt}
                onRefresh={retry[feed]}
                retry={carries}
                note={note}
              />
            </span>
          </span>
        );
      })}
    </span>
  );
}
