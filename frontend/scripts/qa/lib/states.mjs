// S01..S17 state machine. S01..S12 follow SCREENS "How to reproduce" literally; S13..S17 are the
// plan's additions. Each state's `steps` run from the previous state and end at the capture point;
// `after` runs once the screenshot and checks are done (e.g. releasing the S11 drag).
import { sleep } from "./browser.mjs";
import { decode, inPage, pixelDiff } from "./probe.mjs";
import { openPanel, openTab } from "./tabs.mjs";

// S01..S17 are the audit states; S09E, S12E and S18 are the ideal-state additions (ideal-state.md section 6.1).
export const STATE_IDS = Object.freeze(["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12", "S13", "S14", "S15", "S16", "S17", "S09E", "S12E", "S18"]);
// Replay order. S18 forks from S01 and S09E/S12E from S09/S12; each undoes itself in `after`, and an optional state is
// replayed only when it is requested, so a run without them replays the audit chain unchanged.
export const CHAIN_IDS = Object.freeze(["S01", "S18", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S09E", "S10", "S11", "S12", "S12E", "S13", "S14", "S15"]);
export const S17_SUBSTATES = Object.freeze(["S01", "S04", "S06", "S08", "S13"]);
// Legacy-only states: S15 is the D4 roof editor (Legacy GLB roof planning only) and S16 the light-theme reload.
export const LEGACY_ONLY_STATE_IDS = Object.freeze(["S15", "S16"]);
// VWorld replays every chained state that exists there (all but the Legacy-only roof editor) and the S17 sub-states.
export const VWORLD_STATE_IDS = Object.freeze(CHAIN_IDS.filter((id) => !LEGACY_ONLY_STATE_IDS.includes(id)));
// S17 replays the chain with the fixtures up but skips the states between S08 and S13.
export const S17_SKIPPED_IDS = Object.freeze(["S09", "S09E", "S10", "S11", "S12", "S12E", "S18"]);
export const SAMPLE_OFFSETS_MS = Object.freeze([500, 2000, 2500]);
// Screenshots after the S04 chip tap (IS-31: the camera is still between 1500 and 3500 ms).
export const SHOT_OFFSETS_MS = Object.freeze([1500, 3500]);

const PANEL_CLOSE = '[aria-label="패널 닫기"]';
const CHIP = "button[data-qa=campus-label]";

async function act(ctx, selector, text, options) {
  const result = await ctx.b.tap(selector, text, options);
  ctx.actions.push(result.action);
  return result.ok;
}

async function tapIfVisible(ctx, selector, text) {
  if (await ctx.b.center(selector, text)) return act(ctx, selector, text);
  return false;
}

// 설정은 HUD의 `더보기` 메뉴 안에 있다(todo 4): 폰 시트를 열지 않고 연다. 메뉴가 없는 화면에서는 예전처럼
// 패널(폰은 시트)을 열고 `설정` 단추를 누른다.
async function openSettings(ctx) {
  if (await ctx.b.center("[data-qa=more-menu]")) {
    await act(ctx, "[data-qa=more-menu]");
    await sleep(400);
    return act(ctx, "[role=menuitem]", "설정");
  }
  await openPanelOnMobile(ctx);
  return act(ctx, '[aria-label="설정"]');
}

async function wait(ctx, ms) {
  ctx.actions.push(`wait ${ms / 1000} s`);
  await sleep(ms);
}

// After a camera move (preset fly, wheel): wait until the camera and the labels it drives are still, so the next tap
// lands on the chip at its final position instead of where it was mid-flight.
async function settleCamera(ctx) {
  const result = await ctx.b.cameraSettle();
  // The settled pose goes into the action log, so two runs of the same state can be compared (VWorld: the Cesium camera;
  // Legacy: the cam= link state).
  const pose = await ctx.b.run(() => {
    const viewer = window.ws3d?.viewer;
    const Cesium = window.Cesium;
    if (viewer && Cesium) {
      const c = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
      const deg = Cesium.Math.toDegrees;
      let model = null;
      for (let i = 0; i < viewer.scene.primitives.length; i += 1) { const p = viewer.scene.primitives.get(i); if (p?.id === "SCNU_D4_GLTF_OVERLAY") model = p; }
      const origin = model ? Cesium.Cartographic.fromCartesian(Cesium.Matrix4.getTranslation(model.modelMatrix, new Cesium.Cartesian3())).height.toFixed(2) : "none";
      return `lon ${deg(c.longitude).toFixed(6)} lat ${deg(c.latitude).toFixed(6)} h ${c.height.toFixed(1)} heading ${deg(viewer.camera.heading).toFixed(1)} pitch ${deg(viewer.camera.pitch).toFixed(1)} model ${origin} ${model?.anchorSource ?? "unanchored"} ${JSON.stringify(model?.anchorTrace ?? null)}`;
    }
    return new URLSearchParams(location.search).get("cam") ?? "unknown";
  }).catch(() => "unknown");
  ctx.actions.push(`${result.settled ? `camera settled after ${result.ms} ms (8 still frames)` : `camera NOT settled after ${result.ms} ms`}; pose ${pose}`);
}

async function closePanelOnMobile(ctx) {
  if (ctx.mobile && (await tapIfVisible(ctx, PANEL_CLOSE))) await sleep(1200);
}

async function openPanelOnMobile(ctx) {
  if (ctx.mobile) ctx.actions.push(await openPanel(ctx));
}

async function pickTab(ctx, role) {
  const result = await openTab(ctx, role);
  ctx.actions.push(`tab ${role}: ${result.action}`);
  return result.ok;
}

async function setTime(ctx, minutes) {
  const result = await ctx.b.setTimeMinutes(minutes);
  ctx.actions.push(result
    ? `set [data-qa=time-slider] input[type=range] (min ${result.min}, max ${result.max}) to ${minutes} via native value setter + input/change`
    : "NOT FOUND [data-qa=time-slider] input[type=range]");
}

// DOM snapshot used by the loading/skeleton checks (GAP-31, V-F-48).
async function domSample(ctx) {
  return ctx.b.run(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const inspector = document.querySelector("[data-qa=selection-inspector]");
    const spinners = [...document.querySelectorAll(".animate-spin,[role=progressbar],[aria-busy=true]")].filter(visible);
    return {
      spinners: spinners.length,
      spinnerTexts: spinners.map((el) => (el.closest("[role=status],div")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)),
      skeletons: [...document.querySelectorAll("[data-qa=skeleton],.animate-pulse")].filter(visible).length,
      inspector: Boolean(inspector),
      text: (inspector ?? document.querySelector("[data-qa=dashboard-panel]"))?.innerText?.replace(/\s+/g, " ").slice(0, 200) ?? null,
    };
  });
}

// In-page, self-contained: the live camera pose { source, heading (deg), position [x, y, z] (m) }, or null.
// VWorld: the Cesium camera of window.ws3d.viewer (the same handle checks/common.mjs saveCamera uses).
// Legacy: the OrbitControls instance AppLegacy hands its DOM-side components as `controlsRef`, found through React props;
// heading is the camera's azimuth around the controls target.
export function readCameraPose() {
  const cam = window.ws3d?.viewer?.camera;
  if (cam?.positionWC && Number.isFinite(cam.heading)) {
    const p = cam.positionWC;
    return { source: "ws3d.viewer.camera", heading: (cam.heading * 180) / Math.PI, position: [p.x, p.y, p.z] };
  }
  const host = document.getElementById("root");
  const key = host && Object.keys(host).find((k) => k.startsWith("__reactContainer$"));
  if (!key) return null;
  const isControls = (c) => Boolean(c?.object?.isCamera && c.target?.isVector3);
  const fromProps = (props) => {
    if (!props || typeof props !== "object") return null;
    for (const value of Object.values(props)) {
      if (!value || typeof value !== "object") continue;
      if (isControls(value.current)) return value.current;
      if (isControls(value.controlsRef?.current)) return value.controlsRef.current;
    }
    return null;
  };
  const stack = [host[key]];
  let controls = null;
  for (let visited = 0; stack.length && !controls && visited < 50000; visited += 1) {
    const fiber = stack.pop();
    controls = fromProps(fiber.memoizedProps);
    if (fiber.sibling) stack.push(fiber.sibling);
    if (fiber.child) stack.push(fiber.child);
  }
  if (!controls) return null;
  const c = controls.object.position;
  const t = controls.target;
  return { source: "OrbitControls (controlsRef) via React props", heading: (Math.atan2(c.x - t.x, c.z - t.z) * 180) / Math.PI, position: [c.x, c.y, c.z] };
}

// Samples the DOM (and optionally screenshots) at fixed offsets after a trigger action. With `shots`, the page is also
// captured at SHOT_OFFSETS_MS (memo `<state>:shots`: { [offset]: png, actualMs: { [offset]: ms }, pose: { [offset]: pose } }).
async function samplesAfterTrigger(ctx, label, { shots = false } = {}) {
  const start = Date.now();
  const samples = [];
  const captured = { actualMs: {}, pose: {} };
  const schedule = [...SAMPLE_OFFSETS_MS.map((offset) => ({ offset, dom: true })), ...(shots ? SHOT_OFFSETS_MS.map((offset) => ({ offset, shot: true })) : [])]
    .sort((a, b) => a.offset - b.offset);
  for (const step of schedule) {
    const remaining = step.offset - (Date.now() - start);
    if (remaining > 0) await sleep(remaining);
    if (step.shot) {
      captured.actualMs[step.offset] = Date.now() - start;
      captured.pose[step.offset] = await ctx.b.run(readCameraPose);
      captured[step.offset] = await ctx.b.screenshot();
      continue;
    }
    const sample = { offsetMs: step.offset, ...(await domSample(ctx)) };
    if (ctx.sampleShots?.includes(step.offset)) sample.file = await ctx.saveSample(label, step.offset);
    samples.push(sample);
  }
  ctx.memo.set(`${ctx.stateLabel}:samples`, samples);
  if (shots) ctx.memo.set(`${ctx.stateLabel}:shots`, captured);
  ctx.actions.push(`sampled DOM at ${SAMPLE_OFFSETS_MS.join("/")} ms${shots ? ` and screenshots at ${SHOT_OFFSETS_MS.join("/")} ms` : ""} after the tap`);
  return Date.now() - start;
}

async function waitForReady(ctx) {
  const legacy = ctx.entry === "legacy";
  for (let index = 0; index < 120; index += 1) {
    const ready = await ctx.b.run((isLegacy) => Boolean(document.querySelector("canvas"))
      && (isLegacy ? document.querySelectorAll("button[data-qa=campus-label]").length > 5 : Boolean(document.querySelector("[data-qa=dashboard-panel]"))), legacy);
    if (ready) return true;
    await sleep(500);
  }
  return false;
}

// Screenshot every 3 s until two consecutive PNG sizes differ by < 2 % (min 15 s, max 75 s).
async function settle(ctx) {
  const t0 = Date.now();
  let previous = 0;
  for (;;) {
    await sleep(3000);
    const size = (await ctx.b.screenshot()).length;
    const elapsed = Date.now() - t0;
    if ((elapsed > 15000 && previous && Math.abs(size - previous) / previous < 0.02) || elapsed > 75000) break;
    previous = size;
  }
  return Math.round((Date.now() - t0) / 1000);
}

// 설정 > 테마 > 라이트|다크 through the real dialog; dark keeps the default 시스템 + dark media.
export async function applyTheme(ctx, theme) {
  if (theme !== "light") {
    ctx.actions.push("theme 시스템 (prefers-color-scheme: dark emulated)");
    return true;
  }
  await openSettings(ctx);
  await sleep(800);
  await act(ctx, "[role=dialog] button", "라이트");
  await sleep(500);
  await ctx.b.key("Escape");
  ctx.actions.push("press Escape");
  await sleep(600);
  if (await ctx.b.center('[role=dialog] [aria-label="닫기"]')) await act(ctx, '[role=dialog] [aria-label="닫기"]');
  const applied = await ctx.b.evaluate("document.documentElement.dataset.theme");
  ctx.actions.push(`data-theme=${applied}`);
  return applied === "light";
}

// VWorld streams map tiles from a live service after every camera move and refines them in batches;
// wait until three screenshots 1.5 s apart all stay within 1 % PNG size (min 6 s, max 40 s) so a
// frame is never half-loaded or caught between two refinement batches.
// Cesium's own streaming state: the globe and every 3D tileset (VWorld photogrammetry) report all visible tiles loaded.
// A frame-size heuristic alone lets distant tiles finish refining after the capture, so two runs of the same pose
// captured different detail levels (S09/S10).
const cesiumTilesLoaded = (ctx) => ctx.b.run(() => {
  const scene = window.ws3d?.viewer?.scene;
  if (!scene) return null;
  if (scene.globe && scene.globe.tilesLoaded !== true) return false;
  for (let i = 0; i < scene.primitives.length; i += 1) {
    const p = scene.primitives.get(i);
    if (p && p.show !== false && "tilesLoaded" in p && p.tilesLoaded !== true) return false;
  }
  return true;
}).catch(() => null);

export async function settleTiles(ctx) {
  const t0 = Date.now();
  const sizes = [(await ctx.b.screenshot()).length];
  const loaded = [await cesiumTilesLoaded(ctx)];
  for (;;) {
    await sleep(1500);
    sizes.push((await ctx.b.screenshot()).length);
    loaded.push(await cesiumTilesLoaded(ctx));
    const last = sizes.slice(-3);
    const stable = last.length === 3 && Math.max(...last) / Math.min(...last) - 1 < 0.01;
    // null: no Cesium scene to ask (the frame-size test alone decides).
    const streamed = loaded.slice(-3).every((value) => value !== false) && loaded.length >= 3;
    const elapsed = Date.now() - t0;
    if ((elapsed >= 6000 && stable && streamed) || elapsed > 40000) break;
  }
  const done = loaded.at(-1);
  ctx.actions.push(`map tiles settled after ${Math.round((Date.now() - t0) / 100) / 10} s${done === false ? " (Cesium still streaming at the 40 s limit)" : ""}`);
}

export async function loadAndSettle(ctx, url) {
  await ctx.b.navigate(url);
  ctx.memo.set(`${ctx.stateLabel}:navigatedAt`, Date.now());
  ctx.actions.push(`navigate ${url.replace(/^https?:\/\/[^/]+/, "")}`);
  const ready = await waitForReady(ctx);
  ctx.actions.push(ready ? "ready: canvas + labels/panel present" : "NOT READY after 60 s");
  await applyTheme(ctx, ctx.theme);
  const seconds = await settle(ctx);
  ctx.actions.push(`settled after ${seconds} s`);
}

async function enterD4(ctx, beforeLabelTap) {
  await tapIfVisible(ctx, '[aria-label="닫기"]');
  await closePanelOnMobile(ctx);
  if (ctx.entry === "vworld") {
    // VWorld has no campus chips: D4 opens from its MODEL_NAME pick or the D4 coordinate-marker button.
    if (beforeLabelTap) await beforeLabelTap();
    await act(ctx, "button", "D4 공과대학 3호관 상세 보기");
    await wait(ctx, 4000);
    return;
  }
  await act(ctx, "[data-qa=camera-preset-d4]");
  await settleCamera(ctx);
  if (beforeLabelTap) await beforeLabelTap();
  // Building chips show the one display name (GAP-12), not the preset short name 공대 3호관.
  await act(ctx, CHIP, "공과대학 3호관");
  await wait(ctx, 4000);
}

async function selectLibrary(ctx, waitAfterMs, { beforeClick, shots = false } = {}) {
  await act(ctx, "[data-qa=camera-preset-library]");
  await settleCamera(ctx);
  // The idle frame right before the chip tap (after the preset flight): "before" and "after" show the same view.
  if (beforeClick) await beforeClick();
  await act(ctx, CHIP, "도서관");
  const elapsed = await samplesAfterTrigger(ctx, ctx.stateLabel, { shots });
  const extra = waitAfterMs - elapsed;
  if (extra > 0) await wait(ctx, extra);
}

// The 도서관 ground point on the VWorld map (lon, lat, ellipsoid height in m): where the app's 도서관 search flight centres the
// view (measured once from that flight, which aims at the library's label anchor).
export const VWORLD_LIBRARY_GROUND = Object.freeze([127.478934, 34.97016, 38.2]);

export const STATES = Object.freeze([
  {
    id: "S01", name: "initial-load",
    steps: async (ctx) => loadAndSettle(ctx, ctx.url),
  },
  {
    id: "S02", name: "zoomed-out-campus",
    steps: async (ctx) => {
      await closePanelOnMobile(ctx);
      await ctx.b.wheel(ctx.map.x, ctx.map.y, 300, 8);
      ctx.actions.push(`8x mouseWheel deltaY=+300 at ${ctx.map.x},${ctx.map.y}`);
      // OrbitControls damping keeps the camera (and the faded, frozen label layer) moving well past 2.5 s under SwiftShader.
      await settleCamera(ctx);
    },
  },
  {
    id: "S03", name: "zoomed-in-plaza-labels",
    steps: async (ctx) => {
      // Legacy zooms toward the orbit target (the campus centre). The VWorld SDK zooms toward the cursor and its wheel moves the
      // camera along the tilted view direction, which carries the view off campus; so VWorld approaches a fixed campus anchor:
      // the ground point of the 도서관 (where the app's own 도서관 search flight centres the view), along the current view
      // direction, to 406 m - the distance Legacy's 14 wheel ticks (OrbitControls x0.95 each from the 520-unit cap) leave.
      // A fixed point, not the chip: on a phone the 도서관 chip is cap-hidden at S02 and carries no anchor.
      const { x, y } = ctx.map;
      if (ctx.entry === "vworld") {
        const zoomed = await ctx.b.run((lon, lat, height) => {
          const viewer = window.ws3d?.viewer;
          const Cesium = window.Cesium;
          if (!viewer || !Cesium) return false;
          const camera = viewer.camera;
          const ground = Cesium.Cartesian3.fromDegrees(lon, lat, height);
          const toGround = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(ground, camera.positionWC, new Cesium.Cartesian3()), new Cesium.Cartesian3());
          const destination = Cesium.Cartesian3.subtract(ground, Cesium.Cartesian3.multiplyByScalar(toGround, 406, new Cesium.Cartesian3()), new Cesium.Cartesian3());
          const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(destination, new Cesium.Cartesian3());
          const along = Cesium.Cartesian3.multiplyByScalar(toGround, Cesium.Cartesian3.dot(normal, toGround), new Cesium.Cartesian3());
          const up = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(normal, along, new Cesium.Cartesian3()), new Cesium.Cartesian3());
          camera.setView({ destination, orientation: { direction: toGround, up } });
          viewer.scene.requestRender();
          return true;
        }, ...VWORLD_LIBRARY_GROUND);
        ctx.actions.push(`VWorld: camera toward the 도서관 ground point ${VWORLD_LIBRARY_GROUND.join(",")} to 406 m (Legacy S03 distance)${zoomed ? "" : " FAILED"}`);
      } else {
        await ctx.b.wheel(x, y, -300, 14);
        ctx.actions.push(`14x mouseWheel deltaY=-300 at ${x},${y}`);
      }
      await settleCamera(ctx);
    },
  },
  {
    id: "S04", name: "building-selected-library",
    steps: async (ctx) => {
      await selectLibrary(ctx, 3500, { beforeClick: () => ctx.snapshot("S04:before-click"), shots: true });
    },
  },
  {
    id: "S05", name: "D4-section-drilldown",
    steps: async (ctx) => {
      // GAP-07 / V-S-82: the tab and panel scroll position right before the D4 label is tapped.
      await enterD4(ctx, async () => ctx.memo.set("S05:before", await inPage(ctx.b, (qa) => ({
        tab: qa.activeTab(),
        scrollTop: qa.one("[data-qa=dashboard-panel] .overflow-y-auto")?.scrollTop ?? null,
      }))));
    },
  },
  {
    id: "S06", name: "time-night-2100",
    steps: async (ctx) => {
      await act(ctx, '[aria-label="캠퍼스 지도로 돌아가기"]');
      await wait(ctx, 3000);
      ctx.memo.set("S06:after-return", await inPage(ctx.b, (qa) => ({
        tab: qa.activeTab(),
        scrollTop: qa.one("[data-qa=dashboard-panel] .overflow-y-auto")?.scrollTop ?? null,
      })));
      await act(ctx, "[data-qa=camera-preset-overview]");
      await settleCamera(ctx);
      await setTime(ctx, 1260);
      await wait(ctx, 3500);
    },
  },
  {
    id: "S07", name: "time-noon-1200",
    steps: async (ctx) => {
      await setTime(ctx, 720);
      await wait(ctx, 3500);
    },
  },
  {
    id: "S08", name: "panel-environment-tab",
    steps: async (ctx) => {
      await openPanelOnMobile(ctx);
      await pickTab(ctx, "environment");
      await wait(ctx, 3000);
    },
  },
  {
    id: "S09", name: "camera-preset-gate",
    steps: async (ctx) => {
      await pickTab(ctx, "home");
      await sleep(600);
      await closePanelOnMobile(ctx);
      await act(ctx, "[data-qa=camera-preset-gate]");
      await settleCamera(ctx);
    },
  },
  {
    id: "S10", name: "settings-render-quality",
    steps: async (ctx) => {
      await openSettings(ctx);
      await wait(ctx, 1500);
    },
    after: async (ctx) => {
      await ctx.b.key("Escape");
      await sleep(600);
      await tapIfVisible(ctx, '[role=dialog] [aria-label="닫기"]');
      await sleep(600);
    },
  },
  {
    id: "S11", name: "mid-drag",
    steps: async (ctx) => {
      await closePanelOnMobile(ctx);
      const { x, y } = ctx.map;
      await ctx.b.mouse("mouseMoved", x, y, 0);
      await ctx.b.mouse("mousePressed", x, y, 1);
      for (let index = 1; index <= 10; index += 1) {
        await ctx.b.mouse("mouseMoved", x + index * 15, y + index * 6, 1);
        await sleep(40);
      }
      const holdMs = ctx.args?.holdMs ?? 150;
      await sleep(holdMs);
      // OrbitControls damping keeps easing after the last move, so a frame taken 150 ms in depends on
      // the frame rate. Keep holding until two frames 300 ms apart differ by < 0.2 % (max 10 s).
      const started = Date.now();
      let previous = decode(await ctx.b.screenshot());
      let diff = 1;
      while (Date.now() - started < 10000) {
        await sleep(300);
        const next = decode(await ctx.b.screenshot());
        diff = pixelDiff(previous, next);
        previous = next;
        if (diff < 0.002) break;
      }
      ctx.actions.push(`mousePressed at ${x},${y}; 10x mouseMoved (+15,+6); held ${holdMs} ms + ${Date.now() - started} ms until the orbit settled (frame diff ${diff.toFixed(4)}); capture while held`);
    },
    after: async (ctx) => {
      await ctx.b.mouse("mouseReleased", ctx.map.x + 150, ctx.map.y + 60, 0);
      await sleep(1500);
    },
  },
  {
    id: "S12", name: "panel-open-overlap",
    steps: async (ctx) => {
      await selectLibrary(ctx, 2500);
      const opened = await openPanel(ctx);
      ctx.actions.push(opened);
      if (!/^(NOT FOUND|panel already open)/.test(opened)) await wait(ctx, 300);
    },
  },
  {
    id: "S13", name: "parking-safety-tab",
    steps: async (ctx) => {
      await openPanelOnMobile(ctx);
      await pickTab(ctx, "parking");
      await wait(ctx, 3000);
    },
  },
  {
    id: "S14", name: "d4-room-grid-floor-6",
    steps: async (ctx) => {
      await enterD4(ctx);
      if (!(await ctx.b.center('[aria-label="6층 선택"]'))) await tapIfVisible(ctx, "button", "교수동");
      await sleep(1500);
      await act(ctx, '[aria-label="6층 선택"]');
      let grid = false;
      for (let index = 0; index < 24 && !grid; index += 1) {
        grid = await ctx.b.run(() => Boolean(document.querySelector("[data-qa=d4-room-grid]")));
        if (!grid) await sleep(500);
      }
      ctx.actions.push(grid ? "[data-qa=d4-room-grid] present" : "waited 12 s: [data-qa=d4-room-grid] not present (hook not in product yet)");
    },
  },
  {
    id: "S15", name: "roof-editor",
    steps: async (ctx) => {
      const inD4 = await ctx.b.run(() => Boolean(document.querySelector("#d4-installation-tab")));
      if (!inD4) await enterD4(ctx);
      // 편집 only exists when the plan list loads, so the energy fixtures are up for this state only.
      if (ctx.fixtureControl) {
        await ctx.fixtureControl.up();
        ctx.actions.push("fixtures up for S15 (the plan list needs a plan for 편집)");
      }
      // Planning opens from the 에너지 tab's 배치 편집 (ui-simplify todo 7 removed the D4 pane's 설치 계획 disclosure); the
      // disclosure and the old installation tab stay as fallbacks for older builds.
      if (await ctx.b.run(() => Boolean(document.querySelector("#d4-installation-tab")))) await act(ctx, "#d4-installation-tab");
      else if (await ctx.b.run(() => Boolean(document.querySelector("[data-qa=d4-plan-disclosure]")))) await act(ctx, "[data-qa=d4-plan-disclosure] button");
      else {
        await tapIfVisible(ctx, '[aria-label="캠퍼스 지도로 돌아가기"]');
        await sleep(1500);
        await pickTab(ctx, "energy");
        await wait(ctx, 3000);
        const placement = '[aria-label^="D4"][aria-label$="배치 편집"]';
        await ctx.b.run((sel) => { document.querySelector(sel)?.scrollIntoView({ block: "center" }); return true; }, placement);
        // The phone sheet can keep the comparison table below its visible detent, where a tap cannot reach it.
        if (!(await tapIfVisible(ctx, placement))) {
          const clicked = await ctx.b.run((sel) => { const el = document.querySelector(sel); el?.click(); return Boolean(el); }, placement);
          ctx.actions.push(clicked ? `element.click() ${placement} (not tappable in the viewport)` : `NOT FOUND ${placement}`);
        }
        await wait(ctx, 3000);
        // The request opens the roof editor on the scenario; its plan list (and 편집) sits one step back.
        await tapIfVisible(ctx, '[aria-label="설치 계획 목록으로 돌아가기"]');
      }
      await wait(ctx, 3000);
      await ctx.b.run(() => { [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "편집")?.scrollIntoView({ block: "center" }); return true; });
      await act(ctx, "button", "편집");
      await wait(ctx, 3000);
    },
    after: async (ctx) => {
      await tapIfVisible(ctx, '[aria-label="캠퍼스 지도로 돌아가기"]');
      await sleep(2000);
      if (ctx.fixtureControl) await ctx.fixtureControl.restore();
    },
  },
  {
    id: "S16", name: "light-theme",
    forcedTheme: "light",
    steps: async (ctx) => loadAndSettle(ctx, ctx.url),
  },
  {
    id: "S17", name: "fixtures-up",
    steps: async () => {},
  },
  {
    id: "S09E", name: "energy-tab-after-gate", optional: true,
    steps: async (ctx) => {
      await openPanelOnMobile(ctx);
      await pickTab(ctx, "energy");
      await wait(ctx, 3000);
    },
    // S10 opens 설정, which lives on the home tab.
    after: async (ctx) => {
      await pickTab(ctx, "home");
      await sleep(600);
    },
  },
  {
    id: "S12E", name: "energy-tab-with-selection", optional: true,
    steps: async (ctx) => {
      await openPanelOnMobile(ctx);
      await pickTab(ctx, "energy");
      await wait(ctx, 3000);
    },
    after: async (ctx) => {
      await pickTab(ctx, "home");
      await sleep(600);
    },
  },
  {
    id: "S18", name: "presentation-mode", optional: true,
    steps: async (ctx) => {
      await ctx.b.key("p");
      ctx.actions.push("press p");
      await sleep(1500);
      const on = await ctx.b.run(() => Boolean(document.querySelector("[data-qa=campus-hud][data-presenting=true]"))
        || document.querySelector("[data-qa=presentation-toggle]")?.getAttribute("aria-pressed") === "true");
      ctx.actions.push(on ? "presentation mode on" : "presentation mode NOT on after p");
    },
    after: async (ctx) => {
      const on = await ctx.b.run(() => document.querySelector("[data-qa=presentation-toggle]")?.getAttribute("aria-pressed") === "true"
        || Boolean(document.querySelector("[data-qa=campus-hud][data-presenting=true]")));
      if (on) await ctx.b.key("p");
      await sleep(1500);
    },
  },
]);

export function stateById(id) {
  return STATES.find((state) => state.id === id);
}

// Expands "S01..S17", "S01,S04" or "S03..S06" into ordered ids.
export function parseStateList(value) {
  if (!value) return [...STATE_IDS];
  const out = new Set();
  for (const part of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    const range = part.match(/^(S\d\d)\.\.(S\d\d)$/);
    if (range) {
      const from = STATE_IDS.indexOf(range[1]);
      const to = STATE_IDS.indexOf(range[2]);
      if (from < 0 || to < 0 || to < from) throw new Error(`unknown state range ${part}`);
      for (let index = from; index <= to; index += 1) out.add(STATE_IDS[index]);
    } else if (STATE_IDS.includes(part) || part === "GALLERY") {
      out.add(part);
    } else {
      throw new Error(`unknown state ${part}`);
    }
  }
  return STATE_IDS.filter((id) => out.has(id)).concat(out.has("GALLERY") ? ["GALLERY"] : []);
}
