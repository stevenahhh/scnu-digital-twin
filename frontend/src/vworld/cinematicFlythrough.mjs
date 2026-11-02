import { cinematicPose } from "./cinematicRoute.mjs";

const CINEMATIC_QUERY = "cinematic";
const RECORD_QUERY = "record";
const STATIC_QUERY = "static";
const DEFAULT_DURATION_MS = 60_000;
const INITIAL_SCENE_SETTLE_MS = 2_500;
const ROUTE_PRELOAD_MS = 12_000;
const RECORDING_SETTLE_MS = 2_000;
const OUTPUT_BASENAME = "scnu-real-drone-campus-loop-60s-live";
const LANDMARK_IDS = Object.freeze(["SCNU_CINEMATIC_MAIN_GATE", "SCNU_CINEMATIC_LIFE_SCIENCES"]);

export function cinematicProgress(search, key, fallback) {
  const value = Number(search.get(key) ?? fallback);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function setState(state) {
  document.documentElement.dataset.cinematicState = state;
}

function enableCaptureLayout() {
  document.documentElement.dataset.cinematic = "true";
  const style = document.createElement("style");
  style.textContent = `
    html[data-cinematic="true"],
    html[data-cinematic="true"] body,
    html[data-cinematic="true"] #root {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: var(--colors-canvas);
    }
    html[data-cinematic="true"] #vmap {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
      width: 100vw !important;
      height: 100vh !important;
      background: var(--colors-canvas);
    }
    html[data-cinematic="true"] .dashboard-root > * {
      display: none !important;
    }
    html[data-cinematic="true"] .dashboard-root > :has(#vmap) {
      display: block !important;
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
    }
    html[data-cinematic="true"] #vmap ~ * {
      display: none !important;
    }
    html[data-cinematic="true"] #vmap canvas {
      cursor: none !important;
    }
  `;
  document.head.append(style);
}

function waitForScene(timeoutMs = 20_000) {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    function inspect() {
      const map = globalThis.window.__scnuVWorldMapInstance;
      const viewer = map?._wsViewer ?? globalThis.window.ws3d?.viewer;
      const Cesium = globalThis.window.Cesium;
      if (viewer?.camera && viewer?.scene && Cesium) {
        resolve({ map, viewer, Cesium });
        return;
      }
      if (performance.now() - startedAt >= timeoutMs) {
        reject(new Error("The VWorld scene did not become ready for cinematic capture."));
        return;
      }
      requestAnimationFrame(inspect);
    }
    inspect();
  });
}

function emphasizeTraffic(viewer) {
  const entities = viewer.entities?.values ?? [];
  for (const entity of entities) {
    if (!entity.id?.startsWith("SCNU_SIM_") || !entity.model) continue;
    entity.model.minimumPixelSize = 9;
    entity.model.maximumScale = 3;
  }
}

function ensureLandmarkLabels(viewer, Cesium) {
  const landmarks = [
    { id: LANDMARK_IDS[0], text: "정문", longitude: 127.48309, latitude: 34.96873 },
    { id: LANDMARK_IDS[1], text: "생명대", longitude: 127.47955, latitude: 34.96942 },
  ];
  for (const landmark of landmarks) {
    if (viewer.entities.getById(landmark.id)) continue;
    viewer.entities.add({
      id: landmark.id,
      position: Cesium.Cartesian3.fromDegrees(landmark.longitude, landmark.latitude, 70),
      label: {
        text: landmark.text,
        font: "700 24px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.62),
        backgroundPadding: new Cesium.Cartesian2(12, 8),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }
}

function updateLandmarkVisibility(viewer, progress) {
  const mainGate = viewer.entities.getById(LANDMARK_IDS[0]);
  const lifeSciences = viewer.entities.getById(LANDMARK_IDS[1]);
  if (mainGate?.label) mainGate.label.show = progress <= 0.08;
  if (lifeSciences?.label) lifeSciences.label.show = progress >= 0.88;
}

function applyPose({ viewer, Cesium }, pose) {
  emphasizeTraffic(viewer);
  updateLandmarkVisibility(viewer, pose.progress);
  const destination = Cesium.Cartesian3.fromDegrees(
    pose.longitude,
    pose.latitude,
    pose.height,
  );
  viewer.camera.setView({
    destination,
    orientation: {
      heading: Cesium.Math.toRadians(pose.headingDegrees),
      pitch: Cesium.Math.toRadians(pose.pitchDegrees),
      roll: Cesium.Math.toRadians(pose.rollDegrees),
    },
  });
  viewer.render();
}

function supportedRecordingType() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
}

function createRecorder(canvas) {
  const mimeType = supportedRecordingType();
  const chunks = [];
  const stream = canvas.captureStream(0);
  const videoTrack = stream.getVideoTracks()[0];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 20_000_000,
  });
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  return {
    recorder,
    chunks,
    mimeType,
    requestFrame: () => videoTrack.requestFrame(),
  };
}

