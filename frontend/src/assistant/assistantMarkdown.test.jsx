/* @vitest-environment jsdom */
import { expect, it } from "vitest";
import { cardDocument, markdownToHtml, splitAnswer } from "./assistantMarkdown.mjs";

it("renders markdown and strips scripts, styles and handlers", () => {
  const html = markdownToHtml("**굵게**\n\n- 하나\n- 둘\n\n<script>alert(1)</script><span style=\"position:fixed\" onclick=\"x()\">a</span>");
  expect(html).toContain("<strong>굵게</strong>");
  expect(html).toContain("<li>하나</li>");
  expect(html).not.toMatch(/script|onclick|style=/);
});

it("opens links in a new tab without opener access", () => {
  expect(markdownToHtml("[지도](https://example.com)")).toContain('target="_blank" rel="noopener noreferrer"');
});

it("splits html fences into sanitised cards and marks an unfinished fence", () => {
  const segments = splitAnswer("요약입니다.\n\n```html\n<div style=\"color:red\">표</div><script>x()</script>\n```\n\n끝.\n\n```html\n<table><tr><td>1");
  expect(segments.map((s) => s.type)).toEqual(["markdown", "card", "markdown", "card"]);
  expect(segments[1].html).toContain('style="color:red"');
  expect(segments[1].html).not.toContain("script");
  expect(segments[1].complete).toBe(true);
  expect(segments[3].complete).toBe(false);
});

it("drops remote images from cards but keeps inline data images", () => {
  const [card] = splitAnswer('```html\n<img src="https://tracker.test/a.png"><img src="data:image/png;base64,AA==">\n```');
  expect(card.html).not.toContain("tracker.test");
  expect(card.html).toContain("data:image/png");
});

it("keeps a leading style element in a card", () => {
  const [card] = splitAnswer("```html\n<style>.bar{background:var(--accent)}</style><div class=\"bar\">A</div>\n```");
  expect(card.html).toContain("<style>.bar{background:var(--accent)}</style>");
  expect(card.html).toContain('class="bar"');
});

it("card documents forbid every remote request", () => {
  expect(cardDocument("<p>a</p>")).toContain("default-src 'none'");
});
