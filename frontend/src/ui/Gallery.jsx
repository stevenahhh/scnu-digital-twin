import { useEffect, useState } from "react";
import { useViewportMode } from "../hooks/useViewportMode.mjs";
import { Plus, Radio, RefreshCw } from "lucide-react";
import { Alert } from "./Alert.jsx";
import { Breadcrumb } from "./Breadcrumb.jsx";
import { Button } from "./Button.jsx";
import { Disclosure } from "./Disclosure.jsx";
import { EstimateValue } from "./EstimateValue.jsx";
import { MetricList } from "./MetricList.jsx";
import { Popover } from "./Popover.jsx";
import { DotMarker, SCENE_LABEL_STATES, SceneLabel, ZoneLabel } from "./SceneLabel.jsx";
import { SectionHeader } from "./SectionHeader.jsx";
import { Sheet } from "./Sheet.jsx";
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

const SHEET_DETENTS = [
  { value: "peek", label: "살짝" },
  { value: "half", label: "절반" },
  { value: "full", label: "전체" },
];

function SheetGallery() {
  return (
    <GallerySection id="sheet" title="바텀 시트">
      <p className="break-keep text-body text-ink-muted">폭 640px 미만(폰)에서만 쓰는 시트입니다. 아래 단계로 열면 장면 자리 위에 시트가 뜹니다.</p>
      <Row label="열기">
        {SHEET_DETENTS.map((detent) => (
          <a
            key={detent.value}
            href={`?ui=gallery&sheet=${detent.value}`}
            className="inline-flex min-h-8 items-center rounded-control border border-hairline-strong px-3 text-caption text-ink hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [@media(pointer:coarse)]:min-h-11"
          >
            {detent.label}
          </a>
        ))}
      </Row>
    </GallerySection>
  );
}

// ?ui=gallery&sheet=peek|half|full: 장면 자리 위에 시트를 띄운다. 장면 버튼으로 시트 바깥이 계속 눌리는지 확인한다.
function SheetDemo({ initial }) {
  const mode = useViewportMode();
  const [detent, setDetent] = useState(initial);
  const [sceneTaps, setSceneTaps] = useState(0);
  return (
    <main data-qa="ui-gallery" data-viewport-mode={mode} className="relative h-full overflow-hidden bg-canvas text-ink">
      <div data-qa="gallery-scene" className="absolute inset-0 flex flex-col items-center gap-3 bg-surface-3 p-6 pt-16">
        <p className="text-title text-ink">장면 자리</p>
        <Button data-qa="gallery-scene-button" onClick={() => setSceneTaps((count) => count + 1)}>
          장면 단추 {sceneTaps}
        </Button>
      </div>
      {mode === "phone" ? (
        <Sheet label="대시보드" detent={detent} onDetentChange={setDetent} header={<SectionHeader title="공과대학 3호관" badge={<StatusBadge>D4</StatusBadge>} />}>
          <div className="flex flex-col gap-4 pb-4">
            <MetricList
              caption="KMA 초단기실황과 건물 모델로 계산한 추정값입니다."
              items={[
                { label: "기온", value: <EstimateValue value={24.3} digits={1} unit="°C" /> },
                { label: "풍속", value: <EstimateValue value={2.1} digits={1} unit="m/s" /> },
                { label: "표면 온도", value: <EstimateValue value={31.8} digits={1} unit="°C" /> },
              ]}
            />
            {Array.from({ length: 8 }, (_, index) => (
              <p key={index} className="break-keep text-body text-ink-muted">
                {index + 1}층 강의실 사용 현황은 샘플 시간표로 만든 값입니다.
              </p>
            ))}
          </div>
        </Sheet>
      ) : (
        <p className="absolute inset-x-0 bottom-6 text-center text-body text-ink-muted">바텀 시트는 폭 640px 미만에서만 나타납니다.</p>
      )}
    </main>
  );
}

const STATE_NAMES = {
  idle: "기본",
  hover: "올림",
  focus: "키보드 초점",
  selected: "선택",
  dimmed: "흐림",
  "no-data": "데이터 없음",
  stale: "지난 값",
  estimated: "명칭 추정",
  motion: "움직이는 중",
};

function SceneLabelGallery() {
  return (
    <GallerySection id="scene-label" title="장면 라벨">
      <div className="flex flex-col gap-4 rounded-card bg-canvas p-4">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          {SCENE_LABEL_STATES.map((state) => (
            <div key={state} className="flex flex-col items-start gap-1">
              <span className="text-caption text-ink-subtle">{STATE_NAMES[state]}</span>
              <SceneLabel
                name={state === "estimated" ? "운동장 본부석" : "중앙도서관"}
                code={state === "estimated" ? "A15" : undefined}
                elementId={`BLD_GALLERY_${state}`}
                state={state}
                value={state === "hover" ? "24.3 °C 추정" : undefined}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="flex flex-col items-start gap-1">
            <span className="text-caption text-ink-subtle">코드 배지</span>
            <SceneLabel name="공과대학 3호관" code="D4" elementId="BLD_D4" tier={1} />
          </div>
          <div className="flex flex-col items-start gap-1">
            <span className="text-caption text-ink-subtle">긴 이름(두 줄)</span>
            <SceneLabel data-gallery-long-name="true" name="사범대학 3호관 부속 교육 연구 지원 센터 별관 실습동" elementId="BLD_LONG" />
          </div>
          <div className="flex flex-col items-start gap-1 pb-6">
            <span className="text-caption text-ink-subtle">지시선</span>
            <SceneLabel name="학생회관" elementId="BLD_LEADER" leader={{ dx: 18, dy: 22 }} />
          </div>
          <div className="flex flex-col items-start gap-1">
            <span className="text-caption text-ink-subtle">D4 층·호실(작게)</span>
            <div className="flex gap-2">
              <SceneLabel size="sm" name="3층" elementId="D4_F3" tier={3} />
              <SceneLabel size="sm" name="301호" elementId="D4_301" tier={3} state="selected" />
            </div>
          </div>
          <div className="flex flex-col items-start gap-1">
            <span className="text-caption text-ink-subtle">점 마커</span>
            <div className="flex gap-2">
              <DotMarker name="공과대학 3호관 별관" elementId="BLD_DOT" />
              <DotMarker name="학생생활관 5동" elementId="BLD_DOT_SELECTED" selected />
            </div>
          </div>
          <div className="flex flex-col items-start gap-1">
            <span className="text-caption text-ink-subtle">구역 라벨</span>
            <ZoneLabel name="공학 구역" />
          </div>
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

  const sheetDetent = params().get("sheet");
  if (SHEET_DETENTS.some((detent) => detent.value === sheetDetent)) return <SheetDemo initial={sheetDetent} />;

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
        <LoadingGallery />
        <SheetGallery />
        <SceneLabelGallery />
      </div>
    </main>
  );
}
