import { useEffect, useRef, useState } from "react";
import { Ellipsis, Link, LogOut, Presentation, Settings } from "lucide-react";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut } from "@/components/ui/dropdown-menu";
import { Button } from "../ui/Button.jsx";
import { Popover } from "../ui/Popover.jsx";
import { cx } from "../ui/cx.mjs";
import { SettingsSheet } from "./SettingsSheet.jsx";

export const LINK_COPIED = "링크를 복사했습니다";
const COPIED_MS = 2000;

function MenuItem({ icon: Icon, shortcut, onSelect, qa, children }) {
  return (
    <DropdownMenuItem data-qa={qa} aria-keyshortcuts={shortcut} onSelect={() => onSelect()}>
      <Icon aria-hidden="true" className="text-ink-muted" />
      <span className="flex-1">{children}</span>
      {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
    </DropdownMenuItem>
  );
}

// HUD 오른쪽 끝의 `더보기`: 설정, 발표 모드, 링크 복사. 어느 탭에서나 같은 자리에 있다.
// 링크를 복사하지 못하면(클립보드 권한 없음) 주소를 읽기 전용 칸에 골라 둔 채로 보여 준다.
// onTogglePresentation이 없으면 발표 모드 항목을 빼고(학생 화면), accountLabel·onLogout이 있으면 계정 한 줄과 로그아웃을 단다.
export function MoreMenu({
  mode, onTogglePresentation = null, themeMode, onThemeChange, quality, accountLabel = null, onLogout = null,
  getHref = () => window.location.href,
}) {
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
        className="min-w-48"
        renderTrigger={(props) => (
          <Button {...props} variant="secondary" iconOnly label="더보기" data-qa="more-menu" icon={<Ellipsis aria-hidden="true" className="h-4 w-4" />} />
        )}
      >
        <MenuItem icon={Settings} onSelect={() => setSettingsOpen(true)}>설정</MenuItem>
        {onTogglePresentation && (
          <MenuItem icon={Presentation} shortcut="P" qa="presentation-toggle" onSelect={onTogglePresentation}>발표 모드</MenuItem>
        )}
        <MenuItem icon={Link} onSelect={copyLink}>링크 복사</MenuItem>
        {onLogout && (
          <>
            <DropdownMenuSeparator />
            {accountLabel && <DropdownMenuLabel data-qa="account-label" className="py-1 text-caption text-ink-muted">{accountLabel}</DropdownMenuLabel>}
            <MenuItem icon={LogOut} qa="logout" onSelect={onLogout}>로그아웃</MenuItem>
          </>
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
          ref={(node) => { node?.focus(); node?.select(); }}
          onBlur={() => setLink({ copied: false, manual: null })}
          className="absolute right-0 top-full mt-2 w-56 rounded-control border border-hairline-strong bg-surface-1 px-2 py-1 text-caption text-ink"
        />
      )}
      <SettingsSheet mode={mode} open={settingsOpen} onClose={closeSettings} themeMode={themeMode} onThemeChange={onThemeChange} quality={quality} />
    </div>
  );
}
