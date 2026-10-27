import { useState } from "react";
import { ClipboardCopy, Download } from "lucide-react";
import { Button } from "./Button.jsx";
import { exportFileName, toCsv, toTsv } from "./exportTable.mjs";

// 표로 복사(TSV, 표 붙여넣기용)와 CSV 저장(Excel용 BOM, 추정 열 포함). kind는 파일 이름의 종류(comparison, inspector, energy).
export function ExportActions({ kind, rows, columns, clipboard = globalThis.navigator?.clipboard, className = "" }) {
  const [status, setStatus] = useState("");

  const copy = async () => {
    try {
      await clipboard.writeText(toTsv(rows, columns));
      setStatus("표를 복사했습니다");
    } catch {
      setStatus("복사하지 못했습니다 · CSV 저장을 쓰세요");
    }
  };

  const save = () => {
    const url = URL.createObjectURL(new Blob([toCsv(rows, columns)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName(kind);
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("CSV를 저장했습니다");
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <Button size="sm" variant="secondary" data-qa="export-tsv" icon={<ClipboardCopy aria-hidden="true" className="h-4 w-4" />} onClick={copy} disabled={!clipboard?.writeText}>
        표로 복사
      </Button>
      <Button size="sm" variant="secondary" data-qa="export-csv" icon={<Download aria-hidden="true" className="h-4 w-4" />} onClick={save}>
        CSV 저장
      </Button>
      <p role="status" className="text-caption text-ink-muted">{status}</p>
    </div>
  );
}
