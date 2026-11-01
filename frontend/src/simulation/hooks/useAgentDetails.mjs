import { useEffect } from "react";
import { simulationStore } from "../stores/simulationStore";
import { fetchAgentDetails } from "../api/networkApi.mjs";
import { SimulationHttpError, describeSimulationError } from "../api/simulationHttp.mjs";
import { AGENT_DETAILS_BACKOFF, nextPollDelay, shouldPoll } from "./agentDetailsBackoff.mjs";

function describe(error) {
  if (error instanceof SimulationHttpError && error.status === 404) return "선택한 객체가 시뮬레이션을 마쳤습니다";
  return describeSimulationError(error);
}

// 선택한 교통 객체의 상세를 5초마다 받고, 실패하면 간격을 늘린다. 오프라인인 동안은 멈춘다.
export function useAgentDetails(selectedAgentId) {
  useEffect(() => {
    if (!selectedAgentId) return undefined;
    const controller = new AbortController();
    let failures = 0;
    let timer;
    const schedule = () => {
      timer = window.setTimeout(load, nextPollDelay(failures, AGENT_DETAILS_BACKOFF));
    };
    const load = async () => {
      if (!shouldPoll(globalThis.navigator)) return;
      try {
        const details = await fetchAgentDetails(selectedAgentId, { signal: controller.signal });
        failures = 0;
        if (details.id === selectedAgentId) simulationStore.setSelectedAgentDetails(details);
      } catch (error) {
        if (error?.name === "AbortError") return;
        const message = describe(error);
        if (message === null) throw error;
        failures += 1;
        simulationStore.setSelectedAgentDetails(null, message);
      }
      if (!controller.signal.aborted) schedule();
    };
    const resume = () => {
      window.clearTimeout(timer);
      load();
    };
    window.addEventListener("online", resume);
    load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.removeEventListener("online", resume);
    };
  }, [selectedAgentId]);
}
