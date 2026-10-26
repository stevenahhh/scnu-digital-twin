import { CAMERA_PRESETS } from "../camera/cameraPresets.mjs";
import { createPlanDraftFromExisting } from "../features/energy/installations/installationPlanApi.mjs";
import { D4SectionExperience } from "../vworld/D4SectionExperience";

// Legacy 대시보드의 D4 패인: 편집 요청(에너지 탭의 추천·계획)이 있으면 그 건물·시나리오로 열고, 폰에서는 캠퍼스 시점 줄을 함께 둔다.
export function LegacyD4Pane({ flow, selection, plans, camera, phone }) {
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
      presets={phone ? CAMERA_PRESETS : null}
      onSelectPreset={(preset) => {
        flow.exitD4Section();
        camera.selectPreset(preset);
      }}
    />
  );
}
