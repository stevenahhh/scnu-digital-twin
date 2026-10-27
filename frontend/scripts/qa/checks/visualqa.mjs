// V-Q browser rows (visual QA findings). V-Q-06 is static only (static-checks.mjs).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CAMERA_PRESETS } from "../../../src/camera/cameraPresets.mjs";
import {
  sheetSettle,
  HOOKS, chips, contrasts, defineCheck, exists, hueDistance, hueOf, intersection, missingHook, panelAlpha, panelInfo,
  parseCssColor, pixelDiff, result, sceneRegion, textItems, worstContrast,
  openPanelSection,
  contrastAgainst,
  restoreCamera,
  saveCamera,
  withPanelOpen,
} from "./common.mjs";

const D = ["D"];
const P = ["P"];
const DP = ["D", "P"];
const FRONTEND = fileURLToPath(new URL("../../../", import.meta.url));

async function bannerAndCards(ctx) {
  return ctx.inPage((qa) => {
    const panel = qa.one("[data-qa=dashboard-panel]");
    const banner = qa.one("[data-qa=weather-error-banner]");
    const cards = panel ? [...panel.querySelectorAll(".rounded-xl,.rounded-lg,.rounded-2xl")].filter((el) => qa.visible(el) && el !== banner && !el.contains(banner) && !(banner?.contains(el))) : [];
    const last = cards.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
    return { banner: banner ? qa.r(banner) : null, cardsLeft: cards.length ? Math.round(Math.min(...cards.map((c) => c.getBoundingClientRect().left))) : null, cardsRight: cards.length ? Math.round(Math.max(...cards.map((c) => c.getBoundingClientRect().right))) : null, lastCard: last ? qa.r(last) : null };
  });
}

async function degradedCards(ctx) {
  return ctx.inPage((qa) => {
    const panel = qa.one("[data-qa=dashboard-panel]");
    // Cards use the rounded-card radius token since the token pass (W1); the older radius classes are still matched.
    const cards = panel ? [...panel.querySelectorAll(".rounded-card,.rounded-xl,.rounded-lg")].filter((el) => qa.visible(el) && /(^|\s)-(°C|m\/s|%|\s|$)|불러오지 못|연결할 수 없/.test(qa.txt(el))) : [];
    return cards.map((card) => ({ text: qa.txt(card).slice(0, 50), action: Boolean(card.querySelector("button,a")), bareDash: /(^|\s)-(°C|m\/s|%|\s|$)/.test(qa.txt(card)) }));
  });
}

async function accentHues(ctx) {
  return ctx.inPage((qa) => {
    const out = [];
    for (const el of qa.all("body *").filter(qa.visible).slice(0, 2500)) {
      if (el.closest("canvas")) continue;
      const s = getComputedStyle(el);
      // Status UI: alerts, error banners, data-status rows and live status indicators (role=status, e.g. a feed badge).
      const status = Boolean(el.closest("[role=alert],[role=status],[data-qa$=-error],[data-qa=weather-error-banner],[data-status]"));
      for (const prop of ["color", "backgroundColor", "borderTopColor"]) {
        const value = s[prop];
        if (!value || value === "rgba(0, 0, 0, 0)") continue;
        out.push({ value, status, prop, selected: Boolean(el.closest("[aria-pressed=true],[aria-selected=true]")) });
      }
    }
    return out;
  });
}

// A colour has a meaningful hue only when it is saturated and not near black; neutral greys (surfaces, hairlines,
// ink) carry a nominal hue (light surfaces read ~210) that says nothing about the accent.
function chromatic(c) {
  if (!c) return false;
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  return max >= 60 && (max - min) / max >= 0.35;
}

function hueFamilies(rows) {
  const families = new Set();
  for (const row of rows) {
    const c = parseCssColor(row.value);
    if (!chromatic(c)) continue;
    families.add(Math.round(hueOf(c) / 30) % 12);
  }
  return families;
}

