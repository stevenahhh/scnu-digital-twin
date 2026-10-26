import { X } from "lucide-react";
import { AccessibleDialog } from "../components/AccessibleDialog";
import { Button } from "../ui/Button.jsx";
import { Segmented } from "../ui/Segmented.jsx";

const THEME_OPTIONS = [
  { value: "light", label: "라이트" },
  { value: "system", label: "시스템" },
  { value: "dark", label: "다크" },
];

// 설정 대화상자: 테마, 그리고 Legacy에서만 3D 렌더링 품질(quality를 넘길 때).
export function SettingsDialog({ onClose, themeMode, onThemeChange, quality }) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-[var(--colors-dim)]">
      <AccessibleDialog open onClose={onClose} title="설정" className="[&>h2]:sr-only">
        <section className="w-[min(400px,calc(100vw-2rem))] overflow-hidden rounded-card border border-hairline bg-surface-1 text-ink shadow-dialog">
          <div className="flex items-center justify-between border-b border-hairline bg-surface-2 px-5 py-3">
            <h3 className="text-title text-ink">설정</h3>
            <Button variant="ghost" iconOnly label="닫기" icon={<X aria-hidden="true" className="h-4 w-4" />} onClick={onClose} />
          </div>
          <div className="flex flex-col gap-6 p-6">
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
                <p className="break-keep text-caption text-ink-muted">
                  낮음은 기본 렌더러, 보통은 계단 현상 보정과 가벼운 접촉 그림자, 높음은 정밀한 접촉 그림자와 밤 조명 번짐을 더합니다.
                  {quality.source === "auto" ? " 지금은 이 기기의 그래픽 성능을 보고 자동으로 고른 값입니다." : ""}
                </p>
              </div>
            )}
          </div>
        </section>
      </AccessibleDialog>
    </div>
  );
}
