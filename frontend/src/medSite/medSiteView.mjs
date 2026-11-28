import { useSyncExternalStore } from "react";

// 캠퍼스와 의대 예정 부지(MedSiteScene.jsx) 중 지금 3D 장면에 띄운 쪽. HUD 단추가 바꾸고 CampusScene이 읽는다.
export function createMedSiteView() {
  let active = false;
  const listeners = new Set();
  const view = {
    isActive: () => active,
    setActive(next) {
      if (next === active) return;
      active = next;
      listeners.forEach((listener) => listener());
    },
    toggle: () => view.setActive(!active),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return view;
}

export const medSiteView = createMedSiteView();

export const useMedSiteActive = () => useSyncExternalStore(medSiteView.subscribe, medSiteView.isActive);
