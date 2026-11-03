import assert from "node:assert/strict";
import test from "node:test";
import { exportFileName, toCsv, toTsv } from "./exportTable.mjs";

const columns = [
  { key: "name", label: "건물" },
  { key: "temp", label: "국지 기온", estimated: true },
];

test("CSV quotes commas, quotes and newlines (RFC 4180) and starts with a UTF-8 BOM", () => {
  const csv = toCsv([{ name: '도서관, "중앙"\n본관', temp: 21.4 }], columns);
  assert.ok(csv.startsWith("\uFEFF"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], "건물,국지 기온 (추정),추정");
  // The newline inside the quoted cell stays inside one record (records end with CRLF).
  assert.equal(lines[1], '"도서관, ""중앙""\n본관",21.4,국지 기온');
});

test("estimated values always travel with the 추정 flag; empty estimates are not flagged", () => {
  const csv = toCsv([{ name: "학생회관", temp: 19 }, { name: "학군단", temp: null }], columns);
  const lines = csv.slice(1).trim().split("\r\n");
  assert.equal(lines[1], "학생회관,19,국지 기온");
  assert.equal(lines[2], "학군단,,");
});

test("TSV keeps Korean text and flattens tabs and newlines", () => {
  const tsv = toTsv([{ name: "공과대학\t3호관\n(D4)", temp: 20.5 }], columns);
  assert.equal(tsv, "건물\t국지 기온 (추정)\t추정\n공과대학 3호관 (D4)\t20.5\t국지 기온");
});

test("file names follow scnu-<kind>-<YYYYMMDD-HHmm>.csv", () => {
  assert.equal(exportFileName("comparison", new Date(2026, 9, 26, 9, 5)), "scnu-comparison-20261026-0905.csv");
});
