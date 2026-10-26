import { useEffect, useState } from "react";
import { Plus, Radio, RefreshCw } from "lucide-react";
import { Alert } from "./Alert.jsx";
import { Breadcrumb } from "./Breadcrumb.jsx";
import { Button } from "./Button.jsx";
import { Disclosure } from "./Disclosure.jsx";
import { EstimateValue } from "./EstimateValue.jsx";
import { FreshnessStamp } from "./FreshnessStamp.jsx";
import { MetricList } from "./MetricList.jsx";
import { Popover } from "./Popover.jsx";
import { SectionHeader } from "./SectionHeader.jsx";
import { Segmented } from "./Segmented.jsx";
import { Skeleton } from "./Skeleton.jsx";
import { Spinner } from "./Spinner.jsx";
import { StatusBadge } from "./StatusBadge.jsx";

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

function BadgeGallery() {
  return (
    <GallerySection id="badge" title="상태 배지">
      <Row label="톤">
        <StatusBadge tone="neutral">D4</StatusBadge>
        <StatusBadge tone="success" icon={Radio}>실시간</StatusBadge>
        <StatusBadge tone="warning">지연</StatusBadge>
        <StatusBadge tone="danger">연결 끊김</StatusBadge>
        <StatusBadge tone="estimate" />
        <StatusBadge tone="sample" />
      </Row>
    </GallerySection>
  );
}

function AlertGallery() {
  return (
    <GallerySection id="alert" title="인라인 알림">
      <Alert
        tone="danger"
        source="weather"
        title="기상 서버에 연결할 수 없습니다"
        message="09:42에 마지막으로 받은 값을 보여 줍니다."
        lastValue="23.4 °C · 09:40"
        actions={[{ label: "다시 시도", onClick: () => {} }]}
        detail="GET /environment/full -> TypeError: Failed to fetch"
      />
      <Alert tone="warning" source="traffic" title="영상 분석 서버 응답이 지연되고 있습니다" actions={[{ label: "다시 시도", onClick: () => {} }]} />
      <Alert tone="neutral" source="simulation" title="교통 시뮬레이션 연결 중" message="연결되면 차량 흐름이 장면에 나타납니다." />
      <Alert tone="success" source="energy" title="설치 계획을 저장했습니다" actions={[{ label: "계획 보기", onClick: () => {} }]} />
    </GallerySection>
  );
}

function HeaderGallery() {
  return (
    <GallerySection id="header" title="섹션 제목">
      <SectionHeader level={2} title="태양광 현황" />
      <SectionHeader title="미기후" badge={<StatusBadge tone="estimate" />} subtitle="건물 표면 온도와 복사량은 모델로 계산한 추정값입니다." />
      <SectionHeader title="주차 현황" actions={<Button size="sm" variant="ghost">전체 보기</Button>} />
    </GallerySection>
  );
}

function BreadcrumbGallery() {
  return (
    <GallerySection id="breadcrumb" title="위치 경로">
      <Breadcrumb
        items={[
          { label: "캠퍼스", onSelect: () => {} },
          { label: "공과대학 3호관", onSelect: () => {} },
          { label: "3층", onSelect: () => {} },
          { label: "301호" },
        ]}
      />
    </GallerySection>
  );
}

function DisclosureGallery() {
  return (
    <GallerySection id="disclosure" title="펼침">
      <Disclosure summary="설치 계획">
        <p className="text-body text-ink-muted">지붕 면을 골라 태양광 패널 배치를 그립니다.</p>
      </Disclosure>
      <Disclosure summary="계산 방법" defaultOpen>
        <p className="text-body text-ink-muted">기상청 예보와 건물 재질을 넣어 표면 온도를 추정합니다.</p>
      </Disclosure>
    </GallerySection>
  );
}

