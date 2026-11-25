import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("default entry remains Main without requiring the VWorld SDK", async () => {
  const [html, appModule] = await Promise.all([
    readFile(new URL("../../index.html", import.meta.url), "utf8"),
    readFile(new URL("../App.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(html, /src="\/src\/index\.jsx"/);
  assert.doesNotMatch(html, /map\.vworld\.kr|VITE_VWORLD_API_KEY/);
  assert.match(appModule, /import\(["']\.\/AppMain["']\)/);
  assert.doesNotMatch(appModule, /AppVWorld/);
});

test("separate VWorld entry bootstraps the SDK before its React app", async () => {
  const html = await readFile(new URL("../../index-vworld.html", import.meta.url), "utf8");
  const boot = html.indexOf('id="vworld-boot-status"');
  const sdk = html.indexOf("https://map.vworld.kr/js/webglMapInit.js.do");
  const app = html.indexOf('src="/src/index-vworld.jsx"');

  assert(boot >= 0, "VWorld index must show a boot status");
  assert(boot < sdk, "boot status must precede the VWorld SDK");
  assert(sdk >= 0, "VWorld index must load the VWorld WebGL SDK");
  assert(app > sdk, "VWorld SDK must load before the VWorld React app entry");
  assert.match(html, /apiKey=%VITE_VWORLD_API_KEY%/);
});

test("VWorld entry's SDK-delay message offers a retry before the SDK script", async () => {
  const html = await readFile(new URL("../../index-vworld.html", import.meta.url), "utf8");
  const inline = html.match(/<script>([\s\S]*?)<\/script>/);
  const sdk = html.indexOf("https://map.vworld.kr/js/webglMapInit.js.do");

  assert(inline, "VWorld index must keep an inline SDK-delay timeout script");
  assert(sdk >= 0, "VWorld index must load the VWorld WebGL SDK");
  assert(inline.index < sdk, "inline timeout script must precede the VWorld SDK script");

  const script = inline[1];
  assert.match(script, /15000/);
  assert.match(script, /VWorld 서버 응답이 지연되고 있습니다\. 네트워크와 API 키를 확인하세요\./);
  assert.match(script, /다시 시도/);
  assert.match(script, /location\.reload/);
});
