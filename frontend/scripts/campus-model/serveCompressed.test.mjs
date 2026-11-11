import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { brotliCompressSync } from "node:zlib";
import { chooseEncoding, precompressedAssetMiddleware } from "./serveCompressed.mjs";

describe("chooseEncoding", () => {
  const fresh = { br: 200, gz: 200 };
  it("prefers brotli, then gzip, when the client accepts it and the copy is not older than the source", () => {
    assert.equal(chooseEncoding("gzip, deflate, br", 100, fresh), "br");
    assert.equal(chooseEncoding("gzip", 100, fresh), "gz");
    assert.equal(chooseEncoding("identity", 100, fresh), null);
    assert.equal(chooseEncoding(undefined, 100, fresh), null);
  });
  it("skips a missing or stale copy", () => {
    assert.equal(chooseEncoding("br, gzip", 100, { br: null, gz: 200 }), "gz");
    assert.equal(chooseEncoding("br, gzip", 300, { br: 200, gz: 200 }), null);
  });
  it("honours q=0", () => {
    assert.equal(chooseEncoding("br;q=0, gzip", 100, fresh), "gz");
  });
});

function fakeResponse() {
  const headers = {};
  const chunks = [];
  let resolveEnd;
  const ended = new Promise((resolve) => { resolveEnd = resolve; });
  return {
    headers, chunks, ended, statusCode: 200,
    setHeader(name, value) { headers[name.toLowerCase()] = String(value); },
    end(chunk) { if (chunk) chunks.push(Buffer.from(chunk)); resolveEnd(); },
  };
}

describe("precompressedAssetMiddleware", () => {
  it("streams the .br copy with the encoding, the original size for progress, and the source content type", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scnu-precompressed-"));
    try {
      const source = Buffer.from("x".repeat(5000));
      writeFileSync(path.join(dir, "campus-v2.glb"), source);
      writeFileSync(path.join(dir, "campus-v2.glb.br"), brotliCompressSync(source));
      const middleware = precompressedAssetMiddleware(dir, ["campus-v2.glb"]);
      const response = fakeResponse();
      let nextCalled = false;
      middleware({ method: "GET", url: "/campus-v2.glb?v=1", headers: { "accept-encoding": "gzip, br" } }, response, () => { nextCalled = true; });
      await response.ended;
      assert.equal(nextCalled, false);
      assert.equal(response.headers["content-encoding"], "br");
      assert.equal(response.headers["x-file-size"], "5000");
      assert.equal(response.headers["content-type"], "model/gltf-binary");
      assert.equal(response.headers.vary, "Accept-Encoding");
      assert.deepEqual(Buffer.concat(response.chunks), brotliCompressSync(source));
      assert.match(response.headers.etag, /^W\/"br-/);

      const revalidated = fakeResponse();
      middleware({ method: "GET", url: "/campus-v2.glb", headers: { "accept-encoding": "br", "if-none-match": response.headers.etag } }, revalidated, () => {});
      await revalidated.ended;
      assert.equal(revalidated.statusCode, 304);
      assert.equal(Buffer.concat(revalidated.chunks).length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes other files, stale copies and clients without the encoding to the next handler", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scnu-precompressed-"));
    try {
      writeFileSync(path.join(dir, "campus-v2.glb"), "a");
      writeFileSync(path.join(dir, "campus-v2.glb.gz"), "b");
      const old = new Date(Date.now() - 60_000);
      utimesSync(path.join(dir, "campus-v2.glb.gz"), old, old);
      const middleware = precompressedAssetMiddleware(dir, ["campus-v2.glb"]);
      let passed = 0;
      const next = () => { passed += 1; };
      middleware({ method: "GET", url: "/other.glb", headers: { "accept-encoding": "br" } }, fakeResponse(), next);
      middleware({ method: "GET", url: "/campus-v2.glb", headers: { "accept-encoding": "gzip" } }, fakeResponse(), next);
      middleware({ method: "GET", url: "/campus-v2.glb", headers: {} }, fakeResponse(), next);
      middleware({ method: "POST", url: "/campus-v2.glb", headers: { "accept-encoding": "gzip" } }, fakeResponse(), next);
      // vite module requests (?url, ?import) keep vite's own handling
      writeFileSync(path.join(dir, "campus-v2.glb.gz"), "c");
      middleware({ method: "GET", url: "/campus-v2.glb?url", headers: { "accept-encoding": "gzip" } }, fakeResponse(), next);
      assert.equal(passed, 5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