function PopoverGallery() {
  return (
    <GallerySection id="popover" title="팝오버">
      <div className="flex min-h-40 items-start">
        <Popover
          label="범례"
          qa="legend"
          renderTrigger={(props) => (
            <Button size="sm" data-qa="gallery-popover-trigger" {...props}>
              범례
            </Button>
          )}
        >
          <ul className="flex flex-col gap-2 text-caption text-ink-muted">
            <li className="flex items-center gap-2"><StatusBadge tone="estimate" /> 모델로 계산한 값</li>
            <li className="flex items-center gap-2"><StatusBadge tone="sample" /> 실측이 아닌 예시 값</li>
          </ul>
        </Popover>
      </div>
    </GallerySection>
  );
}

// 갤러리 화면의 고정 시각(KST 09:40). 스크린숏이 찍을 때마다 달라지지 않게 한다.
const SAMPLE_AT = "2026-10-26T00:40:00Z";

function MetricGallery() {
  return (
    <GallerySection id="metric" title="지표 목록">
      <MetricList
        caption="KMA 초단기실황과 건물 모델로 계산한 추정값입니다."
        items={[
          { label: "기온", value: <EstimateValue value={24.3} digits={1} unit="°C" /> },
          { label: "풍속", value: <EstimateValue value={2.1} digits={1} unit="m/s" /> },
          { label: "습도", value: null, empty: { message: "기상 서버에 연결할 수 없습니다", actionLabel: "다시 시도", onAction: () => {} } },
          { label: "정문 진입 차량", value: <EstimateValue value={12} unit="대" estimated={false} /> },
        ]}
      />
    </GallerySection>
  );
}

function EstimateGallery() {
  const [temperature, setTemperature] = useState(24.3);
  return (
    <GallerySection id="estimate" title="추정값과 실측값">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-caption text-ink-subtle">추정</span>
          <EstimateValue value={temperature} digits={1} unit="°C" source="KMA 초단기실황" at={SAMPLE_AT} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-ink-subtle">실측</span>
          <EstimateValue value={12} unit="대" estimated={false} source="정문 카메라" at={SAMPLE_AT} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-ink-subtle">지난 값</span>
          <EstimateValue value={23.9} digits={1} unit="°C" source="KMA 초단기실황" at={SAMPLE_AT} stale />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-ink-subtle">값 없음</span>
          <EstimateValue value={undefined} unit="°C" onAction={() => {}} />
        </div>
      </div>
      <Button size="sm" className="self-start" data-qa="gallery-estimate-bump" onClick={() => setTemperature((value) => Math.round((value + 0.4) * 10) / 10)}>
        값 바꾸기
      </Button>
    </GallerySection>
  );
}

function FreshnessGallery() {
  return (
    <GallerySection id="freshness" title="갱신 시각">
      <Row label="기상">
        <FreshnessStamp at={SAMPLE_AT} feed="weather" feedLabel="기상 데이터" onRefresh={() => {}} />
      </Row>
      <Row label="교통">
        <FreshnessStamp at={null} feed="traffic" feedLabel="교통" onRefresh={() => {}} />
      </Row>
      <Row label="에너지">
        <FreshnessStamp at={SAMPLE_AT} feed="energy" feedLabel="에너지" onRefresh={() => {}} refreshing />
      </Row>
    </GallerySection>
  );
}

function LoadingGallery() {
  return (
    <GallerySection id="loading" title="불러오는 중">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-card border border-hairline p-3">
          <Skeleton shape="circle" />
          <Skeleton lines={3} />
        </div>
        <div className="flex flex-col gap-3 rounded-card border border-hairline p-3">
          <Skeleton shape="block" />
          <Spinner label="KMA 예보 가져오는 중" delayMs={0} />
        </div>
      </div>
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
        <BadgeGallery />
        <AlertGallery />
        <HeaderGallery />
        <BreadcrumbGallery />
        <DisclosureGallery />
        <PopoverGallery />
        <MetricGallery />
        <EstimateGallery />
        <FreshnessGallery />
        <LoadingGallery />
      </div>
    </main>
  );
}
