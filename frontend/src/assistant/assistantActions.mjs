import { findCameraPreset } from "../camera/cameraPresets.mjs";

export function applyAssistantAction(event, dashboard) {
  const { flow, camera, clock, panelState, setActiveTab, role } = dashboard;
  const target = event?.target;
  switch (event?.action) {
    case "focus":
      if (typeof target !== "string" || !/^BLD_[A-Za-z0-9_]+$/.test(target)) return false;
      flow.selectFromUrl(target);
      camera.flyToBuilding(target);
      return true;
    case "view": {
      const preset = findCameraPreset(target);
      if (!preset) return false;
      camera.selectPreset(preset);
      return true;
    }
    case "home":
      camera.goHome();
      return true;
    case "tab":
      if (!["building", "status", ...(role === "admin" ? ["energy", "simulation"] : [])].includes(target)) return false;
      setActiveTab(target);
      panelState.reveal();
      return true;
    case "time":
      if (target === "live") clock.snapToNow();
      else {
        if (typeof target !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(target)) return false;
        const [hour, minute] = target.split(":").map(Number);
        clock.setSceneMinuteOfDay(hour * 60 + minute);
      }
      return true;
    default:
      return false;
  }
}

export function assistantContext({ selection, activeTab, flow, clock }, now = new Date()) {
  const minute = clock.sceneMinuteOfDay;
  return {
    t: `${new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16)}+09:00`,
    sel: selection.selectedId ?? null,
    tab: activeTab,
    view: flow.buildingViewMode,
    clock: clock.mode === "live" ? "live" : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
  };
}
