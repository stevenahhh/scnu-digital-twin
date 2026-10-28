import { formatMinuteOfDay } from "../weather/sceneClock.mjs";
import { useUpdatedCue } from "../ui/useUpdatedCue.mjs";

export const sceneTimeReadout = (minuteOfDay) => `장면 ${formatMinuteOfDay(minuteOfDay)}`;

// HUD의 첫 글자: 장면 시각. 옆 칸(statusSlot)에는 데이터 갱신 시각이 붙는다(todo 32). 두 대시보드가 같이 쓴다.
// 시각을 옮기면 2초 동안 강조색 테두리와 data-updated로 갱신을 알린다.
export function HudTimeReadout({ minuteOfDay, statusSlot = null }) {
  const updated = useUpdatedCue(minuteOfDay);
  return (
    <div
      data-updated={updated ? "true" : undefined}
      className="pointer-events-auto flex min-h-10 items-center gap-2 rounded-control border border-hairline bg-surface-1 px-3 transition-colors duration-state data-[updated=true]:border-primary motion-reduce:transition-none"
    >
      <p data-qa="hud-time-readout" className="text-body font-semibold tabular-nums text-ink">{sceneTimeReadout(minuteOfDay)}</p>
      {statusSlot}
    </div>
  );
}
