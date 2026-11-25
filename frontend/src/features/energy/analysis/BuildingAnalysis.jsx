import { Play } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBuildingAnalysisClient } from "./analysisApi.mjs";
import { buildAnalysisReport, parseAnalysisRun } from "./analysisContracts.mjs";
import { analysisReducer, createAnalysisState } from "./analysisState.mjs";
import { AnalysisInsights, AnalysisKpis, AnalysisSeriesChart } from "./BuildingAnalysisPanels.jsx";
import { toKoreanEnergyError } from "../shared/energyErrorMessages.mjs";
import { kstToday } from "../shared/energyContext.mjs";
import { FieldSelect } from "../shared/FieldSelect.jsx";
import { FIELD_CONTROL, FIELD_LABEL } from "../shared/fieldStyles.mjs";
import { Alert } from "../../../ui/Alert.jsx";
import { Button } from "../../../ui/Button.jsx";
import { Disclosure } from "../../../ui/Disclosure.jsx";
import { SectionHeader } from "../../../ui/SectionHeader.jsx";
import { StatusBadge } from "../../../ui/StatusBadge.jsx";

// Select 항목 값은 빈 문자열일 수 없어서 "고르지 않음"을 따로 둔다.
const NO_ALTERNATIVE = "__no-alternative__";
const NO_RUN = "__no-run__";
const planOption = (plan) => ({ value: plan.id, label: plan.name });

const EMPTY_PLANS_MESSAGES = Object.freeze({
  loading: "설치 계획을 불러오는 중입니다.",
  error: "설치 계획을 불러오지 못해 분석할 수 없습니다.",
  ready: "분석할 설치 계획이 없습니다.",
});

