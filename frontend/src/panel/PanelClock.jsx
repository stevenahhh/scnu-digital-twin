import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { formatClock, formatLongDate } from "../ui/format.mjs";

// 패널 머리의 초 단위 시계. 1초 타이머를 이 잎 컴포넌트만 가져서, 매초 다시 그려지는 것이 이 시계뿐이다.
export function PanelClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div data-qa="panel-clock" className="min-w-0">
      <time dateTime={now.toISOString()} className="block text-display tabular-nums text-ink">
        {formatClock(now)}
      </time>
      <p className="mt-1 flex items-center gap-1 text-caption text-ink-muted">
        <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0" />
        {formatLongDate(now)}
      </p>
    </div>
  );
}
