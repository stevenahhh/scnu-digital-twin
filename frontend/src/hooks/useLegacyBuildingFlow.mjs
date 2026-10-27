import { useCallback, useMemo, useState } from "react";
import commonElements from "../../../common/data/common_elemetns.json";
import { isProximitySuspended, resolveSelectionTitle, useSelectionState as useLabelSelection } from "../labels/useSelectionState.mjs";
import { isD4ElementId } from "../utils/d4BuildingData.mjs";
import { usePanelViewMemory } from "../panel/usePanelViewMemory.mjs";

const buildingCodeOf = (elementId) => elementId.slice("BLD_".length);
const ELEMENT_NAMES = new Map(commonElements.elements.map((element) => [element.element_id, element.name]));

// Legacy 3D 캠퍼스에서 건물을 고르는 흐름: 메시·라벨 클릭, 근접(줌인), D4 상세 진입·복귀, 미기후 탭.
// selection은 useSelectionState, popup은 usePopupData, panel은 { activeTab, setActiveTab, scrollRef, onSelectionShown }이다.
// 탭은 사용자가 고른 것을 지킨다. 미기후 탭만 이 흐름이 열고 닫는다.
// 라벨 층의 선택(labels/useSelectionState)은 무엇을 어떤 경로로 골랐는지를 따로 들고 있다: 클릭·시점·검색으로 고른 건물은
// 근접 자동 선택에 밀리지 않고, 드래그를 시작하거나 선택을 풀면 다시 근접을 따른다. 패널 제목은 그 건물의 레지스트리 이름이다.
// onSectionEnter: D4 패인이 열릴 때(카메라를 D4로 옮긴다), onSectionExit: 닫힐 때.
export function useLegacyBuildingFlow({ selection, popup, panel, activePresetRef, onSectionEnter, onSectionExit }) {
  const [buildingViewMode, setBuildingViewMode] = useState("campus");
  const [editorRequest, setEditorRequest] = useState(null);
  const [labelRegistry, setLabelRegistry] = useState(null);
  const label = useLabelSelection();
  const { activeTab, setActiveTab, scrollRef, onSelectionShown } = panel;
  const viewMemory = usePanelViewMemory({ activeTab, setActiveTab, scrollRef });
  const { highlight, clearSelection, selectedBuildingId } = selection;
  const { select: selectLabel, confirm: confirmLabel, clear: clearLabel, selectionRef } = label;

  const clearAll = useCallback(() => {
    clearSelection();
    clearLabel();
  }, [clearLabel, clearSelection]);

  // selectionSource 'click'이면 같은 클릭이 이미 고른 앵커 id를 두고 경로만 확정한다. 그 밖에는 이 요소를 그 경로로 고른다.
  const selectBuilding = useCallback(({ selectionSource = "list", ...target }) => {
    if (selectionSource === "click") confirmLabel(target.elementId, "click");
    else selectLabel(target.elementId, selectionSource);
    return selection.selectBuilding(target);
  }, [confirmLabel, selectLabel, selection.selectBuilding]);

  // CityModel의 건물·라벨 클릭(name은 GLB 노드 이름, elementId는 라벨 앵커 id). 빈 이름은 선택 해제(Esc)다.
  const handleSelect = useCallback((name, _area, _position, elementId) => {
    highlight(name);
    popup.clear();
    if (name) selectLabel(elementId ?? name, "click");
    else clearLabel();
  }, [clearLabel, highlight, popup.clear, selectLabel]);

  // D4 상세가 열린 동안 셸은 숨고(hidden), 나오면 들어가기 전의 탭·스크롤·패널 열림 상태 그대로 돌아온다.
  const openD4Section = useCallback((request = null) => {
    viewMemory.save();
    setEditorRequest(request);
    clearAll();
    popup.clear();
    setBuildingViewMode("section");
    onSectionEnter?.();
  }, [clearAll, onSectionEnter, popup.clear, viewMemory.save]);

  const exitD4Section = useCallback(() => {
    setBuildingViewMode("campus");
    setEditorRequest(null);
    viewMemory.restore();
    onSectionExit();
  }, [onSectionExit, viewMemory.restore]);

  // 고른 건물은 선택 인스펙터가 보여 준다. 탭은 바꾸지 않는다(폰에서는 시트를 half로 올린다).
  const showMicroclimate = useCallback((elementId) => {
    onSelectionShown?.();
    return popup.load(elementId);
  }, [onSelectionShown, popup.load]);

  const handleBuildingClick = useCallback((obj) => {
    const elementId = obj?.parent?.name && obj.parent.name !== "Scene" ? obj.parent.name : obj?.name;
    if (!elementId || !elementId.startsWith("BLD_")) {
      popup.clear();
      return undefined;
    }
    const buildingId = buildingCodeOf(elementId);
    selectBuilding({
      elementId,
      buildingId,
      displayName: obj?.userData?.buildingName ?? obj?.name ?? buildingId,
      title: obj?.userData?.buildingLabel ?? obj?.userData?.buildingName ?? obj?.name ?? buildingId,
      estimate: obj?.userData?.estimate ?? null,
      selectionSource: "click",
    });
    if (isD4ElementId(elementId)) {
      openD4Section();
      return undefined;
    }
    return showMicroclimate(elementId);
  }, [openD4Section, popup.clear, selectBuilding, showMicroclimate]);

  const handleD4Enter = useCallback(() => {
    if (buildingViewMode === "campus") openD4Section();
  }, [buildingViewMode, openD4Section]);

  // 카메라가 건물에 가까이 가면(자유 줌·궤도) 그 건물을 인스펙터로 연다. 기본 현황 탭에서만 그렇게 하고,
  // 시점 버튼으로 간 자리나 사용자가 직접 고른 건물이 있는 동안에는 열거나 닫지 않는다. 모든 건물에서 멀어지면 닫는다.
  const handleBuildingProximity = useCallback((anchor) => {
    if (anchor && activePresetRef.current) return;
    if (isProximitySuspended(selectionRef.current)) return;
    if (!anchor) {
      // 탭은 사용자만 바꾼다. 멀어지면 선택만 푼다.
      if (selection.selectedId) {
        clearAll();
        popup.clear();
      }
      return;
    }
    const { elementId } = anchor;
    if (!elementId?.startsWith("BLD_") || isD4ElementId(elementId) || buildingViewMode !== "campus") return;
    if (activeTab !== "dashboard") return;
    const buildingId = buildingCodeOf(elementId);
    if (selection.selectedId && selectedBuildingId === buildingId) return;
    selectBuilding({
      elementId,
      buildingId,
      displayName: anchor.displayName ?? anchor.name ?? buildingId,
      estimate: anchor.estimate ?? null,
      selectionSource: "proximity",
    });
    showMicroclimate(elementId);
  }, [activePresetRef, activeTab, buildingViewMode, clearAll, popup.clear, selectBuilding,
    selectedBuildingId, selection.selectedId, selectionRef, showMicroclimate]);

  // 공유 링크로 연 건물: 평소 고르기와 같은 길(인스펙터, D4는 패인)로 연다.
  const selectFromUrl = useCallback((elementId) => {
    selectBuilding({ elementId, buildingId: buildingCodeOf(elementId), displayName: ELEMENT_NAMES.get(elementId) ?? elementId, selectionSource: "url" });
    if (isD4ElementId(elementId)) openD4Section();
    else showMicroclimate(elementId);
  }, [openD4Section, selectBuilding, showMicroclimate]);

  // 인스펙터 닫기(닫기 버튼, Esc): 선택만 푼다. 탭은 그대로다.
  const closeMicroclimate = useCallback(() => {
    clearAll();
    popup.clear();
  }, [clearAll, popup.clear]);

  const selectedElementId = label.selection.elementId;
  // 마우스를 올린 칩에 붙일 대표 추정값: 이미 받아 둔 선택 건물의 팝업 값만 쓴다(요청을 더 하지 않는다).
  const localTemp = popup.data?.thermal?.local_temp;
  const headlineById = useMemo(
    () => (selectedElementId && Number.isFinite(localTemp) ? { [selectedElementId]: `추정 ${localTemp.toFixed(1)}°C` } : null),
    [localTemp, selectedElementId],
  );

  return {
    buildingViewMode, editorRequest, selectBuilding, selectFromUrl, handleSelect, openD4Section, exitD4Section,
    handleBuildingClick, handleD4Enter, handleBuildingProximity, closeMicroclimate,
    selectedElementId, headlineById, setLabelRegistry, releaseOnDrag: label.releaseOnDrag,
    selectionPosition: labelRegistry?.get(selectedElementId)?.position ?? null,
    selectionTitle: resolveSelectionTitle(labelRegistry, selectedElementId, ELEMENT_NAMES),
  };
}
