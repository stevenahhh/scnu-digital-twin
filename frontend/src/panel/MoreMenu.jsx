import { useEffect, useRef, useState } from "react";
import { Ellipsis, Link, Presentation, Settings } from "lucide-react";
import { Button, COARSE_TARGET, FOCUS_RING } from "../ui/Button.jsx";
import { Popover } from "../ui/Popover.jsx";
import { cx } from "../ui/cx.mjs";
import { SettingsSheet } from "./SettingsSheet.jsx";

export const LINK_COPIED = "링크를 복사했습니다";
const COPIED_MS = 2000;

function MenuItem({ icon: Icon, shortcut, onSelect, children }) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-keyshortcuts={shortcut}
      onClick={onSelect}
      className={cx(
        "flex min-h-10 w-full items-center gap-2 rounded-control px-2 text-left text-body text-ink hover:bg-surface-2",
        "transition-[color] duration-micro",
        COARSE_TARGET,
        FOCUS_RING,
      )}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
      <span className="flex-1">{children}</span>
      {shortcut && <kbd className="text-caption text-ink-muted">{shortcut}</kbd>}
    </button>
  );
}

function moveFocus(event) {
  const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
  if (!step) return;
  const items = [...event.currentTarget.querySelectorAll("[role=menuitem]")];
  const index = items.indexOf(document.activeElement);
  items[(index + step + items.length) % items.length]?.focus();
  event.preventDefault();
}

// HUD 오른쪽 끝의 `더보기`: 설정, 발표 모드, 링크 복사. 어느 탭에서나 같은 자리에 있다.
// 링크를 복사하지 못하면(클립보드 권한 없음) 주소를 읽기 전용 칸에 골라 둔 채로 보여 준다.
export function MoreMenu({ mode, onTogglePresentation, themeMode, onThemeChange, quality, getHref = () => window.location.href }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [link, setLink] = useState({ copied: false, manual: null });
  const wrapperRef = useRef(null);
  const focusTrigger = () => wrapperRef.current?.querySelector("[data-qa=more-menu]")?.focus();
  const closeSettings = () => {
    setSettingsOpen(false);
    focusTrigger();
  };

  useEffect(() => {
    if (!settingsOpen || mode === "phone") return undefined;
    const handlePointerDown = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [mode, settingsOpen]);

  useEffect(() => {
    if (!link.copied) return undefined;
    const timer = window.setTimeout(() => setLink({ copied: false, manual: null }), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [link.copied]);

  const copyLink = async () => {
    const href = getHref();
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard?.writeText) {
      try {
        await clipboard.writeText(href);
        setLink({ copied: true, manual: null });
        return;
      } catch {
        // 권한이 없으면 아래 직접 복사 칸으로 넘어간다.
      }
    }
    setLink({ copied: false, manual: href });
  };

  return (
    <div ref={wrapperRef} className="pointer-events-auto relative inline-block">
      <Popover
        label="더보기"
        role="menu"
        align="end"
        className="min-w-48 p-1"
        renderTrigger={(props) => (
          <Button {...props} variant="secondary" iconOnly label="더보기" data-qa="more-menu" icon={<Ellipsis aria-hidden="true" className="h-4 w-4" />} />
        )}
      >
        {({ close }) => (
          <div className="flex flex-col" onKeyDown={moveFocus}>
            <MenuItem icon={Settings} onSelect={() => { close(); setSettingsOpen(true); }}>설정</MenuItem>
            <MenuItem icon={Presentation} shortcut="P" onSelect={() => { close(); onTogglePresentation(); }}>발표 모드</MenuItem>
            <MenuItem icon={Link} onSelect={() => { close(); copyLink(); }}>링크 복사</MenuItem>
          </div>
        )}
      </Popover>
      <p role="status" className={cx("absolute right-0 top-full mt-2 whitespace-nowrap text-caption text-ink-muted", !link.copied && "sr-only")}>
        {link.copied ? LINK_COPIED : ""}
      </p>
      {link.manual && (
        <input
          readOnly
          aria-label="공유 링크"
          value={link.manual}
          ref={(node) => node?.select()}
          onBlur={() => setLink({ copied: false, manual: null })}
          className="absolute right-0 top-full mt-2 w-56 rounded-control border border-hairline-strong bg-surface-1 px-2 py-1 text-caption text-ink"
        />
      )}
      <SettingsSheet mode={mode} open={settingsOpen} onClose={closeSettings} themeMode={themeMode} onThemeChange={onThemeChange} quality={quality} />
    </div>
  );
}
