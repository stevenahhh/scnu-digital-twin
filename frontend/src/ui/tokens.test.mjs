import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { EMERGENCY_HEX, SELECTION_HEX, VEHICLE_LANE_HEX } from "./sceneTokens.mjs";

const require = createRequire(import.meta.url);
const tokensCss = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const designDoc = readFileSync(new URL("../../../DESIGN.md", import.meta.url), "utf8");

function declarations(selector) {
  const start = tokensCss.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} block missing in tokens.css`);
  const body = tokensCss.slice(start, tokensCss.indexOf("}", start));
  return new Map([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

const dark = declarations(":root");
const light = new Map([...dark, ...declarations('[data-theme="light"]')]);
const lightOverrides = declarations('[data-theme="light"]');

function hexToRgb(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(match, `expected a #rrggbb value, got ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background) {
  const [hi, lo] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

test("every colour that DESIGN.md gives different dark and light values has a light-theme override", () => {
  const rows = [...designDoc.matchAll(/^\|[^|\n]*\|\s*`(--colors-[a-z0-9-]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/gm)];
  assert.ok(rows.length > 0, "no colour rows found in DESIGN.md");
  for (const [, name, darkValue, lightValue] of rows) {
    if (darkValue.toLowerCase() === lightValue.toLowerCase()) continue;
    assert.ok(dark.has(name), `${name} is documented but not declared in :root`);
    assert.ok(lightOverrides.has(name), `${name} differs between themes in DESIGN.md but has no [data-theme="light"] value`);
  }
});

for (const [theme, values] of [["dark", dark], ["light", light]]) {
  for (const ink of ["ink", "ink-muted", "ink-subtle", "semantic-success", "semantic-warning", "semantic-danger"]) {
    test(`${theme}: --colors-${ink} on --colors-surface-1 clears 4.5:1`, () => {
      const ratio = contrast(values.get(`--colors-${ink}`), values.get("--colors-surface-1"));
      assert.ok(ratio >= 4.5, `${theme} --colors-${ink} on --colors-surface-1 is ${ratio.toFixed(2)} < 4.5`);
    });
  }
  test(`${theme}: --colors-on-primary on --colors-primary clears 4.5:1`, () => {
    const ratio = contrast(values.get("--colors-on-primary"), values.get("--colors-primary"));
    assert.ok(ratio >= 4.5, `${theme} --colors-on-primary on --colors-primary is ${ratio.toFixed(2)} < 4.5`);
  });
}

test("scene colours repeat their tokens", () => {
  assert.equal(SELECTION_HEX, dark.get("--colors-primary"));
  assert.equal(EMERGENCY_HEX, dark.get("--colors-emergency"));
  assert.equal(VEHICLE_LANE_HEX, dark.get("--colors-vehicle-lane"));
});

test("the emergency colour is a status colour, not the accent", () => {
  assert.notEqual(dark.get("--colors-emergency").toLowerCase(), dark.get("--colors-primary").toLowerCase());
  assert.notEqual(VEHICLE_LANE_HEX.toLowerCase(), SELECTION_HEX.toLowerCase());
});

for (const [theme, values] of [["dark", dark], ["light", light]]) {
  for (const token of ["emergency", "vehicle-lane"]) {
    test(`${theme}: scene colour --colors-${token} clears 3:1 against --colors-canvas`, () => {
      const ratio = contrast(values.get(`--colors-${token}`), values.get("--colors-canvas"));
      assert.ok(ratio >= 3, `${theme} --colors-${token} on --colors-canvas is ${ratio.toFixed(2)} < 3`);
    });
  }
}

test("the retired tokens are gone", () => {
  // 이름을 조각으로 적어, 계획의 rg 검사가 이 테스트 파일 자체를 잡지 않게 한다.
  const retired = [["inverse", ""], ["brand", "secure"], ["semantic", "overlay"], ["ink", "tertiary"], ["hairline", "tertiary"], ["surface", "4"], ["spacing", "section"]];
  for (const name of retired.map((parts) => parts.join("-"))) {
    assert.ok(!tokensCss.includes(name), `tokens.css still declares ${name}`);
  }
});

test("the Tailwind theme exposes only token-backed colours", () => {
  const config = require("../../tailwind.config.js");
  assert.deepEqual(Object.keys(config.theme.colors).sort(), [
    "canvas", "current", "danger", "hairline", "hairline-strong", "ink", "ink-muted", "ink-subtle",
    "on-primary", "primary", "primary-hover", "success", "surface-1", "surface-2", "surface-3", "transparent", "warning",
  ]);
  for (const [name, value] of Object.entries(config.theme.colors)) {
    if (name === "transparent" || name === "current") continue;
    const token = /^var\((--colors-[a-z0-9-]+)\)$/.exec(value)?.[1];
    assert.ok(token && dark.has(token), `Tailwind colour ${name} must point at a declared token, got ${value}`);
  }
});
