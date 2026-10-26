// V-S-82..V-S-107: browser half of the remove-ai-slops findings. Each `doc` holds the literal row.
import {
  chipByText, chips, contrasts, defineCheck, gapBetween, hudRects, intersection, luminanceStep, missingHook, HOOKS,
  panelInfo, pixelDiff, result, roofBox, sampleFrames, sceneRegion, textItems, worstContrast,
} from "./common.mjs";

const D = ["D"];
const P = ["P"];

function tabAcrossD4(ctx) {
  const before = ctx.memo.get("S05:before");
  const after = ctx.memo.get("S06:after-return");
  if (!before || !after) return result(false, { before: before ?? null, after: after ?? null }, "tab read before the D4 tap and after 캠퍼스 지도로 돌아가기");
  return result(before.tab != null && before.tab === after.tab, { before: before.tab, after: after.tab }, "same tab (기본 현황)");
}

async function inspectorTitleVsChip(ctx) {
  const m = await ctx.inPage((qa) => {
    const pressed = qa.all("[data-qa=campus-label] button").find((el) => el.getAttribute("aria-pressed") === "true");
    const inspector = qa.one("[data-qa=selection-inspector]");
    const titleEl = inspector?.querySelector("h1,h2,h3") ?? [...document.querySelectorAll("[data-qa=dashboard-panel] h2,[data-qa=dashboard-panel] h3")].find((el) => qa.visible(el));
    return { chip: pressed ? qa.txt(pressed) : null, title: titleEl ? qa.txt(titleEl) : null, inspectorHook: Boolean(inspector) };
  });
  return result(m.chip === "도서관" && m.title === m.chip, m, "identical string (도서관)");
}

async function bannerVsLastCard(ctx, cardMatcher) {
  return ctx.inPage((qa, a) => {
    const banner = qa.one("[data-qa=weather-error-banner]");
    const panel = qa.one("[data-qa=dashboard-panel]");
    const cards = panel ? [...panel.querySelectorAll("[data-qa],section,article,div.rounded-xl,div.rounded-lg")].filter((el) => qa.visible(el) && el !== banner && !el.contains(banner) && !(banner && banner.contains(el))) : [];
    const target = a.text ? cards.find((el) => qa.txt(el).toUpperCase().includes(a.text)) : cards.filter((el) => el.querySelector("[role=alert]") || el.getAttribute("role") === "alert").sort((x, y) => y.getBoundingClientRect().bottom - x.getBoundingClientRect().bottom)[0];
    return { banner: banner ? qa.r(banner) : null, card: target ? qa.r(target) : null, overlap: banner && target ? qa.inter(qa.r(banner), qa.r(target)) : 0 };
  }, { text: cardMatcher });
}

async function labelLayerOpacity(ctx) {
  const frames = await sampleFrames(ctx, (qa) => {
    const layer = qa.one("[data-qa=campus-label-layer]");
    return layer ? Number(getComputedStyle(layer).opacity) : null;
  }, 5);
  if (frames[0] == null) return missingHook(HOOKS.labelLayer, "label layer opacity <= 0.4 while dragging", { frames: frames.length });
  return result(frames.every((o) => o <= 0.4), { opacities: frames }, "<= 0.4 while dragging");
}

