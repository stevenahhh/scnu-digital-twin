import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { COARSE_TARGET } from "../../../ui/Button.jsx";
import { FIELD_CONTROL } from "./fieldStyles.mjs";

// 이름표가 붙은 선택 칸. 값은 문자열이고 빈 문자열은 항목 값으로 쓸 수 없다(Radix Select 제약).
// 트리거의 value 속성은 네이티브 select처럼 지금 값을 DOM에서 읽게 한다. 나머지 속성(data-qa, aria-label)은 트리거로 간다.
export function FieldSelect({ label, value, onValueChange, options, className, triggerClassName, ...triggerProps }) {
  const id = useId();
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <Label htmlFor={id} className="text-caption text-ink-muted">{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} aria-label={label} value={value} className={cn(FIELD_CONTROL, triggerClassName)} {...triggerProps}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled} className={COARSE_TARGET}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
