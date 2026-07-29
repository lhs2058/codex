import type { ImportParseResult, WorkbookSheet } from "../contracts";
import { qualityOnlyRow } from "../import-row";
import { normalizeProductionDate, normalizeQuantity } from "../normalize";
import { parseHeaderQualityWorkbook } from "./header-quality-adapter";

const present = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== "";

export function parseXrayWorkbook(sheets: WorkbookSheet[]): ImportParseResult {
  const usesLegacyModelHeader = sheets.some(({ sheet, data }) =>
    /^xray$/i.test(sheet.trim())
    && data.some((row) => row.some((cell) => String(cell ?? "").trim().toLowerCase() === "model")));
  const headerResult = usesLegacyModelHeader ? null : parseHeaderQualityWorkbook(sheets, {
    kind: "xray",
    processCode: "XRAY",
    sheetName: (name) => /^xray$/i.test(name),
    title: (value) => value.includes("hieu suat") && value.includes("xray"),
  });
  if (headerResult) return headerResult;

  const rows: ImportParseResult["rows"] = [];
  const diagnostics: ImportParseResult["diagnostics"] = [];
  for (const sheet of sheets.filter((candidate) => /^xray$/i.test(candidate.sheet))) {
    const header = sheet.data.findIndex((row) => String(row[1] ?? "").includes("Data Theo Dõi Hiệu Suất"));
    if (header < 0) {
      diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: 1, code: "missing-required-value", message: "Xray signature missing", field: "headers" });
      continue;
    }
    for (let index = header + 4; index < sheet.data.length; index += 1) {
      const source = sheet.data[index] ?? [];
      if (/total|ttl/i.test(String(source[2] ?? source[6] ?? ""))) continue;
      if (!source[2] || !source[5]) {
        if (present(source[2]) || present(source[5]) || present(source[7]) || present(source[8])) {
          diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: index + 1, code: "missing-required-value", message: "Xray candidate is incomplete", field: !source[2] ? "productionDate" : "modelCode" });
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
          lineCode: "LINE-2",
          modelCode: String(source[5]),
          processCode: "XRAY",
          inputQty,
          actualQty: 0,
          okQty,
          ngQty: inputQty - okQty,
          downtimeMinutes: 0,
          downtimeReasonCode: null,
          note: "",
        }));
      } catch {
        diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: index + 1, code: "invalid-count", message: "Invalid Xray counts", field: "counts" });
      }
    }
  }
  return { kind: "xray", rows, diagnostics };
}
