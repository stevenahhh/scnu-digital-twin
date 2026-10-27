// GAP-01..GAP-37 (DESIGN-AUDIT section 3 rows as section-7 checks). Each `doc` holds the literal row.
import {
  HOOKS, canvasRect, chipByText, chips, contrasts, defineCheck, exists, hasUpperEyebrow, hudRects, intersection,
  gapBetween, luminanceStep, missingHook, modelEdgeStep, panelInfo, pixelDiff, rectOf, result, roofBox, sampleFrames,
  sceneRegion, selectedTab, textItems, meanLuminance, worstContrast,
  openPanelSection,
  withPanelOpen,
} from "./common.mjs";

const D = ["D"];
const P = ["P"];
const DP = ["D", "P"];
const TIME_RE = /\b([01]?\d|2[0-3]):[0-5]\d\b/;

async function firstHudText(ctx) {
  return ctx.inPage((qa) => {
    const hud = qa.one("[data-qa=campus-hud]");
    if (!hud) return null;
    const items = qa.textNodesShown(hud).sort((a, b) => {
      const ra = a.el.getBoundingClientRect();
      const rb = b.el.getBoundingClientRect();
      return ra.top - rb.top || ra.left - rb.left;
    });
    return items[0] ? { text: items[0].value, qa: items[0].el.closest("[data-qa]")?.getAttribute("data-qa") ?? null } : null;
  });
}

