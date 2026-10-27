// V-F browser rows (frontend-design findings). V-F-40 is static only (static-checks.mjs).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  chipByText, chips, contrasts, defineCheck, hasUpperEyebrow, hudRects, hueDistance, hueOf, intersection,
  panelAlpha, panelInfo, parseCssColor, result, roofBox, sampleFrames, textItems, worstContrast,
  openPanelSection,
  withPanelOpen,
} from "./common.mjs";

const D = ["D"];
const P = ["P"];
const SRC = fileURLToPath(new URL("../../../src/", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const readSrc = (rel) => (existsSync(SRC + rel) ? readFileSync(SRC + rel, "utf8") : "");

// Computed custom property values from :root (as rgb strings via a probe element).
async function tokenColors(ctx, names) {
  return ctx.inPage((qa, a) => {
    const out = {};
    for (const name of a.names) {
      const probe = document.createElement("span");
      probe.style.color = `var(${name})`;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      out[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim() ? value : null;
    }
    return out;
  }, { names });
}

async function fontSizes(ctx, scope) {
  return ctx.inPage((qa, a) => {
    const root = a.scope ? qa.one(a.scope) : document.body;
    const sizes = new Map();
    for (const item of qa.textNodesShown(root ?? document.body)) {
      const px = Math.round(qa.eff(item.el) * 10) / 10;
      sizes.set(px, (sizes.get(px) ?? 0) + 1);
    }
    return [...sizes].sort((x, y) => x[0] - y[0]);
  }, { scope });
}

async function primaryFilled(ctx) {
  return ctx.inPage((qa) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--colors-primary)";
    document.body.appendChild(probe);
    const primary = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { primary, filled: qa.all("button,a,[role=tab]").filter((el) => qa.visible(el) && getComputedStyle(el).backgroundColor === primary).map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const b = range.getBoundingClientRect();
      return { text: qa.txt(el).slice(0, 30), color: getComputedStyle(el).color, box: { x: b.x, y: b.y, w: b.width, h: b.height }, px: parseFloat(getComputedStyle(el).fontSize) };
    }) };
  });
}

async function backControls(ctx) {
  return ctx.inPage((qa) => qa.all("button,a").filter((el) => qa.visible(el) && (/지도|캠퍼스 전체 보기/.test(qa.txt(el) + (el.getAttribute("aria-label") ?? "")) || /^[←<]/.test(qa.txt(el)))).map((el) => qa.txt(el) || el.getAttribute("aria-label")));
}

async function errorElements(ctx) {
  return ctx.inPage((qa) => {
    const nodes = qa.all("[role=alert],[data-qa$=-error],[data-qa=weather-error-banner]").filter(qa.visible);
    const top = nodes.filter((el) => !nodes.some((o) => o !== el && o.contains(el)));
    return top.map((el) => {
      const s = getComputedStyle(el);
      return { qa: el.getAttribute("data-qa"), text: qa.txt(el).slice(0, 60), style: [s.backgroundColor, s.borderColor, s.borderRadius, s.paddingTop].join("|"), retry: Boolean(el.querySelector("button")), rect: qa.r(el) };
    });
  });
}

