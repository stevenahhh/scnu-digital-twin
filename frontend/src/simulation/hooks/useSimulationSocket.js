import { useEffect } from "react";
import { simulationStore } from "../stores/simulationStore";
import { SIMULATION_WS_URL } from "../utils/apiConfig";
import { connectionLabel, reconnectDelayMs } from "./simulationSocketCore.mjs";

export function useSimulationSocket(url = SIMULATION_WS_URL) {
  useEffect(() => {
    if (typeof WebSocket === "undefined") {
      simulationStore.setConnectionStatus("연결 불가", "현재 환경에서 WebSocket을 지원하지 않습니다.");
      return undefined;
    }
    let socket = null;
    let retryTimer = null;
    let retryCount = 0;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      simulationStore.setConnectionStatus(retryCount ? "재연결 중" : "연결 중");
      try {
        socket = new WebSocket(url);
      } catch (error) {
        scheduleReconnect(error);
        return;
      }
      socket.onopen = () => {
        retryCount = 0;
        simulationStore.setConnectionStatus("연결됨");
      };
      socket.onmessage = (event) => {
        try {
          simulationStore.applyMessage(event.data);
        } catch (error) {
          console.warn("잘못된 시뮬레이션 메시지를 무시했습니다.", error);
        }
      };
      socket.onerror = () => simulationStore.setConnectionStatus("오류", "WebSocket 연결 오류");
      socket.onclose = () => {
        if (!disposed) scheduleReconnect(new Error("WebSocket 연결이 종료되었습니다."));
      };
    };

    const scheduleReconnect = (error) => {
      if (disposed) return;
      retryCount += 1;
      simulationStore.setConnectionStatus(
        connectionLabel(retryCount),
        error?.message || null,
      );
      const delay = reconnectDelayMs(retryCount);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "component unmounted");
      simulationStore.setConnectionStatus("연결 끊김");
    };
  }, [url]);
}
