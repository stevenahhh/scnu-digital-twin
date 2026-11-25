import { useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// 가림막 없이 뜨는 대화상자. 뒤의 화면은 그대로 읽히고, 바깥을 눌러도 닫히지 않는다. Tab은 안에서 돌고 Esc로 닫는다.
export function AccessibleDialog({ open, onClose, title, children, className }) {
  const previousFocusRef = useRef(null);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }} modal={false}>
      <DialogContent
        showClose={false}
        aria-modal="true"
        aria-describedby={undefined}
        className={className}
        onOpenAutoFocus={() => { previousFocusRef.current = document.activeElement; }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          previousFocusRef.current?.focus();
        }}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle>{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
