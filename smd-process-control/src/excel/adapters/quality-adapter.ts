import type { ImportDiagnostic, ImportParseResult, WorkbookKind, WorkbookSheet } from "../contracts";
import type { ProcessCode } from "../../domain/types";
import { normalizeLineName, normalizeProcessName, normalizeProductionDate, normalizeQuantity } from "../normalize";
import { qualityOnlyRow } from "../import-row";

type QualityOptions = { kind: Extract<WorkbookKind, "aoi" | "spi" | "ict" | "xray">; process: ProcessCode; sheet: (name: string) => boolean; daily: boolean };
const fold = (value: unknown) => typeof value === "string" ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim() : "";
const aliases: Record<string, string[]> = { date: ["date", "ngay"], shift: ["shift", "ca"], time: ["time"], line: ["line", "chuyen"], model: ["model"], input: ["input"], ok: ["ok", "output", "ouput"] };

function diagnostic(sourceSheet: string, sourceRow: number, code: ImportDiagnostic["code"], message: string, field?: string): ImportDiagnostic {
  return { sourceSheet, sourceRow, code, message, field };
}

export function parseQualityWorkbook(sheets: WorkbookSheet[], options: QualityOptions): ImportParseResult {
  const rows: ImportParseResult["rows"] = []; const diagnostics: ImportDiagnostic[] = [];
  for (const sheet of sheets.filter((candidate) => options.sheet(candidate.sheet)).sort((a, b) => a.sheet.localeCompare(b.sheet))) {
    const headerIndex = sheet.data.slice(0, 30).findIndex((row) => {
      const values = row.map(fold);
      return ["date", "model", "input", "ok"].every((key) => values.some((value) => aliases[key].includes(value)));
    });
    if (headerIndex < 0) continue;
    const header = sheet.data[headerIndex]!.map(fold);
    const col = (key: keyof typeof aliases) => header.findIndex((value) => aliases[key].includes(value));
    const date = col("date"), model = col("model"), input = col("input"), ok = col("ok"), line = col("line"), shift = col("shift"), time = col("time");
    for (let index = headerIndex + 1; index < Math.min(sheet.data.length, headerIndex + 51); index++) {
      const source = sheet.data[index] ?? []; if (!source.some((value) => value !== null && value !== "")) continue;
      const sourceRow = index + 1;
      if (model < 0 || !source[model] || line < 0 || !source[line]) { diagnostics.push(diagnostic(sheet.sheet, sourceRow, "missing-required-value", "A quality row requires both a model and line.", !source[model] ? "modelCode" : "lineCode")); continue; }
      try {
        const inputQty = normalizeQuantity(source[input], "inputQty"); const okQty = normalizeQuantity(source[ok], "okQty");
        if (okQty > inputQty) throw new Error("okQty");
        rows.push(qualityOnlyRow({ sourceSheet: sheet.sheet, sourceRow, productionDate: normalizeProductionDate(source[date], 2026), shiftCode: typeof source[shift] === "string" && source[shift].trim() ? source[shift].trim() : "DAY", timeSlotCode: options.daily ? null : typeof source[time] === "string" && source[time].trim() ? source[time].trim().toUpperCase() : null, lineCode: normalizeLineName(source[line]), modelCode: String(source[model]).trim(), processCode: options.process, inputQty, actualQty: 0, okQty, ngQty: inputQty - okQty, downtimeMinutes: 0, downtimeReasonCode: null, note: "" }));
      } catch (error) {
        const field = error instanceof Error && error.message.includes("okQty") ? "okQty" : error instanceof Error && error.message.includes("inputQty") ? "inputQty" : "row";
        diagnostics.push(diagnostic(sheet.sheet, sourceRow, field === "row" ? "missing-required-value" : "invalid-count", error instanceof Error ? error.message : "Invalid quality row", field));
      }
    }
  }
  return { kind: options.kind, rows, diagnostics, capacityEvidence: [] };
}
