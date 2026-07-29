import type { ImportParseResult, WorkbookSheet } from "../contracts";
import { qualityOnlyRow } from "../import-row";
import { normalizeLineName, normalizeProductionDate, normalizeQuantity } from "../normalize";

type QualityKind = "aoi" | "spi" | "ict" | "xray";
type QualityProcess = "AOI" | "SPI" | "ICT" | "XRAY";

const folded = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/đ/g, "d")
  .trim();
const label = (value: unknown) => folded(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const present = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== "";
const missingCount = (value: unknown) =>
  !present(value) || /^-+$|^#(?:div\/0!|n\/a|value!|ref!|name\?|num!|null!)$/i.test(String(value).trim());
const boundary = (value: unknown) => /\b(total|ttl|section|header)\b|tong|합계/i.test(folded(value));
const column = (row: unknown[], predicate: (value: string) => boolean) =>
  row.findIndex((cell) => predicate(label(cell)));
const productionDate = (value: unknown) => {
  try { return normalizeProductionDate(value, 2026); } catch { return null; }
};

export function parseHeaderQualityWorkbook(
  sheets: WorkbookSheet[],
  options: {
    kind: QualityKind;
    processCode: QualityProcess;
    sheetName(name: string): boolean;
    title(value: string): boolean;
  },
): ImportParseResult | null {
  const rows: ImportParseResult["rows"] = [];
  const diagnostics: ImportParseResult["diagnostics"] = [];
  let matchedLayouts = 0;

  for (const sheet of sheets.filter(({ sheet }) => options.sheetName(sheet.trim()))) {
    const titleRow = sheet.data.findIndex((row) =>
      row.some((cell) => typeof cell === "string" && options.title(folded(cell))));
    if (titleRow < 0) continue;
    const headerRow = sheet.data.findIndex((row, index) =>
      index > titleRow
      && index <= titleRow + 8
      && column(row, (value) => value === "input") >= 0
      && column(row, (value) => ["ok", "output", "ouput"].includes(value)) >= 0);
    if (headerRow < 0) continue;

    const header = sheet.data[headerRow] ?? [];
    const dateColumn = column(header, (value) => value === "ngay" || value === "date");
    const shiftColumn = column(header, (value) => value === "ca" || value === "shift");
    const timeColumn = column(header, (value) => value === "time");
    const inputColumn = column(header, (value) => value === "input");
    const okColumn = column(header, (value) => ["ok", "output", "ouput"].includes(value));
    const namedModelColumn = column(header, (value) => value === "model");
    const processColumn = column(header, (value) => value === "cong doan");
    const itemColumn = column(header, (value) => value === "hang muc");
    const modelSheet = /model/i.test(sheet.sheet);
    const constantLine = options.processCode === "ICT"
      ? "LINE-1"
      : options.processCode === "XRAY"
        ? "LINE-2"
        : modelSheet
          ? "LINE-1"
          : null;
    const lineColumn = constantLine ? -1 : processColumn;
    const modelColumn = namedModelColumn >= 0
      ? options.processCode === "ICT" || options.processCode === "XRAY"
        ? namedModelColumn + 1
        : namedModelColumn
      : modelSheet
        ? processColumn
        : options.processCode === "XRAY"
          ? itemColumn
          : itemColumn >= 0
            ? itemColumn
            : processColumn + 1;
    if ([dateColumn, inputColumn, okColumn, modelColumn].some((value) => value < 0)
      || (!constantLine && lineColumn < 0)) continue;

    matchedLayouts += 1;
    let lastDate: string | null = null;
    let hasSeenDate = false;
    let lastShift: unknown = "DAY";
    let lastLine: unknown = constantLine;
    let lastModel: unknown = null;
    for (let index = headerRow + 1; index < sheet.data.length; index += 1) {
      const source = sheet.data[index] ?? [];
      if (source.some((value, sourceColumn) => sourceColumn !== dateColumn && value instanceof Date)) {
        lastDate = null;
        lastModel = null;
        continue;
      }
      const shiftBoundary = boundary(source[shiftColumn]);
      if (boundary(source[dateColumn]) || (shiftBoundary && !present(source[modelColumn]))) {
        lastDate = null;
        lastModel = null;
        continue;
      }
      if (boundary(source[lineColumn]) || boundary(source[modelColumn])) {
        lastModel = null;
        continue;
      }
      const explicitDate = productionDate(source[dateColumn]);
      if (explicitDate) {
        lastDate = explicitDate;
        hasSeenDate = true;
      }
      if (shiftColumn >= 0 && present(source[shiftColumn])) lastShift = source[shiftColumn];
      if (lineColumn >= 0 && present(source[lineColumn])) lastLine = source[lineColumn];
      if (present(source[modelColumn])) lastModel = source[modelColumn];
      if (missingCount(source[inputColumn]) || missingCount(source[okColumn])) continue;
      if (!lastDate && !hasSeenDate) continue;
      if (!lastDate) continue;
      if (!lastDate || !lastLine || !lastModel) {
        diagnostics.push({
          sourceSheet: sheet.sheet,
          sourceRow: index + 1,
          code: "missing-required-value",
          message: `${options.processCode} candidate is incomplete`,
          field: !lastDate ? "productionDate" : !lastModel ? "modelCode" : "lineCode",
        });
        continue;
      }
      try {
        const inputQty = normalizeQuantity(source[inputColumn], "inputQty");
        const okQty = normalizeQuantity(source[okColumn], "okQty");
        if (okQty > inputQty) throw new Error("okQty");
        rows.push(qualityOnlyRow({
          sourceSheet: sheet.sheet,
          sourceRow: index + 1,
          productionDate: lastDate,
          shiftCode: String(lastShift || "DAY"),
          timeSlotCode: timeColumn >= 0 && /^[A-E]$/.test(String(source[timeColumn] ?? ""))
            ? String(source[timeColumn]) as "A" | "B" | "C" | "D" | "E"
            : null,
          lineCode: normalizeLineName(lastLine),
          modelCode: String(lastModel).trim(),
          processCode: options.processCode,
          inputQty,
          actualQty: 0,
          okQty,
          ngQty: inputQty - okQty,
          downtimeMinutes: 0,
          downtimeReasonCode: null,
          note: "",
        }));
      } catch (error) {
        diagnostics.push({
          sourceSheet: sheet.sheet,
          sourceRow: index + 1,
          code: "invalid-count",
          message: String(error),
          field: "counts",
        });
      }
    }
  }

  return matchedLayouts > 0 ? { kind: options.kind, rows, diagnostics, capacityEvidence: [], stWarnings: [] } : null;
}
