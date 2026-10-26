import { cx } from "./cx.mjs";

// 섹션 제목: 한국어 문장형 제목 하나가 실제 heading 수준(기본 h3)으로 들어간다. 대문자 머리말·자간·강조색 아이콘은 쓰지 않는다.
// 부제(subtitle)는 정말 필요한 곳에만 둔다: 이어지는 섹션 세 개 중 많아야 하나.
export function SectionHeader({ title, level = 3, badge, subtitle, actions, className, ...rest }) {
  const Heading = `h${Math.min(Math.max(level, 2), 4)}`;
  return (
    <div data-qa="section-header" className={cx("flex items-start justify-between gap-3", className)} {...rest}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Heading className={cx("break-keep text-ink", level <= 2 ? "text-title" : "text-body font-semibold")}>{title}</Heading>
          {badge}
        </div>
        {subtitle && <p className="break-keep text-caption text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
