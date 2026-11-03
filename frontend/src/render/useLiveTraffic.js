import { useSyncExternalStore } from "react";
import { simulationStore } from "../simulation/stores/simulationStore";
import { isLiveTraffic } from "./useDemandLoop.mjs";

const getLiveTraffic = () => isLiveTraffic(simulationStore.getState());

// 시뮬레이션 틱마다 바뀌는 스토어 대신 boolean 스냅숏을 구독해서, 실시간 여부가 바뀔 때만 대시보드를 다시 렌더한다.
export function useLiveTraffic() {
  return useSyncExternalStore(simulationStore.subscribe, getLiveTraffic, getLiveTraffic);
}
