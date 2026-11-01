import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BADGE_TONES, TONE_TEXT_MIX } from "./badgeTones.mjs";

const tokensCss = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

function block(selector) {
  const start = tokensCss.indexOf(`${selector} {`);
  const body = tokensCss.slice(start, tokensCss.indexOf("}", start));
  return new Map([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

const dark = block(":root");
const themes = { dark, light: new Map([...dark, ...block('[data-theme="light"]')]) };

const hex = (value) => {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  assert.ok(match, `expected #rrggbb, got ${value}`);
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, percentA) => a.map((channel, i) => (channel * percentA + b[i] * (100 - percentA)) / 100);

// var(), #hex와 color-mix(in srgb, A p%, B)를 tokens.css 값으로 풀어 sRGB로 만든다.
function resolve(value, tokens) {
  const v = value.trim();
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(v);
  if (ref) return resolve(tokens.get(ref[1]), tokens);
  const mixed = /^color-mix\(in srgb, (.+) (\d+)%, (.+)\)$/.exec(v);
  if (mixed) return mix(resolve(mixed[1], tokens), resolve(mixed[3], tokens), Number(mixed[2]));
  return hex(v);
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const [theme, tokens] of Object.entries(themes)) {
  for (const [tone, spec] of Object.entries(BADGE_TONES)) {
    test(`${theme}: ${tone} badge text on its background clears 4.5:1`, () => {
      const background = spec.semantic ? resolve(`var(${spec.semantic}-wash)`, tokens) : resolve(`var(${spec.background})`, tokens);
      const text = spec.semantic
        ? resolve(`color-mix(in srgb, var(${spec.semantic}) ${TONE_TEXT_MIX}%, var(--colors-ink))`, tokens)
        : resolve(`var(${spec.text})`, tokens);
      const ratio = contrast(text, background);
      assert.ok(ratio >= 4.5, `${theme} ${tone}: ${ratio.toFixed(2)} < 4.5`);
    });
  }
}

test("no tone writes white text on a tone colour", () => {
  for (const spec of Object.values(BADGE_TONES)) assert.notEqual(spec.text, "--colors-on-primary");
});
