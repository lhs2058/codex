import type { ImportParseResult, WorkbookSheet } from "../contracts";
import { normalizeLineName, normalizeQuantity } from "../normalize";
import { findProductionGroupedLayout } from "../production-layout";

const slots = ["A", "B", "C", "D", "E"] as const;
const text = (value: unknown) => String(value ?? "").trim();
const folded = (value: unknown) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function parseProductionWorkbook(sheets: WorkbookSheet[]): ImportParseResult {
  const rows: ImportParseResult["rows"] = [];
  const diagnostics: ImportParseResult["diagnostics"] = [];
  for (const sheet of sheets.filter((value) => /^\d{2}\.\d{2}$/.test(value.sheet))) {
    const layout = findProductionGroupedLayout(sheet);
    const title = layout ? sheet.data[layout.titleRow]?.find((cell) => typeof cell === "string" && /bao cao san luong.*ngay/i.test(folded(cell))) : undefined;
    const date = typeof title === "string" ? title.match(/(\d{2})\/(\d{2})\/(\d{4})/) : null;
    if (!date || !layout) {
      diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: 1, code: "missing-required-value", message: "Production grouped signature missing", field: "headers" });
      continue;
    }
    if (layout.lineColumn < 0 || layout.modelColumn < 0 || layout.slots.some((slot) => Object.values(slot).some((column) => column < 0))) {
      diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: layout.subheaderRow + 1, code: "missing-required-value", message: "Production grouped headers missing", field: "headers" });
      continue;
    }
    for (let i = layout.dataStartRow; i < sheet.data.length; i += 1) {
      const row = sheet.data[i] ?? [];
      const line = row[layout.lineColumn]; const model = row[layout.modelColumn];
      if (!line || !model || /total/i.test(text(line))) {
        if (row.some(Boolean)) diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, code: "missing-required-value", message: "Production row lacks a model or line", field: !model ? "modelCode" : "lineCode" });
        continue;
      }
      const lineText = text(line);
      const process = /xray/i.test(lineText) ? "XRAY" : /ict/i.test(lineText) ? "ICT" : /router/i.test(lineText) ? "ROUTER" : "AOI";
      for (let j = 0; j < slots.length; j += 1) {
        const column = layout.slots[j]; const actual = row[column.actualColumn]; const downtime = row[column.downtimeColumn]; const note = row[column.noteColumn];
        if (actual == null) { diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, code: "missing-required-value", message: "Time slot has no actual quantity", field: "actualQty" }); continue; }
        let actualQty: number; let downtimeMinutes = 0;
        try { actualQty = normalizeQuantity(actual, "actualQty"); } catch (error) { diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, code: "invalid-count", message: String(error), field: "actualQty" }); continue; }
        try { downtimeMinutes = downtime == null ? 0 : normalizeQuantity(downtime, "downtimeMinutes"); } catch (error) { diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, code: "invalid-count", message: String(error), field: "downtimeMinutes" }); continue; }
        const lineCode = process === "ICT" ? "ICT-1" : /router may 2/i.test(folded(lineText)) ? "ROUTER-2" : normalizeLineName(line);
        rows.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, productionDate: `${date[3]}-${date[2]}-${date[1]}`, shiftCode: text(row[3]) || "DAY", timeSlotCode: slots[j], lineCode, modelCode: text(model), processCode: process, inputQty: 0, actualQty, okQty: 0, ngQty: 0, downtimeMinutes, downtimeReasonCode: null, note: typeof note === "string" ? note : "" });
      }
    }
  }
  return { kind: "production", rows, diagnostics };
}
