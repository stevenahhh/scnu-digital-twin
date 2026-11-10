import { Copy, Edit3, MoreHorizontal, Plus, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createInstallationPlanClient, InstallationPlanContractError } from "./installationPlanApi.mjs";
import { toKoreanEnergyError } from "../shared/energyErrorMessages.mjs";
import { FIELD_INPUT } from "../shared/fieldStyles.mjs";
import { Alert } from "../../../ui/Alert.jsx";
import { Button } from "../../../ui/Button.jsx";
import { Popover } from "../../../ui/Popover.jsx";
import { SectionHeader } from "../../../ui/SectionHeader.jsx";
import { StatusBadge } from "../../../ui/StatusBadge.jsx";

function validateLoadedContext(buildingId, plans, representative) {
  if (!Array.isArray(plans)) throw new InstallationPlanContractError("plans", "array required");
  if (plans.some((plan) => plan.buildingId !== buildingId)) {
    throw new InstallationPlanContractError("plans", "every detailed plan must match the requested building");
  }
  if (representative && representative.buildingId !== buildingId) {
    throw new InstallationPlanContractError("representativePlan.buildingId", "requested building must match");
  }
  if (representative && !plans.some((plan) => plan.id === representative.installationPlanId)) {
    throw new InstallationPlanContractError(
      "representativePlan.installationPlanId",
      "representative must be one of the loaded plans",
    );
  }
}

const icon = (Icon, props) => <Icon aria-hidden="true" className="h-4 w-4" {...props} />;

// 대표 지정·해제 단추 하나. 대표 계획이면 해제, 아니면 지정한다.
function RepresentativeToggle({ representative, displayName, disabled, onSet, onClear }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className="w-full justify-start"
      onClick={representative ? onClear : onSet}
      disabled={disabled}
      aria-label={`${displayName} ${representative ? "대표 해제" : "대표로 지정"}`}
      icon={icon(Star, { fill: representative ? "currentColor" : "none" })}
    >
      {representative ? "대표 해제" : "대표 지정"}
    </Button>
  );
}

