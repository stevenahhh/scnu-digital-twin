// 차트 범례: 선 모양을 글자 기호 대신 작은 SVG로 그린다. dashed면 점선이다. 색은 토큰(CSS 변수)으로 받는다.
export function ChartLegend({ items, note }) {
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-ink-muted" aria-label="범례">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-2">
          <svg aria-hidden="true" width="16" height="8" viewBox="0 0 16 8" className="shrink-0">
            <rect x="0" y="3" width="16" height="2" rx="1" fill={item.dashed ? "none" : item.color} />
            {item.dashed && (
              <line x1="0" x2="16" y1="4" y2="4" stroke={item.color} strokeWidth="2" strokeDasharray="3 3" />
            )}
          </svg>
          {item.label}
        </li>
      ))}
      {note && <li>{note}</li>}
    </ul>
  );
}

// 에너지 차트 선 색(토큰). 수요는 강조색의 밝은 단계, 발전은 성공색, 계통 인입은 위험색, 대안·일사량은 경고색·보조 글자색.
export const SERIES_COLORS = Object.freeze({
  demand: "var(--colors-primary-hover)",
  generation: "var(--colors-semantic-success)",
  grid: "var(--colors-semantic-danger)",
  alternative: "var(--colors-semantic-warning)",
  irradiance: "var(--colors-ink-subtle)",
});
