// 강의실 사용 여부·냉난방 상태·절감량은 d4BuildingData의 샘플 시간표와 가정으로 만든 값이다. 실측처럼 보이지 않게 표시한다.
export const D4_ROOM_SAMPLE_NOTE = "실측이 아닌 샘플 시간표·설비 데이터로 만든 추정 값입니다.";

export function D4SampleBadge() {
  return (
    <span
      data-testid="d4-sample-badge"
      title={D4_ROOM_SAMPLE_NOTE}
      className="rounded-full border border-[var(--colors-hairline)] px-2 py-0.5 text-[11px] font-[800] text-[var(--colors-ink-subtle)]"
    >
      샘플 데이터
      <span className="sr-only"> · {D4_ROOM_SAMPLE_NOTE}</span>
    </span>
  );
}
