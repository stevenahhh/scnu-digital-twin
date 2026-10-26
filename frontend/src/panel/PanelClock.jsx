import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { formatClock } from "../ui/format.mjs";
import { formatMinuteOfDay } from "../weather/sceneClock.mjs";

// 패널 머리의 시계 둘. 큰 글자는 장면 시각(지도 위 시간 조작과 같은 값), 작은 글자는 라벨을 붙인 현재 시각이다.
// 현재 시각의 1초 타이머는 이 잎 컴포넌트만 가져서, 매초 다시 그려지는 것이 이 시계뿐이다.
export function PanelClock({ sceneMinuteOfDay, sceneDate }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div data-qa="panel-clock" className="min-w-0">
      <p className="text-display tabular-nums text-ink">
        <span className="mr-2 text-title text-ink-muted">장면</span>
        {formatMinuteOfDay(sceneMinuteOfDay)}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted">
        <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="tabular-nums">{sceneDate}</span>
        <time dateTime={now.toISOString()} className="tabular-nums">현재 {formatClock(now)}</time>
      </p>
    </div>
  );
}
