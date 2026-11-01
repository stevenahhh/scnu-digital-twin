// Street lamps -> data/streetlights.json.
//
// Source: 공공데이터포털 순천시_가로등 (data.go.kr 15064740, file data, 데이터 기준일 2021-09-01). The CSV lists
// city road lamps with 관리번호, 위도, 경도; only lamps inside BBOX are kept. It has no lamps inside the campus,
// so the generator adds estimated campus lamps itself (stages/lights.mjs); this file holds real positions only.
// The file is fetched without a key. Pass --csv <path> to read an already downloaded copy instead.
//
//   bun scripts/campus-model/fetch/streetlights.mjs [--csv <file>]
import path from "node:path";
import { BBOX, DATA, TIMEOUT_MS, USER_AGENT } from "./common.mjs";

export const STREETLIGHTS_JSON = path.join(DATA, "streetlights.json");
const DATASET = "https://www.data.go.kr/data/15064740/fileData.do";
const CSV_URL = "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002437561&fileDetailSn=1";

// data.go.kr serves Korean CSVs as UTF-8 or CP949 depending on the upload; try UTF-8 strictly first.
function decodeCsv(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

async function readCsv(csvPath) {
  if (csvPath) return decodeCsv(new Uint8Array(await Bun.file(csvPath).arrayBuffer()));
  const response = await fetch(CSV_URL, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS * 4) });
  if (!response.ok) throw new Error(`data.go.kr streetlight CSV HTTP ${response.status}`);
  return decodeCsv(new Uint8Array(await response.arrayBuffer()));
}

export function parseStreetlights(text) {
  const [header, ...rows] = text.split(/\r?\n/).filter((line) => line.trim());
  const columns = header.split(",").map((name) => name.trim());
  const col = (name) => {
    const index = columns.indexOf(name);
    if (index < 0) throw new Error(`streetlight CSV has no ${name} column (columns: ${columns.join(", ")})`);
    return index;
  };
  const [idCol, latCol, lonCol, baseDateCol] = [col("관리번호"), col("위도"), col("경도"), col("데이터 기준일")];
  const lamps = [];
  let baseDate = null;
  for (const row of rows) {
    const cells = row.split(",");
    const latitude = Number(cells[latCol]);
    const longitude = Number(cells[lonCol]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    baseDate ??= cells[baseDateCol]?.trim() || null;
    if (longitude < BBOX.west || longitude > BBOX.east || latitude < BBOX.south || latitude > BBOX.north) continue;
    lamps.push([cells[idCol].trim(), Number(longitude.toFixed(7)), Number(latitude.toFixed(7))]);
  }
  return { lamps, baseDate, rows: rows.length };
}

export async function writeStreetlights({ csvPath } = {}) {
  const { lamps, baseDate, rows } = parseStreetlights(await readCsv(csvPath));
  const json = {
    source: "공공데이터포털 순천시_가로등 (data.go.kr 15064740)",
    url: DATASET,
    dataDate: baseDate,
    note: "Real lamp positions (MEASURED by Suncheon City) inside the campus bbox. Campus-interior lamps are not in this source; the generator places them along walkways and labels them as estimated positions.",
    bbox: BBOX,
    columns: ["id", "longitude", "latitude"],
    lamps,
  };
  // one lamp per line keeps diffs readable
  const body = JSON.stringify({ ...json, lamps: [] }, null, 2).replace(
    '"lamps": []',
    `"lamps": [\n${lamps.map((lamp) => `    ${JSON.stringify(lamp)}`).join(",\n")}\n  ]`,
  );
  await Bun.write(STREETLIGHTS_JSON, `${body}\n`);
  console.log(`streetlights: ${lamps.length} of ${rows} lamps inside the bbox (data date ${baseDate}) -> ${path.relative(process.cwd(), STREETLIGHTS_JSON)}`);
  return lamps.length;
}

if (import.meta.main) {
  const csvIndex = process.argv.indexOf("--csv");
  await writeStreetlights({ csvPath: csvIndex > 0 ? process.argv[csvIndex + 1] : undefined });
}
