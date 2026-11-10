import { createPlanDraftFromExisting } from "../features/energy/installations/installationPlanApi.mjs";
import { D4SectionExperience } from "../vworld/D4SectionExperience";

// Legacy 대시보드의 D4 패인: 편집 요청(에너지 탭의 `배치 편집`)이 있으면 그 건물·시나리오의 배치 편집 단계로 연다.
export function LegacyD4Pane({ flow, selection, plans }) {
  const editor = flow.editorRequest;
  return (
    <D4SectionExperience
      buildingId={editor?.buildingId ?? selection.selectedBuildingId}
      scenarioId={editor?.scenarioId}
      installationPlanId={editor?.installationPlanId}
      startInstallation={Boolean(editor?.scenarioId || editor?.installationPlanId)}
      onClose={flow.exitD4Section}
      onPlanSaved={plans.refreshAll}
      createInstallationPlanDraft={createPlanDraftFromExisting}
      onPlansChange={plans.onPlansChange}
      onRepresentativeChange={plans.onRepresentativeChange}
      planRefreshKey={plans.refreshKey}
    />
  );
}
