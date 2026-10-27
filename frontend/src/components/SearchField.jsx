import { useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cx } from "../ui/cx.mjs";
import { SEARCH_GROUPS, groupOf, searchBuildings, suggestBuilding } from "../labels/searchIndex.mjs";

export const RECENT_SEARCHES_KEY = "scnu.recentSearches";
const RECENT_LIMIT = 5;

function readRecents(storage) {
  try {
    const value = JSON.parse(storage?.getItem(RECENT_SEARCHES_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id) => typeof id === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function writeRecents(storage, ids) {
  try {
    storage?.setItem(RECENT_SEARCHES_KEY, JSON.stringify(ids.slice(0, RECENT_LIMIT)));
  } catch {
    // 저장소를 못 쓰면(사생활 보호 모드) 최근 검색만 빠진다.
  }
}

// 건물 검색칸: 이름·짧은 이름·코드·별칭으로 찾는 콤보박스. 결과는 계층별(주요 건물·건물·부속 시설·구역)로 묶고 최대 8개.
// 칸에 포커스가 오면 최근 검색 5개를 보인다. Enter나 결과 클릭은 칩을 누른 것과 같은 선택(onPick(entry))이다.
// registry: buildLabelRegistry 결과(Map) 또는 항목 배열. 지도에서 / 키를 누르면 이 칸으로 온다(useCameraKeys).
export function SearchField({ registry, onPick, className = "", storage = globalThis.localStorage }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [recentIds, setRecentIds] = useState(() => readRecents(storage));
  const inputRef = useRef(null);
  const listId = useId();

  const byId = useMemo(() => {
    const list = registry instanceof Map ? [...registry.values()] : registry ?? [];
    return new Map(list.map((entry) => [entry.elementId, entry]));
  }, [registry]);
  const trimmed = query.trim();
  const results = useMemo(
    () => (trimmed ? searchBuildings(trimmed, registry) : recentIds.map((id) => byId.get(id)).filter(Boolean)),
    [byId, recentIds, registry, trimmed],
  );
  const suggestion = trimmed && results.length === 0 ? suggestBuilding(trimmed, registry) : null;
  // 화면에 그리는 순서(묶음 순서) 그대로 위아래 키가 움직인다.
  const groups = trimmed
    ? SEARCH_GROUPS.map((group) => ({ ...group, items: results.filter((entry) => groupOf(entry) === group.id) })).filter((g) => g.items.length > 0)
    : results.length > 0 ? [{ id: "recent", label: "최근 검색", items: results }] : [];
  const ordered = groups.flatMap((group) => group.items);
  const expanded = open && (ordered.length > 0 || Boolean(trimmed));
  const optionId = (index) => `${listId}-option-${index}`;

  const pick = (entry) => {
    if (!entry) return;
    const next = [entry.elementId, ...recentIds.filter((id) => id !== entry.elementId)].slice(0, RECENT_LIMIT);
    setRecentIds(next);
    writeRecents(storage, next);
    setQuery("");
    setOpen(false);
    setActive(0);
    onPick?.(entry);
  };

  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (ordered.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + ordered.length) % ordered.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(ordered[Math.min(active, ordered.length - 1)]);
    } else if (event.key === "Escape") {
      if (query || open) {
        event.preventDefault();
        event.stopPropagation();
        setQuery("");
        setOpen(false);
      }
    }
  };

  let index = -1;
  return (
    <div data-qa="search-field" className={cx("pointer-events-auto relative w-[min(18rem,calc(100vw-2rem))]", className)}>
      <div className="flex h-11 items-center gap-2 rounded-control border border-hairline bg-surface-1 px-3 shadow-popover sm:h-9">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="건물 검색"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && ordered.length > 0 ? optionId(Math.min(active, ordered.length - 1)) : undefined}
          aria-keyshortcuts="/"
          placeholder="건물 이름, 코드 (예: 도서관, D4)"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-muted focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            aria-label="검색어 지우기"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-control text-ink-muted hover:text-ink sm:h-8 sm:w-8"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label="검색 결과"
        hidden={!expanded}
        className="absolute left-0 right-0 top-full z-10 mt-1 max-h-80 overflow-y-auto rounded-card border border-hairline bg-surface-1 p-1 shadow-popover"
      >
        {groups.map((group) => (
          <div key={group.id} role="group" aria-label={group.label}>
            <div aria-hidden="true" className="px-2 pb-1 pt-2 text-caption text-ink-muted">{group.label}</div>
            {group.items.map((entry) => {
              index += 1;
              const position = index;
              const selected = position === Math.min(active, ordered.length - 1);
              return (
                <div
                  key={entry.elementId}
                  id={optionId(position)}
                  role="option"
                  aria-selected={selected}
                  data-qa="search-result"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(position)}
                  onClick={() => pick(entry)}
                  className={cx(
                    "flex min-h-11 cursor-pointer items-center gap-2 rounded-control px-2 text-body text-ink sm:min-h-9",
                    selected && "bg-surface-2",
                  )}
                >
                  {entry.code && <span className="text-caption text-ink-muted">{entry.code}</span>}
                  <span className="min-w-0 truncate">{entry.displayName}</span>
                </div>
              );
            })}
          </div>
        ))}
        {trimmed && ordered.length === 0 && (
          <p data-qa="search-empty" className="px-2 py-2 text-body text-ink-muted">
            {`'${trimmed}'에 맞는 건물이 없습니다.`}
            {suggestion && ` '${suggestion}'을(를) 찾으시나요?`}
          </p>
        )}
      </div>
    </div>
  );
}
