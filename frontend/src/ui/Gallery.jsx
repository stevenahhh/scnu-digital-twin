import { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "./Button.jsx";
import { Segmented } from "./Segmented.jsx";

// 공용 기본 요소를 한 화면에 늘어놓는 확인용 화면(?ui=gallery). 시각 QA가 이 화면을 찍는다.
// ?theme=light|dark로 테마를 고른다. 제품 화면에는 연결되지 않는다.
const params = () => new URLSearchParams(window.location.search);

function GallerySection({ id, title, children }) {
  return (
    <section data-qa={`gallery-${id}`} id={`gallery-${id}`} className="flex flex-col gap-3 rounded-card border border-hairline bg-surface-1 p-4">
      <h2 className="text-title text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-20 shrink-0 text-caption text-ink-subtle">{label}</span>
      {children}
    </div>
  );
}

const BUTTON_STATES = [
  { id: "default", label: "기본" },
  { id: "hover", label: "올림" },
  { id: "active", label: "누름" },
  { id: "disabled", label: "비활성" },
  { id: "loading", label: "처리 중" },
];

function ButtonGallery() {
  return (
    <GallerySection id="button" title="버튼">
      {[["primary", "주요 동작"], ["secondary", "보조 동작"], ["ghost", "테두리 없음"]].map(([variant, variantLabel]) => (
        <div key={variant} className="flex flex-col gap-2">
          <h3 className="text-caption text-ink-muted">{variantLabel}</h3>
          {[["sm", "작게"], ["md", "보통"]].map(([size, sizeLabel]) => (
            <Row key={size} label={sizeLabel}>
              {BUTTON_STATES.map((state) => (
                <Button
                  key={state.id}
                  variant={variant}
                  size={size}
                  data-gallery-force={state.id === "hover" || state.id === "active" ? state.id : undefined}
                  disabled={state.id === "disabled"}
                  disabledReason="기상 서버 연결이 없어 지금은 저장할 수 없습니다"
                  loading={state.id === "loading"}
                >
                  저장 · {state.label}
                </Button>
              ))}
              <Button variant={variant} size={size} iconOnly icon={<RefreshCw aria-hidden="true" className="h-4 w-4" />} label="기상 데이터 새로고침" />
            </Row>
          ))}
        </div>
      ))}
      <Row label="아이콘">
        <Button variant="secondary" icon={<Plus aria-hidden="true" className="h-4 w-4" />}>비교에 추가</Button>
      </Row>
    </GallerySection>
  );
}

function SegmentedGallery() {
  const [tab, setTab] = useState("basic");
  const [mode, setMode] = useState("measured");
  const [wing, setWing] = useState("lab");
  return (
    <GallerySection id="segmented" title="세그먼트">
      <Segmented
        data-qa="gallery-segmented-tabs"
        kind="tabs"
        label="대시보드 탭"
        value={tab}
        onChange={setTab}
        options={[
          { value: "basic", label: "기본 현황" },
          { value: "parking", label: "주차·안전" },
          { value: "energy", label: "에너지" },
          { value: "environment", label: "환경 시뮬" },
        ]}
      />
      <Segmented
        kind="radio"
        label="데이터 기준"
        value={mode}
        onChange={setMode}
        options={[
          { value: "measured", label: "실측" },
          { value: "simulation", label: "시뮬레이션" },
        ]}
      />
      <Segmented
        kind="radio"
        size="sm"
        label="D4 동"
        value={wing}
        onChange={setWing}
        options={[
          { value: "lab", label: "실험동" },
          { value: "faculty", label: "교수동" },
          { value: "bridge", label: "연결 통로", disabled: true, disabledReason: "3층과 5층에서만 고를 수 있습니다" },
        ]}
      />
    </GallerySection>
  );
}

export default function Gallery() {
  const [theme, setTheme] = useState(() => (params().get("theme") === "light" ? "light" : "dark"));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <main data-qa="ui-gallery" className="h-full overflow-y-auto bg-canvas text-ink">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-display text-ink">공용 UI 기본 요소</h1>
          <Segmented
            className="max-w-xs"
            kind="radio"
            size="sm"
            label="테마"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: "어둡게" },
              { value: "light", label: "밝게" },
            ]}
          />
        </header>
        <ButtonGallery />
        <SegmentedGallery />
      </div>
    </main>
  );
}