export function BuildingAnalysis({
  buildingId,
  buildingName = buildingId,
  plans = [],
  plansStatus = "ready",
  representativePlanId,
  date = kstToday(),
  weatherPreset = "clear",
  client,
  onRun,
}) {
  const api = useMemo(() => client ?? createBuildingAnalysisClient(), [client]);
  const [state, dispatch] = useReducer(
    analysisReducer,
    { buildingId, plans, representativePlanId, date },
    createAnalysisState,
  );
  const requestId = useRef(0);
  const execution = useRef(null);
  const planKey = plans.map((plan) => plan.id).join("\u0000");
  const normalizeRun = (value) => (value?.kpis && value?.series ? value : parseAnalysisRun(value));

  useEffect(() => {
    const id = ++requestId.current;
    execution.current?.abort();
    dispatch({ type: "context", requestId: id, buildingId, plans, representativePlanId });
    return () => {
      requestId.current += 1;
      execution.current?.abort();
    };
  }, [buildingId, planKey, representativePlanId]);

  // 날짜와 기상 프리셋은 에너지 탭 맨 위 한 줄을 따른다. 저장된 정의를 불러와도 탭의 값으로 다시 맞추고,
  // 이전 결과와 조건이 달라지면 조건 변경 경고가 붙는다.
  const draftDate = state.draft.date;
  const draftWeather = state.draft.conditions.weatherPreset;
  useEffect(() => {
    if (draftDate !== date) dispatch({ type: "draft", field: "date", value: date });
  }, [date, draftDate]);
  useEffect(() => {
    if (draftWeather !== weatherPreset)
      dispatch({ type: "draft", condition: true, field: "weatherPreset", value: weatherPreset });
  }, [weatherPreset, draftWeather]);

  useEffect(() => {
    const id = requestId.current;
    const controller = new AbortController();
    (async () => {
      const [scenarioResult, runResult] = await Promise.allSettled([
        api.listScenarios(buildingId, controller.signal),
        api.listRuns(buildingId, controller.signal),
      ]);
      if (controller.signal.aborted || id !== requestId.current) return;
      const failures = [scenarioResult, runResult]
        .filter((item) => item.status === "rejected")
        .map((item) => item.reason);
      if (failures.some((error) => error?.name === "AbortError")) return;
      dispatch({
        type: "loaded",
        requestId: id,
        scenarios: scenarioResult.status === "fulfilled" ? scenarioResult.value : [],
        runs: runResult.status === "fulfilled" ? runResult.value.map(normalizeRun) : [],
        error: failures.length ? toKoreanEnergyError(failures[0]) : null,
      });
    })();
    return () => controller.abort();
  }, [api, buildingId, planKey, representativePlanId]);

  const changeRepresentative = (value) => dispatch({ type: "draft", field: "representativePlanId", value });
  const changeAlternative = (value) =>
    dispatch({ type: "draft", field: "alternativePlanId", value: value === NO_ALTERNATIVE ? null : value });
  const condition = (field) => (event) =>
    dispatch({ type: "draft", condition: true, field, value: event.target.value });
  const costConditionsValid = [
    state.draft.conditions.electricityPriceKrwPerKwh,
    state.draft.conditions.carbonIntensityKgCo2ePerKwh,
  ].every((value) => value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0);

  const execute = async () => {
    if (!state.draft.representativePlanId || !state.draft.date || !costConditionsValid || state.status === "loading")
      return;
    const id = ++requestId.current;
    const controller = new AbortController();
    execution.current?.abort();
    execution.current = controller;
    dispatch({ type: "request", requestId: id });
    const definitionInput = {
      buildingId,
      name: `${buildingName} 비교 분석`.slice(0, 120),
      representativePlanId: state.draft.representativePlanId,
      alternativePlanId: state.draft.alternativePlanId,
      weatherPreset: state.draft.conditions.weatherPreset,
      electricityPriceKrwPerKwh: Number(state.draft.conditions.electricityPriceKrwPerKwh),
      carbonIntensityKgCo2ePerKwh: Number(state.draft.conditions.carbonIntensityKgCo2ePerKwh),
    };
    try {
      const definition = state.scenarioId
        ? await api.updateScenario(state.scenarioId, definitionInput, controller.signal)
        : await api.createScenario(definitionInput, controller.signal);
      if (controller.signal.aborted || id !== requestId.current) return;
      const report = normalizeRun(
        await api.runScenario(definition.id, state.draft.date, controller.signal, {
          demandSource: "predicted",
          weatherPreset: definitionInput.weatherPreset,
          electricityPriceKrwPerKwh: definitionInput.electricityPriceKrwPerKwh,
          carbonIntensityKgCo2ePerKwh: definitionInput.carbonIntensityKgCo2ePerKwh,
        }),
      );
      if (controller.signal.aborted || id !== requestId.current) return;
      dispatch({ type: "report", requestId: id, report: buildAnalysisReport(report), scenarioId: definition.id });
      onRun?.(report);
    } catch (error) {
      if (error?.name !== "AbortError" && id === requestId.current)
        dispatch({ type: "failure", requestId: id, error: toKoreanEnergyError(error) });
    } finally {
      if (execution.current === controller) execution.current = null;
    }
  };

  const selectRun = (value) => {
    const run = state.runs.find((item) => item.id === value);
    if (run)
      dispatch({
        type: "report",
        requestId: state.requestId,
        report: buildAnalysisReport(run),
        scenarioId: state.scenarioId,
      });
  };

  const canRun = Boolean(state.draft.representativePlanId && state.draft.date && costConditionsValid);
  return (
    <section data-qa="building-analysis" className="flex flex-col gap-3 pb-4" aria-labelledby="building-analysis-title">
      <SectionHeader
        id="building-analysis-title"
        title="건물 분석"
        badge={<StatusBadge tone="neutral">{buildingName}</StatusBadge>}
      />
      <Disclosure summary="분석 조건과 결과">
        <div className="flex flex-col gap-4">
          {plans.length === 0 ? (
            <p className="py-4 text-center text-body text-ink-muted">
              {EMPTY_PLANS_MESSAGES[plansStatus] ?? EMPTY_PLANS_MESSAGES.ready}
            </p>
          ) : (
            <>
              <p className="break-keep text-caption text-ink-muted">무태양광 기준선과 비교 · 예측 수요 15분 간격</p>
              <div className="grid grid-cols-2 gap-2">
                <FieldSelect
                  label="대표 설치 계획"
                  value={state.draft.representativePlanId}
                  onValueChange={changeRepresentative}
                  options={plans.map(planOption)}
                />
                <FieldSelect
                  label="대안 설치 계획"
                  value={state.draft.alternativePlanId ?? NO_ALTERNATIVE}
                  onValueChange={changeAlternative}
                  options={[
                    { value: NO_ALTERNATIVE, label: "대안 없음" },
                    ...plans.filter((plan) => plan.id !== state.draft.representativePlanId).map(planOption),
                  ]}
                />
              </div>
              <Disclosure summary="고급 · 요금·탄소 계수와 이전 실행">
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Label className={FIELD_LABEL}>
                      전기요금 (KRW/kWh)
                      <Input
                        aria-label="전기요금 (KRW/kWh)"
                        type="number"
                        min="0"
                        step="1"
                        value={state.draft.conditions.electricityPriceKrwPerKwh}
                        onChange={condition("electricityPriceKrwPerKwh")}
                        className={FIELD_CONTROL}
                      />
                    </Label>
                    <Label className={FIELD_LABEL}>
                      탄소배출계수 (kgCO2/kWh)
                      <Input
                        aria-label="탄소배출계수 (kgCO2/kWh)"
                        type="number"
                        min="0"
                        step="0.01"
                        value={state.draft.conditions.carbonIntensityKgCo2ePerKwh}
                        onChange={condition("carbonIntensityKgCo2ePerKwh")}
                        className={FIELD_CONTROL}
                      />
                    </Label>
                  </div>
                  {state.runs.length > 0 && (
                    <FieldSelect
                      label="이전 실행 스냅샷"
                      value={state.report?.id ?? NO_RUN}
                      onValueChange={selectRun}
                      options={[
                        { value: NO_RUN, label: "실행 선택", disabled: true },
                        ...state.runs.map((run) => ({
                          value: run.id,
                          label: `${run.date} · ${run.plans.representative.name}`,
                        })),
                      ]}
                    />
                  )}
                </div>
              </Disclosure>
              <Button
                variant="primary"
                onClick={execute}
                loading={state.status === "loading"}
                disabled={!canRun}
                disabledReason="대표 설치 계획, 날짜, 0 이상의 요금·배출계수가 필요합니다"
                icon={<Play aria-hidden="true" className="h-4 w-4" />}
                className="w-full"
              >
                분석 실행
              </Button>
            </>
          )}

          {state.error && (
            <Alert tone="danger" source="building-analysis" title="분석을 완료하지 못했습니다." message={state.error} />
          )}
          {state.dirty && state.report && (
            <Alert
              tone="warning"
              source="building-analysis"
              title="조건이 변경되었습니다"
              message="다시 실행하기 전까지 아래 결과는 이전 실행 스냅샷입니다."
            />
          )}
          {state.report && (
            <div data-qa="analysis-report" className="flex flex-col gap-4">
              <AnalysisInsights run={state.report} />
              <AnalysisKpis run={state.report} />
              <AnalysisSeriesChart run={state.report} />
            </div>
          )}
        </div>
      </Disclosure>
    </section>
  );
}
