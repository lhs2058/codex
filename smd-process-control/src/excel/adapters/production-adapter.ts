import type { ImportParseResult, WorkbookSheet } from "../contracts";
import { normalizeLineName, normalizeQuantity } from "../normalize";
import { findProductionGroupedLayout } from "../production-layout";
import { productionOnlyRow } from "../import-row";

const slots = ["A", "B", "C", "D", "E"] as const;
const text = (value: unknown) => String(value ?? "").trim();
const folded = (value: unknown) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function parseProductionWorkbook(sheets: WorkbookSheet[]): ImportParseResult {
  const rows: ImportParseResult["rows"] = [];
  const diagnostics: ImportParseResult["diagnostics"] = [];
  const candidates = sheets
    .filter((value) => /^\d{2}\.\d{1,2}$/.test(value.sheet))
    .map((sheet) => ({ sheet, layout: findProductionGroupedLayout(sheet) }));
  const hasSupportedSheet = candidates.some(({ layout }) => layout !== null);
  for (const { sheet, layout } of candidates) {
    const title = layout ? sheet.data[layout.titleRow]?.find((cell) => typeof cell === "string" && /bao cao san luong.*ngay/i.test(folded(cell))) : undefined;
    const date = typeof title === "string" ? title.match(/(\d{2})\/(\d{2})\/(\d{4})/) : null;
    const sheetDate = sheet.sheet.match(/^(\d{2})\.(\d{1,2})$/);
    if (!date || !layout) {
      if (!hasSupportedSheet) {
        diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: 1, code: "missing-required-value", message: "Production grouped signature missing", field: "headers" });
      }
      continue;
    }
    let inheritedLine: unknown = null;
    let inheritedShift = "DAY";
    for (let i = layout.dataStartRow; i < sheet.data.length; i += 1) {
      const row = sheet.data[i] ?? [];
      const rawShift = layout.shiftColumn == null ? "" : text(row[layout.shiftColumn]);
      if (rawShift && !/total/i.test(rawShift)) inheritedShift = rawShift;
      const rawLine = row[layout.lineColumn];
      const model = row[layout.modelColumn];
      if (/total/i.test(text(rawLine))) {
        inheritedLine = null;
        continue;
      }
      if (rawLine) inheritedLine = rawLine;
      const line = rawLine || inheritedLine;
      if (!line && !model) continue;
      if (!line || !model) {
        const hasReportedActual = layout.slots.some(({ actualColumn }) => {
          const value = row[actualColumn];
          return typeof value === "number"
            ? value !== 0
            : value !== null && value !== undefined && !/^$|^0$|^#(?:div\/0!|n\/a|value!|ref!|name\?)$/i.test(String(value).trim());
        });
        if (hasReportedActual) diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, code: "missing-required-value", message: "Production row lacks a model or line", field: !model ? "modelCode" : "lineCode" });
        continue;
      }
      const lineText = text(line);
      const process = /xray/i.test(lineText) ? "XRAY" : /ict/i.test(lineText) ? "ICT" : /router/i.test(lineText) ? "ROUTER" : "AOI";
      for (let j = 0; j < slots.length; j += 1) {
        const column = layout.slots[j]; const actual = row[column.actualColumn]; const downtime = row[column.downtimeColumn]; const note = row[column.noteColumn];
        if (actual == null) continue;
        let actualQty: number; let downtimeMinutes = 0;
        try { actualQty = normalizeQuantity(actual, "actualQty"); } catch (error) { diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, code: "invalid-count", message: String(error), field: "actualQty" }); continue; }
        try { downtimeMinutes = downtime == null ? 0 : normalizeQuantity(downtime, "downtimeMinutes"); } catch (error) { diagnostics.push({ sourceSheet: sheet.sheet, sourceRow: i + 1, code: "invalid-count", message: String(error), field: "downtimeMinutes" }); continue; }
        const lineCode = process === "ICT" ? "ICT-1" : /router may 2/i.test(folded(lineText)) ? "ROUTER-2" : normalizeLineName(line);
        const missingLegacyReason = downtimeMinutes > 0;
        rows.push(productionOnlyRow({
          sourceSheet: sheet.sheet,
          sourceRow: i + 1,
          productionDate: `${date[3]}-${sheetDate![2].padStart(2, "0")}-${sheetDate![1]}`,
          shiftCode: inheritedShift,
          timeSlotCode: slots[j],
          lineCode,
          modelCode: text(model),
          processCode: process,
          inputQty: 0,
          actualQty,
          okQty: 0,
          ngQty: 0,
          downtimeMinutes,
          downtimeReasonCode: missingLegacyReason ? "LEGACY_UNSPECIFIED" : null,
          note: typeof note === "string" ? note : "",
        }, missingLegacyReason ? ["legacy-downtime-reason-unspecified"] : []));
      }
    }
  }
  return { kind: "production", rows, diagnostics };
}
