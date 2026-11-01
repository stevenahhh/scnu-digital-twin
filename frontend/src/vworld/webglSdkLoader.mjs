export function loadVWorldWebGlSdk(apiKey) {
  if (!apiKey?.trim() || apiKey.includes("%VITE_")) {
    const error = new Error(
      "VWorld API 키가 없습니다. frontend/.env 에 VITE_VWORLD_API_KEY 를 설정하세요.",
    );
    error.code = "VWORLD_KEY_MISSING";
    return Promise.reject(error);
  }

  const win = globalThis.window;
  if (win?.vworldIsValid === "false") {
    const error = new Error(
      `VWorld API 키가 유효하지 않습니다: ${win.vworldErrMsg ?? ""}`,
    );
    error.code = "VWORLD_KEY_INVALID";
    return Promise.reject(error);
  }

  const vworldSdk = win?.vw;
  if (!vworldSdk) {
    const error = new Error(
      "VWorld SDK를 불러오지 못했습니다. 네트워크를 확인하세요.",
    );
    error.code = "VWORLD_SDK_UNAVAILABLE";
    return Promise.reject(error);
  }

  return Promise.resolve(vworldSdk);
}
