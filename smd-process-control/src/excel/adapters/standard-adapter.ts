import type {
  DefectClassification,
  ImportDiagnostic,
  ImportParseResult,
  NormalizedDefectRow,
  WorkbookSheet,
} from "../contracts";
import { combinedRow } from "../import-row";
import { normalizeLineName, normalizeProcessName, normalizeProductionDate, normalizeQuantity } from "../normalize";
import { DEFECT_HEADERS, PRODUCTION_HEADERS } from "../template";

const normalizedHeader = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const expectedHeaders = PRODUCTION_HEADERS.map(normalizedHeader);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const hasData = (row: unknown[]) => row.some((value) => value !== null && value !== undefined && String(value).trim() !== "");

function diagnostic(sourceRow: number, code: ImportDiagnostic["code"], message: string, field?: string): ImportDiagnostic {
  return { sourceSheet: "Production", sourceRow, code, message, field };
}

function defectDiagnostic(sourceRow: number, code: ImportDiagnostic["code"], message: string, field?: string): ImportDiagnostic {
  return { sourceSheet: "Defects", sourceRow, code, message, field };
}

function parseDefects(
  sheet: WorkbookSheet | undefined,
  productionRows: Map<number, ImportParseResult["rows"][number]>,
): { rows: NormalizedDefectRow[]; diagnostics: ImportDiagnostic[] } {
  if (!sheet) return { rows: [], diagnostics: [] };
  const diagnostics: ImportDiagnostic[] = [];
  const header = sheet.data[0] ?? [];
  const expected = DEFECT_HEADERS.map(normalizedHeader);
  if (!expected.every((value, index) => normalizedHeader(header[index]) === value)
    || hasData(header.slice(DEFECT_HEADERS.length))) {
    return {
      rows: [],
      diagnostics: [defectDiagnostic(1, "missing-required-value", "Defects headers do not match SMD_STANDARD_V1", "headers")],
    };
  }

  const rows: NormalizedDefectRow[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < sheet.data.length; index += 1) {
    const source = sheet.data[index] ?? [];
    if (!hasData(source)) continue;
    const sourceRow = index + 1;
    let productionSourceRow: number;
    let quantity: number;
    try {
      productionSourceRow = normalizeQuantity(source[0], "Production Row");
      quantity = normalizeQuantity(source[3], "defect quantity");
    } catch (error) {
      diagnostics.push(defectDiagnostic(sourceRow, "invalid-count", error instanceof Error ? error.message : "Invalid Defects row", "quantity"));
      continue;
    }
    if (productionSourceRow < 3 || !productionRows.has(productionSourceRow)) {
      diagnostics.push(defectDiagnostic(sourceRow, "missing-required-value", "Defect references an unknown Production row", "productionRow"));
      continue;
    }
    const defectType = text(source[1]);
    if (!defectType || defectType.length > 200 || /^[=+\-@]/.test(defectType)) {
      diagnostics.push(defectDiagnostic(sourceRow, "invalid-count", "Defect Type is missing or unsafe for spreadsheet export", "defectType"));
      continue;
    }
    const classification = text(source[2]).toLowerCase();
    if (!["pseudo", "real", "scrap"].includes(classification)) {
      diagnostics.push(defectDiagnostic(sourceRow, "invalid-count", "Classification must be pseudo, real, or scrap", "classification"));
      continue;
    }
    if (quantity <= 0) {
      diagnostics.push(defectDiagnostic(sourceRow, "invalid-count", "Defect quantity must be positive", "quantity"));
      continue;
    }
    const key = `${productionSourceRow}|${defectType.toLocaleLowerCase()}|${classification}`;
    if (seen.has(key)) {
      diagnostics.push(defectDiagnostic(sourceRow, "duplicate-record", "Duplicate defect in workbook", "duplicate"));
      continue;
    }
    seen.add(key);
    rows.push({
      sourceSheet: "Defects",
      sourceRow,
      productionSourceRow,
      defectType,
      classification: classification as DefectClassification,
      quantity,
    });
  }

  for (const [productionSourceRow, production] of productionRows) {
    const linked = rows.filter((row) => row.productionSourceRow === productionSourceRow);
    if (linked.length === 0) continue;
    const quality = production.dimensions.quality;
    if (!quality) {
      diagnostics.push(defectDiagnostic(linked[0]!.sourceRow, "missing-required-value", "Defects require a linked quality dimension", "productionRow"));
      continue;
    }
    if (linked.reduce((total, row) => total + row.quantity, 0) > quality.ngQty) {
      diagnostics.push(defectDiagnostic(linked[0]!.sourceRow, "invalid-count", "Defect quantity exceeds linked NG quantity", "quantity"));
    }
  }

  return { rows: diagnostics.length ? [] : rows, diagnostics };
}

