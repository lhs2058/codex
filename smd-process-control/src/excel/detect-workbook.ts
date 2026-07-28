import type { WorkbookDetection, WorkbookKind, WorkbookSheet } from "./contracts";
import { findProductionGroupedLayout } from "./production-layout";

const QUALITY_HEADERS = ["date", "model", "input", "ok", "ng"];
const PRODUCTION_HEADERS = ["date", "line", "time", "actual", "downtime"];
const STANDARD_HEADERS = [
  "production date", "shift", "time slot", "line", "model", "process", "input", "actual", "ok", "ng",
  "downtime minutes", "downtime reason", "note",
];
const HEADER_ROW_LIMIT = 30;
const HEADER_COLUMN_LIMIT = 40;

function normalizeCell(value: unknown): string {
  if (typeof value !== "string" || /^#(?:div\/0!|n\/a|value!|ref!|name\?|num!|null!)$/i.test(value.trim())) return "";
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  return normalized === "ngay" ? "date" : normalized;
}

function matchingRows(sheet: WorkbookSheet, required: readonly string[]): number[] {
  return sheet.data.slice(0, HEADER_ROW_LIMIT).flatMap((row, rowIndex) => {
    const headers = new Set(row.slice(0, HEADER_COLUMN_LIMIT).map(normalizeCell).filter(Boolean));
    return required.every((header) => headers.has(header)) ? [rowIndex + 1] : [];
  });
}

function legacyKind(sheetName: string): Exclude<WorkbookKind, "standard" | "unknown" | "production"> | "production" | null {
  if (/\btotal aoi\b/.test(sheetName)) return "aoi";
  if (/\bspi model\b/.test(sheetName)) return "spi";
  if (/\bdata hs cong doan ict\b/.test(sheetName)) return "ict";
  if (/\bxray\b|\bx ray\b/.test(sheetName)) return "xray";
  if (/\bsan luong tung time\b/.test(sheetName)) return "production";
  return null;
}


export function detectWorkbook(sheets: WorkbookSheet[]): WorkbookDetection {
  const standardMatches = sheets.flatMap((sheet) => {
    const rows = matchingRows(sheet, STANDARD_HEADERS);
    const hasVersion = sheet.data.slice(0, HEADER_ROW_LIMIT).some((row) => row.slice(0, HEADER_COLUMN_LIMIT).some((cell) => cell === "SMD_STANDARD_V1"));
    return hasVersion && rows.length ? [{ sheet: sheet.sheet, row: rows[0] }] : [];
  });
  if (standardMatches.length) return { kind: "standard", diagnostics: [] };

  const unsupported = sheets.flatMap((sheet) => sheet.data.slice(0, HEADER_ROW_LIMIT).flatMap((row, rowIndex) =>
    row.slice(0, HEADER_COLUMN_LIMIT).flatMap((cell) => typeof cell === "string" && /^SMD_STANDARD_V\d+$/i.test(cell.trim()) && cell.trim() !== "SMD_STANDARD_V1"
      ? [{ sourceSheet: sheet.sheet, sourceRow: rowIndex + 1, code: "unsupported-template-version" as const, message: `Unsupported template version: ${cell.trim()}`, field: "template_version" }]
      : [])));
  if (unsupported.length) return { kind: "unknown", diagnostics: unsupported.sort((a, b) => a.sourceSheet.localeCompare(b.sourceSheet) || a.sourceRow - b.sourceRow) };

  const matches = sheets.flatMap((sheet) => {
    const productionLayout = findProductionGroupedLayout(sheet);
    if (productionLayout) return [{ kind: "production" as const, sheet: sheet.sheet, row: productionLayout.groupRow + 1 }];
    const kind = legacyKind(normalizeCell(sheet.sheet));
    if (!kind) return [];
    const rows = matchingRows(sheet, kind === "production" ? PRODUCTION_HEADERS : QUALITY_HEADERS);
    return rows.length ? [{ kind, sheet: sheet.sheet, row: rows[0] }] : [];
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.sheet.localeCompare(b.sheet));

  const kinds = [...new Set(matches.map((match) => match.kind))];
  if (kinds.length === 1) return { kind: kinds[0], diagnostics: [] };
  if (kinds.length > 1) {
    return {
      kind: "unknown",
      diagnostics: [{ code: "ambiguous-workbook", message: `Multiple workbook signatures matched: ${matches.map((match) => `${match.kind} (${match.sheet}, row ${match.row})`).join(", ")}` }],
    };
  }
  return {
    kind: "unknown",
    diagnostics: sheets.slice().sort((a, b) => a.sheet.localeCompare(b.sheet)).map((sheet) => ({
      code: "missing-workbook-signature" as const,
      message: "No supported workbook signature was found in the inspected header rows.",
      sourceSheet: sheet.sheet,
      field: "headers",
    })),
  };
}
