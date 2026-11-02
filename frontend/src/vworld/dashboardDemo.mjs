import { useEffect } from "react";

export const DASHBOARD_DEMO_DURATION_MS = 12_800;

export const DASHBOARD_DEMO_STATES = Object.freeze([
  Object.freeze({ at: 0, tab: "dashboard", temperature: 22, hour: 9, minute: 30 }),
  Object.freeze({ at: 2_400, tab: "environment", temperature: 22, hour: 9, minute: 30 }),
  Object.freeze({ at: 4_000, tab: "environment", temperature: 27, hour: 11, minute: 0 }),
  Object.freeze({ at: 5_600, tab: "environment", temperature: 33, hour: 14, minute: 30 }),
  Object.freeze({ at: 7_300, tab: "safety", temperature: 33, hour: 14, minute: 30 }),
  Object.freeze({ at: 9_300, tab: "energy", temperature: 33, hour: 14, minute: 30, selectBuilding: true }),
]);

export function dashboardDemoStateAt(elapsedMs) {
  const elapsed = Math.max(0, elapsedMs);
  return DASHBOARD_DEMO_STATES.findLast((state) => state.at <= elapsed) ?? DASHBOARD_DEMO_STATES[0];
}

export function dashboardDemoCameraPose(progress) {
  const clamped = Math.min(1, Math.max(0, progress));
  const eased = clamped < 0.5
    ? 4 * clamped ** 3
    : 1 - ((-2 * clamped + 2) ** 3) / 2;
  return {
    longitude: 127.48072 + (127.47872 - 127.48072) * eased,
    latitude: 34.96708 + (34.96872 - 34.96708) * eased,
    height: 430 + (390 - 430) * eased,
    headingDegrees: 332 + 13 * eased,
    pitchDegrees: -68,
  };
}

function waitForViewer() {
  return new Promise((resolve) => {
    function inspect() {
      const map = globalThis.window.__scnuVWorldMapInstance;
      const viewer = map?._wsViewer ?? globalThis.window.ws3d?.viewer;
      const Cesium = globalThis.window.Cesium;
      if (viewer?.camera && Cesium) resolve({ viewer, Cesium });
      else globalThis.window.requestAnimationFrame(inspect);
    }
    inspect();
  });
}

function applyCamera({ viewer, Cesium }, progress) {
  const pose = dashboardDemoCameraPose(progress);
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(pose.longitude, pose.latitude, pose.height),
    orientation: {
      heading: Cesium.Math.toRadians(pose.headingDegrees),
      pitch: Cesium.Math.toRadians(pose.pitchDegrees),
      roll: 0,
    },
  });
  viewer.render();
}

export function useDashboardDemo({ selectBuilding, setActiveTab, setMode, setSimTemp, setSunMonth, setSunDay, setSunHour, setSunMinute }) {
  useEffect(() => {
    const search = new URLSearchParams(globalThis.window.location.search);
    if (search.get("dashboardDemo") !== "1") return undefined;

    let active = true;
    let animationFrame = 0;
    let previousState = null;
    document.documentElement.dataset.dashboardDemo = "loading";
    setMode("simulation");
    setSunMonth(5);
    setSunDay(18);

    waitForViewer().then(async (scene) => {
      if (!active) return;
      applyCamera(scene, 0);
      await new Promise((resolve) => globalThis.window.setTimeout(resolve, 3_500));
      if (!active) return;
      const startedAt = performance.now();
      document.documentElement.dataset.dashboardDemo = "playing";

      function frame(now) {
        if (!active) return;
        const elapsed = Math.min(DASHBOARD_DEMO_DURATION_MS, now - startedAt);
        const state = dashboardDemoStateAt(elapsed);
        if (state !== previousState) {
          previousState = state;
          setActiveTab(state.tab);
          setSimTemp(state.temperature);
          setSunHour(state.hour);
          setSunMinute(state.minute);
          if (state.selectBuilding) selectBuilding({
            elementId: "BLD_D4",
            buildingId: "D4",
            displayName: "D4 공과대학 3호관",
          });
        }
        applyCamera(scene, elapsed / DASHBOARD_DEMO_DURATION_MS);
        if (elapsed < DASHBOARD_DEMO_DURATION_MS) animationFrame = requestAnimationFrame(frame);
        else document.documentElement.dataset.dashboardDemo = "complete";
      }

      animationFrame = requestAnimationFrame(frame);
    });

    return () => {
      active = false;
      cancelAnimationFrame(animationFrame);
      delete document.documentElement.dataset.dashboardDemo;
    };
  }, [selectBuilding, setActiveTab, setMode, setSimTemp, setSunDay, setSunHour, setSunMinute, setSunMonth]);
}
