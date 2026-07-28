import type { ImportParseResult, WorkbookSheet } from "../contracts";
import { normalizeLineName, normalizeQuantity } from "../normalize";

const slots = ["A", "B", "C", "D", "E"] as const;
const text = (value: unknown) => String(value ?? "").trim();
const folded = (value: unknown) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function parseProductionWorkbook(sheets: WorkbookSheet[]): ImportParseResult {
  const rows: ImportParseResult["rows"] = [];
  const diagnostics: ImportParseResult["diagnostics"] = [];
  for (const sheet of sheets.filter((value) => /^\d{2}\.\d{2}$/.test(value.sheet))) {
    const title = sheet.data[1]?.find((cell) => typeof cell === "string" && /bao cao san luong.*ngay/i.test(folded(cell)));
    const date = typeof title === "string" ? title.match(/(\d{2})\/(\d{2})\/(\d{4})/) : null;
    const groupRow = sheet.data[2] ?? [];
    const timeRow = sheet.data[3] ?? [];
    const subheaderRow = sheet.data[5] ?? [];
    const groupStart = groupRow.findIndex((cell) => /san luong tung time/i.test(folded(cell)));
    const slotStarts = slots.map((slot) => timeRow.findIndex((cell) => new RegExp(`^time\\s*${slot}$`, "i").test(text(cell))));
    if (!date || groupStart < 0 || slotStarts.some((index) => index < 0)) {
      diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: 1, code: "missing-required-value", message: "Production grouped signature missing", field: "headers" });
      continue;
    }
    const columns = slotStarts.map((start) => ({
      actual: subheaderRow.findIndex((cell, index) => index >= start && index < start + 5 && /san luong thuc te/i.test(folded(cell))),
      downtime: subheaderRow.findIndex((cell, index) => index >= start && index < start + 5 && /(?:thoi gian|time) dung may/i.test(folded(cell))),
      note: subheaderRow.findIndex((cell, index) => index >= start && index < start + 5 && /ghi chu/i.test(folded(cell))),
    }));
    if (columns.some((column) => column.actual < 0 || column.downtime < 0 || column.note < 0)) {
      diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: 6, code: "missing-required-value", message: "Production time-slot subheaders missing", field: "headers" });
      continue;
    }
    for (let i = 6; i < sheet.data.length; i += 1) {
      const row = sheet.data[i] ?? [];
      const line = row[4]; const model = row[5];
      if (!line || !model || /total/i.test(text(line))) {
        if (row.some(Boolean)) diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, code: "missing-required-value", message: "Production row lacks a model or line", field: !model ? "modelCode" : "lineCode" });
        continue;
      }
      const lineText = text(line);
      const process = /xray/i.test(lineText) ? "XRAY" : /ict/i.test(lineText) ? "ICT" : /router/i.test(lineText) ? "ROUTER" : "AOI";
      for (let j = 0; j < slots.length; j += 1) {
        const column = columns[j]; const actual = row[column.actual]; const downtime = row[column.downtime]; const note = row[column.note];
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
