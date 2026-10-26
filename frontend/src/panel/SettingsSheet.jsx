import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Settings, X } from "lucide-react";
import { Button } from "../ui/Button.jsx";
import { Popover } from "../ui/Popover.jsx";
import { Segmented } from "../ui/Segmented.jsx";
import { Sheet } from "../ui/Sheet.jsx";

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

const triggerButton = (props) => (
  <Button iconOnly label="설정" icon={<Settings aria-hidden="true" className="h-4 w-4" />} {...props} />
);

// 설정: 장면을 가리지 않는다(가림막·흐림 없음). 품질을 바꾸면 뒤의 장면이 바로 다시 그려진다(저장은 그대로).
// 데스크톱·태블릿은 `설정` 단추에 붙은 팝오버, 폰은 half 단계 시트다. 폰에서는 대시보드 시트를 peek로 내려
// 시트가 하나만 열려 있게 한다(onOpenChange). Esc로 닫으면 포커스가 `설정` 단추로 돌아간다.
export function SettingsSheet({ mode, themeMode, onThemeChange, quality, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);
  const setSheetOpen = (next) => {
    setOpen(next);
    onOpenChange?.(next);
    if (!next) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (mode !== "phone") {
    return (
      <Popover label="설정" align="end" qa="settings-sheet" className="w-80" renderTrigger={triggerButton}>
        <SettingsContent themeMode={themeMode} onThemeChange={onThemeChange} quality={quality} />
      </Popover>
    );
  }

  return (
    <>
      {triggerButton({ ref: triggerRef, onClick: () => setSheetOpen(true), "aria-expanded": open, "aria-haspopup": "dialog" })}
      {open && createPortal(
        <Sheet label="설정" detent="half" onDetentChange={(detent) => detent === "peek" && setSheetOpen(false)} escapeCollapses={false}>
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
              setSheetOpen(false);
            }}
            className="flex flex-col gap-3 outline-none"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-title text-ink">설정</h2>
              <Button variant="ghost" iconOnly label="닫기" icon={<X aria-hidden="true" className="h-4 w-4" />} onClick={() => setSheetOpen(false)} />
            </div>
            <SettingsContent themeMode={themeMode} onThemeChange={onThemeChange} quality={quality} />
          </div>
        </Sheet>,
        document.body,
      )}
    </>
  );
}