async function saveRecording(chunks, mimeType) {
  const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
  const blob = new Blob(chunks, { type: mimeType });
  const anchor = document.createElement("a");
  anchor.id = "cinematic-download";
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${OUTPUT_BASENAME}.${extension}`;
  anchor.setAttribute("aria-label", "시네마틱 녹화 다운로드");
  anchor.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0.01;z-index:2147483647";
  document.body.append(anchor);
  const video = document.createElement("video");
  video.id = "cinematic-recording";
  video.src = anchor.href;
  video.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0.01;z-index:2147483647";
  document.body.append(video);
  const response = await fetch("/__cinematic-capture", {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: blob,
  });
  if (!response.ok) throw new Error("The cinematic recording could not be saved locally.");
  anchor.click();
  document.documentElement.dataset.cinematicFilename = anchor.download;
}

function playRoute(scene, durationMs, requestFrame, startProgress = 0, endProgress = 1) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    function renderFrame(now) {
      const elapsedProgress = Math.min(1, (now - startedAt) / durationMs);
      const progress = startProgress + (endProgress - startProgress) * elapsedProgress;
      applyPose(scene, cinematicPose(progress));
      requestFrame?.();
      if (elapsedProgress < 1) requestAnimationFrame(renderFrame);
      else resolve();
    }
    requestAnimationFrame(renderFrame);
  });
}

function hashProgress() {
  const value = Number(new URLSearchParams(globalThis.window.location.hash.slice(1)).get("frame"));
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

async function startStaticFrameMode(scene) {
  const renderStaticFrame = () => {
    setState("frame-loading");
    applyPose(scene, cinematicPose(hashProgress()));
    globalThis.window.setTimeout(() => setState("frame-ready"), INITIAL_SCENE_SETTLE_MS);
  };
  globalThis.window.addEventListener("hashchange", renderStaticFrame);
  renderStaticFrame();
}

async function startCinematicCapture({ shouldRecord, durationMs, startProgress, endProgress }) {
  setState("loading");
  enableCaptureLayout();
  const scene = await waitForScene();
  ensureLandmarkLabels(scene.viewer, scene.Cesium);
  scene.viewer.resize?.();
  applyPose(scene, cinematicPose(startProgress));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  scene.viewer.resize?.();

  if (searchParams?.get(STATIC_QUERY) === "1") {
    await startStaticFrameMode(scene);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, INITIAL_SCENE_SETTLE_MS));
  setState("preloading");
  await playRoute(scene, ROUTE_PRELOAD_MS);
  applyPose(scene, cinematicPose(startProgress));
  await new Promise((resolve) => setTimeout(resolve, RECORDING_SETTLE_MS));

  if (!shouldRecord) {
    setState("playing");
    await playRoute(scene, durationMs, undefined, startProgress, endProgress);
    setState("complete");
    return;
  }

  const recording = createRecorder(scene.viewer.canvas);
  recording.recorder.start(250);
  setState("recording");
  await playRoute(scene, durationMs, recording.requestFrame, startProgress, endProgress);
  const stopped = new Promise((resolve) => recording.recorder.addEventListener("stop", resolve, { once: true }));
  recording.recorder.stop();
  await stopped;
  await saveRecording(recording.chunks, recording.mimeType);
  setState("complete");
}

const searchParams = typeof globalThis.window === "undefined"
  ? null
  : new URLSearchParams(globalThis.window.location.search);
if (searchParams?.get(CINEMATIC_QUERY) === "1") {
  const requestedDuration = Number(searchParams.get("duration"));
  const durationMs = Number.isFinite(requestedDuration) && requestedDuration > 0
    ? requestedDuration
    : DEFAULT_DURATION_MS;
  startCinematicCapture({
    shouldRecord: searchParams.get(RECORD_QUERY) === "1",
    durationMs,
    startProgress: cinematicProgress(searchParams, "from", 0),
    endProgress: cinematicProgress(searchParams, "to", 1),
  }).catch((error) => {
    console.error("Cinematic capture failed.", error);
    setState("error");
  });
}
