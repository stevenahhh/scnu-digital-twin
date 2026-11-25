import { useRef } from "react";
import { Check } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cx } from "./cx.mjs";
import { COARSE_TARGET } from "./Button.jsx";

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

// 트랙은 pill이라 안쪽 칸의 반지름과 맞출 필요가 없다. 칸은 높이를 내용에 맞춰 늘려 긴 이름이 줄을 바꿔도 잘리지 않는다.
const TRACK = "flex h-auto w-full items-stretch justify-start gap-1 rounded-pill border border-hairline bg-surface-1 p-1";
const SEGMENT = "h-auto min-w-0 flex-1 basis-0 gap-2 whitespace-normal rounded-control border py-0 font-medium transition-[color,border-color] duration-micro hover:bg-surface-2 hover:text-ink [&_svg]:size-3";

// 탭과 라디오가 함께 쓰는 칸 동작. Radix 루트에는 값만 내려 주고 선택은 여기서 처리한다:
// 클릭 한 번과 방향키가 onChange를 정확히 한 번 부르고, 비활성 칸은 포커스와 title(사유)을 유지한 채 건너뛴다.
// 방향키 처리기가 preventDefault를 부르므로 Radix의 포커스 이동은 실행되지 않는다.
function useSegments({ options, value, onChange, size }) {
  const itemRefs = useRef([]);
  const enabled = options.filter((option) => !option.disabled);

  const move = (fromValue, step) => {
    const from = enabled.findIndex((option) => option.value === fromValue);
    const target = enabled[(from + step + enabled.length) % enabled.length];
    if (!target) return;
    onChange?.(target.value);
    itemRefs.current[options.indexOf(target)]?.focus();
  };

  const handleKeyDown = (event, optionValue) => {
    if (NEXT_KEYS.has(event.key)) move(optionValue, 1);
    else if (PREV_KEYS.has(event.key)) move(optionValue, -1);
    else if (event.key === "Home") move(enabled[0]?.value, 0);
    else if (event.key === "End") move(enabled[enabled.length - 1]?.value, 0);
    else return;
    event.preventDefault();
  };

  // 선택된 값이 없으면 처음 쓸 수 있는 칸이 Tab을 받는다(로빙 tabindex).
  const tabStop = options.some((option) => option.value === value && !option.disabled) ? value : enabled[0]?.value;

  return (option, index) => {
    const active = option.value === value;
    return {
      ref: (node) => {
        itemRefs.current[index] = node;
      },
      value: option.value,
      id: option.id,
      "aria-controls": option.controls,
      "aria-disabled": option.disabled ? "true" : undefined,
      title: option.disabled ? option.disabledReason : undefined,
      tabIndex: option.value === tabStop ? 0 : -1,
      "data-active": active ? "true" : undefined,
      "data-qa": option.qa,
      onClick: () => !option.disabled && !active && onChange?.(option.value),
      onKeyDown: (event) => handleKeyDown(event, option.value),
      className: cx(
        SEGMENT,
        size === "sm" ? "min-h-8 px-2 text-caption" : "min-h-10 px-3 text-body",
        COARSE_TARGET,
        active ? "border-hairline-strong bg-surface-2 text-ink" : "border-transparent text-ink-muted",
        option.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      ),
    };
  };
}

// 활성 칸은 어디서나 같은 모양 하나: surface-2 바탕, ink 글자, 이름 앞 체크. 강조색 테두리·채움은 쓰지 않는다.
function SegmentLabel({ option, active }) {
  return (
    <>
      {active && <Check aria-hidden="true" className="h-3 w-3 shrink-0" data-qa="segment-dot" />}
      <span className="break-keep sm:whitespace-nowrap">{option.label}</span>
      {option.alert && <span aria-hidden="true" data-qa="alert-dot" className="h-2 w-2 shrink-0 rounded-pill bg-warning" />}
      {option.alert && <span className="sr-only">{option.alert}</span>}
    </>
  );
}

// 탭 목록만 그린다. 탭 본문과 함께 쓰는 쪽(DashboardPanel)은 이 목록과 TabsContent를 한 Tabs 아래에 둔다.
export function SegmentedTabList({ label, options, value, onChange, size = "md", className, ...rest }) {
  const segmentProps = useSegments({ options, value, onChange, size });
  return (
    <TabsList tabIndex={-1} aria-label={label} className={cx(TRACK, className)} {...rest}>
      {options.map((option, index) => (
        <TabsTrigger key={option.value} {...segmentProps(option, index)}>
          <SegmentLabel option={option} active={option.value === value} />
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

function SegmentedRadioGroup({ label, options, value, onChange, size = "md", className, ...rest }) {
  const segmentProps = useSegments({ options, value, onChange, size });
  return (
    <ToggleGroup type="single" rovingFocus={false} value={value ?? ""} aria-label={label} className={cx(TRACK, className)} {...rest}>
      {options.map((option, index) => (
        <ToggleGroupItem key={option.value} {...segmentProps(option, index)}>
          <SegmentLabel option={option} active={option.value === value} />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function Segmented({ kind = "tabs", ...props }) {
  if (kind === "radio") return <SegmentedRadioGroup {...props} />;
  return (
    <Tabs value={props.value ?? ""}>
      <SegmentedTabList {...props} />
    </Tabs>
  );
}
