import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createInstallationPlanClient } from "../features/energy/installations/installationPlanApi.mjs";

// 선택한 건물의 설치 계획 목록과 대표 계획. 건물이 바뀌거나 다시 시도하면 새로 받고, 늦게 온 이전 응답은
// 세대 번호(generation)로 버린다. 편집기에서 계획을 바꾸면(onPlansChange 등) 진행 중인 응답보다 그 값이 이긴다.
// 결과는 받은 건물 id와 함께 둔다. 건물이 막 바뀐 렌더에서는 이전 건물의 계획 대신 바로 `loading`을 돌려준다.
const LOADING = Object.freeze({ plans: [], representativePlanId: null, status: "loading" });

export function useInstallationPlans(buildingId) {
  const client = useMemo(() => createInstallationPlanClient(), []);
  const generationRef = useRef(0);
  const [result, setResult] = useState({ buildingId, ...LOADING });
  const [refreshKey, setRefreshKey] = useState(0);
  const [overlayRefreshKey, setOverlayRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let active = true;
    setResult({ buildingId, ...LOADING });
    Promise.all([
      client.listDetails(buildingId, { signal: controller.signal }),
      client.getRepresentative(buildingId, { signal: controller.signal }),
    ]).then(([plans, representative]) => {
      if (!active || generationRef.current !== generation) return;
      setResult({ buildingId, plans, representativePlanId: representative?.installationPlanId ?? null, status: "ready" });
    }).catch((loadError) => {
      if (!active || generationRef.current !== generation || loadError?.name === "AbortError") return;
      setResult({ buildingId, ...LOADING, status: "error" });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [client, refreshKey, buildingId]);

  const onPlansChange = useCallback((plans) => {
    generationRef.current += 1;
    setResult((previous) => ({ ...previous, plans, status: "ready" }));
  }, []);

  const onRepresentativeChange = useCallback((representative) => {
    generationRef.current += 1;
    setResult((previous) => ({ ...previous, representativePlanId: representative?.installationPlanId ?? null, status: "ready" }));
    setOverlayRefreshKey((value) => value + 1);
  }, []);

  const retry = useCallback(() => setRefreshKey((value) => value + 1), []);
  // 계획을 저장했거나 편집기를 닫은 뒤: 목록과 지도 위 대표 계획을 함께 다시 받는다.
  const refreshAll = useCallback(() => {
    setRefreshKey((value) => value + 1);
    setOverlayRefreshKey((value) => value + 1);
  }, []);

  const current = result.buildingId === buildingId ? result : LOADING;
  return {
    plans: current.plans,
    representativePlanId: current.representativePlanId,
    status: current.status,
    refreshKey,
    overlayRefreshKey,
    retry,
    refreshAll,
    onPlansChange,
    onRepresentativeChange,
  };
}
