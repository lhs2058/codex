import type { ImportParseResult, WorkbookSheet } from "../contracts";
import { normalizeLineName, normalizeProductionDate, normalizeQuantity } from "../normalize";
import { parseHeaderQualityWorkbook } from "./header-quality-adapter";
import { qualityOnlyRow } from "../import-row";

const boundary = (row: unknown[]) => row.some((cell) => /\b(total|ttl|section|header)\b/i.test(String(cell ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
const present = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== "";
const productionDate = (value: unknown) => {
  try { return normalizeProductionDate(value, 2026); } catch { return null; }
};
export function parseAoiWorkbook(sheets: WorkbookSheet[]): ImportParseResult {
  const preservedMonthlyWorkbook = sheets.some(({ sheet }) =>
    sheet.normalize("NFKC").trim().toLowerCase().includes("total aoi"));
  const usesLegacyModelHeader = sheets.some(({ sheet, data }) =>
    /^aoi model$/i.test(sheet.trim())
    && data.some((row) => row.some((cell) => String(cell ?? "").trim().toLowerCase() === "model")));
  const headerResult = usesLegacyModelHeader ? null : parseHeaderQualityWorkbook(sheets, {
    kind: "aoi",
    processCode: "AOI",
    sheetName: (name) => preservedMonthlyWorkbook
      ? /^aoi model$/i.test(name)
      : /^(aoi line|aoi model)$/i.test(name),
    title: (value) => value.includes("hieu suat may aoi"),
  });
  if (headerResult) return headerResult;
  const rows: ImportParseResult["rows"] = [], diagnostics: ImportParseResult["diagnostics"] = [];
  for (const sheet of sheets
    .filter((candidate) => preservedMonthlyWorkbook
      ? /^aoi model$/i.test(candidate.sheet)
      : /^(AOI Line|aoi model)$/i.test(candidate.sheet))
    .sort((a, b) => a.sheet.localeCompare(b.sheet))) {
    const rowStart = rows.length;
    const diagnosticStart = diagnostics.length;
    const title = sheet.data.findIndex((r) => String(r[1] ?? r[2] ?? "").includes("Data Theo Dõi Hiệu Suất Máy AOI"));
    if (title < 0) { diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: 1, code: "missing-required-value", message: "AOI signature missing", field: "headers" }); continue; }
    const modelSheet = /model/i.test(sheet.sheet); let lastDate: unknown = null; let hasSeenDate = false; let lastShift: unknown = "DAY";
    for (let i = title + 4; i < sheet.data.length; i += 1) {
      const row = sheet.data[i] ?? [];
      if (boundary(row)) { lastDate = null; continue; }
      const explicitDate = productionDate(row[2]);
      if (!explicitDate && productionDate(row[1])) { lastDate = null; continue; }
      const model = modelSheet ? row[6] : row[5]; const line = modelSheet ? "LINE-1" : row[4]; const dataCandidate = present(model) || present(row[7]) || present(row[8]);
      if (!dataCandidate) continue;
      if (explicitDate) { lastDate = explicitDate; hasSeenDate = true; }
      if (present(row[3])) lastShift = row[3];
      const date = explicitDate || lastDate;
      if (!date && !hasSeenDate) continue;
      if (!date) continue;
      if (!date || !model || !line || !present(row[7]) || !present(row[8])) { diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, code: "missing-required-value", message: "AOI candidate is incomplete", field: !date ? "productionDate" : !model ? "modelCode" : "lineCode" }); continue; }
      try { const inputQty = normalizeQuantity(row[7], "inputQty"), okQty = normalizeQuantity(row[8], "okQty"); if (okQty > inputQty) throw new Error("okQty"); rows.push(qualityOnlyRow({ sourceSheet: sheet.sheet, sourceRow: i + 1, productionDate: String(date), shiftCode: String(lastShift), timeSlotCode: typeof row[6] === "string" && /^[A-E]$/.test(row[6]) ? row[6] : null, lineCode: normalizeLineName(line), modelCode: String(model), processCode: "AOI", inputQty, actualQty: 0, okQty, ngQty: inputQty - okQty, downtimeMinutes: 0, downtimeReasonCode: null, note: "" })); } catch (error) { diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, code: "invalid-count", message: String(error), field: "counts" }); }
    }
    if (rows.length === rowStart
      && diagnostics.slice(diagnosticStart).every((item) => item.field === "productionDate")) {
      diagnostics.splice(diagnosticStart);
    }
  }
  return { kind: "aoi", rows, diagnostics };
}