// 건물별 설치 계획 관리. createPlanDraft는 옥상 로컬 미터 좌표의 { name, arrays }를 돌려준다.
// 계획 행에는 편집 단추 하나만 보이고 복사·대표 지정·삭제는 행 메뉴 안에 있다. 이름은 칸을 벗어날 때 저장한다.
export function InstallationPlanManager({
  buildingId,
  client,
  createPlanDraft,
  onEditPlan,
  onPlansChange,
  onRepresentativeChange,
  refreshKey,
  className = "",
}) {
  const api = useMemo(() => client ?? createInstallationPlanClient(), [client]);
  const [plans, setPlans] = useState([]);
  const [representativeId, setRepresentativeId] = useState(null);
  const [names, setNames] = useState({});
  const [state, setState] = useState({ status: "loading", message: "설치 계획을 불러오는 중입니다." });
  const [busyAction, setBusyAction] = useState("");
  const callbacksRef = useRef({ onEditPlan, onPlansChange, onRepresentativeChange });
  const mutationRef = useRef({ generation: 0, controller: null });

  useEffect(() => {
    callbacksRef.current = { onEditPlan, onPlansChange, onRepresentativeChange };
  }, [onEditPlan, onPlansChange, onRepresentativeChange]);

  useEffect(
    () => () => {
      mutationRef.current.generation += 1;
      mutationRef.current.controller?.abort();
      mutationRef.current.controller = null;
    },
    [],
  );

  const publishPlans = useCallback(
    (nextPlans) => {
      if (nextPlans.some((plan) => plan.buildingId !== buildingId)) {
        throw new InstallationPlanContractError("plans", "every published plan must match the requested building");
      }
      setPlans(nextPlans);
      setNames(Object.fromEntries(nextPlans.map((plan) => [plan.id, plan.name])));
      callbacksRef.current.onPlansChange?.(nextPlans);
    },
    [buildingId],
  );

  const load = useCallback(() => {
    mutationRef.current.generation += 1;
    mutationRef.current.controller?.abort();
    mutationRef.current.controller = null;
    const controller = new AbortController();
    let active = true;
    publishPlans([]);
    setRepresentativeId(null);
    callbacksRef.current.onRepresentativeChange?.(null);
    setBusyAction("");
    setState({ status: "loading", message: "설치 계획을 불러오는 중입니다." });
    Promise.all([
      (api.listDetails ?? api.list).call(api, buildingId, { signal: controller.signal }),
      api.getRepresentative(buildingId, { signal: controller.signal }),
    ])
      .then(([nextPlans, representative]) => {
        if (!active) return;
        validateLoadedContext(buildingId, nextPlans, representative);
        publishPlans(nextPlans);
        setRepresentativeId(representative?.installationPlanId ?? null);
        callbacksRef.current.onRepresentativeChange?.(representative);
        setState({ status: "ready", message: "" });
      })
      .catch((error) => {
        if (active && error?.name !== "AbortError") {
          publishPlans([]);
          setRepresentativeId(null);
          callbacksRef.current.onRepresentativeChange?.(null);
          setState({ status: "error", message: toKoreanEnergyError(error) });
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, buildingId, publishPlans, refreshKey]);

  useEffect(load, [load]);

  const run = async (key, operation) => {
    if (busyAction) return;
    mutationRef.current.controller?.abort();
    const controller = new AbortController();
    const generation = mutationRef.current.generation + 1;
    mutationRef.current = { generation, controller };
    const isFresh = () =>
      mutationRef.current.generation === generation &&
      mutationRef.current.controller === controller &&
      !controller.signal.aborted;
    setBusyAction(key);
    setState({ status: "ready", message: "" });
    try {
      await operation({ signal: controller.signal, isFresh });
    } catch (error) {
      if (isFresh() && error?.name !== "AbortError") {
        setState({ status: "error", message: toKoreanEnergyError(error) });
      }
    } finally {
      if (isFresh()) {
        mutationRef.current.controller = null;
        setBusyAction("");
      }
    }
  };

  const create = () =>
    run("create", async ({ signal, isFresh }) => {
      const draft = await createPlanDraft({ buildingId, plans, representativePlanId: representativeId });
      if (!isFresh()) return;
      const created = await api.create({ buildingId, name: draft.name, arrays: draft.arrays }, { signal });
      if (!isFresh()) return;
      if (created.buildingId !== buildingId)
        throw new InstallationPlanContractError("plan.buildingId", "created plan must match the requested building");
      publishPlans([...plans, created]);
      callbacksRef.current.onEditPlan?.(created);
    });

  const rename = (plan) =>
    run(`rename-${plan.id}`, async ({ signal, isFresh }) => {
      const updated = await api.update(plan.id, { buildingId, name: names[plan.id], arrays: plan.arrays }, { signal });
      if (!isFresh()) return;
      if (updated.id !== plan.id || updated.buildingId !== buildingId) {
        throw new InstallationPlanContractError("plan", "updated plan identity must match the request");
      }
      publishPlans(plans.map((item) => (item.id === plan.id ? updated : item)));
    });

  const copy = (plan) =>
    run(`copy-${plan.id}`, async ({ signal, isFresh }) => {
      const created = await api.copy(plan, `${names[plan.id] || plan.name} 복사본`, { signal });
      if (!isFresh()) return;
      if (created.buildingId !== buildingId)
        throw new InstallationPlanContractError("plan.buildingId", "copied plan must match the requested building");
      publishPlans([...plans, created]);
    });

  const makeRepresentative = (plan) =>
    run(`representative-${plan.id}`, async ({ signal, isFresh }) => {
      const representative = await api.setRepresentative(buildingId, plan.id, { signal });
      if (!isFresh()) return;
      if (representative.buildingId !== buildingId || representative.installationPlanId !== plan.id) {
        throw new InstallationPlanContractError(
          "representativePlan",
          "updated representative identity must match the request",
        );
      }
      setRepresentativeId(representative.installationPlanId);
      callbacksRef.current.onRepresentativeChange?.(representative);
    });

  const clearRepresentative = (plan) =>
    run(`representative-${plan.id}`, async ({ signal, isFresh }) => {
      await api.unsetRepresentative(buildingId, { signal });
      if (!isFresh()) return;
      setRepresentativeId(null);
      callbacksRef.current.onRepresentativeChange?.(null);
    });

  const remove = (plan) =>
    run(`delete-${plan.id}`, async ({ signal, isFresh }) => {
      await api.remove(plan.id, { signal });
      if (!isFresh()) return;
      publishPlans(plans.filter((item) => item.id !== plan.id));
    });

  return (
    <section
      className={`flex flex-col gap-4 ${className}`}
      aria-labelledby="installation-plan-title"
    >
      <SectionHeader
        id="installation-plan-title"
        title="설치 계획"
        actions={
          <Button
            size="sm"
            onClick={create}
            disabled={!createPlanDraft || Boolean(busyAction)}
            disabledReason={
              !createPlanDraft ? "새 계획 초안을 만들 수 없습니다" : "다른 작업이 끝날 때까지 기다려 주세요"
            }
            icon={icon(Plus)}
          >
            새 설치 계획
          </Button>
        }
      />

      {state.status === "loading" && (
        <p role="status" className="text-caption text-ink-muted">
          {state.message}
        </p>
      )}
      {state.status === "error" && (
        <Alert
          tone="danger"
          source="installation-plans"
          title={state.message}
          actions={[{ label: "다시 시도", onClick: load }]}
        />
      )}
      {state.status === "ready" && plans.length === 0 && (
        <p className="py-4 text-center text-caption text-ink-muted">
          저장된 설치 계획이 없습니다.
        </p>
      )}

      <ul className="flex flex-col">
        {plans.map((plan) => {
          const representative = representativeId === plan.id;
          const displayName = names[plan.id] || plan.name;
          const busy = Boolean(busyAction);
          return (
            <li key={plan.id} className="flex flex-col gap-2 border-b border-hairline py-3 last:border-b-0">
              <div className="flex items-center justify-between gap-2">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">{plan.name} 계획 이름</span>
                  <input
                    aria-label={`${plan.name} 계획 이름`}
                    value={names[plan.id] ?? plan.name}
                    onChange={(event) => setNames((current) => ({ ...current, [plan.id]: event.target.value }))}
                    onBlur={() => { if (displayName.trim() && displayName !== plan.name && !busy) rename(plan); }}
                    className={`${FIELD_INPUT} font-medium`}
                  />
                </label>
                {representative && (
                  <StatusBadge tone="neutral" icon={Star}>
                    대표 계획
                  </StatusBadge>
                )}
              </div>
              <p className="text-caption text-ink-muted">
                {`배열 ${plan.arrays.length}개`}
                <span className="sr-only">{` ${plan.id}`}</span>
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => onEditPlan?.(plan)}
                  aria-label={`${displayName} 편집`}
                  icon={icon(Edit3)}
                >
                  편집
                </Button>
                <Popover
                  label={`${displayName} 작업`}
                  align="end"
                  renderTrigger={(props) => (
                    <Button {...props} size="sm" variant="ghost" iconOnly label={`${displayName} 작업 더 보기`} icon={icon(MoreHorizontal)} />
                  )}
                >
                  {({ close }) => (
                    <div className="flex flex-col gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="w-full justify-start"
                        onClick={() => { close(); copy(plan); }}
                        disabled={busy}
                        aria-label={`${displayName} 복사`}
                        icon={icon(Copy)}
                      >
                        복사
                      </Button>
                      <RepresentativeToggle
                        representative={representative}
                        displayName={displayName}
                        disabled={busy}
                        onSet={() => { close(); makeRepresentative(plan); }}
                        onClear={() => { close(); clearRepresentative(plan); }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="w-full justify-start"
                        onClick={() => { close(); remove(plan); }}
                        disabled={representative || busy}
                        disabledReason={
                          representative ? "대표 계획은 다른 계획을 대표로 지정한 뒤 삭제할 수 있습니다." : undefined
                        }
                        aria-label={`${displayName} 삭제`}
                        icon={icon(Trash2)}
                      >
                        삭제
                      </Button>
                    </div>
                  )}
                </Popover>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
