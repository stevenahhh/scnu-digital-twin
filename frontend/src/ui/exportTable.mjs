// 표 내보내기(순수). columns: [{ key, label, estimated? }], rows: [{ [key]: 값 }].
// 추정값이 있는 열은 머리글에 "(추정)"을 붙이고, 줄마다 끝의 `추정` 열에 그 줄의 추정 열 이름을 적는다(값만 떼어 보내지 않는다).

export const ESTIMATE_COLUMN = "추정";
const BOM = "\uFEFF";

const text = (value) => (value === null || value === undefined ? "" : String(value));

function table(rows, columns) {
  const estimated = columns.filter((column) => column.estimated);
  const header = columns.map((column) => (column.estimated ? `${column.label} (추정)` : column.label));
  if (estimated.length) header.push(ESTIMATE_COLUMN);
  const body = rows.map((row) => {
    const cells = columns.map((column) => text(row[column.key]));
    if (estimated.length) cells.push(estimated.filter((column) => text(row[column.key]) !== "").map((column) => column.label).join(", "));
    return cells;
  });
  return [header, ...body];
}

// RFC 4180: 쉼표·따옴표·줄바꿈이 든 칸은 따옴표로 감싸고 따옴표는 두 번 쓴다. 줄 끝은 CRLF, 맨 앞에 UTF-8 BOM(Excel 한글).
export function toCsv(rows, columns) {
  const quote = (cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  return BOM + table(rows, columns).map((line) => line.map(quote).join(",")).join("\r\n") + "\r\n";
}

// 표 붙여넣기용 TSV: 칸 안의 탭·줄바꿈은 공백으로 바꾼다.
export function toTsv(rows, columns) {
  const clean = (cell) => cell.replace(/[\t\r\n]+/g, " ");
  return table(rows, columns).map((line) => line.map(clean).join("\t")).join("\n");
}

// 내려받을 파일 이름: scnu-<kind>-<YYYYMMDD-HHmm>.csv
export function exportFileName(kind, now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `scnu-${kind}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.csv`;
}
