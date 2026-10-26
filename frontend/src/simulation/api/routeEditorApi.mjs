export { fetchNetworkQuality } from "./networkApi.mjs";

// 경로 편집기가 불러온 GeoJSON 파일을 Feature 목록으로. JSON이 아니면 SyntaxError를 한국어 문구로 바꿔 던진다.
export async function readGeoJsonFeatures(file) {
  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new SyntaxError("GeoJSON 형식이 아닙니다");
    throw error;
  }
  return payload.type === "FeatureCollection" ? payload.features : [payload];
}
