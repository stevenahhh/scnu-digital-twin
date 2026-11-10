import { useEffect, useState } from "react";
import { GitCompare, X } from "lucide-react";
import { Button } from "../ui/Button.jsx";
import { EstimateValue } from "../ui/EstimateValue.jsx";
import { ExportActions } from "../ui/ExportActions.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { COMPARISON_NEEDS_TWO } from "../state/useComparisonSet.mjs";
import { cachedPopup, loadPopupOnce } from "../state/popupCache.mjs";
import commonElements from "../../../common/data/common_elemetns.json";

const NAMES = new Map(commonElements.elements.map((element) => [element.element_id, element.name]));
const registryName = (id) => NAMES.get(id) ?? id;

// 비교하는 대표 추정값(행). 모두 미기후 모델의 추정이다.
export const COMPARISON_METRICS = Object.freeze([
  { key: "local", label: "국지 기온", unit: "°C", read: (popup) => popup?.thermal?.local_temp },
  { key: "feels", label: "체감", unit: "°C", read: (popup) => popup?.thermal?.feels_like },
  { key: "solar", label: "일사(복사)", unit: "", read: (popup) => popup?.factors?.radiation?.level },
  { key: "wind", label: "통풍", unit: "", read: (popup) => popup?.factors?.wind?.level },
]);

const codeOf = (id) => (id.startsWith("BLD_") ? id.slice(4) : id);

// 건물마다 팝업 하나(인스펙터와 같은 요청, 공용 캐시). 이미 받은 건물은 다시 묻지 않는다.
function useComparisonPopups(ids) {
  const [popups, setPopups] = useState(() => Object.fromEntries(ids.map((id) => [id, cachedPopup(id)])));
  useEffect(() => {
    let active = true;
    for (const id of ids) {
      loadPopupOnce(id).then(
        (data) => active && setPopups((previous) => ({ ...previous, [id]: data })),
        () => active && setPopups((previous) => ({ ...previous, [id]: { failed: true } })),
      );
    }
    return () => {
      active = false;
    };
  }, [ids]);
  return popups;
}

// 건물 2~3개의 추정값을 나란히 놓은 표. 표는 글자를 고를 수 있고, 표로 복사·CSV 저장으로 내보낸다.
export function ComparisonPane({ ids, nameOf = registryName, onRemove, onClose }) {
  const popups = useComparisonPopups(ids);
  const columns = [
    { key: "name", label: "건물" },
    ...COMPARISON_METRICS.map((metric) => ({ key: metric.key, label: metric.unit ? `${metric.label}(${metric.unit})` : metric.label, estimated: true })),
  ];
  const rows = ids.map((id) => ({ name: `${nameOf(id)} (${codeOf(id)})`, ...Object.fromEntries(COMPARISON_METRICS.map((metric) => [metric.key, metric.read(popups[id]) ?? null])) }));

  return (
    <section data-qa="comparison-pane" aria-label="건물 비교" className="flex flex-col gap-3 select-text">
      <div className="flex items-start justify-between gap-2">
        <SectionHeader level={3} title="건물 비교" badge={<StatusBadge tone="estimate">추정</StatusBadge>} />
        <Button variant="ghost" iconOnly label="비교 닫기" icon={<X aria-hidden="true" className="h-4 w-4" />} onClick={onClose} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-caption">
          <thead>
            <tr>
              <th scope="col" className="py-1 pr-2 font-medium text-ink-muted">항목</th>
              {ids.map((id) => (
                <th key={id} scope="col" className="py-1 pr-2 align-top font-semibold text-ink">
                  <span className="flex flex-wrap items-center gap-1">
                    {nameOf(id)}
                    <StatusBadge tone="neutral">{codeOf(id)}</StatusBadge>
                    <Button size="sm" variant="ghost" iconOnly label={`${nameOf(id)} 비교에서 빼기`} icon={<X aria-hidden="true" className="h-3.5 w-3.5" />} onClick={() => onRemove(id)} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARISON_METRICS.map((metric) => (
              <tr key={metric.key} className="border-t border-hairline">
                <th scope="row" className="py-2 pr-2 font-medium text-ink-muted">{metric.label}</th>
                {ids.map((id) => (
                  <td key={id} className="py-2 pr-2 text-body">
                    {popups[id]?.failed
                      ? <span className="text-caption text-ink-muted">불러오지 못했습니다</span>
                      : <EstimateValue value={popups[id] ? metric.read(popups[id]) : null} unit={metric.unit || undefined} source="미기후 모델" emptyLabel={popups[id] ? "데이터 없음" : "가져오는 중"} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ExportActions kind="comparison" rows={rows} columns={columns} />
    </section>
  );
}

// 인스펙터 안의 비교 열기 단추(비교 대상이 하나 이상일 때만 부르는 쪽이 그린다): 건물 2개 이상이 모이기 전에는 흐리게 두고
// 까닭을 title과 aria-describedby로 알린다. 넷째 추가 거절도 여기 알린다.
export function CompareButton({ comparison, className = "" }) {
  const reasonId = "comparison-reason";
  const disabled = !comparison.canCompare;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Button
        size="sm"
        data-qa="compare-open"
        icon={<GitCompare aria-hidden="true" className="h-4 w-4" />}
        disabled={disabled}
        disabledReason={COMPARISON_NEEDS_TWO}
        aria-describedby={disabled ? reasonId : undefined}
        onClick={() => comparison.setOpen(true)}
      >
        {`비교 열기 (${comparison.ids.length})`}
      </Button>
      <span id={reasonId} className="sr-only text-caption">{disabled ? COMPARISON_NEEDS_TWO : ""}</span>
      <span role="status" className="text-caption text-ink-muted">{comparison.status}</span>
    </span>
  );
}
