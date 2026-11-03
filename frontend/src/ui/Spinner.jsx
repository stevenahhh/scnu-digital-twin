import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { cx } from "./cx.mjs";

// 작업 하나에 스피너 하나. delayMs가 지나도 작업이 끝나지 않았을 때만 나타나고, 무엇을 기다리는지 이름을 붙인다.
export function Spinner({ label, delayMs = 1000, className }) {
  const [visible, setVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) return undefined;
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  if (!visible) return null;
  return (
    <span role="status" data-qa="spinner" className={cx("inline-flex items-center gap-2 break-keep text-caption text-ink-muted", className)}>
      <LoaderCircle aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
      {label}
    </span>
  );
}
