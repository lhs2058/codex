import type { ImportParseResult, WorkbookSheet } from "../contracts";
import { qualityOnlyRow } from "../import-row";
import { normalizeProductionDate, normalizeQuantity } from "../normalize";
import { parseHeaderQualityWorkbook } from "./header-quality-adapter";

const present = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== "";

export function parseIctWorkbook(sheets: WorkbookSheet[]): ImportParseResult {
  const headerResult = parseHeaderQualityWorkbook(sheets, {
    kind: "ict",
    processCode: "ICT",
    sheetName: (name) => /^ict\.$/i.test(name),
    title: (value) => value.includes("hieu suat") && value.includes("ict"),
  });
  if (headerResult) return headerResult;

  const rows: ImportParseResult["rows"] = [];
  const diagnostics: ImportParseResult["diagnostics"] = [];
  for (const sheet of sheets.filter((candidate) => /ict/i.test(candidate.sheet))) {
    const header = sheet.data.findIndex((row) => String(row[1] ?? "").includes("Data Theo Dõi Hiệu Suất"));
    if (header < 0) {
      diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: 1, code: "missing-required-value", message: "ICT signature missing", field: "headers" });
      continue;
    }
    for (let index = header + 4; index < sheet.data.length; index += 1) {
      const source = sheet.data[index] ?? [];
      if (/total|ttl/i.test(String(source[2] ?? source[6] ?? ""))) continue;
      if (!source[2] || !source[5]) {
        if (present(source[2]) || present(source[5]) || present(source[7]) || present(source[8])) {
          diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: index + 1, code: "missing-required-value", message: "ICT candidate is incomplete", field: !source[2] ? "productionDate" : "modelCode" });
        }
        continue;
      }
      try {
        const inputQty = normalizeQuantity(source[7], "inputQty");
        const okQty = normalizeQuantity(source[8], "okQty");
        if (okQty > inputQty) throw new Error("ok_exceeds_input");
        rows.push(qualityOnlyRow({
          sourceSheet: sheet.sheet,
          sourceRow: index + 1,
          productionDate: normalizeProductionDate(source[2], 2026),
          shiftCode: String(source[3] ?? "DAY"),
          timeSlotCode: null,
          lineCode: "LINE-1",
          modelCode: String(source[5]),
          processCode: "ICT",
          inputQty,
          actualQty: 0,
          okQty,
          ngQty: inputQty - okQty,
          downtimeMinutes: 0,
          downtimeReasonCode: null,
          note: "",
        }));
      } catch {
        diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: index + 1, code: "invalid-count", message: "Invalid ICT counts", field: "counts" });
      }
    }
  }
  return { kind: "ict", rows, diagnostics, capacityEvidence: [], stWarnings: [] };
}
