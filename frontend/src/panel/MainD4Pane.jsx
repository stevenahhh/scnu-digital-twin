import { createPlanDraftFromExisting } from "../features/energy/installations/installationPlanApi.mjs";
import { D4SectionExperience } from "../vworld/D4SectionExperience";

// Main 대시보드의 D4 패인: 편집 요청(에너지 탭의 `배치 편집`)이 있으면 그 건물·시나리오의 배치 편집 단계로 연다.
// 요청 없이 들어와도 건물 단계의 `옥상 태양광 배치` 버튼으로 설치안 관리에 들어간다.
export function MainD4Pane({ flow, selection, plans }) {
  const editor = flow.editorRequest;
  return (
    <D4SectionExperience
      buildingId={editor?.buildingId ?? selection.selectedBuildingId}
      scenarioId={editor?.scenarioId}
      installationPlanId={editor?.installationPlanId}
      startInstallation={Boolean(editor?.scenarioId || editor?.installationPlanId)}
      allowInstallation
      onClose={flow.exitD4Section}
      onPlanSaved={plans.refreshAll}
      createInstallationPlanDraft={createPlanDraftFromExisting}
      onPlansChange={plans.onPlansChange}
      onRepresentativeChange={plans.onRepresentativeChange}
      planRefreshKey={plans.refreshKey}
    />
  );
}
