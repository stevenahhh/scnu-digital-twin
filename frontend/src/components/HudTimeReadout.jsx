import { formatMinuteOfDay } from "../weather/sceneClock.mjs";

export const sceneTimeReadout = (minuteOfDay) => `장면 ${formatMinuteOfDay(minuteOfDay)}`;

// 장면 시각은 시간 카드 한 곳에만 보인다. 이 칸은 HUD를 직접 짜는 쪽(VWorld)이 넘긴 statusSlot만 담는다.
export function HudTimeReadout({ statusSlot = null }) {
  if (!statusSlot) return null;
  return (
    <div className="pointer-events-auto flex min-h-10 items-center gap-2 rounded-control border border-hairline bg-surface-1 px-3">
      {statusSlot}
    </div>
  );
}
