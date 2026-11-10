// 발표 모드에 들어가기 직전의 화면 배치(패널 열림, 시트 단계, 탭)를 기억했다가 나올 때 그대로 되돌린다.
// 발표 모드 자체는 저장하지 않는다(새로 고치면 늘 일반 화면이다).
export function capturePresentationLayout({ panelOpen, detent, activeTab }) {
  return Object.freeze({ panelOpen: Boolean(panelOpen), detent: detent ?? "peek", activeTab: activeTab ?? "status" });
}

export function restorePresentationLayout(snapshot, { setPanelOpen, setDetent, setActiveTab }) {
  if (!snapshot) return false;
  setPanelOpen(snapshot.panelOpen);
  setDetent(snapshot.detent);
  setActiveTab(snapshot.activeTab);
  return true;
}

// 키 입력이 글자 입력 칸에서 왔으면 단축키로 쓰지 않는다.
export function isTypingTarget(target) {
  if (!target || typeof target !== "object") return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

// 투어 중 점 표시의 위치: 지금 시점이 시점 목록에서 몇 번째인지(1부터). 목록에 없으면 null.
export function tourPosition(presets, activeId) {
  const index = presets.findIndex((preset) => preset.id === activeId);
  return index < 0 ? null : { current: index + 1, total: presets.length };
}
