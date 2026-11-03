import { useState } from "react";
import { Link } from "lucide-react";
import { Button } from "../ui/Button.jsx";

export const LINK_COPIED = "링크를 복사했습니다";

// 지금 화면의 주소(공유 링크)를 복사한다. 클립보드를 쓸 수 없으면 주소를 읽기 전용 칸에 골라 둔 채로 보여 준다.
export function LinkCopyButton({ getHref = () => window.location.href, clipboard = globalThis.navigator?.clipboard }) {
  const [state, setState] = useState({ copied: false, manual: null });

  const copy = async () => {
    const href = getHref();
    if (clipboard?.writeText) {
      try {
        await clipboard.writeText(href);
        setState({ copied: true, manual: null });
        return;
      } catch {
        // 권한이 없으면 아래 직접 복사 칸으로 넘어간다.
      }
    }
    setState({ copied: false, manual: href });
  };

  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      <Button size="sm" variant="ghost" data-qa="link-copy" icon={<Link aria-hidden="true" className="h-4 w-4" />} onClick={copy}>
        링크 복사
      </Button>
      <p role="status" className="text-caption text-ink-muted">{state.copied ? LINK_COPIED : ""}</p>
      {state.manual && (
        <input
          readOnly
          aria-label="공유 링크"
          value={state.manual}
          ref={(node) => node?.select()}
          className="w-56 rounded-control border border-hairline-strong bg-surface-1 px-2 py-1 text-caption text-ink"
        />
      )}
    </div>
  );
}