export function parseStandardWorkbook(sheets: WorkbookSheet[]): ImportParseResult {
  const production = sheets.find((sheet) => sheet.sheet === "Production");
  if (!production) {
    return { kind: "standard", rows: [], diagnostics: [diagnostic(1, "missing-required-value", "Production sheet is required", "sheet")], capacityEvidence: [] };
  }

  const versionCells = sheets.flatMap((sheet) => sheet.data.slice(0, 30).flatMap((row) => row.slice(0, 40)));
  const version = versionCells.find((cell) => typeof cell === "string" && /^SMD_STANDARD_V\d+$/i.test(cell.trim()));
  const reference = sheets.find((sheet) => sheet.sheet === "Reference");
  const numericVersion = reference?.data[0]?.[0] === "Template Version" ? reference.data[0][1] : undefined;
  if (version !== "SMD_STANDARD_V1" || numericVersion !== 1) {
    return {
      kind: "standard",
      rows: [],
      diagnostics: [diagnostic(
        1,
        "unsupported-template-version",
        `Unsupported template version: marker=${String(version ?? "(missing)")}, numeric=${String(numericVersion ?? "(missing)")}`,
        "template_version",
      )],
      capacityEvidence: [],
    };
  }

  const headerIndex = production.data.slice(0, 30).findIndex((row) => {
    const values = row.slice(0, PRODUCTION_HEADERS.length).map(normalizedHeader);
    return expectedHeaders.every((header, index) => values[index] === header);
  });
  if (headerIndex < 0) {
    return { kind: "standard", rows: [], diagnostics: [diagnostic(1, "missing-required-value", "Production headers do not match SMD_STANDARD_V1", "headers")], capacityEvidence: [] };
  }
  if (hasData(production.data[headerIndex].slice(PRODUCTION_HEADERS.length))) {
    return { kind: "standard", rows: [], diagnostics: [diagnostic(headerIndex + 1, "missing-required-value", "Production contains unexpected header columns", "headers")], capacityEvidence: [] };
  }

  const rows: ImportParseResult["rows"] = [];
  const diagnostics: ImportParseResult["diagnostics"] = [];
  for (let index = headerIndex + 1; index < production.data.length; index += 1) {
    const row = production.data[index] ?? [];
    if (!hasData(row)) continue;
    const sourceRow = index + 1;
    const required = [
      ["productionDate", row[0]],
      ["shiftCode", row[1]],
      ["timeSlotCode", row[2]],
      ["lineCode", row[3]],
      ["modelCode", row[4]],
      ["processCode", row[5]],
      ["inputQty", row[6]],
      ["actualQty", row[7]],
      ["okQty", row[8]],
      ["ngQty", row[9]],
      ["downtimeMinutes", row[10]],
    ] as const;
    const missing = required.find(([, value]) => value === null || value === undefined || String(value).trim() === "");
    if (missing) {
      diagnostics.push(diagnostic(sourceRow, "missing-required-value", `Missing required value: ${missing[0]}`, missing[0]));
      continue;
    }
    try {
      const inputQty = normalizeQuantity(row[6], "input quantity");
      const actualQty = normalizeQuantity(row[7], "actual quantity");
      const okQty = normalizeQuantity(row[8], "OK quantity");
      const ngQty = normalizeQuantity(row[9], "NG quantity");
      const downtimeMinutes = normalizeQuantity(row[10], "downtime minutes");
      const downtimeReasonCode = text(row[11]) || null;
      if (okQty > inputQty || okQty + ngQty > inputQty) throw new Error("Quality count exceeds input");
      if ((downtimeMinutes > 0 && !downtimeReasonCode) || (downtimeMinutes === 0 && downtimeReasonCode)) {
        throw new Error("Downtime minutes and reason must be supplied together");
      }
      rows.push(combinedRow({
        sourceSheet: "Production",
        sourceRow,
        productionDate: normalizeProductionDate(row[0]),
        shiftCode: text(row[1]),
        timeSlotCode: text(row[2]),
        lineCode: normalizeLineName(row[3]),
        modelCode: text(row[4]),
        processCode: normalizeProcessName(row[5]),
        inputQty,
        actualQty,
        okQty,
        ngQty,
        downtimeMinutes,
        downtimeReasonCode,
        note: text(row[12]),
      }));
    } catch (error) {
      diagnostics.push(diagnostic(sourceRow, "invalid-count", error instanceof Error ? error.message : "Invalid production row", "row"));
    }
  }
  const bySourceRow = new Map(rows.map((row) => [row.sourceRow, row]));
  const defects = parseDefects(sheets.find((sheet) => sheet.sheet === "Defects"), bySourceRow);
  diagnostics.push(...defects.diagnostics);
  for (const defect of defects.rows) bySourceRow.get(defect.productionSourceRow)!.defects.push(defect);
  return { kind: "standard", rows, diagnostics, capacityEvidence: [] };
}
