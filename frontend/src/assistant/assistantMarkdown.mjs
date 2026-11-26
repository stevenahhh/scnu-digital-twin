// 도우미 답변 렌더링: 본문은 마크다운, 모델이 ```html 블록으로 보낸 자료는 스크립트 없는 iframe 카드로 그린다.
import DOMPurify from "dompurify";
import { marked } from "marked";

const HTML_FENCE = /```html[^\n]*\n([\s\S]*?)(```|$)/g;

// 본문 마크다운에는 인라인 스타일·이미지·양식을 허용하지 않는다. 꾸민 자료는 카드(격리된 문서)로만 들어온다.
const MARKDOWN_POLICY = {
  FORBID_TAGS: ["style", "img", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"],
  FORBID_ATTR: ["style", "class", "id"],
};
// 카드 문서는 sandbox iframe 안에서만 열린다. 스크립트·외부 자원·양식은 여기서 한 번 더 걷어 낸다.
const CARD_POLICY = {
  // FORCE_BODY: 조각 맨 앞의 <style>을 DOMPurify가 버리지 않게 한다.
  FORCE_BODY: true,
  ADD_TAGS: ["style"],
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "link", "meta", "base"],
  FORBID_ATTR: ["srcset"],
};

let hooked = false;
function sanitizer() {
  if (!hooked) {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      const src = node.getAttribute?.("src");
      if (src && !src.startsWith("data:image/")) node.removeAttribute("src");
    });
    hooked = true;
  }
  return DOMPurify;
}

export function markdownToHtml(markdown) {
  const html = marked.parse(markdown, { gfm: true, breaks: true, async: false });
  return sanitizer().sanitize(html, MARKDOWN_POLICY);
}

export function sanitizeCardHtml(html) {
  return sanitizer().sanitize(html, CARD_POLICY);
}

// text -> [{ type: "markdown", html } | { type: "card", html, complete }]. 닫히지 않은 블록은 스트리밍 중인 카드다.
export function splitAnswer(text) {
  const segments = [];
  let last = 0;
  for (const match of (text ?? "").matchAll(HTML_FENCE)) {
    const before = text.slice(last, match.index);
    if (before.trim()) segments.push({ type: "markdown", html: markdownToHtml(before) });
    segments.push({ type: "card", html: sanitizeCardHtml(match[1]), complete: match[2] === "```" });
    last = match.index + match[0].length;
  }
  const rest = (text ?? "").slice(last);
  if (rest.trim()) segments.push({ type: "markdown", html: markdownToHtml(rest) });
  return segments;
}

// 카드 문서: 외부 요청을 모두 막는 CSP와, 대시보드 글꼴·색을 이어받는 기본 스타일.
// 모델은 아래 CSS 변수로 색을 고르므로(프롬프트 Format 절) 같은 카드가 밝은·어두운 테마에 모두 맞는다.
export function cardDocument(html, { color = "CanvasText", font = "system-ui, sans-serif", accent = "royalblue", scheme = "dark" } = {}) {
  const vars = `--fg:${color};--muted:color-mix(in srgb,${color} 62%,transparent);--surface:color-mix(in srgb,${color} 7%,transparent);`
    + `--line:color-mix(in srgb,${color} 16%,transparent);--accent:${accent};--ok:mediumseagreen;--warn:goldenrod;--danger:tomato`;
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`
    + `<meta name="color-scheme" content="${scheme}"><style>:root{${vars};color-scheme:${scheme}}html,body{margin:0;background:transparent}body{color:var(--fg);font:14px/1.55 ${font};overflow:hidden;word-break:keep-all;overflow-wrap:anywhere}`
    + `table{border-collapse:collapse}*{box-sizing:border-box;max-width:100%}</style></head><body>${html}</body></html>`;
}
