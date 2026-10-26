import { useEffect } from "react";

// 요소를 inert로 뺀다(React 18은 inert 불리언 속성을 몰라 직접 건다). 닫힌 패널, 또는 열린 패널이 다 덮은 지도처럼
// 보이지 않는 요소가 포커스·클릭·보조 기술 대상에 남지 않게 한다. deps는 ref 대상이 새로 마운트될 수 있는 값이다.
export function useInert(refs, inert, deps = []) {
  useEffect(() => {
    for (const ref of refs) {
      if (!ref.current) continue;
      if (inert) ref.current.setAttribute("inert", "");
      else ref.current.removeAttribute("inert");
    }
  }, [inert, ...deps]);
}
