import { useState } from "react";
import { CircleAlert, CircleCheck, Copy, Info, TriangleAlert } from "lucide-react";
import { Button } from "./Button.jsx";
import { Disclosure } from "./Disclosure.jsx";
import { toneBackground, toneInk } from "./badgeTones.mjs";
import { cx } from "./cx.mjs";

const TONE_ICON = { neutral: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert };
const COPY_LABEL = { idle: "자세한 내용 복사", done: "복사됨", failed: "복사하지 못했습니다. 위 내용을 직접 선택하세요" };

// 인라인 알림: 원인(title), 설명(message), 마지막 정상 값, 다음 동작, 복사할 수 있는 자세한 내용.
// 데이터 출처 하나에 알림 하나만 두는 것은 쓰는 쪽의 규칙이다(data-source로 구분한다).
export function Alert({ tone = "neutral", title, message, lastValue, actions = [], detail, source, className, ...rest }) {
  const Icon = TONE_ICON[tone] ?? Info;
  const [copyState, setCopyState] = useState("idle");

  // 클립보드 권한이 없으면 실패를 알리고, 내용은 위 상자에서 직접 선택해 복사할 수 있다.
  const copyDetail = async () => {
    try {
      await navigator.clipboard.writeText(detail);
      setCopyState("done");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      data-qa="alert"
      data-tone={tone}
      data-source={source}
      style={{ backgroundColor: toneBackground(tone) }}
      className={cx("flex gap-3 rounded-card border border-hairline p-3 text-ink", className)}
      {...rest}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" style={{ color: toneInk(tone) }} />
      <div className="flex min-w-0 flex-1 flex-col gap-1 break-keep">
        {title && <p className="text-body font-semibold text-ink">{title}</p>}
        {message && <p className="text-caption text-ink-muted">{message}</p>}
        {lastValue && (
          <p className="text-caption text-ink-muted">
            마지막 정상 값 <span className="text-ink">{lastValue}</span>
          </p>
        )}
        {actions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button key={action.label} size="sm" variant="secondary" onClick={action.onClick}>
                {action.label}
              </Button>
            ))}
          </div>
        )}
        {detail && (
          <Disclosure summary="자세히">
            <div className="flex flex-col gap-2">
              <pre className="select-text whitespace-pre-wrap break-all rounded-control bg-surface-1 p-2 text-caption text-ink-muted">{detail}</pre>
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                icon={<Copy aria-hidden="true" className="h-4 w-4" />}
                onClick={copyDetail}
              >
                {COPY_LABEL[copyState]}
              </Button>
            </div>
          </Disclosure>
        )}
      </div>
    </div>
  );
}
