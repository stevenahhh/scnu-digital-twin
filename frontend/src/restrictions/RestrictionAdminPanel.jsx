import { useEffect, useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert } from "../ui/Alert.jsx";
import { Button } from "../ui/Button.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { Segmented } from "../ui/Segmented.jsx";
import { SimulationHttpError, describeSimulationError } from "../simulation/api/simulationHttp.mjs";
import { ACCESS_OPTIONS, CAUSE_OPTIONS, describeRestriction } from "./restrictionModel.mjs";
import { createRestriction, fetchRestrictionTargets, removeRestriction } from "./useCampusRestrictions.mjs";

const TARGET_OPTIONS = Object.freeze([{ value: "road", label: "도로" }, { value: "building", label: "건물" }]);
const failureText = (error) => {
  const text = (error instanceof SimulationHttpError && error.detail) || describeSimulationError(error);
  if (text === null) throw error;
  return text;
};

// 관리자용 시나리오 입력: 도로 ID로 통행을 막고 건물 ID로 공사·행사 알림을 띄운다. 3D 모델은 바꾸지 않는다.
export function RestrictionAdminPanel({ restrictions }) {
  const [targets, setTargets] = useState({ roads: [], buildings: [] });
  const [targetType, setTargetType] = useState("road");
  const [targetId, setTargetId] = useState("");
  const [cause, setCause] = useState("construction");
  const [access, setAccess] = useState("vehicles");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const targetField = useId();
  const messageField = useId();

  useEffect(() => {
    const controller = new AbortController();
    fetchRestrictionTargets({ signal: controller.signal })
      .then((body) => setTargets({ roads: body?.roads ?? [], buildings: body?.buildings ?? [] }))
      .catch((failure) => {
        if (failure?.name !== "AbortError") setError(failureText(failure));
      });
    return () => controller.abort();
  }, []);

  const options = targetType === "road" ? targets.roads : targets.buildings;
  const taken = useMemo(() => new Set(restrictions.items.map((item) => item.target_id)), [restrictions.items]);
  const available = options.filter((option) => !taken.has(option.id));
  const selected = available.some((option) => option.id === targetId) ? targetId : available[0]?.id ?? "";

  const run = async (action) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      await action();
      restrictions.refresh();
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  };
  const submit = (event) => {
    event.preventDefault();
    run(async () => {
      const body = await createRestriction({
        target_type: targetType, target_id: selected, cause, message: message.trim(),
        ...(targetType === "road" ? { access } : {}),
      });
      setMessage("");
      if (targetType === "road") setResult(`이동 중이던 ${body?.rerouted ?? 0}대·명이 우회합니다`);
    });
  };

  return (
    <section data-qa="restriction-admin" className="flex flex-col gap-3">
      <SectionHeader title="통제·공사 시나리오" />
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Segmented kind="radio" label="대상 종류" options={TARGET_OPTIONS} value={targetType} onChange={setTargetType} />
        <div className="flex flex-col gap-1">
          <Label htmlFor={targetField}>{targetType === "road" ? "도로" : "건물"}</Label>
          <Select value={selected} onValueChange={setTargetId}>
            <SelectTrigger id={targetField} className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-[min(18rem,var(--radix-select-content-available-height))]">
              {available.map((option) => <SelectItem key={option.id} value={option.id}>{`${option.id} · ${option.name}`}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Segmented kind="radio" label="사유" options={CAUSE_OPTIONS} value={cause} onChange={setCause} />
        {targetType === "road" && <Segmented kind="radio" label="통제 범위" options={ACCESS_OPTIONS} value={access} onChange={setAccess} />}
        <div className="flex flex-col gap-1">
          <Label htmlFor={messageField}>안내 문구</Label>
          <Input id={messageField} className="h-10" maxLength={200} value={message} onChange={(event) => setMessage(event.target.value)} />
        </div>
        <Button type="submit" variant="primary" data-qa="restriction-apply" loading={busy} disabled={!selected}>시나리오 적용</Button>
      </form>
      {error && <Alert tone="danger" source="restriction-admin" title={error} />}
      {result && <p role="status" className="text-caption text-ink-muted">{result}</p>}
      {restrictions.items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {restrictions.items.map((item) => {
            const text = describeRestriction(item);
            return (
              <li key={item.id} className="flex items-center justify-between gap-2 rounded-card bg-surface-2 px-3 py-2">
                <span className="min-w-0 break-keep text-caption text-ink">{`${text.title} · ${text.status}`}</span>
                <Button size="sm" variant="ghost" label={`${text.title} 해제`} disabled={busy} onClick={() => run(() => removeRestriction(item.id))}>해제</Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
