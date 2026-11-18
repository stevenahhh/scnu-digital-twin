import { Search } from "lucide-react";
import { Button } from "../ui/Button.jsx";

const focusSearch = () => document.querySelector("[data-qa=search-field] input")?.focus();

// 건물 탭의 빈 상태: 고른 건물이 없을 때 다음 동작(지도에서 누르기, 검색)을 알린다.
export function BuildingEmptyState() {
  return (
    <div data-qa="building-empty" className="flex flex-col items-start gap-3 py-2">
      <p className="break-keep text-body text-ink-muted">지도에서 건물을 누르거나 검색하세요</p>
      <Button size="sm" variant="secondary" icon={<Search aria-hidden="true" className="h-4 w-4" />} onClick={focusSearch}>
        건물 검색
      </Button>
    </div>
  );
}
