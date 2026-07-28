import type { ImportParseResult, WorkbookSheet } from "../contracts";
import { normalizeLineName, normalizeProductionDate, normalizeQuantity } from "../normalize";

const total = (row: unknown[]) => /total|ttl/i.test(String(row[2] ?? row[3] ?? row[6] ?? ""));
export function parseAoiWorkbook(sheets: WorkbookSheet[]): ImportParseResult {
  const rows: ImportParseResult["rows"] = [], diagnostics: ImportParseResult["diagnostics"] = [];
  for (const sheet of sheets.filter((s) => /^(AOI Line|aoi model)$/i.test(s.sheet)).sort((a, b) => a.sheet.localeCompare(b.sheet))) {
    const title = sheet.data.findIndex((r) => String(r[1] ?? r[2] ?? "").includes("Data Theo Dõi Hiệu Suất Máy AOI"));
    if (title < 0) { diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: 1, code: "missing-required-value", message: "AOI signature missing", field: "headers" }); continue; }
    const modelSheet = /model/i.test(sheet.sheet); let lastDate: unknown = null;
    for (let i = title + 4; i < sheet.data.length; i += 1) {
      const row = sheet.data[i] ?? [];
      if (total(row)) { lastDate = null; continue; }
      const model = modelSheet ? row[6] : row[5]; const line = modelSheet ? "LINE-1" : row[4]; const dataCandidate = model || row[7] !== undefined || row[8] !== undefined;
      if (!dataCandidate) continue;
      const date = row[2] || lastDate;
      if (!date || !model || !line || row[7] === undefined || row[8] === undefined) { diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, code: "missing-required-value", message: "AOI candidate is incomplete", field: !date ? "productionDate" : !model ? "modelCode" : "lineCode" }); continue; }
      try { const inputQty = normalizeQuantity(row[7], "inputQty"), okQty = normalizeQuantity(row[8], "okQty"); if (okQty > inputQty) throw new Error("okQty"); rows.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, productionDate: normalizeProductionDate(date, 2026), shiftCode: String(row[3] ?? "DAY"), timeSlotCode: typeof row[6] === "string" && /^[A-E]$/.test(row[6]) ? row[6] : null, lineCode: normalizeLineName(line), modelCode: String(model), processCode: "AOI", inputQty, actualQty: okQty, okQty, ngQty: inputQty - okQty, downtimeMinutes: 0, downtimeReasonCode: null, note: "" }); if (row[2]) lastDate = row[2]; } catch (error) { diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, code: "invalid-count", message: String(error), field: "counts" }); }
    }
  }
  return { kind: "aoi", rows, diagnostics };
}
