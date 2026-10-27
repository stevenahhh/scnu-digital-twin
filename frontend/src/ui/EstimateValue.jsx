import { useEffect, useRef, useState } from "react";
import { Button } from "./Button.jsx";
import { StatusBadge } from "./StatusBadge.jsx";
import { cx } from "./cx.mjs";
import { formatHHmm } from "./format.mjs";

const HIGHLIGHT_MS = 200;

const isMissing = (value) => value === null || value === undefined || value === "" || (typeof value === "number" && Number.isNaN(value));

// 값 하나와 그 출처. 추정값(estimated)은 `추정` 배지를 달고, 실측값은 배지 없이 data-qa="measured-value"로 구분한다.
// 값이 없으면 자리 표시 기호 대신 `데이터 없음`과 다음 동작을 보여 주고 단위는 붙이지 않는다.
export function EstimateValue({
  value,
  unit,
  source,
  at,
  estimated = true,
  stale = false,
  digits,
  emptyLabel = "데이터 없음",
  actionLabel = "다시 시도",
  onAction,
  className,
}) {
  const qa = estimated ? "estimate-value" : "measured-value";
  const missing = isMissing(value);
  const text = missing ? null : typeof value === "number" && digits !== undefined ? value.toFixed(digits) : String(value);
  const [highlight, setHighlight] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const previous = useRef(text);

  useEffect(() => {
    if (previous.current === text) return undefined;
    const changed = previous.current !== null && text !== null;
    previous.current = text;
    if (!changed) return undefined;
    setHighlight(true);
    setAnnouncement("갱신됨");
    const timer = window.setTimeout(() => setHighlight(false), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  if (missing) {
    return (
      <span data-qa={qa} data-estimated={estimated ? "true" : undefined} data-empty="true" className={cx("inline-flex flex-wrap items-center gap-2", className)}>
        <span className="text-body text-ink-muted">{emptyLabel}</span>
        {onAction && (
          <Button size="sm" variant="ghost" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </span>
    );
  }

  const clock = formatHHmm(at);
  const provenance = [source, clock].filter(Boolean).join(" · ");

  return (
    <span data-qa={qa} data-estimated={estimated ? "true" : undefined} data-stale={stale ? "true" : undefined} className={cx("inline-flex flex-col gap-1", className)}>
      <span className="inline-flex flex-wrap items-baseline gap-1">
        <span
          className={cx(
            "rounded-control text-body font-semibold tabular-nums text-ink transition-colors duration-state motion-reduce:transition-none",
            highlight && "bg-surface-3",
          )}
        >
          {text}
        </span>
        {unit && <span className="text-caption text-ink-muted">{unit}</span>}
        {estimated && <StatusBadge tone="estimate">추정</StatusBadge>}
        {stale && <StatusBadge tone="warning">지난 값</StatusBadge>}
      </span>
      {provenance && <span className="text-caption text-[var(--colors-estimate-ink)]">{provenance}</span>}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </span>
  );
}
