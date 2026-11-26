import { Check, List, Plus, Redo2, RotateCcw, Save, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FIELD_CONTROL, FIELD_LABEL } from "../shared/fieldStyles.mjs";
import { Alert } from "../../../ui/Alert.jsx";
import { Button } from "../../../ui/Button.jsx";
import { Sheet } from "../../../ui/Sheet.jsx";
import { StatusBadge } from "../../../ui/StatusBadge.jsx";
import { cx } from "../../../ui/cx.mjs";
import { useViewportMode } from "../../../hooks/useViewportMode.mjs";

// 장면 아래 칸. 장면이 화면 폭을 다 쓰도록 위아래로 나누고, 넘치는 제어는 이 칸 안에서만 스크롤한다.
const BOTTOM_PANEL = [
  "relative z-20 flex max-h-[45%] min-h-0 shrink-0 flex-col gap-4 overflow-y-auto overscroll-contain",
  "border-t border-hairline-strong bg-surface-1 p-4 text-ink",
].join(" ");
const icon = (Icon) => <Icon aria-hidden="true" className="h-4 w-4" />;
const pressedClass = (pressed) => cx(pressed && "border-hairline-strong bg-surface-3 text-ink");

function NumberField({ label, value, min, max, step = 1, suffix, onChange }) {
  return (
    <Label className={FIELD_LABEL}>
      <span>
        {label} <span className="text-ink-subtle">({suffix})</span>
      </span>
      <Input
        className={FIELD_CONTROL}
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Label>
  );
}

// 머리 한 줄: 제목과 배열 추가·계획 목록. 데스크톱 아래 칸과 폰 바텀 시트가 같은 머리를 쓴다.
function ControlsHeader({ buildingId, onAdd, onBackToPlans }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-title text-ink">{buildingId} 옥상 태양광</h2>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" aria-label="태양광 배열 추가" onClick={onAdd} icon={icon(Plus)}>
          배열 추가
        </Button>
        {onBackToPlans && (
          <Button size="sm" aria-label="설치 계획 목록으로 돌아가기" onClick={onBackToPlans} icon={icon(List)}>
            계획 목록
          </Button>
        )}
      </div>
    </div>
  );
}

function ControlsBody({
  arrays,
  selectedArray,
  summary,
  canSave,
  canUndo,
  status,
  violations,
  onSelect,
  onUpdate,
  onDelete,
  onUndo,
  onSave,
  onReload,
}) {
  const message = status?.message;
  const update = (key) => (value) => onUpdate({ originMeters: { ...selectedArray.originMeters, [key]: value } });
  return (
    <div className="flex flex-col gap-4">
      {arrays.length > 1 && (
        <div className="flex flex-wrap gap-2" aria-label="배열 선택 목록">
          {arrays.map((array, index) => {
            const selected = array.id === selectedArray?.id;
            return (
              <Button
                size="sm"
                aria-pressed={selected}
                key={array.id}
                onClick={() => onSelect(array.id)}
                icon={selected ? <Check aria-hidden="true" className="h-4 w-4" /> : undefined}
                className={pressedClass(selected)}
              >
                배열 {index + 1}
              </Button>
            );
          })}
        </div>
      )}

      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ["모듈", `${summary.moduleCount}장`],
          ["면적", `${summary.areaSquareMeters.toFixed(2)}m²`],
          ["용량", `${summary.capacityKwp.toFixed(3)}kWp`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-control bg-surface-2 p-2">
            <dt className="text-caption text-ink-muted">{label}</dt>
            <dd className="mt-1 text-body font-semibold tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {selectedArray && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberField
            label="가로 위치"
            suffix="m"
            min={0}
            step={0.1}
            value={selectedArray.originMeters.xMeters}
            onChange={update("xMeters")}
          />
          <NumberField
            label="세로 위치"
            suffix="m"
            min={0}
            step={0.1}
            value={selectedArray.originMeters.yMeters}
            onChange={update("yMeters")}
          />
          <NumberField
            label="행 수"
            suffix="행"
            min={1}
            max={12}
            value={selectedArray.rows}
            onChange={(rows) => onUpdate({ rows })}
          />
          <NumberField
            label="열 수"
            suffix="열"
            min={1}
            max={12}
            value={selectedArray.columns}
            onChange={(columns) => onUpdate({ columns })}
          />
          <NumberField
            label="방위각"
            suffix="°"
            min={0}
            max={359}
            value={selectedArray.azimuthDeg}
            onChange={(azimuthDeg) => onUpdate({ azimuthDeg })}
          />
          <NumberField
            label="경사각"
            suffix="°"
            min={0}
            max={45}
            value={selectedArray.tiltDeg}
            onChange={(tiltDeg) => onUpdate({ tiltDeg })}
          />
          <fieldset className="col-span-2 sm:col-span-3">
            <legend className="mb-1 text-caption text-ink-muted">모듈 방향</legend>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["portrait", "세로형"],
                ["landscape", "가로형"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  aria-pressed={selectedArray.orientation === value}
                  onClick={() => onUpdate({ orientation: value })}
                  icon={selectedArray.orientation === value ? <Check aria-hidden="true" className="h-4 w-4" /> : undefined}
                  className={pressedClass(selectedArray.orientation === value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {violations.length > 0 && (
        <Alert
          tone="danger"
          source="roof-editor"
          title="오류: 이 배치는 저장할 수 없습니다"
          message={`${violations.map((violation) => violation.messageKo).join(" ")} Esc 키로 마지막 유효 배치로 돌아갑니다.`}
        />
      )}
      {message && (
        <p role="status">
          <StatusBadge tone={status.kind === "error" ? "danger" : "success"} className="text-caption">
            {message}
          </StatusBadge>
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button size="sm" onClick={onUndo} disabled={!canUndo} icon={icon(RotateCcw)}>
          실행 취소
        </Button>
        <Button size="sm" onClick={onDelete} disabled={!selectedArray} icon={icon(Trash2)}>
          삭제
        </Button>
        <Button size="sm" onClick={onReload} disabled={status?.busy} icon={icon(Redo2)}>
          다시 불러오기
        </Button>
        <Button
          size="sm"
          variant="primary"
          aria-label="배치 저장"
          onClick={onSave}
          disabled={!canSave}
          disabledReason="배치 오류를 고친 뒤 저장할 수 있습니다"
          loading={status?.busy}
          icon={icon(Save)}
        >
          배치 저장
        </Button>
      </div>
    </div>
  );
}

// 옥상 태양광 편집 제어판. 데스크톱·태블릿은 장면 아래 칸, 폰은 장면을 가리지 않는 바텀 시트(Sheet)다.
export function RoofEditorControls({ buildingId = "D4", arrays = [], onAdd, onBackToPlans, ...body }) {
  const phone = useViewportMode() === "phone";
  const header = <ControlsHeader buildingId={buildingId} onAdd={onAdd} onBackToPlans={onBackToPlans} />;
  const content = <ControlsBody arrays={arrays} {...body} />;
  if (phone) {
    return (
      <Sheet label="태양광 설치 제어판" defaultDetent="half" header={header}>
        {content}
      </Sheet>
    );
  }
  return (
    <aside
      className={BOTTOM_PANEL}
      aria-label="태양광 설치 제어판"
    >
      {header}
      {content}
    </aside>
  );
}
