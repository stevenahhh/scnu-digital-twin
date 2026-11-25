import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Button } from "../ui/Button.jsx";
import { Segmented } from "../ui/Segmented.jsx";
import { Sheet } from "../ui/Sheet.jsx";
import { SURFACE_MS } from "./DashboardShell.jsx";

const THEME_OPTIONS = [
  { value: "dark", label: "다크" },
  { value: "light", label: "라이트" },
  { value: "system", label: "시스템" },
];

// 품질 단계마다 한 문장. 고른 단계의 문장만 보인다.
export const QUALITY_COPY = Object.freeze({
  low: "낮음은 기본 렌더러만 써서 가장 가볍습니다.",
  medium: "보통은 계단 현상 보정과 가벼운 접촉 그림자를 더합니다.",
  high: "높음은 정밀한 그림자와 밤 조명 번짐까지 더합니다.",
});

function SettingsContent({ themeMode, onThemeChange, quality }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span id="theme-mode-label" className="text-caption text-ink-muted">테마</span>
        <Segmented kind="radio" aria-labelledby="theme-mode-label" options={THEME_OPTIONS} value={themeMode} onChange={onThemeChange} />
      </div>
      {quality && (
        <div role="group" aria-labelledby="render-quality-label" data-qa="render-quality" className="flex flex-col gap-2">
          <span id="render-quality-label" className="text-caption text-ink-muted">3D 렌더링 품질</span>
          <Segmented
            kind="radio"
            aria-labelledby="render-quality-label"
            options={quality.tiers.map((tier) => ({ value: tier, label: quality.labels[tier], qa: `render-quality-${tier}` }))}
            value={quality.value}
            onChange={quality.onChange}
          />
          <p className="break-keep text-caption text-ink-muted">{QUALITY_COPY[quality.value]}</p>
          {quality.source === "auto" && <p className="break-keep text-caption text-ink-muted">이 기기의 그래픽 성능을 보고 자동으로 골랐습니다</p>}
        </div>
      )}
    </div>
  );
}

function SettingsBody({ onClose, ...content }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-title text-ink">설정</h2>
        <Button variant="ghost" iconOnly label="닫기" icon={<X aria-hidden="true" className="h-4 w-4" />} onClick={onClose} />
      </div>
      <SettingsContent {...content} />
    </div>
  );
}

function PhoneSettingsDialog({ onClose, ...content }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="false"
      aria-label="설정"
      data-qa="settings-sheet"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
      className="outline-none"
    >
      <SettingsBody onClose={onClose} {...content} />
    </div>
  );
}

// 폰 설정 시트: 화면 아래에서 half까지 올라오고, 닫을 때 같은 길로 내려간 뒤 사라진다. 대시보드 시트는 움직이지 않는다.
function PhoneSettings({ open, onClose, ...content }) {
  const [mounted, setMounted] = useState(open);
  const [detent, setDetent] = useState("peek");
  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = window.requestAnimationFrame(() => setDetent("half"));
      return () => window.cancelAnimationFrame(frame);
    }
    setDetent("peek");
    const timer = window.setTimeout(() => setMounted(false), SURFACE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  if (!mounted) return null;
  return createPortal(
    <Sheet label="설정" detent={detent} peekHeight={0} onDetentChange={(next) => next === "peek" && onClose()} escapeCollapses={false}>
      {open && <PhoneSettingsDialog onClose={onClose} {...content} />}
    </Sheet>,
    document.body,
  );
}

// 설정: 더보기 메뉴의 `설정`이 연다. 장면을 가리지 않는다(가림막·흐림 없음). 품질을 바꾸면 뒤의 장면이 바로 다시 그려진다.
// 데스크톱·태블릿은 위치 지정된 부모(더보기 묶음) 아래 shadcn 팝오버(제목과 닫기), 폰은 half 단계 시트다.
// 팝오버는 Esc로 닫고, 바깥 클릭 처리와 더보기로 포커스를 돌리는 일은 부르는 쪽이 맡는다.
export function SettingsSheet({ mode, open, onClose, themeMode, onThemeChange, quality }) {
  const content = { themeMode, onThemeChange, quality };
  if (mode === "phone") return <PhoneSettings open={open} onClose={onClose} {...content} />;
  if (!open) return null;
  return (
    <Popover open onOpenChange={() => onClose()}>
      <PopoverAnchor className="pointer-events-none absolute inset-0" />
      <PopoverContent
        portalled={false}
        align="end"
        sideOffset={8}
        aria-label="설정"
        data-qa="settings-sheet"
        className="w-80 max-w-[min(20rem,calc(100vw-1rem))] p-3"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          event.currentTarget.focus();
        }}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <SettingsBody onClose={onClose} {...content} />
      </PopoverContent>
    </Popover>
  );
}
