import type { ImportParseResult, WorkbookSheet } from "../contracts";
import { normalizeLineName, normalizeProductionDate, normalizeQuantity } from "../normalize";
import { parseHeaderQualityWorkbook } from "./header-quality-adapter";

const boundary = (row: unknown[]) => row.some((cell) => /\b(total|ttl|section|header)\b/i.test(String(cell ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
export function parseSpiWorkbook(sheets: WorkbookSheet[]): ImportParseResult {
  const usesLegacyModelHeader = sheets.some(({ sheet, data }) =>
    /^spi model$/i.test(sheet.trim())
    && data.some((row) => row.some((cell) => String(cell ?? "").trim().toLowerCase() === "model")));
  const headerResult = usesLegacyModelHeader ? null : parseHeaderQualityWorkbook(sheets, {
    kind: "spi",
    processCode: "SPI",
    sheetName: (name) => /^spi\s+(model|line)\.?$/i.test(name),
    title: (value) => /hieu suat may\s*spi/.test(value),
  });
  if (headerResult) return headerResult;
  const rows: ImportParseResult["rows"] = [], diagnostics: ImportParseResult["diagnostics"] = [];
  for (const sheet of sheets.filter((s) => /^(SPI MODEL|SPI Line)$/i.test(s.sheet)).sort((a, b) => a.sheet.localeCompare(b.sheet))) {
    const title = sheet.data.findIndex((r) => String(r[1] ?? r[2] ?? "").includes("Hiệu Suất Máy SPI"));
    if (title < 0) { diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: 1, code: "missing-required-value", message: "SPI signature missing", field: "headers" }); continue; }
    const modelSheet = /model/i.test(sheet.sheet); let lastDate: unknown = null;
    for (let i = title + 4; i < sheet.data.length; i += 1) {
      const row = sheet.data[i] ?? [];
      if (boundary(row)) { lastDate = null; continue; }
      const model = modelSheet ? row[6] : row[5]; const line = modelSheet ? "LINE-1" : row[4]; const dataCandidate = model || row[7] !== undefined || row[8] !== undefined;
      if (!dataCandidate) continue;
      if (row[2]) lastDate = row[2];
      const date = row[2] || lastDate;
      if (!date || !model || row[7] === undefined || row[8] === undefined) { diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, code: "missing-required-value", message: "SPI candidate is incomplete", field: !date ? "productionDate" : !model ? "modelCode" : "inputQty" }); continue; }
      try { const inputQty = normalizeQuantity(row[7], "inputQty"), okQty = normalizeQuantity(row[8], "okQty"); if (okQty > inputQty) throw new Error("okQty"); rows.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, productionDate: normalizeProductionDate(date, 2026), shiftCode: String(row[3] ?? "DAY"), timeSlotCode: typeof row[6] === "string" && /^[A-E]$/.test(row[6]) ? row[6] : null, lineCode: normalizeLineName(line), modelCode: String(model), processCode: "SPI", inputQty, actualQty: okQty, okQty, ngQty: inputQty - okQty, downtimeMinutes: 0, downtimeReasonCode: null, note: "" }); } catch (error) { diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, code: "invalid-count", message: String(error), field: "counts" }); }
    }
  }
  return { kind: "spi", rows, diagnostics };
}
