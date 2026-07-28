import type { ImportDiagnostic, ImportParseResult, WorkbookSheet } from "../contracts";
import { normalizeLineName, normalizeProcessName, normalizeProductionDate, normalizeQuantity } from "../normalize";

const slotCodes = ["A", "B", "C", "D", "E"] as const;
const fold = (value: unknown) => typeof value === "string" ? value.toLowerCase().replace(/\s+/g, " ").trim() : "";
const cell = (row: unknown[], index: number) => index >= 0 ? row[index] : undefined;
function normalizeProductionLine(value: unknown): string {
  const text = typeof value === "string" ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d") : "";
  const router = text.match(/^router\s+may\s+(\d+)$/i);
  return router ? `ROUTER-${router[1]}` : normalizeLineName(value);
}

export function parseProductionWorkbook(sheets: WorkbookSheet[]): ImportParseResult {
  const rows: ImportParseResult["rows"] = []; const diagnostics: ImportDiagnostic[] = [];
  for (const sheet of sheets.filter((candidate) => /^\d{2}\.\d{2}$/.test(candidate.sheet)).sort((a, b) => a.sheet.localeCompare(b.sheet))) {
    const headerIndex = sheet.data.slice(0, 30).findIndex((row) => row.some((value) => fold(value) === "time a actual"));
    if (headerIndex < 0) continue;
    const header = sheet.data[headerIndex]!.map(fold);
    const indexOf = (name: string) => header.indexOf(name);
    const date = indexOf("date"), shift = indexOf("shift"), line = indexOf("line"), model = indexOf("model"), process = indexOf("process");
    for (let dataIndex = headerIndex + 1; dataIndex < Math.min(sheet.data.length, headerIndex + 51); dataIndex++) {
      const source = sheet.data[dataIndex] ?? []; if (!source.some((value) => value !== null && value !== "")) continue;
      const sourceRow = dataIndex + 1;
      if (!cell(source, model) || !cell(source, line) || /^total$/i.test(String(cell(source, line)))) { diagnostics.push({ sourceSheet: sheet.sheet, sourceRow, code: "missing-required-value", message: "A production row requires a non-total model and line.", field: !cell(source, model) ? "modelCode" : "lineCode" }); continue; }
      try {
        const productionDate = normalizeProductionDate(cell(source, date), 2026); const lineCode = normalizeProductionLine(cell(source, line)); const modelCode = String(cell(source, model)).trim(); const processCode = normalizeProcessName(cell(source, process));
        for (const slotCode of slotCodes) {
          const actualIndex = indexOf(`time ${slotCode.toLowerCase()} actual`); const downtimeIndex = indexOf(`time ${slotCode.toLowerCase()} downtime`); const noteIndex = indexOf(`time ${slotCode.toLowerCase()} note`);
          const actualValue = cell(source, actualIndex); if (actualValue === null || actualValue === undefined || actualValue === "") continue;
          const actualQty = normalizeQuantity(actualValue, "actualQty"); const downtimeValue = cell(source, downtimeIndex);
          rows.push({ sourceSheet: sheet.sheet, sourceRow, productionDate, shiftCode: typeof cell(source, shift) === "string" && String(cell(source, shift)).trim() ? String(cell(source, shift)).trim() : "DAY", timeSlotCode: slotCode, lineCode, modelCode, processCode, inputQty: 0, actualQty, okQty: 0, ngQty: 0, downtimeMinutes: downtimeValue === null || downtimeValue === undefined || downtimeValue === "" ? 0 : normalizeQuantity(downtimeValue, "downtimeMinutes"), downtimeReasonCode: null, note: typeof cell(source, noteIndex) === "string" ? String(cell(source, noteIndex)).trim() : "" });
        }
      } catch (error) {
        diagnostics.push({ sourceSheet: sheet.sheet, sourceRow, code: "invalid-count", message: error instanceof Error ? error.message : "Invalid production row", field: "row" });
      }
    }
  }
  return { kind: "production", rows, diagnostics };
}