export const GAP_CHECKS = [
  defineCheck("GAP-01", {
    states: ["S01"], viewports: DP,
    async run(ctx) {
      const panel = await panelInfo(ctx);
      const canvas = await canvasRect(ctx);
      const first = await firstHudText(ctx);
      const firstOk = Boolean(first && (TIME_RE.test(first.text) || /갱신/.test(first.text) || ["time-slider-value", "freshness-stamp"].includes(first.qa)));
      if (!panel) return result(false, { panel: null, canvas, firstHudText: first }, "panel present");
      if (ctx.viewport === "D") {
        return result(panel.visibleWidth <= 72 && firstOk, { panelVisibleWidth: panel.visibleWidth, firstHudText: first }, "panel width <= 72 px (rail) and the first HUD text is the time readout or the freshness stamp");
      }
      const canvasCover = canvas ? (canvas.w * Math.max(0, Math.min(canvas.h, ctx.height) - Math.max(0, panel.visibleHeight))) / (ctx.width * ctx.height) : 0;
      const panelShare = (panel.visibleWidth * panel.visibleHeight) / (ctx.width * ctx.height);
      const heightShare = panel.visibleWidth > 0 ? panel.visibleHeight / ctx.height : 0;
      return result(heightShare <= 0.25 && panelShare <= 0.25 && canvasCover >= 0.75 && firstOk,
        { panelHeightShare: Math.round(heightShare * 100) / 100, panelAreaShare: Math.round(panelShare * 100) / 100, canvasCoverShare: Math.round(canvasCover * 100) / 100, firstHudText: first },
        "panel height <= 25% of the viewport, canvas covers >= 75%, first HUD text is the time readout or the freshness stamp");
    },
  }),
  defineCheck("GAP-02", {
    states: ["S01", "S06"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const statusRows = qa.all("[role=alert],[data-qa=weather-error-banner]").filter(qa.visible).length;
        const retries = qa.all("button").filter((el) => qa.visible(el) && qa.txt(el).includes("다시 시도")).length;
        const dashes = qa.textNodesShown(qa.one("[data-qa=dashboard-panel]") ?? document.body).filter((item) => /^-(\s|°|m\/s|%|$)/.test(item.value)).map((item) => item.value).slice(0, 8);
        const modals = qa.all("[aria-modal=true]").filter(qa.visible).length;
        return { statusRows, retries, bareDashValues: dashes, modals };
      });
      return result(m.statusRows <= 3 && m.retries === 3 && m.bareDashValues.length === 0 && m.modals === 0, m,
        "<= 1 status row and exactly 1 retry per failed feed; no bare '-' metric value; no modal");
    },
  }),
  defineCheck("GAP-03", {
    states: ["S01"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const status = qa.one("[data-qa=weather-status]");
        const statusText = qa.txt(status);
        const hasRetry = Boolean(status && status.querySelector("button"));
        const simActive = qa.all("button").some((el) => qa.txt(el) === "시뮬레이션" && (el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-selected") === "true"));
        return { statusText: statusText.slice(0, 120), hasRetry, simulationSegmentActive: simActive, mentionsSimMode: document.body.innerText.includes("시뮬레이션 모드") };
      });
      const causeTimeRetry = /\d{1,2}:\d{2}/.test(m.statusText) && m.hasRetry && m.statusText.length > 8;
      return result(causeTimeRetry && (!m.mentionsSimMode || m.simulationSegmentActive), m,
        "status names cause + HH:mm + retry in one element; 시뮬레이션 모드 only while the simulation segment is active");
    },
  }),
  defineCheck("GAP-04", {
    states: ["S04"], viewports: D, fixtures: "up",
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const values = qa.all("[data-qa=estimate-value]").filter(qa.visible);
        return { estimateValues: values.length, withTag: values.filter((el) => /추정/.test(qa.txt(el)) && /\d{1,2}:\d{2}/.test(qa.txt(el))).length };
      });
      if (!m.estimateValues) return missingHook(HOOKS.estimate, "every estimated value carries 추정, unit, source + HH:mm through [data-qa=estimate-value]", m);
      return result(m.withTag === m.estimateValues, m, "every [data-qa=estimate-value] carries 추정 and a provenance time");
    },
  }),
  defineCheck("GAP-05", {
    states: { D: ["S01"], P: ["S04", "S12"] }, mutates: true,
    async run(ctx) {
      const panel = await panelInfo(ctx);
      if (ctx.viewport === "D") {
        if (!panel?.toggle) return result(false, { toggle: null }, "패널 닫기 control collapses the panel to <= 72 px");
        await ctx.b.tap('[aria-label="패널 닫기"]');
        await ctx.sleep(800);
        const collapsed = await panelInfo(ctx);
        await ctx.b.tap('[aria-label="패널 열기"]');
        await ctx.sleep(800);
        return result(collapsed.visibleWidth <= 72, { openWidth: panel.visibleWidth, collapsedVisibleWidth: collapsed.visibleWidth, toggle: panel.toggle }, "the collapse control reduces the panel to <= 72 px");
      }
      const selected = (await chips(ctx)).find((chip) => chip.pressed === "true") ?? null;
      const top = panel && panel.visibleWidth > 0 ? panel.rect.y : ctx.height;
      const chipAbove = Boolean(selected && selected.rect.y + selected.rect.h <= top && selected.rect.y >= 0);
      return result(top >= ctx.height * 0.5 && chipAbove, { panelTop: top, panelVisibleWidth: panel?.visibleWidth ?? null, selectedChip: selected?.rect ?? null }, "panel top >= 50% of the viewport and the selected chip fully visible above it");
    },
  }),
  defineCheck("GAP-06", {
    states: ["S07"], viewports: DP,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const banner = qa.one("[data-qa=weather-error-banner]");
        const position = banner ? getComputedStyle(banner).position : null;
        const scroller = qa.one("[data-qa=dashboard-panel] .overflow-y-auto") ?? qa.one("[data-qa=dashboard-panel]");
        const cards = scroller ? [...scroller.querySelectorAll("section,article,div.rounded-xl,div.rounded-lg,div.rounded-2xl")].filter(qa.visible) : [];
        const last = cards.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
        const inScroller = Boolean(banner && scroller && scroller.contains(banner) && !["fixed", "absolute", "sticky"].includes(position));
        return { banner: banner ? qa.r(banner) : null, position, inScrollBody: inScroller, lastCard: last ? qa.r(last) : null, overlap: banner && last ? qa.inter(qa.r(banner), qa.r(last)) : 0 };
      });
      return result(!m.banner || (m.inScrollBody && m.overlap === 0), m, "no fixed banner: weather status inside the scroll body, 0 px overlap with any card");
    },
  }),
  defineCheck("GAP-07", {
    states: ["S06"], viewports: DP,
    async run(ctx) {
      const before = ctx.memo.get("S05:before");
      const after = ctx.memo.get("S06:after-return");
      if (!before || !after) return result(false, { before: before ?? null, after: after ?? null }, "tab and scrollTop recorded around the D4 drill-down");
      const scrollOk = before.scrollTop == null || after.scrollTop == null || Math.abs(before.scrollTop - after.scrollTop) <= 8;
      return result(before.tab != null && before.tab === after.tab && scrollOk, { before, after }, "same tab (기본 현황) and scrollTop within 8 px after the return");
    },
  }),
  defineCheck("GAP-08", {
    states: ["S04"], viewports: D,
    async run(ctx) {
      const lib = await chipByText(ctx, "도서관");
      const inspectorTitle = await ctx.inPage((qa) => qa.txt(qa.one("[data-qa=selection-inspector] h2,[data-qa=selection-inspector] h3")) || null);
      const before = ctx.memo.get("S04:before-click");
      let roofDelta = null;
      let neighbourDrop = null;
      if (before && lib) {
        const prior = ctx.decode(before.png);
        const box = roofBox(lib);
        roofDelta = Math.round(pixelDiff(prior, ctx.image(), box, ctx.scale) * 1000) / 1000;
        const neighbour = before.chips.find((chip) => chip.text !== "도서관" && chip.rect && chip.rect.w > 0);
        if (neighbour) {
          const nb = roofBox({ rect: neighbour.rect });
          const l0 = meanLuminance(prior, nb, ctx.scale);
          const l1 = meanLuminance(ctx.image(), nb, ctx.scale);
          neighbourDrop = l0 ? Math.round(((l0 - l1) / l0) * 1000) / 1000 : null;
        }
      }
      const m = { pressed: lib?.pressed ?? null, roofDelta, neighbourLuminanceDrop: neighbourDrop, inspectorTitle };
      return result(lib?.pressed === "true" && roofDelta > 0.02 && neighbourDrop >= 0.1 && inspectorTitle === "도서관", m,
        "aria-pressed=true; library roof differs from idle; neighbour roof luminance drops >= 10%; inspector title === 도서관");
    },
  }),
  defineCheck("GAP-09", {
    states: ["S04"], viewports: DP, mutates: true,
    async run(ctx) {
      // Desktop starts on the rail (the inspector is a card beside it); the row measures the open panel's tab strip.
      if (ctx.viewport === "D") await openPanelSection(ctx);
      const before = ctx.memo.get("S04:before-click");
      const m = await ctx.inPage((qa) => {
        const inspector = qa.one("[data-qa=selection-inspector]");
        const tabs = qa.all("[data-qa^=dashboard-tab-]").length;
        const strip = qa.one("[data-qa^=dashboard-tab-]")?.parentElement;
        const above = inspector && strip ? inspector.getBoundingClientRect().bottom <= strip.getBoundingClientRect().top : false;
        return { tabsAfter: tabs, inspector: Boolean(inspector), inspectorAboveTabs: above };
      });
      m.tabsBefore = before ? "recorded" : null;
      if (!m.inspector) return missingHook(HOOKS.inspector, "tab count unchanged (4) and the inspector above the tab strip / at the half detent", m);
      return result(m.tabsAfter === 4 && (ctx.viewport === "P" || m.inspectorAboveTabs), m, "tab count 4 and inspector placement");
    },
  }),
  defineCheck("GAP-10", {
    states: ["S04"], viewports: DP,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const inspector = qa.one("[data-qa=selection-inspector]");
        const errorEl = (inspector ?? document).querySelector("[role=alert]");
        const retry = qa.all("button", inspector ?? document).some((el) => qa.txt(el).includes("다시 시도"));
        const detail = qa.all("button,summary", inspector ?? document).some((el) => /자세히|복사/.test(qa.txt(el) + (el.getAttribute("aria-label") ?? "")));
        return { inspector: Boolean(inspector), error: qa.txt(errorEl).slice(0, 100), retry, detail };
      });
      if (!m.inspector) return missingHook(HOOKS.inspector, "error names the cause, offers 다시 시도 plus 자세히/copy, last value with time, non-empty body", m);
      return result(Boolean(m.error) && m.retry && m.detail, m, "cause + 다시 시도 + 자세히/copy");
    },
  }),
  defineCheck("GAP-11", {
    states: ["S05"], viewports: DP,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const backs = qa.all("button,a").filter((el) => qa.visible(el) && (/지도|캠퍼스 전체 보기/.test(qa.txt(el) + (el.getAttribute("aria-label") ?? "")) || /^[←<]/.test(qa.txt(el))));
        const crumb = qa.one("nav[aria-label=breadcrumb],[data-qa=breadcrumb]");
        const canvas = qa.all("canvas").filter(qa.visible).length;
        return { backControls: backs.map((el) => qa.txt(el) || el.getAttribute("aria-label")), breadcrumb: crumb ? qa.txt(crumb) : null, visibleCanvases: canvas };
      });
      return result(m.backControls.length === 1 && /캠퍼스\s*[>›]\s*공과대학 3호관/.test(m.breadcrumb ?? "") && m.visibleCanvases > 0, m,
        "exactly 1 back control; breadcrumb 캠퍼스 > 공과대학 3호관; canvas rendered with D4 in frame");
    },
  }),
  defineCheck("GAP-12", {
    states: ["S03", "S04", "S05"], viewports: D,
    async run(ctx) {
      // Chips (all mounted, not only those in view), inspector/section titles and breadcrumb;
      // camera presets are exempt because the row allows them the shortName.
      const m = await ctx.inPage((qa) => {
        const names = [
          // All mounted chips: hidden pooled chips have no innerText, so read the name from the DOM (qa.chipName).
          ...qa.all("button[data-qa=campus-label]").map((el) => qa.chipName(el)),
          ...qa.all("h1,h2,h3,[role=heading],[data-qa=selection-inspector] *,[data-qa=breadcrumb] *,[role=dialog] div").filter((el) => qa.visible(el) && !el.closest("[data-qa^=camera-preset-]") && el.children.length === 0).map((el) => qa.txt(el)),
        ].filter((t) => /3호관|^도서관$/.test(t) && /공대|공과대학|도서관/.test(t));
        const headings = qa.all("h1,h2,h3,h4,[role=heading]").filter(qa.visible).map((el) => qa.txt(el));
        return { names: [...new Set(names)], headings: headings.slice(0, 30), texts: qa.textNodesShown().map((item) => item.value).slice(0, 400) };
      });
      const variants = [...new Set(m.names.filter((t) => /3호관/.test(t) && /공대|공과대학/.test(t)).map((t) => t.replace(/^D4\s*/, "").trim()))];
      const seen = new Set([...(ctx.runMemo.get(`GAP-12:${ctx.entry}:${ctx.viewport}:${ctx.theme}`) ?? []), ...variants]);
      ctx.runMemo.set(`GAP-12:${ctx.entry}:${ctx.viewport}:${ctx.theme}`, [...seen]);
      const eyebrows = hasUpperEyebrow([...m.headings, ...m.texts]);
      return result(seen.size === 1 && eyebrows.length === 0, { d4NameVariantsSoFar: [...seen], uppercaseHeadings: eyebrows.slice(0, 5) },
        "one displayName per building on every surface (presets may use shortName); 0 uppercase-English headings");
    },
  }),
  defineCheck("GAP-13", {
    states: ["S08"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const panel = qa.one("[data-qa=dashboard-panel]");
        const ranges = panel ? [...panel.querySelectorAll("input[type=range]")] : [];
        const label = (el) => qa.txt(el.closest("label") ?? el.parentElement?.parentElement ?? el.parentElement);
        const hm = ranges.filter((el) => /(^|\s)(시|분)(\s|$)|^시|^분/.test(label(el))).length;
        const sliderValue = qa.txt(qa.one("[data-qa=time-slider-value]"));
        const panelClock = qa.txt(qa.one("[data-qa=dashboard-panel] [data-qa=panel-clock]") ?? [...(panel?.querySelectorAll("div,span,p") ?? [])].find((el) => /오[전후]\s*\d{1,2}:\d{2}/.test(qa.txt(el)) && el.children.length === 0));
        return { hourMinuteSliders: hm, sliderValue, panelClock };
      });
      const sameClock = m.sliderValue && m.panelClock && m.panelClock.includes(m.sliderValue.replace(/^0/, ""));
      return result(m.hourMinuteSliders === 0 && (sameClock || /현재/.test(m.panelClock ?? "")), m, "0 hour/minute sliders in the panel; header clock equals the scene time or both clocks labelled");
    },
  }),
  defineCheck("GAP-14", {
    states: ["S07"], viewports: D, mutates: true,
    async run(ctx) {
      const region = await sceneRegion(ctx);
      await ctx.b.setTimeMinutes(1140);
      await ctx.sleep(3500);
      const at19 = await ctx.screenshot();
      await ctx.b.setTimeMinutes(1260);
      await ctx.sleep(600);
      const cue = await ctx.inPage((qa) => qa.all("[data-updated],[data-qa=updated-cue]").filter(qa.visible).length);
      await ctx.sleep(2900);
      const at21 = await ctx.screenshot();
      await ctx.b.setTimeMinutes(720);
      await ctx.sleep(1500);
      const diff = Math.round(pixelDiff(at19, at21, region, ctx.scale) * 10000) / 100;
      return result(diff >= 2 && cue > 0, { meanDiffPercent19vs21: diff, updatedCues: cue }, ">= 2% mean difference between 19:00 and 21:00 and an updated cue on changed cards");
    },
  }),
  defineCheck("GAP-15", {
    states: ["S08"], viewports: DP, mutates: true,
    async run(ctx) {
      // Phone: picking the tab leaves the sheet at half, the tab's controls below the fold; raise it as a user would.
      return withPanelOpen(ctx, null, async () => {
      const sliderLabels = await textItems(ctx, "[data-qa=dashboard-panel] *", { match: "^(온도|월|일|시|분|태양)" });
      const rows = contrasts(ctx, sliderLabels);
      const worst = worstContrast(rows);
      const m = await ctx.inPage((qa) => ({
        segments: qa.all("[data-qa=dashboard-panel] button").filter(qa.visible).map((el) => qa.txt(el)).filter((t) => /^(Live|Sim|실측|시뮬레이션|실시간)$/.test(t)),
        timeSliders: qa.all("[data-qa=dashboard-panel] input[type=range]").filter((el) => /(월|일|시|분)/.test(qa.txt(el.parentElement?.parentElement))).length,
      }));
      return result(worst && worst.ratio >= 4.5 && m.segments.join("/") === "실측/시뮬레이션" && m.timeSliders === 0,
        { worstLabel: worst, segments: m.segments, duplicateTimeSliders: m.timeSliders }, "labels >= 4.5:1, segments 실측 / 시뮬레이션, 0 duplicate time sliders");
      });
    },
  }),
  defineCheck("GAP-16", {
    states: { D: ["S01"], P: ["S02", "S09"] },
    async run(ctx) {
      if (ctx.viewport === "D") {
        const groups = await ctx.inPage((qa) => {
          const bar = qa.one("[data-qa=camera-preset-bar]");
          if (!bar) return null;
          const items = qa.all("[data-qa^=camera-preset-]", bar).filter((el) => el.tagName === "BUTTON" && qa.visible(el)).length + qa.all("[data-qa=camera-tour-toggle]", bar).length;
          const menus = qa.all("[aria-haspopup],[role=group]", bar).length;
          return { buttons: items, groupsOrMenus: menus };
        });
        const count = groups ? Math.max(groups.groupsOrMenus, groups.buttons) : null;
        return result(count != null && count <= 3, { toolbar: groups, groups: count }, "<= 3 groups (전체, 시점 menu, 투어)");
      }
      const m = await ctx.inPage((qa) => {
        const items = qa.all("[data-qa^=camera-preset-]").filter((el) => el.tagName === "BUTTON" && !/fade/.test(el.getAttribute("data-qa")));
        const partial = items.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && ((r.left < 0 && r.right > 0) || (r.left < innerWidth && r.right > innerWidth)); }).length;
        const menu = qa.all("button").some((el) => qa.visible(el) && /시점/.test(qa.txt(el) + (el.getAttribute("aria-label") ?? "")) && el.hasAttribute("aria-haspopup"));
        return { presets: items.length, partiallyVisible: partial, viewMenu: menu };
      });
      return result(m.viewMenu && m.partiallyVisible === 0, m, "every preset reachable through a visible 시점 menu; no partially visible item");
    },
  }),
  defineCheck("GAP-17", {
    states: ["S01"], viewports: DP, mutates: true,
    async run(ctx) {
      const selector = "[data-qa=search-field] input[type=search], [data-qa=campus-hud] input[type=search]";
      const field = await ctx.inPage((qa, a) => {
        const el = qa.all(a.sel).find(qa.visible);
        return el ? { rect: qa.r(el) } : null;
      }, { sel: selector });
      if (!field) return missingHook(HOOKS.search, "search field exists; 도서관 result; Enter selects the library chip and moves the camera");
      // Row: type 도서관, press Enter; record the camera before/after. The camera is read from the scene pixels left of the panel.
      const sceneBox = () => ctx.inPage((qa) => {
        const canvas = qa.all("canvas").find(qa.visible);
        if (!canvas) return null;
        const c = canvas.getBoundingClientRect();
        const panel = qa.one("[data-qa=dashboard-panel]");
        const p = panel && qa.visible(panel) ? panel.getBoundingClientRect() : null;
        const right = p && p.left > c.left + 40 ? Math.min(c.right, p.left) : c.right;
        const bottom = p && p.top > c.top + 40 && p.left <= c.left + 1 ? Math.min(c.bottom, p.top) : c.bottom;
        return { x: c.left, y: c.top + 80, w: right - c.left, h: Math.max(0, bottom - c.top - 80) };
      });
      const box = await sceneBox();
      const before = await ctx.screenshot();
      const focused = (await ctx.b.tap(selector)).ok;
      await ctx.b.view.cdp("Input.insertText", { text: "도서관" });
      await ctx.sleep(500);
      const listed = await ctx.inPage((qa) => qa.all("[role=listbox] [role=option]").filter(qa.visible).map((el) => qa.txt(el)));
      await ctx.b.key("Enter");
      await ctx.sleep(3000);
      const chip = await chipByText(ctx, "도서관");
      const after = await ctx.screenshot();
      const cameraChange = box && box.w > 0 && box.h > 0 ? Math.round(pixelDiff(before, after, box, ctx.scale) * 1000) / 1000 : null;
      // Put the page back (no selection, overview camera) so the probe replay's later S01 checks start from S01.
      if (await ctx.b.center('[data-qa=selection-inspector] button[aria-label="닫기"]')) await ctx.b.tap('[data-qa=selection-inspector] button[aria-label="닫기"]');
      await ctx.b.tap("[data-qa=camera-preset-overview]", null, { timeoutMs: 3000 });
      await ctx.b.cameraSettle?.();
      const pass = focused && listed.some((text) => /도서관/.test(text)) && chip?.pressed === "true" && cameraChange > 0.03;
      return result(pass, { field, focused, listed: listed.slice(0, 8), chipPressed: chip?.pressed ?? null, cameraChange },
        "search field exists; a result list shows 도서관; Enter sets the library chip aria-pressed=true and the camera position changes");
    },
  }),
  defineCheck("GAP-18", {
    states: ["S04"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => ({
        href: location.href,
        copyLink: qa.all("button").some((el) => qa.visible(el) && /링크 복사/.test(qa.txt(el) + (el.getAttribute("aria-label") ?? ""))),
      }));
      const url = new URL(m.href);
      const params = [...url.searchParams.keys()];
      return result(params.some((k) => /building|b$/.test(k)) && params.some((k) => /time|t$/.test(k)) && params.some((k) => /cam|pose/.test(k)) && m.copyLink,
        { urlParams: params, copyLinkControl: m.copyLink }, "URL carries building, time and camera params; 링크 복사 exists; reload restores");
    },
  }),
  defineCheck("GAP-19", {
    states: { D: ["S01", "S02"], P: ["S02"] },
    async run(ctx) {
      const list = await chips(ctx);
      const texts = list.map((chip) => chip.text);
      const duplicates = texts.filter((t, i) => texts.indexOf(t) !== i);
      const cap = ctx.viewport === "D" ? 14 : 7;
      return result(list.length <= cap && duplicates.length === 0, { visibleChips: list.length, duplicates: [...new Set(duplicates)] }, `<= ${cap} chips and 0 duplicate chip texts`);
    },
  }),
  defineCheck("GAP-20", {
    states: { D: ["S01", "S03", "S09"], P: ["S03"] },
    async run(ctx) {
      const list = await chips(ctx);
      if (!list.length) return result(false, { visibleChips: 0 }, "visible chips to measure");
      const min = Math.min(...list.map((c) => c.px));
      const max = Math.max(...list.map((c) => c.px));
      const weights = [...new Set(list.map((c) => c.weight))];
      const floor = ctx.viewport === "D" ? 12 : 13;
      const streetOk = ctx.state !== "S09" || max <= 14;
      return result(min >= floor && streetOk && weights.every((w) => w === 500 || w === 600), { minPx: min, maxPx: max, weights, chips: list.length }, `>= ${floor} px, <= 14 px in the street band, weight 500/600`);
    },
  }),
  defineCheck("GAP-21", {
    states: { D: ["S11"], P: ["S02", "S03"] },
    async run(ctx) {
      const list = await chips(ctx);
      const hud = await hudRects(ctx);
      const panel = await panelInfo(ctx);
      const blockers = [...hud.map((h) => h.rect), ...(panel && panel.visibleWidth > 0 ? [panel.rect] : [])];
      const outside = list.filter((c) => c.rect.x < 8 || c.rect.y < 8 || c.rect.x + c.rect.w > ctx.width - 8 || c.rect.y + c.rect.h > ctx.height - 8).map((c) => c.text);
      const near = list.filter((c) => blockers.some((b) => gapBetween(c.rect, b) < 12)).map((c) => c.text);
      return result(outside.length === 0 && near.length === 0, { chips: list.length, outsideMargin: outside.slice(0, 8), within12pxOfHudOrPanel: near.slice(0, 8) },
        "every chip >= 8 px inside the viewport and >= 12 px from HUD/panel; displaced chips draw a leader");
    },
  }),
  defineCheck("GAP-22", {
    states: ["S02", "S03"], viewports: D,
    async run(ctx) {
      const list = await chips(ctx);
      const long = list.filter((c) => c.text.split(/\s+/).length > 3).map((c) => c.text);
      const qualifier = list.filter((c) => c.text.includes("(추정)")).map((c) => c.text);
      const dorms = list.filter((c) => c.text.startsWith("학생생활관"));
      const codeInText = list.filter((c) => /^[A-Z]\d+\s/.test(c.text) && !(c.badge || c.children.some((child) => /badge/.test(child)))).map((c) => c.text);
      const clustered = dorms.length <= 1;
      return result(long.length === 0 && qualifier.length === 0 && clustered && codeInText.length === 0,
        { overThreeWords: long.slice(0, 5), withEstimateQualifier: qualifier.slice(0, 5), dormitoryChips: dorms.length, codeInText: codeInText.slice(0, 5) },
        "<= 3 words, no (추정), code as a badge child, dormitories as one cluster chip");
    },
  }),
  defineCheck("GAP-23", {
    states: ["S11"], viewports: DP,
    async run(ctx) {
      const frames = await sampleFrames(ctx, (qa) => {
        const layer = qa.one("[data-qa=campus-label-layer]");
        return { opacity: layer ? Number(getComputedStyle(layer).opacity) : null, visible: qa.chips().map((el) => qa.txt(el)).join("|") };
      }, 5);
      if (frames[0].opacity == null) return missingHook(HOOKS.labelLayer, "layer opacity <= 0.4 while dragging; 0 visibility toggles", { frames: frames.length });
      const toggles = frames.slice(1).filter((f, i) => f.visible !== frames[i].visible).length;
      return result(frames.every((f) => f.opacity <= 0.4) && toggles === 0, { opacities: frames.map((f) => f.opacity), visibilityToggles: toggles }, "opacity <= 0.4 and 0 toggles during the drag");
    },
  }),
  defineCheck("GAP-24", {
    states: ["S03"], viewports: D, mutates: true,
    async run(ctx) {
      const lib = await chipByText(ctx, "도서관");
      if (!lib) return result(false, { libraryChip: null }, "library chip visible to locate its mesh");
      const before = await ctx.screenshot();
      const tabs0 = await ctx.inPage((qa) => qa.all("[data-qa^=dashboard-tab-]").length + qa.all("[data-qa=selection-inspector]").length);
      // Row: the pointer goes onto the 도서관 mesh, not the chip. A displaced chip (pushed below the HUD) is not above its
      // building, so aim at the building anchor the layer projected (6 units above the roof) when the chip carries one.
      const x = lib.anchor ? lib.anchor.x : lib.rect.x + lib.rect.w / 2;
      // The mesh, not a chip: step down from the anchor to the first point where the canvas itself is under the pointer
      // (another chip's 40 px tap area may cover the roof right below the anchor).
      const y = lib.anchor
        ? await ctx.inPage((qa, a) => {
          for (let dy = 12; dy <= 60; dy += 4) if (document.elementFromPoint(a.x, a.y + dy)?.tagName === "CANVAS") return a.y + dy;
          return a.y + 24;
        }, { x: lib.anchor.x, y: lib.anchor.y })
        : lib.rect.y + lib.rect.h + 24;
      const roof = lib.anchor ? { x: lib.anchor.x - 20, y: lib.anchor.y + 6, w: 40, h: 30 } : roofBox(lib);
      await ctx.b.mouse("mouseMoved", x, y, 0);
      await ctx.sleep(300);
      const after = await ctx.screenshot();
      const lib2 = await chipByText(ctx, "도서관");
      const tabs1 = await ctx.inPage((qa) => qa.all("[data-qa^=dashboard-tab-]").length + qa.all("[data-qa=selection-inspector]").length);
      await ctx.b.mouse("mouseMoved", 5, 5, 0);
      const roofDelta = Math.round(pixelDiff(before, after, roof, ctx.scale) * 1000) / 1000;
      const lifted = Boolean(lib2 && (lib2.rect.y < lib.rect.y - 1 || lib2.text !== lib.text));
      return result(roofDelta > 0.02 && lifted && tabs0 === tabs1, { roofPixelDelta: roofDelta, aimedAtAnchor: Boolean(lib.anchor), chipLiftedOrValue: lifted, tabsAndInspectors: [tabs0, tabs1] }, "hover tints the roof, lifts the chip, opens nothing");
    },
  }),
  defineCheck("GAP-25", {
    states: ["S02"], viewports: D,
    async run(ctx) {
      // Row: sample ground luminance along the model's bounding rectangle and 20 px outward (data-model-edge).
      const m = await modelEdgeStep(ctx);
      const clear = await ctx.inPage(() => getComputedStyle(document.querySelector("canvas")?.parentElement ?? document.body).backgroundColor);
      if (!m.edge) return missingHook("[data-model-edge]", "no luminance step > 20% along the bounding edge");
      return result((m.edgeOffScreen || (m.samples > 0 && m.step <= 0.2)), { maxLuminanceStepAcrossEdge: m.step, edgeSamples: m.samples, edgeOffScreen: m.edgeOffScreen, canvasBackdrop: clear }, "no luminance step > 20% along the bounding edge (20 px inside vs 20 px outside); clear colour not darker than #0b0c0e");
    },
  }),
  defineCheck("GAP-26", {
    states: ["S05"], viewports: DP,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const dialog = qa.one("[role=dialog]");
        const text = dialog ? dialog.innerText : "";
        const roomIdx = text.indexOf("사용 중인 강의실");
        const planIdx = text.indexOf("태양광 설치");
        const disclosure = qa.all("details,[aria-expanded]", dialog ?? document).some((el) => /설치 계획/.test(qa.txt(el)));
        const room = qa.all("div", dialog ?? document).find((el) => el.children.length && qa.txt(el).startsWith("사용 중인 강의실"));
        return { roomListBeforePlanTools: roomIdx >= 0 && (planIdx < 0 || roomIdx < planIdx), planToolsInDisclosure: disclosure, roomCardTop: room ? Math.round(room.getBoundingClientRect().top) : null, mainCanvasVisible: qa.all("canvas").filter(qa.visible).length };
      });
      const phoneOk = ctx.viewport === "D" || (m.roomCardTop != null && m.roomCardTop <= 844);
      return result(m.roomListBeforePlanTools && m.planToolsInDisclosure && phoneOk, m, "room list precedes plan tools; plan tools in a collapsed disclosure; P room card top <= 844");
    },
  }),
  defineCheck("GAP-27", {
    states: ["S13"], viewports: D, mutates: true,
    async run(ctx) {
      return withPanelOpen(ctx, null, async () => {
      // The sample group sits below the live values in the panel's scroll body: scroll it into view, as a user would.
      await ctx.inPage((qa) => { qa.one("[data-qa=dashboard-panel] [data-qa=sample-group]")?.scrollIntoView({ block: "center" }); return true; });
      await ctx.sleep(300);
      const m = await ctx.inPage((qa) => ({
        badges: qa.all("[data-qa=sample-badge]").filter(qa.visible).length,
        sampleWords: qa.textNodesShown(qa.one("[data-qa=dashboard-panel]") ?? document.body).filter((item) => /샘플|예시|sample/i.test(item.value)).length,
      }));
      if (!m.badges) return missingHook(HOOKS.sample, "every sample-sourced element carries the same 샘플 데이터 badge component", m);
      return result(m.badges >= 1, m, "sample rows carry the shared badge");
      });
    },
  }),
  defineCheck("GAP-28", {
    states: ["S10"], viewports: D, mutates: true,
    async run(ctx) {
      const info = await ctx.inPage((qa) => {
        const group = qa.one("[data-qa=render-quality]");
        const copy = group?.querySelector("p");
        const dialog = group?.closest("[role=dialog]");
        return {
          initial: qa.all("[data-qa^=render-quality-]").find((el) => el.getAttribute("aria-pressed") === "true")?.getAttribute("data-qa") ?? null,
          fullStops: (copy?.textContent.match(/다\.|\./g) ?? []).length,
          modal: dialog?.getAttribute("aria-modal") ?? null,
        };
      });
      // A strip of scene left of the centred settings surface, below the HUD and above the time card.
      const region = { x: 0, y: 160, w: 160, h: 360 };
      const before = await ctx.screenshot();
      await ctx.b.tap("[data-qa=render-quality-medium]");
      await ctx.sleep(1000);
      const mid = await ctx.screenshot();
      await ctx.b.tap("[data-qa=render-quality-high]");
      await ctx.sleep(1000);
      const after = await ctx.screenshot();
      if (info.initial) await ctx.b.tap(`[data-qa=${info.initial}]`);
      const live = Math.max(pixelDiff(before, mid, region, ctx.scale), pixelDiff(mid, after, region, ctx.scale));
      return result(live > 0.002 && info.modal !== "true" && info.fullStops <= 1, { canvasChangeBehindSheet: Math.round(live * 10000) / 10000, ariaModal: info.modal, fullStopsInCopy: info.fullStops },
        "canvas re-renders within 1 s behind a non-blocking sheet; each option's copy <= 1 full stop");
    },
  }),
  defineCheck("GAP-29", {
    states: ["S01"], viewports: D, mutates: true,
    async run(ctx) {
      if (!(await exists(ctx, HOOKS.presentation))) return missingHook(HOOKS.presentation, "HUD and panel hidden, time visible, chips 1.5x, dot pager, Esc restores");
      // Row: activate 발표 모드, start 투어, press Esc. The tour is started first (its button lives in the toolbar that
      // presentation hides); P is the documented key.
      const layout = () => ctx.inPage((qa) => {
        const sizes = qa.all("button[data-qa=campus-label]").filter(qa.visible).map((el) => parseFloat(getComputedStyle(el.querySelector("[data-qa=label-chip]") ?? el).fontSize));
        const panel = qa.one("[data-qa=dashboard-panel]");
        const pager = qa.one("[data-qa=tour-pager]");
        return {
          presenting: qa.one("[data-qa=campus-hud]")?.getAttribute("data-presenting") === "true",
          toolbar: Boolean(qa.all("[data-qa=camera-view-menu]").find(qa.visible)),
          panelVisible: Boolean(panel && qa.visible(panel) && panel.getAttribute("aria-hidden") !== "true"),
          panelOpen: panel?.getAttribute("data-open") ?? null,
          time: Boolean(qa.all("[data-qa=hud-time-readout]").find(qa.visible)),
          chipPx: sizes.length ? Math.max(...sizes) : null,
          pager: pager && qa.visible(pager) ? pager.getAttribute("aria-label") : null,
        };
      });
      const before = await layout();
      const tour = (await ctx.b.tap("[data-qa=camera-tour-toggle]", null, { timeoutMs: 4000 })).ok;
      await ctx.sleep(600);
      await ctx.b.key("p");
      await ctx.sleep(1500);
      const on = await layout();
      await ctx.b.key("Escape");
      await ctx.sleep(1200);
      const after = await layout();
      // Stop the tour only if it still runs (Esc may already have ended it; a second tap would restart it and keep the
      // camera touring through the probe replay's later S01 checks), then return to the overview.
      if (await ctx.inPage((qa) => qa.one("[data-qa=camera-tour-toggle]")?.getAttribute("aria-pressed") === "true")) {
        await ctx.b.tap("[data-qa=camera-tour-toggle]", null, { timeoutMs: 4000 });
      }
      await ctx.b.tap("[data-qa=camera-preset-overview]", null, { timeoutMs: 3000 });
      await ctx.b.cameraSettle?.();
      const scale = before.chipPx && on.chipPx ? Math.round((on.chipPx / before.chipPx) * 100) / 100 : null;
      const pass = tour && on.presenting && !on.toolbar && !on.panelVisible && on.time && scale >= 1.5 && /^투어 \d+\/\d+$/.test(on.pager ?? "")
        && !after.presenting && after.toolbar === before.toolbar && after.panelVisible === before.panelVisible && after.panelOpen === before.panelOpen;
      return result(pass, { tourStarted: tour, before, presenting: on, afterEsc: after, chipScale: scale }, "HUD and panel hidden, time readout visible, chip text 1.5x, dot pager during the tour, Esc restores the previous layout");
    },
  }),
  defineCheck("GAP-30", {
    states: ["S01"], viewports: D, fixtures: "any",
    async run(ctx) {
      const m = await ctx.inPage((qa) => qa.all("[data-qa=freshness-stamp]").filter(qa.visible).map((el) => ({ text: qa.txt(el), refresh: Boolean(el.parentElement?.querySelector("button")) })));
      if (!m.length) return missingHook(HOOKS.freshness, "a 갱신 HH:mm (or 갱신 없음) stamp per feed beside the time readout, refresh control next to it");
      return result(m.length >= 3 && m.every((s) => /갱신 (\d{1,2}:\d{2}|없음)/.test(s.text) && s.refresh), { stamps: m }, "stamps for weather, traffic and energy with refresh");
    },
  }),
  defineCheck("GAP-31", {
    states: ["S12"], viewports: D, fixtures: "delay",
    async run(ctx) {
      const samples = ctx.memo.get(`${ctx.stateLabel}:samples`) ?? [];
      const s05 = samples.find((s) => s.offsetMs === 500);
      const s25 = samples.find((s) => s.offsetMs === 2500);
      if (!s05 || !s25) return result(false, { samples: samples.length }, "DOM samples at 0.5 s and 2.5 s");
      const named = s25.spinnerTexts.every((t) => /(가져오는|불러오는) 중/.test(t) && !/^불러오는 중/.test(t));
      return result(s05.skeletons > 0 && s05.spinners === 0 && s25.spinners >= 1 && named, { at500: s05, at2500: s25 },
        "0.5 s: skeletons, no spinner; 2.5 s: one spinner per operation naming the feed");
    },
  }),
  defineCheck("GAP-32", {
    states: ["S03"], viewports: D, mutates: true,
    async run(ctx) {
      await ctx.inPage(() => { document.activeElement?.blur(); document.querySelector("[data-qa=campus-hud]")?.setAttribute("tabindex", "-1"); document.querySelector("[data-qa=campus-hud]")?.focus(); return true; });
      const order = [];
      // Row: Tab "until focus returns" (the loop breaks when focus comes back to the HUD); 200 is only a runaway bound. A
      // zoomed-in view can show more than 60 chips and dots, which a 60-press cap mistook for an order without the panel.
      for (let i = 0; i < 200; i += 1) {
        await ctx.b.key("Tab");
        const f = await ctx.inPage((qa) => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          // Chips and their collapsed dot form are the label layer's stops, in priority order.
          const zone = el.closest("[data-qa=campus-label],[data-qa=campus-label-layer]") ? "chip" : el.closest("[data-qa=dashboard-panel]") ? "panel" : el.closest("[data-qa=campus-hud]") ? "hud" : "other";
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          const ring = parseFloat(s.outlineWidth) || 0;
          return { zone, inside: r.left - ring >= 0 && r.top - ring >= 0 && r.right + ring <= innerWidth && r.bottom + ring <= innerHeight };
        });
        if (f) order.push(f);
        if (order.length > 3 && f?.zone === "hud" && order[order.length - 2]?.zone !== "hud") break;
      }
      const zones = order.map((o) => o.zone).filter((z, i, a) => z !== a[i - 1]);
      const expected = ["hud", "chip", "panel"];
      const orderOk = expected.every((z, i) => zones[i] === z);
      const clipped = order.filter((o) => !o.inside).length;
      const before = await ctx.screenshot();
      await ctx.inPage(() => { const c = document.querySelector("canvas"); c?.setAttribute("tabindex", "0"); c?.focus(); return true; });
      await ctx.b.key("ArrowLeft");
      await ctx.b.key("ArrowLeft");
      await ctx.sleep(600);
      const moved = pixelDiff(before, await ctx.screenshot(), await sceneRegion(ctx), ctx.scale);
      return result(orderOk && clipped === 0 && moved > 0.01, { zoneOrder: zones.slice(0, 6), clippedFocusRings: clipped, arrowKeyPixelChange: Math.round(moved * 1000) / 1000 },
        "Tab order HUD -> chips -> panel, focus rings inside the viewport, arrow keys change the pose");
    },
  }),
  defineCheck("GAP-33", {
    states: ["S01", "S03"], viewports: P,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const sels = ['[aria-label="패널 닫기"]', '[aria-label="패널 열기"]', "[data-qa=sheet-handle]", "button[data-qa=campus-label]", "[data-qa^=camera-preset-]", "[data-qa=time-slider] input[type=range]"];
        const small = [];
        let measured = 0;
        for (const sel of sels) {
          for (const el of qa.all(sel).filter(qa.visible)) {
            if (el.tagName !== "BUTTON" && el.tagName !== "INPUT" && !el.matches("[data-qa=sheet-handle]")) continue;
            measured += 1;
            const r = el.getBoundingClientRect();
            if (r.width < 44 || r.height < 44) small.push(`${sel} ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        return { measured, under44: small.slice(0, 10), under44Count: small.length };
      });
      return result(m.measured > 0 && m.under44Count === 0, m, "every target >= 44x44 CSS px");
    },
  }),
  defineCheck("GAP-34", {
    states: ["S01"], viewports: DP, entries: ["vworld"],
    async run(ctx) {
      const { existsSync, readFileSync } = await import("node:fs");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const srcRoot = fileURLToPath(new URL("../../../src/", import.meta.url));
      // Both entries reach the shared primitives through shared panel modules (DashboardShell, SelectionInspector, ...),
      // not always by a direct import: follow local imports transitively and collect every src/ui module reached.
      const resolve = (from, spec) => {
        const base = path.resolve(path.dirname(from), spec);
        for (const candidate of [base, `${base}.jsx`, `${base}.mjs`, `${base}.js`, `${base}.css`, path.join(base, "index.jsx")]) {
          if (existsSync(candidate) && !candidate.endsWith(path.sep)) try { readFileSync(candidate); return candidate; } catch { /* a directory */ }
        }
        return null;
      };
      const reached = (entry) => {
        const seen = new Set();
        const stack = [path.join(srcRoot, entry)];
        while (stack.length) {
          const file = stack.pop();
          if (seen.has(file)) continue;
          seen.add(file);
          const text = readFileSync(file, "utf8");
          // JS imports (static, side-effect, dynamic) and CSS @import (index.css -> ui/tokens.css).
          for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|@import\s+)["'](\.{1,2}\/[^"']+)["']/g)) {
            const next = resolve(file, m[1]);
            if (next) stack.push(next);
          }
        }
        return new Set([...seen].map((file) => path.relative(srcRoot, file)).filter((rel) => rel.startsWith(`ui${path.sep}`)));
      };
      // The real entry points (index.html -> index.jsx -> App -> AppLegacy; index-vworld.html -> index-vworld.jsx).
      const legacy = reached("index.jsx");
      const vworld = reached("index-vworld.jsx");
      const has = (set, name) => [...set].some((rel) => path.basename(rel).startsWith(name));
      const shared = ["SceneLabel", "Segmented", "Alert", "tokens"].map((name) => ({ name, legacy: has(legacy, name), vworld: has(vworld, name) }));
      const uiShared = [...legacy].filter((rel) => vworld.has(rel));
      return result(uiShared.length > 0 && shared.every((s) => s.legacy && s.vworld), { sharedUiImports: uiShared.slice(0, 12), sharedCount: uiShared.length, primitives: shared, note: "the GAP-01..33 PASS-set comparison needs a --entry both run" },
        "same PASS set as Legacy; both entries import the same SceneLabel, Segmented, Alert and token modules");
    },
  }),
  defineCheck("GAP-35", {
    states: ["S03"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => ({ compare: qa.all("button,[role=menuitem]").filter((el) => /^비교/.test(qa.txt(el))).map((el) => ({ text: qa.txt(el), disabled: el.disabled || el.getAttribute("aria-disabled") === "true", reason: el.title || el.getAttribute("aria-description") || "" })) }));
      return result(m.compare.length > 0 && m.compare.every((c) => c.disabled && c.reason), m, "비교 control dimmed with a reason until two buildings are picked; comparison pane after two");
    },
  }),
  defineCheck("GAP-36", {
    states: ["S04"], viewports: D, fixtures: "up",
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const panel = qa.one("[data-qa=dashboard-panel]");
        const value = panel ? qa.textNodesShown(panel).find((item) => /\d/.test(item.value)) : null;
        return {
          userSelect: value ? getComputedStyle(value.el).userSelect : null,
          exportAction: qa.all("button,[role=menuitem]").some((el) => /내보내기|CSV|표 복사|표로/.test(qa.txt(el) + (el.getAttribute("aria-label") ?? ""))),
        };
      });
      return result(m.userSelect && m.userSelect !== "none" && m.exportAction, m, "panel text selectable and a table/export action exists");
    },
  }),
  defineCheck("GAP-37", {
    states: ["S09"], viewports: P, mutates: true,
    async run(ctx) {
      // Row: "tap the 도서관 chip from the gate view" - S09 is the gate view, so the check makes that tap itself.
      const tapped = (await ctx.b.tap("button[data-qa=campus-label]", "도서관", { timeoutMs: 6000 })).ok;
      if (!tapped) return result(false, { tapped, note: "도서관 chip not reachable from the gate view" }, "inspector at the half detent shows the distance from 정문 and a direction cue while the building stays visible");
      await ctx.sleep(2500);
      if (!(await exists(ctx, HOOKS.inspector))) return missingHook(HOOKS.inspector, "inspector at the half detent shows the distance from 정문 and a direction cue while the building stays visible");
      const text = await ctx.inPage((qa) => qa.txt(qa.one("[data-qa=selection-inspector]")));
      return result(/정문[^\n]*\d+\s*m/.test(text) && /(북|남|동|서)/.test(text), { inspectorText: text.slice(0, 120) }, "distance from 정문 and direction");
    },
  }),
];
