import { FileLoader } from "three";
import { CAMPUS_MODEL_URL } from "../campusModelAsset.mjs";
import { campusLoad } from "./campusLoad.mjs";

// 모델의 바이트 진행률. 같은 URL을 FileLoader로 요청하면 three가 진행 중인 요청에 콜백을 합친다(중복 요청 없음).
// 받은 값은 로딩 화면이 쓰는 campusLoad에도 넣는다.
export function tapCampusModelBytes({ onProgress, onLoad } = {}) {
  const loader = new FileLoader();
  loader.setResponseType("arraybuffer");
  loader.load(
    CAMPUS_MODEL_URL,
    () => {
      campusLoad.reportDownloaded();
      onLoad?.();
    },
    (event) => {
      campusLoad.reportBytes(event.loaded, event.total);
      onProgress?.(event);
    },
    () => {},
  );
}
