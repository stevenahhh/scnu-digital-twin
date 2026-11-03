import { badgeStyle, TONE_DEFAULT_LABEL } from "./badgeTones.mjs";
import { cx } from "./cx.mjs";

// 상태 배지: 글자가 항상 있다(장식용 점만 있는 배지는 없다). 아이콘은 글자를 돕기만 한다.
export function StatusBadge({ tone = "neutral", icon: Icon, children, title, className, ...rest }) {
  const text = typeof children === "string" ? children.trim() : children;
  const label = text || TONE_DEFAULT_LABEL[tone];
  if (!label) return null;

  return (
    <span
      data-qa={tone === "sample" ? "sample-badge" : "status-badge"}
      data-tone={tone}
      title={title}
      style={badgeStyle(tone)}
      className={cx("inline-flex shrink-0 items-center gap-1 whitespace-normal break-keep rounded-control border px-2 py-0 text-caption", className)}
      {...rest}
    >
      {Icon && <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />}
      {label}
    </span>
  );
}
