import assert from "node:assert/strict";
import test from "node:test";

let loaderModuleVersion = 0;

function importFreshVWorldSdkLoader() {
  loaderModuleVersion += 1;
  return import(`./webglSdkLoader.mjs?test=${loaderModuleVersion}`);
}

test("loads VWorld only from the parsing-time bootstrap", async (context) => {
  const hadWindow = "window" in globalThis;
  const initialWindow = globalThis.window;
  const hadDocument = "document" in globalThis;
  const initialDocument = globalThis.document;

  try {
    await context.test("rejects missing and unresolved placeholder keys", async () => {
      const { loadVWorldWebGlSdk } = await importFreshVWorldSdkLoader();

      await assert.rejects(
        loadVWorldWebGlSdk(""),
        {
          code: "VWORLD_KEY_MISSING",
          message: "VWorld API 키가 없습니다. frontend/.env 에 VITE_VWORLD_API_KEY 를 설정하세요.",
        },
      );
      await assert.rejects(loadVWorldWebGlSdk("%VITE_VWORLD_API_KEY%"), {
        code: "VWORLD_KEY_MISSING",
      });
    });

    await context.test("rejects when the SDK is absent after bootstrap", async () => {
      globalThis.window = { location: { host: "localhost:5173" } };
      delete globalThis.document;

      const { loadVWorldWebGlSdk } = await importFreshVWorldSdkLoader();

      await assert.rejects(
        loadVWorldWebGlSdk("test-browser-key"),
        {
          code: "VWORLD_SDK_UNAVAILABLE",
          message: "VWorld SDK를 불러오지 못했습니다. 네트워크를 확인하세요.",
        },
      );
    });

    await context.test("rejects an invalid key with the SDK error message", async () => {
      globalThis.window = {
        vworldIsValid: "false",
        vworldErrMsg: "등록되지 않은 키",
        vw: Object.freeze({}),
      };

      const { loadVWorldWebGlSdk } = await importFreshVWorldSdkLoader();

      await assert.rejects(loadVWorldWebGlSdk("test-browser-key"), {
        code: "VWORLD_KEY_INVALID",
        message: "VWorld API 키가 유효하지 않습니다: 등록되지 않은 키",
      });
    });

    await context.test("returns the SDK that was bootstrapped during parsing", async () => {
      const bootstrappedSdk = Object.freeze({});
      globalThis.window = { vw: bootstrappedSdk };

      const { loadVWorldWebGlSdk } = await importFreshVWorldSdkLoader();

      assert.equal(
        await loadVWorldWebGlSdk("test-browser-key"),
        bootstrappedSdk,
      );
    });
  } finally {
    if (hadWindow) {
      globalThis.window = initialWindow;
    } else {
      delete globalThis.window;
    }

    if (hadDocument) {
      globalThis.document = initialDocument;
    } else {
      delete globalThis.document;
    }
  }
});