export const FRONTEND_CHECKS = [
  defineCheck("V-F-06", {
    states: ["S13"], viewports: D, fixtures: "up",
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const ink = getComputedStyle(qa.one("[data-qa=dashboard-panel]") ?? document.body).color;
        const risk = qa.textNodesShown(qa.one("[data-qa=dashboard-panel]") ?? document.body).filter((item) => /위험/.test(item.value)).map((item) => getComputedStyle(item.el).color);
        return { ink, riskColors: risk.slice(0, 5) };
      });
      const css = ["index.css", "ui/tokens.css"].map(readSrc).join("\n");
      const declared = new Set([...css.matchAll(/(--colors-[\w-]+)\s*:/g)].map((x) => x[1]));
      const jsx = readSrc("AppLegacy.jsx") + readSrc("AppVWorld.jsx") + readSrc("simulation/components/TrafficSafetyPanel.jsx");
      const undefinedVars = [...new Set([...jsx.matchAll(/var\((--colors-[\w-]+)\)/g)].map((x) => x[1]).filter((name) => !declared.has(name)))];
      const toned = m.riskColors.length > 0 && m.riskColors.every((c) => c !== m.ink);
      return result(toned && undefinedVars.length === 0, { ...m, undefinedVars }, "risk metrics in a semantic tone and 0 undefined CSS variables");
    },
  }),
  defineCheck("V-F-11", {
    states: ["S06"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--colors-primary)";
        document.body.appendChild(probe);
        const primary = getComputedStyle(probe).color;
        probe.remove();
        const offenders = qa.all("[data-qa=dashboard-panel] *").filter((el) => {
          if (!qa.visible(el)) return false;
          const s = getComputedStyle(el);
          const accent = s.color === primary || s.borderTopColor === primary || s.backgroundColor === primary;
          if (!accent) return false;
          const allowed = el.closest("button[aria-pressed=true],[aria-selected=true],[aria-current]") || (el.tagName === "BUTTON" && s.backgroundColor === primary);
          return !allowed;
        }).map((el) => `${el.tagName.toLowerCase()} ${qa.txt(el).slice(0, 20)}`);
        return { primary, nonActionAccentElements: offenders.length, examples: offenders.slice(0, 6) };
      });
      return result(m.nonActionAccentElements === 0, m, "only the primary action and selected elements use the accent");
    },
  }),
  defineCheck("V-F-12", {
    states: ["S04"], viewports: D,
    async run(ctx) {
      const lib = await chipByText(ctx, "도서관");
      const border = await ctx.inPage((qa) => {
        const el = qa.all("button[data-qa=campus-label]").find((b) => b.getAttribute("aria-pressed") === "true");
        // The visible border is the chip surface (SceneLabel's [data-qa=label-chip]); the button itself has no border, so its
        // borderTopColor is only the text colour.
        return el ? getComputedStyle(el.querySelector("[data-qa=label-chip]") ?? el).borderTopColor : null;
      });
      const design = existsSync(`${ROOT}DESIGN.md`) ? readFileSync(`${ROOT}DESIGN.md`, "utf8") : "";
      const docHex = (design.match(/primary[^\n]*?(#[0-9a-fA-F]{6})/) ?? [])[1] ?? null;
      const roof = lib ? (() => {
        const img = ctx.image();
        const box = roofBox(lib);
        let r = 0; let g = 0; let b = 0; let n = 0;
        for (let y = Math.floor(box.y * ctx.scale); y < (box.y + box.h) * ctx.scale; y += 2) for (let x = Math.floor(box.x * ctx.scale); x < (box.x + box.w) * ctx.scale; x += 2) {
          const i = (y * img.width + x) * img.channels; r += img.pixels[i]; g += img.pixels[i + 1]; b += img.pixels[i + 2]; n += 1;
        }
        return n ? { r: r / n, g: g / n, b: b / n } : null;
      })() : null;
      const hex = (h) => h ? { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) } : null;
      const hues = { roof: roof ? hueOf(roof) : null, chipBorder: border ? hueOf(parseCssColor(border)) : null, design: docHex ? hueOf(hex(docHex)) : null };
      const pink = /#ffb8c6|#ffe0e8/i.test(readSrc("CityModel.jsx"));
      const spread = Math.max(hueDistance(hues.roof, hues.design) ?? 999, hueDistance(hues.chipBorder, hues.design) ?? 999);
      return result(spread <= 10 && !pink, { hues, maxHueDistance: spread, pinkLiteralInCityModel: pink }, "roof, chip border and DESIGN.md selection hue within 10 degrees; 0 pink literals");
    },
  }),
  defineCheck("V-F-13", {
    states: ["S01"], viewports: D, themes: ["dark", "light"], mutates: true,
    async run(ctx) {
      return withPanelOpen(ctx, null, async () => {
      // Tone badges: short labels (<= 12 chars, <= 12 px) on their own bordered or filled pill.
      const badgeTexts = await ctx.inPage((qa) => qa.all("[data-qa=dashboard-panel] span, [data-qa=dashboard-panel] div").filter((el) => {
        if (!qa.visible(el)) return false;
        const s = getComputedStyle(el);
        const t = qa.txt(el);
        return t && t.length <= 12 && parseFloat(s.fontSize) <= 12 && (parseFloat(s.borderTopWidth) > 0 || qa.alphaOf(s.backgroundColor) > 0) && el.children.length <= 2;
      }).map((el) => qa.txt(el)));
      const items = (await textItems(ctx, "[data-qa=dashboard-panel] *")).filter((item) => badgeTexts.includes(item.text));
      const rows = contrasts(ctx, items);
      const worst = worstContrast(rows);
      return result(rows.length > 0 && worst.ratio >= 4.5, { badgesMeasured: rows.length, worst }, ">= 4.5:1 for every tone badge");
      });
    },
  }),
  defineCheck("V-F-14", {
    // S05/S08 (the audit's views) no longer have filled-primary segments (DESIGN.md: no primary fill on segments), so the
    // roof editor's primary actions (S15) are measured too; a run that measured no filled-primary control at all fails.
    states: ["S05", "S08", "S15"], viewports: D, themes: ["dark", "light"], mutates: true,
    async run(ctx) {
      return withPanelOpen(ctx, null, async () => {
      const m = await primaryFilled(ctx);
      const rows = contrasts(ctx, m.filled.filter((f) => f.box.w > 0));
      const worst = worstContrast(rows);
      const key = `V-F-14:${ctx.entry}:${ctx.theme}`;
      const total = (ctx.runMemo.get(key) ?? 0) + rows.length;
      ctx.runMemo.set(key, total);
      const contrastOk = rows.length === 0 || worst.ratio >= 4.5;
      const evidenceOk = ctx.state !== "S15" || total > 0;
      return result(contrastOk && evidenceOk, { filledPrimaryControls: rows.length, measuredInRunSoFar: total, worst }, ">= 4.5:1 white text on every filled-primary control (>= 1 measured in the run)");
      });
    },
  }),
  defineCheck("V-F-15", {
    states: ["S13"], viewports: D, themes: ["dark"],
    async run(ctx) {
      const items = await textItems(ctx, "[data-qa=dashboard-panel] *", { maxPx: 12, limit: 120 });
      const worst = worstContrast(contrasts(ctx, items));
      return result(items.length > 0 && worst && worst.ratio >= 4.5, { smallTexts: items.length, worst }, ">= 4.5:1 for every 11-12 px status/error text");
    },
  }),
  defineCheck("V-F-16", {
    states: ["S01"], viewports: D,
    async run(ctx) {
      const items = await textItems(ctx, "[data-qa=time-slider] *", { limit: 40 });
      const ticks = items.filter((item) => item !== items.find((i) => /\d{1,2}:\d{2}/.test(i.text)) && /^\d{1,2}(시|:00)?$/.test(item.text));
      if (!ticks.length) return result(true, { tickLabels: 0 }, "ticks absent, or >= 12 px with >= 4.5:1");
      const worst = worstContrast(contrasts(ctx, ticks));
      const minPx = Math.min(...ticks.map((t) => t.px));
      return result(minPx >= 12 && worst && worst.ratio >= 4.5, { tickLabels: ticks.length, minPx, worst }, "ticks absent, or >= 12 px with >= 4.5:1");
    },
  }),
  defineCheck("V-F-17", {
    states: ["S01", "S15", "S16"], viewports: D, themes: ["light"],
    async run(ctx) {
      // The audit's ink-subtle / ink-tertiary pair is ink-muted / ink-subtle in the shipped tokens (DESIGN.md section 2).
      const tokens = await tokenColors(ctx, ["--colors-ink-muted", "--colors-ink-subtle"]);
      const items = await textItems(ctx, "body *", { maxPx: 14, limit: 300 });
      const subtle = items.filter((item) => Object.values(tokens).includes(item.color) || /데이터를 불러오지|불러오지 못했|연결할 수 없|갱신 없음|확인 \d{1,2}:\d{2}/.test(item.text));
      const worst = worstContrast(contrasts(ctx, subtle));
      return result(subtle.length > 0 && worst && worst.ratio >= 4.5, { measured: subtle.length, worst, tokens }, ">= 4.5:1 for ink-subtle labels and error/status lines in light theme");
    },
  }),
  defineCheck("V-F-18", {
    states: ["S07", "S08"], viewports: D, mutates: true,
    async run(ctx) {
      return withPanelOpen(ctx, null, async () => {
      // The audit's ink-subtle is the shipped ink-muted (DESIGN.md section 2, as in V-F-17); measure both secondary inks.
      const tokens = await tokenColors(ctx, ["--colors-ink-muted", "--colors-ink-subtle"]);
      const items = [
        ...(await textItems(ctx, "[data-qa=dashboard-panel] *", { color: tokens["--colors-ink-muted"] })),
        ...(await textItems(ctx, "[data-qa=dashboard-panel] *", { color: tokens["--colors-ink-subtle"] })),
      ];
      const worst = worstContrast(contrasts(ctx, items));
      const alpha = await panelAlpha(ctx);
      return result(worst && worst.ratio >= 4.5 && alpha >= 0.9, { worst, inkSubtleTexts: items.length, panelBackgroundAlpha: alpha }, ">= 4.5:1 and panel alpha >= 0.9");
      });
    },
  }),
  defineCheck("V-F-19", {
    states: ["S04"], viewports: D, fixtures: "up",
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const panel = qa.one("[data-qa=selection-inspector]") ?? qa.one("[data-qa=dashboard-panel]");
        const header = [...(panel?.querySelectorAll("div,header") ?? [])].find((el) => qa.visible(el) && /rgb\(76, 175, 80\)|rgb\(245, 124, 0\)/.test(getComputedStyle(el).backgroundColor));
        return { headerUsesRiskColor: Boolean(header), riskText: qa.textNodesShown(panel ?? document.body).filter((i) => /낮음|보통|높음|매우 높음/.test(i.value)).length };
      });
      const delta = (await textItems(ctx, "[data-qa=dashboard-panel] *", { limit: 200 })).filter((i) => /기준 기온 대비/.test(i.text));
      const worst = worstContrast(contrasts(ctx, delta));
      return result(!m.headerUsesRiskColor && m.riskText > 0 && worst && worst.ratio >= 4.5, { ...m, deltaCopy: worst }, "header is surface-2, risk is badge + text, delta copy >= 4.5:1");
    },
  }),
  defineCheck("V-F-20", {
    states: ["S14"], viewports: D,
    async run(ctx) {
      const items = await textItems(ctx, "[role=dialog] *", { limit: 200 });
      const rooms = items.filter((item) => /\d{3}|화장실|계단|창고|기계실|EV|전기/.test(item.text));
      const worst = worstContrast(contrasts(ctx, rooms));
      return result(rooms.length > 0 && worst && worst.ratio >= 4.5, { roomLabels: rooms.length, worst }, ">= 4.5:1 for utility-room labels");
    },
  }),
  defineCheck("V-F-22", {
    states: ["S01", "S04", "S05"], viewports: D,
    async run(ctx) {
      const sizes = await fontSizes(ctx);
      const allowed = new Set([11, 12, 14, 20, 28]);
      const off = sizes.filter(([px]) => !allowed.has(Math.round(px)));
      return result(off.length === 0, { sizes: sizes.map(([px, n]) => `${px}px x${n}`), offScale: off.map(([px]) => px) }, "subset of {12, 14, 20, 28} px (11 px badges allowed)");
    },
  }),
  defineCheck("V-F-23", {
    states: ["S05"], viewports: D, mutates: true,
    async run(ctx) {
      return withPanelOpen(ctx, null, async () => {
      const m = await ctx.inPage((qa) => {
        const weights = new Set();
        let worstBlock = 0;
        for (const item of qa.textNodesShown()) weights.add(Number(getComputedStyle(item.el).fontWeight));
        for (const block of qa.all("[role=dialog] .rounded-lg, [role=dialog] .rounded-xl, [role=dialog] [class*=rounded-]").filter(qa.visible)) {
          const bold = [...block.querySelectorAll("*")].filter((el) => qa.visible(el) && Number(getComputedStyle(el).fontWeight) >= 600 && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).length;
          worstBlock = Math.max(worstBlock, bold);
        }
        return { weights: [...weights].sort(), maxBoldPerBlock: worstBlock };
      });
      return result(m.weights.every((w) => [400, 500, 600, 700].includes(w)) && m.maxBoldPerBlock <= 1, m, "weights in {400, 500, 600, 700}; <= 1 bold element per block");
      });
    },
  }),
  defineCheck("V-F-26", {
    states: ["S06", "S04"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const texts = qa.textNodesShown().map((i) => i.value);
        const headings = qa.all("h1,h2,h3").filter(qa.visible);
        const withSub = headings.filter((h) => { const n = h.nextElementSibling; return n && n.tagName === "P" && qa.visible(n); }).length;
        return { texts, headings: headings.length, withSubtitle: withSub };
      });
      const eyebrows = hasUpperEyebrow(m.texts);
      return result(eyebrows.length === 0 && m.withSubtitle * 3 <= Math.max(m.headings, 1), { uppercaseEyebrows: eyebrows.slice(0, 6), headings: m.headings, headingsWithSubtitle: m.withSubtitle }, "0 uppercase English eyebrows; subtitles under <= 1 in 3 headings");
    },
  }),
  defineCheck("V-F-27", {
    states: ["S01", "S05"], viewports: D, mutates: true,
    async run(ctx) {
      return withPanelOpen(ctx, null, async () => {
      const m = await ctx.inPage((qa) => {
        const h1 = qa.all("h1").filter((el) => qa.visible(el) || el.classList.contains("sr-only")).length;
        const visibleH1 = qa.all("h1").filter(qa.visible).length;
        const cards = qa.all(".rounded-xl,.rounded-lg,.rounded-2xl,article,section").filter(qa.visible);
        const h2InCard = cards.filter((card) => card.querySelector("h2")).length;
        const outline = qa.all("h1,h2,h3,h4").filter(qa.visible).map((el) => el.tagName).slice(0, 12);
        return { visibleH1, h1, h2InsideCards: h2InCard, outline };
      });
      return result(m.visibleH1 === 1 && m.h2InsideCards === 0, m, "exactly one visible h1, card titles h3, no h2 inside a card");
      });
    },
  }),
  defineCheck("V-F-28", {
    states: ["S03"], viewports: D,
    async run(ctx) {
      const list = await chips(ctx);
      const wide = list.filter((c) => c.rect.w > 160).map((c) => `${c.text} ${c.rect.w}px`);
      return result(wide.length === 0, { chips: list.length, wider160: wide.slice(0, 6), whiteSpace: [...new Set(list.map((c) => c.whiteSpace))] }, "no chip wider than 160 px; long names wrap to <= 2 lines or use shortName");
    },
  }),
  defineCheck("V-F-29", {
    states: ["S01", "S05"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const off = [];
        const cardPad = [];
        for (const el of qa.all("[data-qa=dashboard-panel] *, [role=dialog] *").filter(qa.visible)) {
          const s = getComputedStyle(el);
          for (const prop of ["paddingTop", "paddingLeft", "rowGap", "columnGap"]) {
            const v = parseFloat(s[prop]);
            if (v && Math.abs(v / 4 - Math.round(v / 4)) > 0.01) off.push(`${prop}=${v}`);
          }
          if (/rounded-(xl|lg|2xl)/.test(el.className) && el.children.length) cardPad.push(parseFloat(s.paddingTop));
        }
        return { offGrid: off.length, offGridExamples: [...new Set(off)].slice(0, 8), cardPaddings: [...new Set(cardPad)].sort((a, b) => a - b) };
      });
      return result(m.offGrid === 0 && m.cardPaddings.every((p) => p === 12 || p === 16), m, "every padding/gap a multiple of 4 px; card padding in {12, 16}");
    },
  }),
  defineCheck("V-F-30", {
    states: ["S05"], viewports: D,
    async run(ctx) {
      const radii = await ctx.inPage((qa) => [...new Set(qa.all("body *").filter(qa.visible).map((el) => getComputedStyle(el).borderTopLeftRadius).filter((r) => r !== "0px"))]);
      const off = radii.filter((r) => !["6px", "12px", "9999px"].includes(r) && !(parseFloat(r) > 1000));
      return result(off.length === 0, { radii, offScale: off }, "subset of {6, 12, 9999} px");
    },
  }),
  defineCheck("V-F-31", {
    states: ["S01", "S05"], viewports: D, mutates: true,
    async run(ctx) {
      return withPanelOpen(ctx, null, async () => {
      const m = await ctx.inPage((qa) => {
        const rails = qa.all("[role=tablist], [data-qa=dashboard-panel] .rounded-full.p-1, [data-qa=dashboard-panel] .p-1, [role=dialog] .p-1").filter(qa.visible);
        return rails.map((rail) => {
          const s = getComputedStyle(rail);
          const child = [...rail.children].find((c) => qa.visible(c));
          return child ? { outer: parseFloat(s.borderTopLeftRadius), padding: parseFloat(s.paddingTop), inner: parseFloat(getComputedStyle(child).borderTopLeftRadius) } : null;
        }).filter(Boolean);
      });
      const bad = m.filter((p) => p.outer < 1000 && Math.abs(p.inner - (p.outer - p.padding)) > 0.5);
      return result(m.length > 0 && bad.length === 0, { pairs: m.slice(0, 6), mismatched: bad.length }, "inner = outer - padding for every pair");
      });
    },
  }),
  defineCheck("V-F-32", {
    states: ["S01", "S06"], viewports: D, mutates: true,
    async run(ctx) {
      return withPanelOpen(ctx, null, async () => {
      // The panel scroll body's direct children are the card/header stack of the active tab.
      const gaps = await ctx.inPage((qa) => {
        const body = qa.one("[data-qa=dashboard-panel] .overflow-y-auto");
        if (!body) return null;
        const kids = [...body.children].filter(qa.visible).map((el) => el.getBoundingClientRect());
        return kids.slice(1).map((r, i) => Math.round(r.top - kids[i].bottom));
      });
      if (!gaps || gaps.length === 0) return result(false, { thisStateGaps: gaps }, "a measurable card stack in the panel scroll body");
      if (ctx.state === "S01") ctx.memo.set("V-F-32:S01", gaps);
      const base = ctx.memo.get("V-F-32:S01") ?? gaps;
      const all = [...new Set([...base, ...gaps].filter((g) => g >= 0))];
      return result(all.length <= 1, { s01Gaps: base, thisStateGaps: gaps }, "identical gap values across tabs");
      });
    },
  }),
  defineCheck("V-F-33", {
    states: ["S01", "S04", "S15"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--colors-primary)";
        document.body.appendChild(probe);
        const primary = getComputedStyle(probe).color;
        probe.remove();
        const active = qa.all("[aria-pressed=true],[aria-selected=true]").filter(qa.visible);
        return active.map((el) => ({ text: qa.txt(el).slice(0, 20), border: getComputedStyle(el).borderTopColor, accentBorder: getComputedStyle(el).borderTopColor === primary, glyph: Boolean(el.querySelector("svg")) }));
      });
      const bad = m.filter((a) => a.accentBorder || !a.glyph);
      return result(m.length > 0 && bad.length === 0, { activeElements: m.length, offenders: bad.slice(0, 5) }, "selected = wash + ink text + glyph; border not the accent");
    },
  }),
  defineCheck("V-F-34", {
    states: ["S01", "S05", "S08", "S10"], viewports: D, mutates: true,
    async run(ctx) {
      return withPanelOpen(ctx, null, async () => {
      const styles = await ctx.inPage((qa) => qa.all("[aria-pressed=true],[aria-selected=true]").filter((el) => qa.visible(el) && el.tagName === "BUTTON" && !el.closest("[data-qa=campus-label]")).map((el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.color, s.fontWeight, s.borderTopLeftRadius].join("|"); }));
      const seen = ctx.memo.get("V-F-34:styles") ?? [];
      const all = [...new Set([...seen, ...styles])];
      ctx.memo.set("V-F-34:styles", all);
      const css = readSrc("index.css");
      const variants = (css.match(/\.dashboard-segment|\.dashboard-tab/g) ?? []).length;
      return result(styles.length > 0 && all.length === 1 && variants === 0, { activeStylesSoFar: all, legacyCssVariants: variants }, "one identical active style across all segmented controls; 0 unused CSS variants");
      });
    },
  }),
  defineCheck("V-F-35", {
    states: ["S05", "S06"], viewports: D,
    async run(ctx) {
      const variants = await ctx.inPage((qa) => [...new Set(qa.all("button").filter(qa.visible).map((el) => { const s = getComputedStyle(el); return [Math.round(el.getBoundingClientRect().height), s.fontSize, s.fontWeight, s.borderTopLeftRadius, s.borderTopWidth].join("|"); }))]);
      const css = readSrc("index.css");
      const legacy = (css.match(/\.dashboard-ghost|\.dashboard-outline-button|\.linear-btn/g) ?? []).length;
      return result(variants.length <= 6 && legacy === 0, { distinctButtonStyles: variants.length, examples: variants.slice(0, 8), legacyButtonClasses: legacy }, "<= 3 variants x 2 sizes and 0 legacy button classes");
    },
  }),
  defineCheck("V-F-36", {
    states: ["S01"], viewports: D, mutates: true,
    async run(ctx) {
      await ctx.inPage(() => { document.activeElement?.blur(); return true; });
      const rows = [];
      for (let i = 0; i < 25; i += 1) {
        await ctx.b.key("Tab");
        const f = await ctx.inPage((qa) => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return { label: (el.getAttribute("aria-label") || qa.txt(el)).slice(0, 20), outline: parseFloat(s.outlineWidth) || 0, ring: s.boxShadow !== "none", x: r.x + r.width / 2, y: r.y + r.height / 2, bg: s.backgroundColor, transform: s.transform };
        });
        if (f) rows.push(f);
      }
      const noRing = rows.filter((r) => r.outline <= 0 && !r.ring).map((r) => r.label);
      let pressedChanges = 0;
      for (const row of rows.slice(0, 8)) {
        await ctx.b.mouse("mouseMoved", row.x, row.y, 0);
        await ctx.b.mouse("mousePressed", row.x, row.y, 1);
        const during = await ctx.inPage((qa, a) => { const el = document.elementFromPoint(a.x, a.y)?.closest("button,a,[role=tab],input"); return el ? [getComputedStyle(el).backgroundColor, getComputedStyle(el).transform].join("|") : null; }, { x: row.x, y: row.y });
        await ctx.b.mouse("mouseMoved", 2, 2, 1);
        await ctx.b.mouse("mouseReleased", 2, 2, 0);
        if (during && during !== [row.bg, row.transform].join("|")) pressedChanges += 1;
      }
      return result(rows.length > 0 && noRing.length === 0 && pressedChanges === Math.min(8, rows.length), { focusStops: rows.length, withoutFocusRing: noRing.slice(0, 8), pressedStyleChanges: `${pressedChanges}/${Math.min(8, rows.length)}` },
        "every control shows a focus-visible outline and an active/pressed style change");
    },
  }),
  defineCheck("V-F-37", {
    states: ["S01", "S04"], viewports: D, mutates: true,
    async run(ctx) {
      const measure = () => ctx.inPage((qa) => {
        const targets = [...qa.all('[aria-label="패널 닫기"],[aria-label="패널 열기"],[aria-label="설정"],[aria-label="닫기"],[aria-label="기상 데이터 새로고침"]'), ...qa.all("button[data-qa=campus-label]")].filter(qa.visible);
        const small = targets.map((el) => el.getBoundingClientRect()).filter((r) => r.width < 40 || r.height < 40).length;
        const coarseSmall = targets.map((el) => el.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length;
        return { targets: targets.length, under40: small, under44: coarseSmall, coarse: matchMedia("(pointer: coarse)").matches };
      });
      const fine = await measure();
      await ctx.b.view.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      await ctx.sleep(300);
      const coarse = await measure();
      await ctx.b.view.cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
      return result(fine.under40 === 0 && coarse.under44 === 0, { pointerFine: fine, pointerCoarse: coarse }, "pointer >= 40x40; coarse >= 44x44; thumbs >= 24 px on coarse");
    },
  }),
  defineCheck("V-F-38", {
    states: ["S05"], viewports: D,
    async run(ctx) {
      const dots = await ctx.inPage((qa) => qa.all("[role=dialog] span.rounded-full").filter((el) => qa.visible(el) && el.getBoundingClientRect().width <= 8 && !qa.txt(el)).length);
      const hardcoded = ["AppLegacy.jsx", "AppVWorld.jsx"].map(readSrc).join("\n").includes("정상 운영 중");
      const statusBadge = /StatusBadge/.test(readSrc("vworld/D4SectionExperience.jsx") + readSrc("components/D4WingFloorSelect.jsx"));
      return result(dots === 0 && !hardcoded && statusBadge, { decorativeDots: dots, hardcodedStatusString: hardcoded, usesStatusBadge: statusBadge }, "dots/badges bound to state through StatusBadge; 0 hard-coded status strings; no decorative dots");
    },
  }),
  defineCheck("V-F-41", {
    states: ["S13"], viewports: D, fixtures: "up", mutates: true,
    async run(ctx) {
      return withPanelOpen(ctx, null, async () => {
      const m = await ctx.inPage((qa) => {
        const rows = qa.all("[data-qa=dashboard-panel] li, [data-qa=dashboard-panel] article, [data-qa=dashboard-panel] [data-risk]").filter((el) => qa.visible(el) && /위험|주의|risk/i.test(qa.txt(el)));
        return { riskRows: rows.length, withLeftStripe: rows.filter((el) => parseFloat(getComputedStyle(el).borderLeftWidth) >= 2).length };
      });
      // Without a rendered risk row there is nothing to verify, which is a FAIL, not a pass.
      return result(m.riskRows > 0 && m.withLeftStripe === 0, m, "border-left-width 0 on every risk row; a tone badge + text carries the risk");
      });
    },
  }),
  defineCheck("V-F-42", {
    states: ["S01"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const panel = qa.one("[data-qa=dashboard-panel]");
        const dl = panel?.querySelector("dl");
        const dashes = qa.textNodesShown(panel ?? document.body).filter((i) => /^-(°C|m\/s|\s|$)/.test(i.value)).length;
        return { currentConditionsDl: Boolean(dl), tilesShowingDash: dashes };
      });
      return result(m.currentConditionsDl && m.tilesShowingDash === 0, m, "current conditions as a two-column dl; 0 tiles showing '-'");
    },
  }),
  defineCheck("V-F-43", {
    states: ["S01"], viewports: D,
    async run(ctx) {
      const shadows = await ctx.inPage((qa) => ["[data-qa=dashboard-panel]", "[data-qa=camera-preset-bar]", "[data-qa=time-slider]", "button[data-qa=campus-label]", "[data-qa=dashboard-panel] .rounded-xl"].flatMap((sel) => qa.all(sel).filter(qa.visible).filter((el) => getComputedStyle(el).boxShadow !== "none").map(() => sel)));
      const code = ["AppLegacy.jsx", "AppVWorld.jsx", "CityModel.jsx", "components/CameraPresetBar.jsx", "components/TimeSlider.jsx"].map(readSrc).join("\n");
      const arbitrary = (code.match(/shadow-\[|shadow-2xl|shadow-lg/g) ?? []).length;
      return result(shadows.length === 0 && arbitrary === 0, { surfacesWithShadow: [...new Set(shadows)], shadowClassesInCode: arbitrary }, "no shadow on rail/cards/chips/HUD; only --shadow-popover on modals");
    },
  }),
  defineCheck("V-F-44", {
    states: ["S01"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const surfaces = ["[data-qa=dashboard-panel]", "[data-qa=camera-preset-bar]", "[data-qa=time-slider]", "[data-qa=campus-hud] > *"].flatMap((sel) => qa.all(sel).filter(qa.visible));
        const blurred = surfaces.filter((el) => { const s = getComputedStyle(el); return (s.backdropFilter && s.backdropFilter !== "none") || (s.webkitBackdropFilter && s.webkitBackdropFilter !== "none"); }).length;
        const gradients = qa.all("body *").filter((el) => qa.visible(el) && /gradient/.test(getComputedStyle(el).backgroundImage) && el.getBoundingClientRect().width >= innerWidth * 0.9).length;
        return { backdropFilteredSurfaces: blurred, fullScreenGradients: gradients };
      });
      return result(m.backdropFilteredSurfaces === 0 && m.fullScreenGradients === 0, m, "0 backdrop-filter, no full-screen decorative gradient");
    },
  }),
  defineCheck("V-F-45", {
    states: ["S06"], viewports: D,
    async run(ctx) {
      const errors = await errorElements(ctx);
      const styles = new Set(errors.map((e) => e.style));
      const qas = new Set(errors.map((e) => e.qa));
      const bareRed = await ctx.inPage((qa) => qa.textNodesShown().filter((i) => /못했습니다|없습니다|실패/.test(i.value) && !i.el.closest("[role=alert],[data-qa$=-error],[data-qa=weather-error-banner]")).length);
      return result(errors.length > 0 && styles.size === 1 && qas.size === 1 && bareRed === 0, { errorElements: errors.length, distinctStyles: styles.size, distinctDataQa: [...qas], bareErrorTexts: bareRed }, "one Alert component for every error; 0 bare red errors");
    },
  }),
  defineCheck("V-F-46", {
    states: ["S06", "S07", "S04"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const texts = qa.textNodesShown().map((i) => i.value);
        const energy = new Set(texts.filter((t) => /에너지|설치 계획|분석을 완료/.test(t) && /못했|없습니다|실패/.test(t)));
        const captions = texts.filter((t) => /마지막 정상 수신/.test(t)).length;
        return { energyMessages: [...energy], lastGoodCaptions: captions };
      });
      return result(m.energyMessages.length <= 1 && m.lastGoodCaptions <= 1, m, "one status per data source; last-good caption once per group");
    },
  }),
  defineCheck("V-F-47", {
    states: ["S01"], viewports: D, mutates: true,
    async run(ctx) {
      const opened = await openPanelSection(ctx);
      const m = await ctx.inPage((qa) => {
        const alert = qa.one("[data-qa=weather-error-banner]") ?? qa.one("[data-qa=weather-status]");
        const cards = qa.all("[data-qa=dashboard-panel] .grid > *").filter(qa.visible);
        const firstCard = cards[0]?.getBoundingClientRect();
        const ar = alert?.getBoundingClientRect();
        const distance = ar && firstCard ? Math.round(firstCard.top - ar.bottom) : null;
        return { alertToFirstCardPx: distance, alertBelowCards: ar && firstCard ? ar.top > firstCard.bottom : null };
      });
      // MicroclimatePanel was replaced by the selection inspector (todo 31); its retry now lives there.
      const reloads = ["AppLegacy.jsx", "AppVWorld.jsx", "panel/SelectionInspector.jsx", "components/PanelErrorBoundary.jsx"].map(readSrc).join("\n").match(/window\.location\.reload/g)?.length ?? 0;
      const microRetry = /다시 시도/.test(readSrc("panel/SelectionInspector.jsx"));
      const placed = m.alertToFirstCardPx != null && m.alertToFirstCardPx >= 0 && m.alertToFirstCardPx <= 16;
      return result(placed && microRetry && reloads === 0, { ...m, microclimateRetry: microRetry, reloadCalls: reloads, opened }, "alert within 16 px above the failed group; every error has a retry; 0 reload calls");
    },
  }),
  defineCheck("V-F-48", {
    // S01 reads empty values with the fixtures down; S12 times skeleton vs spinner with the fixtures delayed (--delay-ms 3000).
    states: ["S12", "S01"], viewports: D, fixtures: { S01: "down", S12: "delay" },
    async run(ctx) {
      if (ctx.state === "S01") {
        const dashes = await ctx.inPage((qa) => qa.textNodesShown(qa.one("[data-qa=dashboard-panel]") ?? document.body).filter((i) => /^-(°C|m\/s|\s|$)/.test(i.value)).map((i) => i.value).slice(0, 6));
        return result(dashes.length === 0, { bareDashValues: dashes }, "empty values name the action (연결 재시도 / 건물 선택), not '-'");
      }
      if (ctx.fixtures !== "delay") return result(false, { note: "requires a run with --delay-ms 3000 (fixtures delayed)" }, "skeletons at 0.5 s, spinner only after 1 s");
      const samples = ctx.memo.get(`${ctx.stateLabel}:samples`) ?? [];
      const a = samples.find((s) => s.offsetMs === 500);
      const b = samples.find((s) => s.offsetMs === 2000);
      return result(a && b && a.skeletons > 0 && a.spinners === 0 && b.spinners >= 1, { at500: a ?? null, at2000: b ?? null }, "skeletons at 0.5 s, spinner only after 1 s");
    },
  }),
  defineCheck("V-F-49", {
    states: ["S08", "S05", "S13"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const labels = qa.all("button,label,[role=tab],option").filter(qa.visible).map((el) => qa.txt(el) || el.getAttribute("aria-label") || "");
        const english = labels.filter((t) => /^[A-Za-z][A-Za-z /]{1,}$/.test(t));
        const instruction = qa.textNodesShown().filter((i) => /클릭하면|선택하면 .*이동합니다/.test(i.value)).length;
        return { englishLabels: english.slice(0, 8), visibleInstructionSentences: instruction };
      });
      return result(m.englishLabels.length === 0 && m.visibleInstructionSentences === 0, m, "0 English control labels; instruction sentence in a title attribute");
    },
  }),
  defineCheck("V-F-50", {
    states: ["S05", "S06"], viewports: D,
    async run(ctx) {
      if (ctx.state === "S05") {
        const backs = await backControls(ctx);
        return result(backs.length === 1, { backControls: backs }, "exactly one back control in the D4 header");
      }
      const errors = await errorElements(ctx);
      const sourceOf = (text) => (/기상/.test(text) ? "weather" : /에너지|설치 계획|분석|상태 API/.test(text) ? "energy" : /영상|교통|주차/.test(text) ? "traffic" : "other");
      const perSource = {};
      for (const error of errors) {
        const source = sourceOf(error.text);
        perSource[source] ??= { errors: 0, retries: 0 };
        perSource[source].errors += 1;
        perSource[source].retries += error.retry ? 1 : 0;
      }
      const ok = Object.keys(perSource).length > 0 && Object.values(perSource).every((s) => s.retries === 1);
      return result(ok, { perSource }, "one retry per failed source");
    },
  }),
  defineCheck("V-F-51", {
    states: ["S01", "S02"], viewports: D,
    async run(ctx) {
      const list = await chips(ctx);
      const min = list.length ? Math.min(...list.map((c) => c.px)) : null;
      return result(min != null && min >= 12, { chips: list.length, minEffectivePx: min }, ">= 12 px on every chip (scale >= 1)");
    },
  }),
  defineCheck("V-F-52", {
    states: ["S01", "S02", "S09"], viewports: D,
    async run(ctx) {
      const list = await chips(ctx);
      const untiered = list.filter((c) => c.tier == null).length;
      const tiers = [...new Set(list.map((c) => c.tier))];
      const farOk = ctx.state === "S09" || tiers.every((t) => t === "0" || t === "1");
      const streetOk = ctx.state !== "S09" || list.length <= 8;
      return result(list.length > 0 && untiered === 0 && farOk && streetOk, { chips: list.length, withoutTier: untiered, tiers }, "tier attribute on every chip; far band tiers 0-1; street band <= 8 chips");
    },
  }),
  defineCheck("V-F-53", {
    states: ["S01"], viewports: D,
    async run(ctx) {
      const dorms = (await chips(ctx)).filter((c) => c.text.startsWith("학생생활관")).map((c) => c.text);
      const unique = new Set(dorms).size === dorms.length;
      return result(unique, { dormitoryChips: dorms }, "every 학생생활관 chip text unique or one clustered chip");
    },
  }),
  defineCheck("V-F-54", {
    states: ["S02", "S11"], viewports: D,
    async run(ctx) {
      const frames = await sampleFrames(ctx, (qa) => qa.chips().map((el) => qa.txt(el)).join("|"), 10);
      const toggles = frames.slice(1).filter((f, i) => f !== frames[i]).length;
      const list = await chips(ctx);
      const clipped = list.filter((c) => c.rect.x < 0 || c.rect.y < 0 || c.rect.x + c.rect.w > ctx.width || c.rect.y + c.rect.h > ctx.height).length;
      let overlaps = 0;
      for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) if (intersection(list[i].rect, list[j].rect) > 0 && !list[i].leader && !list[j].leader) overlaps += 1;
      return result(toggles <= 1 && clipped === 0 && overlaps === 0, { visibilityChangesIn10Frames: toggles, partiallyClipped: clipped, overlappingPairsWithoutLeader: overlaps }, "no toggling within 300 ms, overlaps offset/clustered, 0 clipped chips");
    },
  }),
  defineCheck("V-F-55", {
    states: ["S03"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const list = qa.chips();
        const exposed = list.filter((el) => el.hasAttribute("data-occluded") || el.closest("[data-occluded]")).length;
        const occludedVisible = list.filter((el) => (el.getAttribute("data-occluded") ?? el.closest("[data-occluded]")?.getAttribute("data-occluded")) === "true").length;
        return { chips: list.length, chipsExposingOcclusion: exposed, occludedButVisible: occludedVisible };
      });
      return result(m.chips > 0 && m.chipsExposingOcclusion === m.chips && m.occludedButVisible === 0, m, "0 visible chips whose anchor is occluded (chips expose data-occluded from the raycast)");
    },
  }),
  defineCheck("V-F-56", {
    states: ["S09"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => qa.chips().map((el) => {
        const host = el.closest("[data-anchor-top]");
        const top = host ? Number(host.getAttribute("data-anchor-top")) : null;
        const r = el.getBoundingClientRect();
        return { text: qa.txt(el), offset: top == null ? null : Math.round(r.bottom - top), leader: Boolean(qa.leaderOf(el)) };
      }));
      const bad = m.filter((c) => !c.leader && (c.offset == null || Math.abs(c.offset) > 24));
      return result(m.length > 0 && bad.length === 0, { chips: m.length, withoutAnchorOrLeader: bad.slice(0, 6) }, "every chip within the bbox top edge +/- 24 px or connected by a leader");
    },
  }),
  defineCheck("V-F-57", {
    states: ["S03"], viewports: D, mutates: true,
    async run(ctx) {
      const list = await chips(ctx);
      if (!list.length) return result(false, { chips: 0 }, "chips to probe");
      const target = list[0];
      const style = () => ctx.inPage((qa, a) => { const el = qa.chips().find((c) => qa.txt(c) === a.text); if (!el) return null; const s = getComputedStyle(el); return [s.backgroundColor, s.outlineWidth, s.boxShadow, s.transform].join("|"); }, { text: target.text });
      const idle = await style();
      await ctx.b.mouse("mouseMoved", target.rect.x + target.rect.w / 2, target.rect.y + target.rect.h / 2, 0);
      await ctx.sleep(250);
      const hover = await style();
      await ctx.b.mouse("mouseMoved", 3, 3, 0);
      await ctx.inPage((qa, a) => { qa.chips().find((c) => qa.txt(c) === a.text)?.focus({ focusVisible: true }); return true; }, { text: target.text });
      const focus = await ctx.inPage((qa, a) => { const el = qa.chips().find((c) => qa.txt(c) === a.text); return el ? parseFloat(getComputedStyle(el).outlineWidth) || (getComputedStyle(el).boxShadow !== "none" ? 1 : 0) : 0; }, { text: target.text });
      await ctx.inPage(() => { document.activeElement?.blur(); return true; });
      const minHeight = Math.min(...list.map((c) => c.rect.h));
      return result(minHeight >= 32 && hover !== idle && focus > 0, { minChipHeight: minHeight, hoverChangesStyle: hover !== idle, focusRing: focus > 0 }, "height >= 32 px; hover wash, focus ring and pressed state present");
    },
  }),
  defineCheck("V-F-58", {
    states: ["S01", "S05"], viewports: D,
    async run(ctx) {
      // One SceneLabel = one chip surface: every campus chip, D4 floor label and D4 room label carries the shared
      // [data-qa=label-chip] surface with a size tier, and the surface tokens (radius, fill, border, ink) equal the campus
      // chip's. S01 records the campus chip; S05 compares the D4 labels against it.
      const m = await ctx.inPage((qa) => {
        const surface = (el) => (el.matches("[data-qa=label-chip]") ? el : el.querySelector("[data-qa=label-chip]"));
        const tokens = (el) => { const s = getComputedStyle(el); return [s.borderTopLeftRadius, s.backgroundColor, s.borderTopColor, s.color].join(" | "); };
        const describe = (el) => { const chip = surface(el); return { qa: el.getAttribute("data-qa"), tier: el.getAttribute("data-tier"), surface: chip ? tokens(chip) : null }; };
        const campus = qa.all("button[data-qa=campus-label][data-state=idle]").filter(qa.visible).slice(0, 1).map(describe);
        const d4 = qa.all('[data-qa=d4-pane] [aria-label$="층 선택"],[data-qa=d4-pane] [aria-label$="강의실 상세"]').filter(qa.visible).slice(0, 6).map(describe);
        return { campus: campus[0] ?? null, d4Labels: d4 };
      });
      if (ctx.state === "S01") {
        ctx.runMemo.set(`V-F-58:${ctx.entry}`, m.campus);
        return result(Boolean(m.campus?.surface && m.campus.tier), m, "campus chips render the shared label-chip surface with a size tier");
      }
      const campus = ctx.runMemo.get(`V-F-58:${ctx.entry}`) ?? null;
      const same = m.d4Labels.length > 0 && Boolean(campus?.surface) && m.d4Labels.every((label) => label.surface === campus.surface && label.tier != null);
      return result(same, { campusAtS01: campus, d4Labels: m.d4Labels }, "campus chips, D4 floor labels and room labels render through one SceneLabel (same label-chip surface, size tiers, same surface tokens)");
    },
  }),
  defineCheck("V-F-59", {
    states: ["S01"], viewports: D,
    async run(ctx) {
      const hud = await hudRects(ctx);
      const m = await ctx.inPage((qa) => {
        const bar = qa.one("[data-qa=camera-preset-bar]");
        const map = qa.one("[data-qa=campus-map-layer]") ?? qa.one("canvas");
        const hidden = qa.all("button[data-qa=campus-label]").filter((el) => !qa.visible(el) || Number(getComputedStyle(el.closest("[data-qa=campus-label]")).opacity) === 0).map((el) => qa.r(el));
        return { barShare: bar && map ? Math.round((bar.getBoundingClientRect().width / map.getBoundingClientRect().width) * 100) / 100 : null, hiddenRects: hidden };
      });
      const covered = (await chips(ctx)).filter((c) => hud.some((h) => intersection(c.rect, h.rect) > 0)).map((c) => c.text);
      const hiddenUnderHud = m.hiddenRects.filter((r) => r.w > 0 && hud.some((h) => intersection(r, h.rect) > 0)).length + covered.length;
      return result(hiddenUnderHud === 0 && m.barShare != null && m.barShare <= 0.5, { labelsUnderHudRects: hiddenUnderHud, examples: covered.slice(0, 5), presetBarWidthShare: m.barShare }, "0 labels hidden under HUD rects (labels nudge out); bar <= 50% of the map width");
    },
  }),
  defineCheck("V-F-60", {
    states: ["S13"], viewports: D,
    async run(ctx) {
      const nested = await ctx.inPage((qa) => {
        const scroller = qa.one("[data-qa=dashboard-panel] .overflow-y-auto");
        if (!scroller) return null;
        return [...scroller.querySelectorAll("*")].filter((el) => qa.visible(el) && /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight).length;
      });
      const sniff = /closest\??\.?\(\s*["']\.overflow-y-auto["']\s*\)/.test(readSrc("vworld/D4SectionExperience.jsx"));
      return result(nested === 0 && !sniff, { nestedVerticalScrollers: nested, exitGestureSniffsClassNames: sniff }, "0 nested same-axis scrollers; the exit gesture does not sniff class names");
    },
  }),
  defineCheck("V-F-61", {
    states: ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const banner = qa.one("[data-qa=weather-error-banner]");
        if (!banner) return { banner: false };
        const s = getComputedStyle(banner);
        const scroller = qa.one("[data-qa=dashboard-panel] .overflow-y-auto");
        return { banner: true, position: s.position, insideScroller: Boolean(scroller?.contains(banner)), bottomGap: Math.round(innerHeight - banner.getBoundingClientRect().bottom) };
      });
      return result(!m.banner || (m.insideScroller && !["fixed", "absolute", "sticky"].includes(m.position)), m, "no permanent footer banner; status at the top of the affected group");
    },
  }),
  defineCheck("V-F-62", {
    states: ["S01", "S06"], viewports: D,
    async run(ctx) {
      const m = await primaryFilled(ctx);
      const inPanel = await ctx.inPage((qa, a) => qa.all("[data-qa=dashboard-panel] button").filter((el) => qa.visible(el) && getComputedStyle(el).backgroundColor === a.primary && el.getAttribute("role") !== "tab").length, { primary: m.primary });
      return result(inPanel <= 1, { filledPrimaryButtonsInTab: inPanel }, "<= 1 primary per tab");
    },
  }),
  defineCheck("V-F-63", {
    // The ranking and the comparison only exist when the energy API answers: measure at S17's fixtures-up S06.
    states: ["S06"], viewports: D, mutates: true, fixtures: "up",
    async run(ctx) {
      return withPanelOpen(ctx, "energy", async () => {
      const m = await ctx.inPage((qa) => {
        const panel = qa.one("[data-qa=dashboard-panel]");
        return { orderedLists: panel?.querySelectorAll("ol").length ?? 0, tables: panel?.querySelectorAll("table").length ?? 0, h2: panel?.querySelectorAll("h2").length ?? 0 };
      });
      return result(m.orderedLists >= 1 && m.tables >= 1 && m.h2 <= 1, m, "ranking is an ol, comparison a table, <= 1 heading group");
      });
    },
  }),
  defineCheck("V-F-64", {
    states: ["S13"], viewports: D,
    async run(ctx) {
      const tiles = await ctx.inPage((qa) => {
        const grid = qa.all("[data-qa=dashboard-panel] .grid-cols-3").find(qa.visible);
        return grid ? [...grid.children].map((el) => { const s = getComputedStyle(el); return { content: Math.round(el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)), padding: parseFloat(s.paddingLeft) }; }) : [];
      });
      const dl = await ctx.inPage((qa) => Boolean(qa.one("[data-qa=dashboard-panel] dl")));
      const ok = dl || (tiles.length > 0 && tiles.every((t) => t.content >= 120 && t.padding <= 16));
      return result(ok, { tiles, dlLayout: dl }, "content width >= 120 px per tile or a dl layout; padding <= 16 px");
    },
  }),
  defineCheck("V-F-65", {
    states: ["S05"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const dialog = qa.one("[role=dialog]");
        const tall = [...(dialog?.querySelectorAll("*") ?? [])].filter((el) => qa.visible(el) && el.getBoundingClientRect().height >= innerHeight * 0.6 && /rounded/.test(el.className) && el.querySelectorAll("button").length <= 2).length;
        const spacers = [...(dialog?.querySelectorAll("[aria-hidden=true]") ?? [])].filter((el) => el.tagName === "DIV" && !el.children.length && !qa.txt(el) && el.getBoundingClientRect().width > 100).length;
        return { tallCardsForOneRow: tall, spacerDivs: spacers };
      });
      return result(m.tallCardsForOneRow === 0 && m.spacerDivs === 0, m, "list-detail layout: no 64vh card for one row, no spacer div");
    },
  }),
  defineCheck("V-F-67", {
    states: ["S06"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const error = qa.all("[role=alert],[data-qa$=-error]").find(qa.visible);
        return { errorUserSelect: error ? getComputedStyle(error).userSelect : null };
      });
      return result(m.errorUserSelect && m.errorUserSelect !== "none", m, "!= none for panel content");
    },
  }),
  defineCheck("V-F-68", {
    states: ["S01"], viewports: D,
    async run(ctx) {
      const m = await ctx.inPage((qa) => ["[data-qa=dashboard-panel]", '[aria-label="패널 닫기"]', "[data-qa=campus-hud]"].map((sel) => ({ sel, props: qa.one(sel) ? getComputedStyle(qa.one(sel)).transitionProperty : null })));
      const bad = m.filter((x) => x.props && x.props.split(",").map((p) => p.trim()).some((p) => /^(all|right|left|width|top|bottom|height|margin|inset)/.test(p)));
      return result(bad.length === 0, { transitions: m }, "only transform / opacity / filter animate");
    },
  }),
  defineCheck("V-F-69", {
    states: ["S01"], viewports: D, mutates: true,
    async run(ctx) {
      await ctx.b.setMedia({ reducedMotion: true, colorScheme: ctx.theme === "light" ? "light" : "dark" });
      await ctx.sleep(200);
      const m = await ctx.inPage((qa) => ({
        panelTransition: qa.one("[data-qa=dashboard-panel]") ? getComputedStyle(qa.one("[data-qa=dashboard-panel]")).transitionProperty : null,
        spinnersAnimating: qa.all(".animate-spin").filter((el) => qa.visible(el) && getComputedStyle(el).animationName !== "none" && parseFloat(getComputedStyle(el).animationDuration) > 0.01).length,
      }));
      await ctx.b.setMedia({ reducedMotion: false, colorScheme: ctx.theme === "light" ? "light" : "dark" });
      const block = /prefers-reduced-motion/.test(readSrc("index.css") + readSrc("ui/tokens.css"));
      const positional = m.panelTransition && /(all|right|left|width|transform)/.test(m.panelTransition);
      return result(!positional && m.spinnersAnimating === 0 && block, { ...m, reducedMotionBlock: block }, "positional transitions replaced by opacity fades, spinners static, global reduced-motion block");
    },
  }),
  defineCheck("V-F-71", {
    // 분석 실행 exists only when the energy API returns a representative plan: measure at S17's fixtures-up S01.
    states: ["S01"], viewports: D, mutates: true, fixtures: "up",
    async run(ctx) {
      // The refresh lives in the 기본 현황 weather card: open the panel first (rail-first shell).
      return withPanelOpen(ctx, null, async () => {
      const count = () => ctx.inPage((qa) => qa.all(".animate-spin,[role=status],[aria-busy=true]").filter(qa.visible).length);
      const base = await count();
      const tapped = await ctx.b.tap('[aria-label="기상 데이터 새로고침"]', null, { timeoutMs: 2000 });
      await ctx.sleep(150);
      const weather = (await count()) - base;
      const toEnergy = await ctx.b.tap("[data-qa=dashboard-tab-energy]", null, { timeoutMs: 2000 });
      await ctx.sleep(800);
      const base2 = await count();
      await ctx.inPage(() => { [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "분석 실행")?.scrollIntoView({ block: "center" }); return true; });
      await ctx.sleep(300);
      const run = await ctx.b.tap("button", "분석 실행", { timeoutMs: 2000 });
      await ctx.sleep(150);
      const analysis = run.ok ? (await count()) - base2 : null;
      if (toEnergy.ok) await ctx.b.tap("[data-qa=dashboard-tab-dashboard]", null, { timeoutMs: 2000 });
      return result(tapped.ok && run.ok && weather <= 1 && analysis <= 1, { refreshTapped: tapped.ok, weatherIndicators: weather, analysisRunFound: run.ok, analysisIndicators: analysis }, "one progress indicator per action");
      });
    },
  }),
  defineCheck("V-F-72", {
    states: ["S01", "S04", "S12"], viewports: P,
    async run(ctx) {
      const panel = await panelInfo(ctx);
      const handle = await ctx.inPage((qa) => { const el = qa.one("[data-qa=sheet-handle]") ?? qa.one('[aria-label="패널 닫기"],[aria-label="패널 열기"]'); return el ? qa.r(el) : null; });
      const share = panel && panel.visibleWidth > 0 ? panel.visibleHeight / ctx.height : 0;
      const sheet = await ctx.inPage((qa) => Boolean(qa.one("[data-qa=sheet-handle]")));
      return result(sheet && share <= 0.5 && handle && handle.w >= 44 && handle.h >= 44, { bottomSheet: sheet, panelHeightShare: Math.round(share * 100) / 100, handle }, "bottom sheet with detents (<= 50% at half), handle >= 44 px");
    },
  }),
  defineCheck("V-F-73", {
    states: ["S01", "S04"], viewports: P,
    async run(ctx) {
      const tabs = await ctx.inPage((qa) => qa.all("[data-qa^=dashboard-tab-]").map((el) => ({ id: el.getAttribute("data-qa"), rect: qa.r(el) })));
      if (ctx.state === "S01") ctx.memo.set("V-F-73:S01", tabs);
      const before = ctx.memo.get("V-F-73:S01") ?? tabs;
      const minH = tabs.filter((t) => t.rect.w > 0).reduce((m, t) => Math.min(m, t.rect.h), Infinity);
      const sameSet = before.map((t) => t.id).join() === tabs.map((t) => t.id).join();
      return result(minH >= 44 && sameSet, { tabsBefore: before.map((t) => t.id), tabsNow: tabs.map((t) => t.id), minTabHeight: minH === Infinity ? null : minH }, "tab height >= 44 px; tab count and positions unchanged after selection");
    },
  }),
  defineCheck("V-F-74", {
    states: ["S01"], viewports: P,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const targets = qa.all("[data-qa^=dashboard-tab-], [data-qa=dashboard-panel] button, button[data-qa=campus-label], [data-qa^=camera-preset-]").filter((el) => qa.visible(el) && (el.tagName === "BUTTON" || el.getAttribute("role") === "tab"));
        const small = targets.filter((el) => { const r = el.getBoundingClientRect(); return r.width < 44 || r.height < 44; });
        return { targets: targets.length, under44: small.length, examples: small.slice(0, 6).map((el) => `${qa.txt(el).slice(0, 10) || el.getAttribute("aria-label")} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`) };
      });
      return result(m.targets > 0 && m.under44 === 0, m, "all >= 44x44 CSS px; thumbs >= 24 px");
    },
  }),
  defineCheck("V-F-75", {
    states: ["S05"], viewports: P,
    async run(ctx) {
      const m = await ctx.inPage((qa) => {
        const dialog = qa.one("[role=dialog]");
        const canvas = [...(dialog?.querySelectorAll("canvas") ?? [])].find(qa.visible);
        const room = [...(dialog?.querySelectorAll("div") ?? [])].find((el) => el.children.length && qa.txt(el).startsWith("사용 중인 강의실"));
        return { sceneTop: canvas ? Math.round(canvas.getBoundingClientRect().top) : null, roomCardTop: room ? Math.round(room.getBoundingClientRect().top) : null };
      });
      return result(m.sceneTop != null && m.sceneTop <= 160 && m.roomCardTop != null && m.roomCardTop <= 844, m, "scene starts within 160 px of the top; room card within 844 px");
    },
  }),
  defineCheck("V-F-79", {
    states: ["S12"], viewports: ["D", "P"],
    async run(ctx) {
      const readings = [];
      for (let i = 0; i < 10; i += 1) {
        readings.push(await ctx.inPage((qa) => ({
          // The building name without the code badge ("C1 도서관" -> 도서관), like chipByText.
          chip: (() => { const el = qa.all("button[data-qa=campus-label]").find((b) => b.getAttribute("aria-pressed") === "true"); return el ? qa.chipName(el) : null; })(),
          mesh: qa.one("[data-qa=campus-map-layer]")?.getAttribute("data-selected-id") ?? null,
          title: qa.txt(qa.one("[data-qa=selection-inspector] h2,[data-qa=selection-inspector] h3")) || null,
        })));
        await ctx.sleep(500);
      }
      const stable = readings.every((r) => r.chip === "도서관" && r.mesh === "BLD_C1" && r.title === "도서관");
      return result(stable, { first: readings[0], last: readings[readings.length - 1] }, "chip, tinted mesh id and inspector title stay 도서관 (BLD_C1) for 5 s");
    },
  }),
];