export const SLOP_UX_CHECKS = [
  defineCheck("V-S-82", { states: ["S06"], viewports: D, run: async (ctx) => tabAcrossD4(ctx) }),
  defineCheck("V-S-83", { states: ["S06"], viewports: P, run: async (ctx) => tabAcrossD4(ctx) }),
  defineCheck("V-S-84", { states: ["S12"], viewports: D, run: inspectorTitleVsChip }),
  defineCheck("V-S-85", { states: ["S12"], viewports: P, run: inspectorTitleVsChip }),
  defineCheck("V-S-86", {
    states: ["S07"], viewports: D,
    async run(ctx) {
      const m = await bannerVsLastCard(ctx, "CAMPUS COMPARISON");
      return result(!m.banner || m.overlap === 0, m, "0 px overlap between the banner and the CAMPUS COMPARISON card");
    },
  }),
  defineCheck("V-S-87", {
    states: ["S07"], viewports: P,
    async run(ctx) {
      const m = await bannerVsLastCard(ctx, null);
      return result(!m.banner || m.overlap === 0, m, "0 px overlap between the banner and the last error card");
    },
  }),
  defineCheck("V-S-88", {
    states: ["S06"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const blocks = qa.all("[role=alert],[data-qa=weather-error-banner],[data-qa$=-error]").filter(qa.visible);
        const unique = blocks.filter((el) => !blocks.some((other) => other !== el && other.contains(el)));
        const texts = unique.map((el) => qa.txt(el).slice(0, 60));
        return { energy: texts.filter((t) => /에너지|설치 계획|분석|에너지 API/.test(t)).length, weather: texts.filter((t) => /기상/.test(t)).length, texts };
      });
      return result(m.energy <= 1 && m.weather <= 1, m, "<= 1 element per failed feed (energy 1, weather 1)");
    },
  }),
  defineCheck("V-S-89", {
    states: ["S04"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const panel = qa.one("[data-qa=selection-inspector]") ?? qa.one("[data-qa=dashboard-panel]");
        const alert = panel?.querySelector("[role=alert]") ?? [...(panel?.querySelectorAll("p,div") ?? [])].find((el) => /불러오지 못했습니다/.test(qa.txt(el)) && el.children.length === 0);
        let next = alert?.nextElementSibling ?? alert?.parentElement?.nextElementSibling ?? null;
        const nextText = next ? qa.txt(next) : "";
        const action = next ? Boolean(next.querySelector("button,a")) : false;
        return { error: alert ? qa.txt(alert).slice(0, 60) : null, belowText: nextText.slice(0, 60), belowHasAction: action };
      });
      const lib = await chipByText(ctx, "도서관");
      const before = ctx.memo.get("S04:before-click");
      const roof = before && lib ? Math.round(pixelDiff(ctx.decode(before.png), ctx.image(), roofBox(lib), ctx.scale) * 1000) / 1000 : null;
      return result(Boolean(m.belowText) && m.belowHasAction && roof > 0.02, { ...m, libraryRoofDelta: roof }, "empty-state block with a next action below the error; library roof differs from idle");
    },
  }),
  defineCheck("V-S-90", {
    states: ["S01"], viewports: P,
    async run(ctx) {
      const panel = await panelInfo(ctx);
      const share = panel && panel.visibleWidth > 0 ? panel.visibleHeight / 844 : 0;
      return result(share <= 0.25, { panelHeightShare: Math.round(share * 100) / 100 }, "<= 0.25 on load (collapsed sheet)");
    },
  }),
  defineCheck("V-S-91", {
    states: ["S04"], viewports: P,
    async run(ctx) {
      const panel = await panelInfo(ctx);
      const selected = (await chips(ctx)).find((chip) => chip.pressed === "true") ?? null;
      const top = panel && panel.visibleWidth > 0 ? panel.rect.y : ctx.height;
      return result(Boolean(selected) && selected.rect.y >= 0 && selected.rect.y + selected.rect.h <= top, { selectedChip: selected?.rect ?? null, panelTop: top, panelVisibleWidth: panel?.visibleWidth ?? null }, "chip fully visible above the sheet");
    },
  }),
  defineCheck("V-S-92", {
    states: ["S08"], viewports: P,
    async run(ctx) {
      const panel = await panelInfo(ctx);
      const share = panel && panel.visibleWidth > 0 ? panel.visibleHeight / 844 : 0;
      return result(share <= 0.5, { panelHeightShare: Math.round(share * 100) / 100 }, "<= 0.5 unless dragged to full");
    },
  }),
  defineCheck("V-S-93", {
    states: ["S02"], viewports: D,
    async run(ctx) {
      const list = await chips(ctx);
      const texts = list.map((c) => c.text);
      const dupes = [...new Set(texts.filter((t, i) => texts.indexOf(t) !== i))];
      return result(list.length <= 20 && dupes.length === 0, { visibleChips: list.length, duplicateTexts: dupes }, "<= 20 chips and 0 duplicate texts");
    },
  }),
  defineCheck("V-S-94", {
    states: ["S03"], viewports: D,
    async run(ctx) {
      const list = await chips(ctx);
      const hud = await hudRects(ctx);
      const min = list.length ? Math.min(...list.map((c) => c.px)) : null;
      const near = list.filter((c) => hud.some((h) => gapBetween(c.rect, h.rect) < 12)).map((c) => c.text);
      return result(min != null && min >= 12 && near.length === 0, { minEffectivePx: min, chipsWithin12pxOfHud: near.slice(0, 8) }, ">= 12 px and 0 chips within 12 px of the HUD");
    },
  }),
  defineCheck("V-S-95", {
    states: ["S09"], viewports: D,
    async run(ctx) {
      const list = await chips(ctx);
      let pairs = 0;
      for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) if (intersection(list[i].rect, list[j].rect) > 0) pairs += 1;
      const max = list.length ? Math.max(...list.map((c) => c.px)) : null;
      return result(max != null && max <= 14 && pairs === 0, { maxEffectivePx: max, intersectingPairs: pairs }, "<= 14 px and 0 intersecting chip rects");
    },
  }),
  defineCheck("V-S-96", {
    states: ["S02"], viewports: P,
    async run(ctx) {
      const list = await chips(ctx);
      const clipped = list.filter((c) => c.rect.x < 0 || c.rect.x + c.rect.w > 390).map((c) => c.text);
      const cue = await ctx.inPage((qa) => qa.all("[data-qa=camera-preset-fade-start],[data-qa=camera-preset-fade-end]").filter((el) => qa.visible(el) && Number(getComputedStyle(el).opacity) > 0).length
        + qa.all("button").filter((el) => qa.visible(el) && el.hasAttribute("aria-haspopup") && /시점/.test(qa.txt(el) + (el.getAttribute("aria-label") ?? ""))).length);
      return result(clipped.length === 0 && cue > 0, { clippedChips: clipped, overflowCues: cue }, "0 clipped chips and a visible fade/menu cue");
    },
  }),
  defineCheck("V-S-97", {
    states: ["S03"], viewports: P,
    async run(ctx) {
      const lib = await chipByText(ctx, "도서관");
      return result(!lib || lib.rect.x >= 8, { libraryChip: lib?.rect ?? "hidden" }, "left >= 8 px or hidden");
    },
  }),
  defineCheck("V-S-98", {
    states: ["S09"], viewports: P,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const presets = qa.all("[data-qa^=camera-preset-]").filter((el) => el.tagName === "BUTTON");
        const visible = presets.filter((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width > 0; }).length;
        const fade = qa.all("[data-qa=camera-preset-fade-end],[data-qa=camera-preset-fade-start]").filter((el) => qa.visible(el) && Number(getComputedStyle(el).opacity) > 0).length;
        const menu = qa.all("button").some((el) => qa.visible(el) && el.hasAttribute("aria-haspopup") && /시점/.test(qa.txt(el) + (el.getAttribute("aria-label") ?? "")));
        return { presets: presets.length, fullyVisible: visible, fadeCue: fade, viewMenu: menu };
      });
      return result(m.viewMenu || m.fadeCue > 0 || m.fullyVisible === m.presets, m, "every preset reachable through a visible menu or fade cue");
    },
  }),
  defineCheck("V-S-99", {
    states: ["S08"], viewports: D,
    async run(ctx) {
      const labels = await textItems(ctx, "[data-qa=dashboard-panel] *", { match: "^(온도|월|일|시|분)" });
      const worst = worstContrast(contrasts(ctx, labels));
      const hm = await ctx.inPage((qa) => qa.all("[data-qa=dashboard-panel] input[type=range]").filter((el) => /(^|\s)(시|분)(\s|$)/.test(qa.txt(el.parentElement?.parentElement))).length);
      return result(hm === 0 && worst && worst.ratio >= 4.5, { hourMinuteSliders: hm, worstLabel: worst, labelsMeasured: labels.length }, "0 duplicate hour/minute sliders and every label >= 4.5:1");
    },
  }),
  defineCheck("V-S-100", {
    states: ["S05"], viewports: D,
    async run(ctx) {
      const backs = await ctx.inPage((qa) => qa.all("button,a").filter((el) => qa.visible(el) && (/지도|캠퍼스 전체 보기/.test(qa.txt(el) + (el.getAttribute("aria-label") ?? "")) || /^[←<]/.test(qa.txt(el)))).map((el) => qa.txt(el) || el.getAttribute("aria-label")));
      return result(backs.length === 1, { backAffordances: backs }, "exactly 1");
    },
  }),
  defineCheck("V-S-101", {
    states: ["S05"], viewports: P,
    async run(ctx) {
      const backs = await ctx.inPage((qa) => qa.all("button,a").filter((el) => qa.visible(el) && (/지도|캠퍼스 전체 보기/.test(qa.txt(el) + (el.getAttribute("aria-label") ?? "")) || /^[←<]/.test(qa.txt(el)))).map((el) => qa.txt(el) || el.getAttribute("aria-label")));
      return result(backs.length === 1, { backAffordances: backs }, "exactly 1");
    },
  }),
  defineCheck("V-S-102", {
    states: ["S01"], viewports: D,
    async run(ctx) {
      const region = await sceneRegion(ctx);
      const img = ctx.image();
      const cy = Math.round(region.y + region.h * 0.6);
      const points = [];
      for (let x = region.x + 20; x < region.x + region.w - 20; x += 40) points.push([x, cy]);
      const step = luminanceStep(img, points, ctx.scale, 4);
      return result(step <= 0.2, { maxLuminanceStep: step }, "<= 20% step along the model's bounding edge");
    },
  }),
  defineCheck("V-S-103", {
    states: ["S07"], viewports: D, mutates: true,
    async run(ctx) {
      const region = await sceneRegion(ctx);
      await ctx.b.setTimeMinutes(1140);
      await ctx.sleep(3500);
      const a = await ctx.screenshot();
      await ctx.b.setTimeMinutes(1260);
      await ctx.sleep(3500);
      const b = await ctx.screenshot();
      await ctx.b.setTimeMinutes(720);
      await ctx.sleep(1500);
      const diff = Math.round(pixelDiff(a, b, region, ctx.scale) * 10000) / 100;
      return result(diff >= 2, { meanAbsDiffPercent: diff }, ">= 2% mean absolute difference");
    },
  }),
  defineCheck("V-S-104", {
    states: ["S01"], viewports: D,
    async run(ctx) {
      const navigatedAt = ctx.memo.get(`${ctx.stateLabel}:navigatedAt`);
      if (!navigatedAt) return result(false, { navigatedAt: null }, "navigation time recorded");
      const remaining = navigatedAt + 60000 - Date.now();
      if (remaining > 0) await ctx.sleep(remaining);
      const requests = (await ctx.readRequests()).filter((r) => r.path.startsWith("/api/traffic") && r.at >= navigatedAt && r.at <= navigatedAt + 60000);
      const gaps = requests.slice(1).map((r, i) => r.at - requests[i].at);
      const increasing = gaps.every((g, i) => i === 0 || g >= gaps[i - 1]);
      return result(requests.length <= 4 && increasing, { trafficRequestsIn60s: requests.length, intervalsMs: gaps.slice(0, 10) }, "<= 4 requests with increasing intervals");
    },
  }),
  defineCheck("V-S-105", {
    states: ["S10"], viewports: P,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const group = qa.one("[data-qa=render-quality]");
        const copy = group?.querySelector("p");
        let lines = null;
        if (copy) {
          const range = document.createRange();
          range.selectNodeContents(copy);
          const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
          lines = tops.size;
        }
        const sheets = qa.all("[role=dialog]").filter(qa.visible).length;
        const panel = qa.one("[data-qa=dashboard-panel]");
        const pr = panel?.getBoundingClientRect();
        return { copyLines: lines, openSheets: sheets, panelHeightShare: pr ? Math.round((Math.max(0, Math.min(pr.bottom, innerHeight) - Math.max(pr.top, 0)) * (pr.right > 0 && pr.left < innerWidth ? 1 : 0) / innerHeight) * 100) / 100 : null };
      });
      return result(m.copyLines != null && m.copyLines <= 2 && m.openSheets === 1 && m.panelHeightShare <= 0.25, m, "<= 2 lines per option and only the settings sheet open (panel collapsed)");
    },
  }),
  defineCheck("V-S-106", { states: ["S11"], viewports: D, run: labelLayerOpacity }),
  defineCheck("V-S-107", { states: ["S11"], viewports: P, run: labelLayerOpacity }),
];