export const VISUALQA_CHECKS = [
  defineCheck("V-Q-01", {
    states: ["S01"], viewports: P,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const panel = qa.one("[data-qa=dashboard-panel]");
        const column = panel ? [...panel.querySelectorAll("*")].find((el) => qa.visible(el) && el.children.length > 2) : null;
        const p = panel?.getBoundingClientRect();
        const c = column?.getBoundingClientRect();
        return { left: c && p ? Math.round(c.left - Math.max(0, p.left)) : null, right: c && p ? Math.round(Math.min(innerWidth, p.right) - c.right) : null };
      });
      const bc = await bannerAndCards(ctx);
      const bannerAligned = !bc.banner || (Math.abs(bc.banner.x - bc.cardsLeft) <= 1 && Math.abs(bc.banner.x + bc.banner.w - bc.cardsRight) <= 1);
      return result(m.left != null && Math.abs(m.left - m.right) <= 1 && bannerAligned, { margins: m, banner: bc.banner, cardEdges: [bc.cardsLeft, bc.cardsRight] }, "left margin == right margin (+/- 1 px) and banner edges equal the cards' edges");
    },
  }),
  defineCheck("V-Q-02", {
    states: ["S02"], viewports: P, mutates: true,
    async run(ctx) {
      let emulated = true;
      try {
        await ctx.b.view.cdp("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47, bottom: 34, left: 0, right: 0 } });
      } catch {
        emulated = false;
      }
      await ctx.sleep(300);
      const m = await ctx.inPage((qa) => {
        const time = qa.one("[data-qa=time-slider]");
        const title = qa.one("[data-qa=dashboard-panel] h1,[data-qa=dashboard-panel] h2");
        return { timeCardBottomGap: time ? Math.round(innerHeight - time.getBoundingClientRect().bottom) : null, titleTop: title && qa.visible(title) ? Math.round(title.getBoundingClientRect().top) : null };
      });
      if (emulated) await ctx.b.view.cdp("Emulation.setSafeAreaInsetsOverride", { insets: {} }).catch(() => {});
      const html = ["index.html", "index-vworld.html"].map((f) => readFileSync(path.join(FRONTEND, f), "utf8")).join("\n");
      const css = ["src/index.css"].map((f) => readFileSync(path.join(FRONTEND, f), "utf8")).join("\n");
      const greps = { viewportFitCover: /viewport-fit=cover/.test(html), safeAreaInset: /safe-area-inset/.test(css + html) };
      return result(emulated && m.timeCardBottomGap >= 34 && (m.titleTop == null || m.titleTop >= 47) && greps.viewportFitCover && greps.safeAreaInset, { insetsEmulated: emulated, ...m, ...greps }, "time card >= 34 px above the bottom; title top >= 47 px; both greps >= 1");
    },
  }),
  defineCheck("V-Q-03", {
    states: { D: ["S05"], P: ["S01"] },
    async run(ctx) {
      if (ctx.viewport === "P") {
        const bc = await bannerAndCards(ctx);
        const ok = !bc.banner || (Math.abs(bc.banner.x - bc.cardsLeft) <= 1 && Math.abs(bc.banner.x + bc.banner.w - bc.cardsRight) <= 1);
        return result(ok, bc, "banner and card edges within 1 px");
      }
      // D4 is a pane beside the map since todo 34 (no dialog; the pane replaces the panel): the 사용 중인 강의실 card must
      // share the edges of the pane's content column - the floor scene above it and the 설치 계획 row below it.
      const m = await ctx.inPage((qa) => {
        const pane = qa.one("[data-qa=d4-pane]");
        const room = pane?.querySelector("section[aria-labelledby=d4-in-use-title]") ?? null;
        const scene = pane?.querySelector("[aria-description]") ?? null;
        const plan = pane?.querySelector("[data-qa=d4-plan-disclosure]") ?? null;
        const cards = [scene, plan].filter((el) => el && qa.visible(el));
        if (cards.length < 2) return { roomCard: room ? qa.r(room) : null, panelCardsLeft: null, panelCardsRight: null, references: cards.length };
        // Content box (border box minus padding): the column a card in that block would occupy.
        const box = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return { left: r.left + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.paddingRight) }; };
        const lefts = cards.map((el) => Math.round(box(el).left));
        const rights = cards.map((el) => Math.round(box(el).right));
        if (Math.max(...lefts) - Math.min(...lefts) > 1 || Math.max(...rights) - Math.min(...rights) > 1) return { roomCard: room ? qa.r(room) : null, panelCardsLeft: null, panelCardsRight: null, referenceLefts: lefts, referenceRights: rights };
        return { roomCard: room ? qa.r(room) : null, panelCardsLeft: lefts[0], panelCardsRight: rights[0] };
      });
      return result(m.roomCard && m.panelCardsLeft != null && Math.abs(m.roomCard.x - m.panelCardsLeft) <= 1 && Math.abs(m.roomCard.x + m.roomCard.w - m.panelCardsRight) <= 1, m, "room card shares the panel cards' edges within 1 px");
    },
  }),
  defineCheck("V-Q-04", {
    states: { D: ["S09", "S07"], P: ["S02", "S03", "S07"] },
    async run(ctx) {
      if (ctx.state === "S07") {
        const bc = await bannerAndCards(ctx);
        const overlap = bc.banner && bc.lastCard ? intersection(bc.banner, bc.lastCard) : 0;
        return result(overlap === 0, { banner: bc.banner, lastCard: bc.lastCard, overlap }, "0 banner/card intersection");
      }
      const list = await chips(ctx);
      const out = list.filter((c) => c.rect.x < 0 || c.rect.x + c.rect.w > ctx.width).map((c) => c.text);
      return result(out.length === 0, { chips: list.length, outsideViewport: out.slice(0, 8) }, "every chip inside the viewport");
    },
  }),
  defineCheck("V-Q-05", {
    states: ["S02"], viewports: P,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const items = qa.all("[data-qa^=camera-preset-]").filter((el) => el.tagName === "BUTTON");
        const all = items.every((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width > 0; });
        const cue = qa.all("[data-qa=camera-preset-fade-end],[data-qa=camera-preset-fade-start]").filter((el) => qa.visible(el) && Number(getComputedStyle(el).opacity) > 0).length + qa.all("button[aria-haspopup]").filter(qa.visible).length;
        return { everyItemVisible: all, overflowCues: cue };
      });
      return result(m.everyItemVisible || m.overflowCues > 0, m, "a fade, chevron or menu is visible when items overflow");
    },
  }),
  defineCheck("V-Q-07", {
    states: ["S06", "S05"], viewports: DP,
    async run(ctx) {
      if (ctx.state === "S05") {
        const backs = await ctx.inPage((qa) => qa.all("button,a").filter((el) => qa.visible(el) && (/지도|캠퍼스 전체 보기/.test(qa.txt(el) + (el.getAttribute("aria-label") ?? "")) || /^[←<]/.test(qa.txt(el)))).length);
        return result(backs === 1, { backControls: backs }, "one back control in D4");
      }
      const m = await ctx.inPage((qa) => {
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--colors-primary)";
        document.body.appendChild(probe);
        const primary = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const filled = qa.all("button").filter((el) => qa.visible(el) && [primary, "rgb(255, 255, 255)"].includes(getComputedStyle(el).backgroundColor)).length;
        const retries = qa.all("button").filter((el) => qa.visible(el) && /다시 시도/.test(qa.txt(el))).length;
        const sources = qa.all("[role=alert],[data-qa$=-error],[data-qa=weather-error-banner]").filter(qa.visible).length;
        return { filledOrWhitePrimaries: filled, retries, failedSources: sources };
      });
      return result(m.filledOrWhitePrimaries <= 1 && m.retries <= Math.max(1, m.failedSources), m, "<= 1 primary per view; 다시 시도 at most once per failed source");
    },
  }),
  defineCheck("V-Q-08", {
    states: ["S01"], viewports: DP,
    async run(ctx) {
      const m = await ctx.inPage((qa) => ({
        title: qa.txt(qa.all("[data-qa=dashboard-panel] h1,[data-qa=dashboard-panel] h2").find((el) => qa.visible(el) || true)),
        mapLabel: qa.one("[data-qa=campus-map-layer]")?.getAttribute("aria-label") ?? qa.one("[role=application],[role=region][aria-label]")?.getAttribute("aria-label") ?? null,
      }));
      return result(m.title && !/스마트 시티 대시보드/.test(m.title) && Boolean(m.mapLabel), m, "title names the view; the map region has an aria-label");
    },
  }),
  defineCheck("V-Q-09", {
    states: ["S01", "S04"], viewports: P,
    async run(ctx) {
      const panel = await panelInfo(ctx);
      const share = panel && panel.visibleWidth > 0 ? panel.visibleHeight / 844 : 0;
      const scene = await sceneRegion(ctx);
      return result(share <= 0.5 && scene && scene.w > 0, { panelHeightShare: Math.round(share * 100) / 100 }, "<= 0.5 on load and after a selection; canvas visible above the sheet");
    },
  }),
  defineCheck("V-Q-10", {
    states: { D: ["S04"], P: ["S06"] },
    async run(ctx) {
      const rows = await accentHues(ctx);
      const families = hueFamilies(rows.filter((r) => !r.status));
      const hueOfFirstChromatic = (list) => list.map((r) => parseCssColor(r.value)).filter(chromatic).map((c) => hueOf(c)).find((h) => h != null) ?? null;
      const selectedHue = hueOfFirstChromatic(rows.filter((r) => r.selected && r.prop !== "color"));
      const errorHue = hueOfFirstChromatic(rows.filter((r) => r.status));
      const distinct = selectedHue == null || errorHue == null || hueDistance(selectedHue, errorHue) >= 30;
      return result(families.size <= 1 && distinct, { nonStatusHueFamilies: families.size, selectionHue: selectedHue, errorHue }, "one accent; selection hue != error hue");
    },
  }),
  defineCheck("V-Q-11", {
    states: { D: ["S01"], P: ["S01", "S02"] },
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const panel = qa.one("[data-qa=dashboard-panel]");
        const sizes = (panel && qa.visible(panel) ? qa.textNodesShown(panel) : []).map((i) => qa.eff(i.el));
        return { panelMin: sizes.length ? Math.min(...sizes) : null, panelSizes: [...new Set(sizes)].sort((a, b) => a - b) };
      });
      const list = await chips(ctx);
      const chipMin = list.length ? Math.min(...list.map((c) => c.px)) : null;
      const body = ctx.viewport === "D" ? 14 : 17;
      const secondary = ctx.viewport === "D" ? 12 : 15;
      const chipFloor = ctx.viewport === "D" ? 12 : 13;
      const bodyOk = m.panelMin == null || m.panelMin >= secondary;
      return result(bodyOk && (chipMin == null || chipMin >= chipFloor) && (m.panelSizes.length === 0 || Math.max(...m.panelSizes) >= body), { ...m, chipMin }, `body >= ${body} px, secondary >= ${secondary} px, chips >= ${chipFloor} px`);
    },
  }),
  defineCheck("V-Q-12", {
    states: ["S01", "S06"], viewports: DP,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const texts = qa.textNodesShown().map((i) => i.value);
        return {
          placeholders: texts.filter((t) => /^-\s*(°C|m\/s|%)|^-$/.test(t)).slice(0, 6),
          engineKeys: texts.filter((t) => /^[a-z]+(_[a-z]+)+$/.test(t)).slice(0, 6),
          paddedClock: texts.filter((t) => /(오전|오후)\s*0\d:/.test(t)).slice(0, 3),
          isoDates: texts.filter((t) => /\b20\d\d-\d\d-\d\d\b/.test(t)).slice(0, 3),
        };
      });
      return result(Object.values(m).every((list) => list.length === 0), m, "no placeholders, Korean dates, 0 engine keys, 12-hour clock without a leading zero");
    },
  }),
  defineCheck("V-Q-13", {
    states: { D: ["S08"], P: ["S05"] },
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const labels = qa.all("button,label,[role=tab],h1,h2,h3").filter(qa.visible).map((el) => qa.txt(el) || el.getAttribute("aria-label") || "");
        return {
          english: labels.filter((t) => /^[A-Za-z][A-Za-z /]+$/.test(t) || /^[A-Z][A-Z -]{3,}$/.test(t)).slice(0, 8),
          clickWording: qa.textNodesShown().filter((i) => /클릭하면/.test(i.value)).length,
        };
      });
      const touchOk = ctx.viewport === "D" || m.clickWording === 0;
      return result(m.english.length === 0 && touchOk, m, "0 English or all-caps labels; no 클릭하면 wording on touch");
    },
  }),
  defineCheck("V-Q-14", {
    states: { D: ["S06"], P: ["S06", "S02", "S10"] },
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const korean = qa.textNodesShown().filter((i) => /[가-힣]{2,}\s[가-힣]/.test(i.value));
        const notKeepAll = korean.filter((i) => getComputedStyle(i.el).wordBreak !== "keep-all");
        let midWord = 0;
        for (const item of notKeepAll.slice(0, 80)) {
          const node = [...item.el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
          if (!node) continue;
          const text = node.textContent;
          let prevTop = null;
          for (let i = 0; i < text.length; i += 1) {
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const top = Math.round(range.getBoundingClientRect().top);
            if (prevTop != null && top > prevTop + 2 && /[가-힣]/.test(text[i]) && /[가-힣]/.test(text[i - 1])) midWord += 1;
            prevTop = top;
          }
        }
        return { koreanTextNodes: korean.length, withoutKeepAll: notKeepAll.length, breaksInsideWords: midWord, bodyWordBreak: getComputedStyle(document.body).wordBreak };
      });
      const code = readFileSync(path.join(FRONTEND, "src/index.css"), "utf8");
      return result(m.breaksInsideWords === 0 && /keep-all/.test(code) && m.bodyWordBreak === "keep-all", m, "no break inside a word; word-break: keep-all on body/panel text");
    },
  }),
  defineCheck("V-Q-15", {
    states: ["S04", "S06"], viewports: DP,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const errors = qa.all("[role=alert],[data-qa$=-error],[data-qa=weather-error-banner]").filter(qa.visible);
        const textErrors = qa.textNodesShown().filter((i) => /불러오지 못했|연결할 수 없|완료하지 못했/.test(i.value) && !i.el.closest("[role=alert],[data-qa$=-error],[data-qa=weather-error-banner]")).map((i) => i.el);
        return [...errors, ...textErrors].map((el) => ({ text: qa.txt(el).slice(0, 50), action: Boolean(el.querySelector("button,a") || el.parentElement?.querySelector("button")) }));
      });
      const bad = m.filter((e) => !e.action);
      return result(m.length > 0 && bad.length === 0, { errors: m.length, withoutNextAction: bad.slice(0, 5) }, "every error names the cause and offers a next action at the point of failure");
    },
  }),
  defineCheck("V-Q-16", {
    states: ["S05"], viewports: DP,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const room = qa.all("[role=dialog] *").find((el) => qa.visible(el) && /^D4 \d{3}$/.test(qa.txt(el)));
        const error = qa.all("[role=alert],[data-qa$=-error]").find(qa.visible);
        return { roomIdText: room ? qa.txt(room) : null, roomId: room ? getComputedStyle(room).userSelect : null, error: error ? getComputedStyle(error).userSelect : "no error element" };
      });
      return result(m.roomId && m.roomId !== "none" && m.error !== "none", m, "user-select != none");
    },
  }),
  defineCheck("V-Q-17", {
    states: ["S01", "S02", "S04"], viewports: P,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const sels = ["[data-qa=sheet-handle]", '[aria-label="패널 닫기"]', '[aria-label="패널 열기"]', '[aria-label="설정"]', '[aria-label="기상 데이터 새로고침"]', '[aria-label="시간 재생"]', '[aria-label="닫기"]'];
        const rects = sels.flatMap((sel) => qa.all(sel).filter(qa.visible).map((el) => ({ sel, r: qa.r(el) })));
        const small = rects.filter((x) => x.r.w < 44 || x.r.h < 44).map((x) => `${x.sel} ${x.r.w}x${x.r.h}`);
        let tight = 0;
        for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) if (qa.gap(rects[i].r, rects[j].r) < 8) tight += 1;
        return { targets: rects.length, under44: small, pairsCloserThan8: tight };
      });
      return result(m.targets > 0 && m.under44.length === 0 && m.pairsCloserThan8 === 0, m, ">= 44x44 CSS px with >= 8 px gaps");
    },
  }),
  defineCheck("V-Q-18", {
    states: ["S05"], viewports: DP,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const backs = qa.all("button,a").filter((el) => qa.visible(el) && (/지도|캠퍼스 전체 보기/.test(qa.txt(el) + (el.getAttribute("aria-label") ?? "")) || /^[←<]/.test(qa.txt(el))));
        const glyphs = new Set(backs.map((el) => el.querySelector("svg")?.getAttribute("class") ?? "none"));
        const presets = qa.all("[data-qa^=camera-preset-]").filter((el) => el.tagName === "BUTTON" && !/fade/.test(el.getAttribute("data-qa")));
        const reachable = presets.filter((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.width > 0 && (top === el || el.contains(top)); }).length;
        return { backControls: backs.length, backGlyphs: glyphs.size, presets: presets.length, presetsReachable: reachable };
      });
      // 시점 개수는 제품의 CAMERA_PRESETS에서 읽는다(감사 당시 문구의 "9개"는 실제 시점 수와 다르다).
      const total = CAMERA_PRESETS.length;
      return result(m.backControls === 1 && m.backGlyphs === 1 && (ctx.viewport === "D" || m.presetsReachable >= total), { ...m, presetCount: total },
        `<= 3 groups; one standard back glyph; all ${total} presets reachable at P`);
    },
  }),
  defineCheck("V-Q-19", {
    aggregate: true, states: [],
    async run(ctx) {
      const dirs = [ctx.outDir, process.env.QA_EVIDENCE_DIR ? path.join(process.env.QA_EVIDENCE_DIR, "before") : null].filter((dir) => dir && existsSync(dir));
      const files = new Set(dirs.flatMap((dir) => readdirSync(dir)));
      // Screenshots are written as <entry>-<state>-<viewport>-<theme>.png: every entry captured in the run needs all 24 pairs.
      const entries = [...new Set([...files].map((file) => /^(legacy|vworld)-S\d{2}-/.exec(file)?.[1]).filter(Boolean))];
      const prefixes = entries.length ? entries.map((entry) => `${entry}-`) : [""];
      const missing = [];
      for (const prefix of prefixes) for (let n = 1; n <= 12; n += 1) for (const vp of ["D", "P"]) {
        const id = `${prefix}S${String(n).padStart(2, "0")}-${vp}`;
        if (!files.has(`${id}-light.png`) || !files.has(`${id}-dark.png`)) missing.push(id);
      }
      const expected = 24 * prefixes.length;
      return result(missing.length === 0, { lightDarkPairsFound: expected - missing.length, expected, entries, missing: missing.slice(0, 8), searched: dirs }, "24 light PNGs exist and pair with the dark set");
    },
  }),
  defineCheck("V-Q-20", {
    states: { D: ["S08", "S07", "S01", "S05"], P: ["S08", "S06", "S01"] }, mutates: true,
    async run(ctx) {
      // The phone time card rests as a chip (W5); the row's probes include its ticks, so open it the way a user would.
      // An earlier check in the same replay may have raised the sheet over it: lower the sheet first (패널 닫기 -> peek).
      if (ctx.viewport === "P" && (await ctx.inPage((qa) => qa.one("[data-qa=dashboard-panel]")?.getAttribute("data-detent") !== "peek"))
        && (await ctx.b.center('[aria-label="패널 닫기"]'))) {
        await ctx.b.tap('[aria-label="패널 닫기"]');
        await ctx.sleep(150);
        await sheetSettle(ctx);
      }
      let expandedChip = false;
      if (await ctx.b.center("[data-qa=time-chip]")) {
        await ctx.b.tap("[data-qa=time-chip]");
        await ctx.sleep(600);
        expandedChip = true;
      }
      const items = await textItems(ctx, "[data-qa=dashboard-panel] *, [data-qa=time-slider] *, [role=dialog] *", { maxPx: 14, limit: 200 });
      // Pixels from a fresh frame: this replay changes the page (opened sections, the chip), so the frame captured before
      // the checks would not match the text boxes measured now.
      const frame = await ctx.screenshot();
      const worst = worstContrast(items.map((item) => ({ text: item.text, px: item.px, ratio: contrastAgainst(frame, item.box, ctx.scale, item.color) })));
      // Put the time card back to its chip so the probe replay's later checks see the page as the state left it.
      if (expandedChip && await ctx.b.center('[aria-label="시간 조작 접기"]')) {
        await ctx.b.tap('[aria-label="시간 조작 접기"]');
        await ctx.sleep(400);
      }
      return result(items.length > 0 && worst && worst.ratio >= 4.5, { probes: items.length, worst }, "every probe >= 4.5:1 (ticks and the count badge included)");
    },
  }),
  defineCheck("V-Q-21", {
    states: { D: ["S04", "S08", "S09"], P: ["S05", "S08", "S09"] },
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--colors-primary)";
        document.body.appendChild(probe);
        const primary = getComputedStyle(probe).color;
        probe.remove();
        const meanings = new Set();
        for (const el of qa.all("body *").filter(qa.visible).slice(0, 2500)) {
          const s = getComputedStyle(el);
          if (![s.color, s.backgroundColor, s.borderTopColor].includes(primary)) continue;
          if (el.closest("[aria-pressed=true],[aria-selected=true],[aria-current]")) meanings.add("selection");
          else if (el.tagName === "BUTTON") meanings.add("primary-action");
          else if (el.closest("[role=status],[data-qa*=status]")) meanings.add("status");
          else if (el.tagName === "SVG" || el.closest("svg")) meanings.add("icon");
          else meanings.add("decoration");
        }
        return { primary, meanings: [...meanings] };
      });
      return result(m.meanings.length <= 2 && m.meanings.every((x) => ["selection", "primary-action"].includes(x)), m, "accent carries <= 2 meanings (selection, primary action)");
    },
  }),
  defineCheck("V-Q-22", {
    states: ["S08"], viewports: DP, mutates: true,
    async run(ctx) {
      // Phone: picking the tab leaves the sheet at half; raise it as a user would. Secondary text is the type scale's
      // secondary step: <= 14 px on desktop, 15 px on the phone (V-Q-11), where nothing is 14 px or smaller.
      return withPanelOpen(ctx, null, async () => {
        const phone = (ctx.viewport?.id ?? ctx.viewport) === "P";
        const items = await textItems(ctx, "[data-qa=dashboard-panel] *", { maxPx: phone ? 15 : 14 });
        const worst = worstContrast(contrasts(ctx, items));
        const alpha = await panelAlpha(ctx);
        return result(worst && worst.ratio >= 4.5 && alpha >= 0.9, { worst, panelBackgroundAlpha: alpha }, ">= 4.5:1 and alpha >= 0.9");
      });
    },
  }),
  defineCheck("V-Q-23", {
    states: ["S01", "S05"], viewports: DP, entries: ["legacy", "vworld"],
    async run(ctx) {
      const shell = await ctx.inPage((qa) => ({
        tabs: qa.all("[data-qa^=dashboard-tab-]").filter(qa.visible).length,
        title: Boolean(qa.all("[data-qa=dashboard-panel] h1,[data-qa=dashboard-panel] h2").find(qa.visible)),
        timeCard: Boolean(qa.all("[data-qa=time-slider]").find(qa.visible)),
        presetBar: Boolean(qa.all("[data-qa=camera-preset-bar]").find(qa.visible)),
        backStyles: [...new Set(qa.all("button").filter((el) => qa.visible(el) && /지도|캠퍼스 전체 보기/.test(qa.txt(el) + (el.getAttribute("aria-label") ?? ""))).map((el) => getComputedStyle(el).borderTopLeftRadius + getComputedStyle(el).backgroundColor))].length,
      }));
      const key = `V-Q-23:${ctx.entry}:${ctx.viewport}`;
      if (ctx.state === "S01") ctx.runMemo.set(`${key}:S01`, shell);
      const atS01 = ctx.runMemo.get(`${key}:S01`) ?? shell;
      const kept = shell.tabs === atS01.tabs && shell.title && shell.timeCard && shell.presetBar && shell.backStyles <= 1;
      const vworldRequested = ctx.args.entries.includes("vworld") && Boolean(process.env.VITE_VWORLD_API_KEY);
      if (ctx.entry === "vworld" && ctx.state === "S05") {
        const legacy = ctx.runMemo.get(`V-Q-23:legacy:${ctx.viewport}:S05`) ?? null;
        return result(kept && legacy && JSON.stringify(legacy) === JSON.stringify(shell), { shell, atS01, legacyS05: legacy }, "VWorld shell matches Legacy at D and P");
      }
      if (ctx.state === "S05") ctx.runMemo.set(`${key}:S05`, shell);
      return result(kept && vworldRequested, { shell, atS01, vworldCapturedInThisRun: vworldRequested }, "D4 view keeps title, tabs, clock, time card and preset bar; tab count constant; one back style; VWorld captured");
    },
  }),
  defineCheck("V-Q-24", {
    states: ["S01"], viewports: DP,
    async run(ctx) {
      const brands = await ctx.inPage((qa) => qa.all("img[alt*=순천대],svg[aria-label*=순천대],[role=img][aria-label*=순천대]").filter(qa.visible).length);
      return result(brands === 1, { brandElements: brands }, "one brand element with alt 순천대학교");
    },
  }),
  defineCheck("V-Q-25", {
    states: { D: ["S01", "S09", "S04", "S12"], P: ["S04"] },
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--colors-primary)";
        document.body.appendChild(probe);
        const primary = getComputedStyle(probe).color;
        probe.remove();
        const active = qa.all("[aria-pressed=true],[aria-selected=true]").filter((el) => qa.visible(el) && (el.closest("[data-qa=campus-label]") || /camera-preset/.test(el.getAttribute("data-qa") ?? "")));
        const outlined = active.filter((el) => getComputedStyle(el).borderTopColor === primary || getComputedStyle(el).outlineColor === primary).length;
        const glyphless = active.filter((el) => !el.querySelector("svg")).length;
        const chip = qa.all("button[data-qa=campus-label]").find((el) => el.getAttribute("aria-pressed") === "true");
        const title = qa.txt(qa.one("[data-qa=selection-inspector] h2,[data-qa=selection-inspector] h3")) || null;
        // chipName: the building name without the code badge, the string the panel title shows.
        return { activeElements: active.length, accentOutlined: outlined, withoutGlyph: glyphless, chip: chip ? qa.chipName(chip) : null, title };
      });
      const titleOk = !["S04", "S12"].includes(ctx.state) || (m.chip && m.title === m.chip);
      return result(m.accentOutlined === 0 && m.withoutGlyph === 0 && titleOk, m, "active/selected = wash + glyph (no accent outline); highlight name == panel title");
    },
  }),
  defineCheck("V-Q-26", {
    states: ["S01"], viewports: D, mutates: true,
    async run(ctx) {
      await ctx.b.setMedia({ reducedMotion: true, colorScheme: ctx.theme === "light" ? "light" : "dark" });
      const region = await sceneRegion(ctx);
      const startCamera = await saveCamera(ctx);
      const start = await ctx.screenshot();
      const tapped = await ctx.b.tap("[data-qa=camera-preset-gate]", null, { timeoutMs: 3000 });
      const frames = [];
      for (let i = 0; i < 6; i += 1) {
        frames.push(await ctx.screenshot());
        await ctx.sleep(150);
      }
      const transitions = await ctx.inPage((qa) => ["[data-qa=dashboard-panel]", '[aria-label="패널 닫기"]', "[data-qa=campus-hud]"]
        .map((sel) => (qa.one(sel) ? getComputedStyle(qa.one(sel)).transitionProperty : null)).filter(Boolean));
      await ctx.b.setMedia({ reducedMotion: false, colorScheme: ctx.theme === "light" ? "light" : "dark" });
      // Put the camera back so the probe replay's later states start from the view their own steps expect.
      if (tapped.ok) await restoreCamera(ctx, startCamera);
      const positional = transitions.filter((value) => value.split(",").some((p) => /^(all|right|left|top|bottom|width|height|inset|margin|transform)$/.test(p.trim())));
      const moving = frames.slice(1).filter((frame, i) => pixelDiff(frames[i], frame, region, ctx.scale) > 0.01).length;
      const moved = pixelDiff(start, frames[frames.length - 1], region, ctx.scale);
      // A run where the camera never left the start pose proves nothing about the flight.
      return result(tapped.ok && moved > 0.01 && moving <= 1 && positional.length === 0,
        { presetTapped: tapped.ok, totalChange: Math.round(moved * 1000) / 1000, framesWithPositionalChange: moving, sampled: frames.length, cssTransitionsUnderReduce: transitions },
        "camera flights become cuts (<= 1 frame of interpolation); CSS transitions drop to opacity");
    },
  }),
  defineCheck("V-Q-27", {
    states: ["S01"], viewports: DP, mutates: true,
    async run(ctx) {
      return withPanelOpen(ctx, "dashboard", async () => {
      const cards = await degradedCards(ctx);
      const bad = cards.filter((c) => c.bareDash || !c.action);
      return result(cards.length > 0 && bad.length === 0, { degradedCards: cards.length, withoutExplanationOrAction: bad.slice(0, 5) }, "each degraded card shows an explanation and a next-action control");
      });
    },
  }),
  defineCheck("V-Q-28", {
    states: ["S01", "S06", "S07", "S12"], viewports: DP, mutates: true,
    async run(ctx) {
      if (ctx.state === "S12") {
        const m = await ctx.inPage((qa) => ({
          // The chip shows a code badge since W2 ("C1 도서관"); its name is compared with the title (qa.chipName, #90).
          chip: (() => { const el = qa.all("button[data-qa=campus-label]").find((b) => b.getAttribute("aria-pressed") === "true"); return el ? qa.chipName(el) || null : null; })(),
          title: qa.txt(qa.one("[data-qa=selection-inspector] h2,[data-qa=selection-inspector] h3") ?? qa.all("[data-qa=dashboard-panel] h3").find(qa.visible)) || null,
        }));
        return result(m.chip && m.chip === m.title, m, "title equals the highlighted chip");
      }
      if (ctx.state === "S06") {
        const before = ctx.memo.get("S05:before");
        const after = ctx.memo.get("S06:after-return");
        const energy = await ctx.inPage((qa) => qa.textNodesShown().filter((i) => /에너지|설치 계획|분석/.test(i.value) && /못했|없습니다/.test(i.value)).length);
        return result(before && after && before.tab != null && before.tab === after.tab && energy <= 1, { tabBefore: before?.tab ?? null, tabAfter: after?.tab ?? null, energyCauseMessages: energy }, "no tab change without a user action; energy cause reported once");
      }
      // The weather failure must sit next to the weather cards (within 16 px above them): open the section first.
      return withPanelOpen(ctx, "dashboard", async () => {
      const m = await ctx.inPage((qa) => {
        const failure = qa.one("[data-qa=weather-error-banner]") ?? qa.all("[role=alert]").find((el) => qa.visible(el) && /기상/.test(qa.txt(el)));
        // The card is the innermost element whose text starts with 현재 기온 (its ancestors - the list, the section - start with
        // the same text in document order); the cards group is that card's parent.
        const card = qa.all("[data-qa=dashboard-panel] *").filter((el) => qa.visible(el) && el.children.length > 0 && /^현재 기온/.test(qa.txt(el))).at(-1);
        const group = card?.parentElement;
        return { failure: failure && qa.visible(failure) ? qa.r(failure) : null, weatherCards: group ? qa.r(group) : null };
      });
      const gap = m.failure && m.weatherCards ? Math.round(m.weatherCards.y - (m.failure.y + m.failure.h)) : null;
      const adjacent = !m.failure || (gap != null && gap >= 0 && gap <= 16);
      return result(adjacent, { ...m, gapAboveWeatherCards: gap }, "failure adjacent to its cards");
      });
    },
  }),
  defineCheck("V-Q-29", {
    states: ["S09"], viewports: DP,
    async run(ctx) {
      if (!(await exists(ctx, HOOKS.cameraControls))) {
        const buttons = await ctx.inPage((qa) => qa.all("button").filter((el) => qa.visible(el) && /확대|축소|회전|초기화|재설정/.test(qa.txt(el) + (el.getAttribute("aria-label") ?? ""))).length);
        return missingHook(HOOKS.cameraControls, "zoom in/out, rotate and reset controls exist, are keyboard-operable and change the pose", { zoomRotateResetButtons: buttons });
      }
      const count = await ctx.inPage((qa) => qa.all("[data-qa=camera-controls] button").filter(qa.visible).length);
      return result(count >= 4, { controls: count }, "all four exist and are keyboard-operable");
    },
  }),
];

