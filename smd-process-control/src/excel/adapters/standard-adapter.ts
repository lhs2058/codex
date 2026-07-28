import type { ImportDiagnostic, ImportParseResult, WorkbookSheet } from "../contracts";
import { normalizeLineName, normalizeProcessName, normalizeProductionDate, normalizeQuantity } from "../normalize";
import { PRODUCTION_HEADERS } from "../template";

const normalizedHeader = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const expectedHeaders = PRODUCTION_HEADERS.map(normalizedHeader);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const hasData = (row: unknown[]) => row.some((value) => value !== null && value !== undefined && String(value).trim() !== "");

function diagnostic(sourceRow: number, code: ImportDiagnostic["code"], message: string, field?: string): ImportDiagnostic {
  return { sourceSheet: "Production", sourceRow, code, message, field };
}

export function parseStandardWorkbook(sheets: WorkbookSheet[]): ImportParseResult {
  const production = sheets.find((sheet) => sheet.sheet === "Production");
  if (!production) {
    return { kind: "standard", rows: [], diagnostics: [diagnostic(1, "missing-required-value", "Production sheet is required", "sheet")] };
  }

  const versionCells = sheets.flatMap((sheet) => sheet.data.slice(0, 30).flatMap((row) => row.slice(0, 40)));
  const version = versionCells.find((cell) => typeof cell === "string" && /^SMD_STANDARD_V\d+$/i.test(cell.trim()));
  if (version !== "SMD_STANDARD_V1") {
    return {
      kind: "standard",
      rows: [],
      diagnostics: [diagnostic(1, "unsupported-template-version", `Unsupported template version: ${String(version ?? "(missing)")}`, "template_version")],
    };
  }

  const headerIndex = production.data.slice(0, 30).findIndex((row) => {
    const values = row.slice(0, PRODUCTION_HEADERS.length).map(normalizedHeader);
    return expectedHeaders.every((header, index) => values[index] === header);
  });
  if (headerIndex < 0) {
    return { kind: "standard", rows: [], diagnostics: [diagnostic(1, "missing-required-value", "Production headers do not match SMD_STANDARD_V1", "headers")] };
  }

  const rows: ImportParseResult["rows"] = [];
  const diagnostics: ImportParseResult["diagnostics"] = [];
  for (let index = headerIndex + 1; index < production.data.length; index += 1) {
    const row = production.data[index] ?? [];
    if (!hasData(row)) continue;
    const sourceRow = index + 1;
    const required = [
      ["productionDate", row[0]],
      ["shiftCode", row[1]],
      ["timeSlotCode", row[2]],
      ["lineCode", row[3]],
      ["modelCode", row[4]],
      ["processCode", row[5]],
      ["inputQty", row[6]],
      ["actualQty", row[7]],
      ["okQty", row[8]],
      ["ngQty", row[9]],
      ["downtimeMinutes", row[10]],
    ] as const;
    const missing = required.find(([, value]) => value === null || value === undefined || String(value).trim() === "");
    if (missing) {
      diagnostics.push(diagnostic(sourceRow, "missing-required-value", `Missing required value: ${missing[0]}`, missing[0]));
      continue;
    }
    try {
      const inputQty = normalizeQuantity(row[6], "input quantity");
      const actualQty = normalizeQuantity(row[7], "actual quantity");
      const okQty = normalizeQuantity(row[8], "OK quantity");
      const ngQty = normalizeQuantity(row[9], "NG quantity");
      const downtimeMinutes = normalizeQuantity(row[10], "downtime minutes");
      const downtimeReasonCode = text(row[11]) || null;
      if (okQty > inputQty || okQty + ngQty > inputQty) throw new Error("Quality count exceeds input");
      if ((downtimeMinutes > 0 && !downtimeReasonCode) || (downtimeMinutes === 0 && downtimeReasonCode)) {
        throw new Error("Downtime minutes and reason must be supplied together");
      }
      rows.push({
        sourceSheet: "Production",
        sourceRow,
        productionDate: normalizeProductionDate(row[0]),
        shiftCode: text(row[1]),
        timeSlotCode: text(row[2]),
        lineCode: normalizeLineName(row[3]),
        modelCode: text(row[4]),
        processCode: normalizeProcessName(row[5]),
        inputQty,
        actualQty,
        okQty,
        ngQty,
        downtimeMinutes,
        downtimeReasonCode,
        note: text(row[12]),
      });
    } catch (error) {
      diagnostics.push(diagnostic(sourceRow, "invalid-count", error instanceof Error ? error.message : "Invalid production row", "row"));
    }
  }
  return { kind: "standard", rows, diagnostics };
}
