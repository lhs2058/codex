import fs from "node:fs/promises";
import path from "node:path";
import readXlsxFile from "read-excel-file/node";
import { describe, expect, it } from "vitest";
import { parseAoiWorkbook } from "../../src/excel/adapters/aoi-adapter";
import { parseIctWorkbook } from "../../src/excel/adapters/ict-adapter";
import { parseProductionWorkbook } from "../../src/excel/adapters/production-adapter";
import { parseSpiWorkbook } from "../../src/excel/adapters/spi-adapter";
import { parseXrayWorkbook } from "../../src/excel/adapters/xray-adapter";
import type { WorkbookSheet } from "../../src/excel/contracts";
import { detectWorkbook } from "../../src/excel/detect-workbook";

async function readFixture(name: string): Promise<WorkbookSheet[]> {
  const file = path.join(import.meta.dirname, "..", "fixtures", name);
  const names = await readXlsxFile(await fs.readFile(file), { getSheets: true });
  return Promise.all(names.map(async ({ name: sheet }) => ({ sheet, data: await readXlsxFile(await fs.readFile(file), { sheet }) })));
}

function productionSheet(rowOffset: number, columnOffset: number): WorkbookSheet {
  const pad = (row: unknown[]) => [...Array(columnOffset).fill(null), ...row];
  const rows = [
    ["BÁO CÁO SẢN LƯỢNG CÁC CÔNG ĐOẠN SMD THEO TIME NGÀY 25/07/2026"],
    ["Ngày", "Ca", "Line", "Model", null, null, "Sản Lượng Từng Time"],
    [null, null, null, null, null, null, "Time A", null, null, null, null, "Time B", null, null, null, null, "Time C", null, null, null, null, "Time D", null, null, null, null, "Time E"],
    [null, null, null, null, null, null, "CAPA", "Sản Lượng Thực Tế", "Tỷ Lệ", "Time dừng máy (p)", "Ghi chú", "CAPA", "Sản Lượng Thực Tế", "Tỷ Lệ", "Time dừng máy (p)", "Ghi chú", "CAPA", "Sản Lượng Thực Tế", "Tỷ Lệ", "Time dừng máy (p)", "Ghi chú", "CAPA", "Sản Lượng Thực Tế", "Tỷ Lệ", "Time dừng máy (p)", "Ghi chú", "CAPA", "Sản Lượng Thực Tế", "Tỷ Lệ", "Time dừng máy (p)", "Ghi chú"],
    [null, "NIGHT", "Line 2", "MODEL-B", null, null, 10, 8, 0.8, 5, "setup", 10, 7, 0.7, 4, "repair", 10, 6, 0.6, 3, null, 10, 5, 0.5, 2, null, 10, 4, 0.4, 1, "changeover"],
  ].map(pad);
  return { sheet: "25.07", data: [...Array(rowOffset).fill([]), ...rows] };
}

describe("legacy Excel adapters", () => {
  it("parses AOI line and model rows from the anonymized workbook and recomputes NG", async () => {
    const result = parseAoiWorkbook(await readFixture("aoi-sample.xlsx"));
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceSheet: "AOI Line", sourceRow: 11, productionDate: "2026-07-27", lineCode: "LINE-1", modelCode: "MODEL-A", processCode: "AOI", inputQty: 100, okQty: 97, ngQty: 3, timeSlotCode: "A" }),
      expect.objectContaining({ sourceSheet: "aoi model", sourceRow: 9, productionDate: "2026-07-27", lineCode: "LINE-1", modelCode: "MODEL-A", inputQty: 100, okQty: 97 }),
    ]));
  });

  it("parses SPI line and model rows without trusting stored yield", async () => {
    const result = parseSpiWorkbook(await readFixture("spi-sample.xlsx"));
    expect(result.rows.map((row) => [row.lineCode, row.modelCode, row.inputQty, row.okQty, row.ngQty])).toEqual(expect.arrayContaining([
      ["LINE-1", "MODEL-A", 40, 39, 1],
    ]));
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceSheet: "SPI Line", sourceRow: 10, productionDate: "2026-07-27", modelCode: "MODEL-A", inputQty: 40, okQty: 39 }),
      expect.objectContaining({ sourceSheet: "SPI MODEL", sourceRow: 9, productionDate: "2026-07-27", modelCode: "MODEL-A", inputQty: 40, okQty: 39 }),
    ]));
  });

  it("keeps daily ICT and Xray quality rows untimed and skips aggregate rows with diagnostics", async () => {
    const ict = parseIctWorkbook(await readFixture("ict-sample.xlsx"));
    const xray = parseXrayWorkbook(await readFixture("xray-sample.xlsx"));
    expect(ict.rows).toHaveLength(1);
    expect(ict.rows[0]).toMatchObject({
      sourceSheet: "Data HS Công Đoạn ICT",
      sourceRow: 9,
      timeSlotCode: null,
      lineCode: "LINE-1",
      modelCode: "MODEL-A",
      inputQty: 20,
      actualQty: 0,
      okQty: 19,
      ngQty: 1,
      dimensions: {
        production: null,
        quality: { inputQty: 20, okQty: 19, ngQty: 1 },
      },
    });
    expect(xray.rows).toHaveLength(1);
    expect(xray.rows[0]).toMatchObject({
      sourceSheet: "Xray",
      sourceRow: 9,
      timeSlotCode: null,
      lineCode: "LINE-2",
      modelCode: "MODEL-A",
      inputQty: 20,
      actualQty: 0,
      okQty: 19,
      ngQty: 1,
      dimensions: {
        production: null,
        quality: { inputQty: 20, okQty: 19, ngQty: 1 },
      },
    });
    expect([...ict.diagnostics, ...xray.diagnostics]).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRow: 11, code: "missing-required-value", field: "modelCode" }),
    ]));
  });

  it("reports ICT incomplete rows and a missing ICT signature independently", () => {
    expect(parseIctWorkbook([{ sheet: "Data HS Công Đoạn ICT", data: [[null, "Data Theo Dõi Hiệu Suất"], [], [], [], [null, null, "27.07.2026", "DAY", null, null, "A", 2, 1]] }]).diagnostics).toContainEqual(expect.objectContaining({ field: "modelCode" }));
    expect(parseIctWorkbook([{ sheet: "Data HS Công Đoạn ICT", data: [["wrong"]] }]).diagnostics).toContainEqual(expect.objectContaining({ field: "headers" }));
  });

  it("reports Xray incomplete rows and a missing Xray signature independently", () => {
    expect(parseXrayWorkbook([{ sheet: "Xray", data: [[null, "Data Theo Dõi Hiệu Suất"], [], [], [], [null, null, "27.07.2026", "DAY", null, null, "A", 2, 1]] }]).diagnostics).toContainEqual(expect.objectContaining({ field: "modelCode" }));
    expect(parseXrayWorkbook([{ sheet: "Xray", data: [["wrong"]] }]).diagnostics).toContainEqual(expect.objectContaining({ field: "headers" }));
  });

  it("rejects legacy ICT and Xray rows whose OK quantity exceeds input", () => {
    const row = [null, null, "27.07.2026", "DAY", null, "MODEL-A", null, 1, 2];
    const ict = parseIctWorkbook([{
      sheet: "Data HS Công Đoạn ICT",
      data: [[null, "Data Theo Dõi Hiệu Suất"], [], [], [], row],
    }]);
    const xray = parseXrayWorkbook([{
      sheet: "Xray",
      data: [[null, "Data Theo Dõi Hiệu Suất"], [], [], [], row],
    }]);

    expect(ict.rows).toEqual([]);
    expect(xray.rows).toEqual([]);
    expect(ict.diagnostics).toContainEqual(expect.objectContaining({ sourceRow: 5, code: "invalid-count" }));
    expect(xray.diagnostics).toContainEqual(expect.objectContaining({ sourceRow: 5, code: "invalid-count" }));
  });

  it("expands production A-E cells, retains actuals and downtime, and ignores CAPA as input", async () => {
    const result = parseProductionWorkbook(await readFixture("production-sample.xlsx"));
    expect(result.rows).toHaveLength(35);
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceSheet: "25.07", sourceRow: 7, productionDate: "2026-07-25", lineCode: "LINE-1", modelCode: "MODEL-A", processCode: "AOI", timeSlotCode: "A", inputQty: 0, actualQty: 8, downtimeMinutes: 5, note: "setup" }),
      expect.objectContaining({ sourceSheet: "25.07", sourceRow: 11, lineCode: "XRAY-1", modelCode: "MODEL-A", processCode: "XRAY", timeSlotCode: "E", actualQty: 4 }),
      expect.objectContaining({ sourceSheet: "25.07", sourceRow: 12, lineCode: "ICT-1", modelCode: "MODEL-B", processCode: "ICT", timeSlotCode: "A", actualQty: 8 }),
      expect.objectContaining({ sourceSheet: "25.07", sourceRow: 13, lineCode: "ROUTER-2", modelCode: "MODEL-A", processCode: "ROUTER", timeSlotCode: "A", actualQty: 8 }),
    ]));
    expect(result.rows.every((row) => row.inputQty === 0 && row.okQty === 0 && row.ngQty === 0)).toBe(true);
    expect(result.rows.every((row) =>
      row.dimensions.production?.actualQty === row.actualQty
      && row.dimensions.quality === null)).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("maps positive legacy downtime without a reason to the registered review fallback", async () => {
    const result = parseProductionWorkbook(await readFixture("production-sample.xlsx"));
    const row = result.rows.find((candidate) => candidate.downtimeMinutes > 0);

    expect(row).toMatchObject({
      downtimeReasonCode: "LEGACY_UNSPECIFIED",
      warnings: ["legacy-downtime-reason-unspecified"],
    });
    expect(result.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "downtimeReasonCode" }),
    ]));
  });

  it("detects and parses a complete production table shifted down and right without changing normalized semantics", () => {
    const unshifted = productionSheet(0, 2);
    const shifted = productionSheet(3, 6);

    expect(detectWorkbook([shifted])).toEqual({ kind: "production", diagnostics: [] });
    const shiftedResult = parseProductionWorkbook([shifted]);
    const semanticRows = shiftedResult.rows.map(({ productionDate, shiftCode, lineCode, modelCode, processCode, timeSlotCode, actualQty, downtimeMinutes }) => ({
      productionDate, shiftCode, lineCode, modelCode, processCode, timeSlotCode, actualQty, downtimeMinutes,
    }));
    expect(semanticRows).toEqual([
      { productionDate: "2026-07-25", shiftCode: "NIGHT", lineCode: "LINE-2", modelCode: "MODEL-B", processCode: "AOI", timeSlotCode: "A", actualQty: 8, downtimeMinutes: 5 },
      { productionDate: "2026-07-25", shiftCode: "NIGHT", lineCode: "LINE-2", modelCode: "MODEL-B", processCode: "AOI", timeSlotCode: "B", actualQty: 7, downtimeMinutes: 4 },
      { productionDate: "2026-07-25", shiftCode: "NIGHT", lineCode: "LINE-2", modelCode: "MODEL-B", processCode: "AOI", timeSlotCode: "C", actualQty: 6, downtimeMinutes: 3 },
      { productionDate: "2026-07-25", shiftCode: "NIGHT", lineCode: "LINE-2", modelCode: "MODEL-B", processCode: "AOI", timeSlotCode: "D", actualQty: 5, downtimeMinutes: 2 },
      { productionDate: "2026-07-25", shiftCode: "NIGHT", lineCode: "LINE-2", modelCode: "MODEL-B", processCode: "AOI", timeSlotCode: "E", actualQty: 4, downtimeMinutes: 1 },
    ]);
    expect(semanticRows).toEqual(parseProductionWorkbook([unshifted]).rows.map(({ productionDate, shiftCode, lineCode, modelCode, processCode, timeSlotCode, actualQty, downtimeMinutes }) => ({
      productionDate, shiftCode, lineCode, modelCode, processCode, timeSlotCode, actualQty, downtimeMinutes,
    })));
    expect(shiftedResult.diagnostics).toEqual([]);
  });

  it("keeps production detector and parser rejection in parity for an incomplete shifted table", () => {
    const malformed = productionSheet(2, 5);
    malformed.data[5]![35] = null;

    expect(detectWorkbook([malformed]).kind).toBe("unknown");
    expect(parseProductionWorkbook([malformed])).toEqual({
      kind: "production",
      rows: [],
      diagnostics: [expect.objectContaining({ sourceSheet: "25.07", code: "missing-required-value", field: "headers" })],
    });
  });

  it("inherits merged legacy production line cells and ignores totals and empty time slots", () => {
    const sheet = productionSheet(0, 2);
    const firstDataRow = sheet.data[4]!;
    const continuation = [...firstDataRow];
    continuation[3] = null;
    continuation[4] = null;
    continuation[5] = "MODEL-C";
    continuation[14] = null;
    const total = [...firstDataRow];
    total[4] = "Total";
    total[5] = null;
    const strayFooter = [...Array(firstDataRow.length).fill(null)];
    strayFooter[14] = 34.75;
    sheet.data.push(continuation, total, strayFooter);

    const result = parseProductionWorkbook([sheet]);

    expect(result.diagnostics).toEqual([]);
    expect(result.rows).toHaveLength(9);
    expect(result.rows.slice(5)).toEqual(expect.arrayContaining([
      expect.objectContaining({ shiftCode: "NIGHT", lineCode: "LINE-2", modelCode: "MODEL-C", timeSlotCode: "A", actualQty: 8 }),
      expect.objectContaining({ lineCode: "LINE-2", modelCode: "MODEL-C", timeSlotCode: "C", actualQty: 6 }),
    ]));
    expect(result.rows.some(({ modelCode }) => !modelCode)).toBe(false);
  });

  it("uses the dated source sheet when a copied production title still contains an older day", () => {
    const staleTitle = productionSheet(0, 2);
    staleTitle.sheet = "26.07";

    const result = parseProductionWorkbook([staleTitle]);

    expect(result.diagnostics).toEqual([]);
    expect(result.rows).toHaveLength(5);
    expect(result.rows.every(({ productionDate }) => productionDate === "2026-07-26")).toBe(true);
  });

  it.each([
    ["AOI", "aoi model", parseAoiWorkbook],
    ["SPI", "SPI MODEL", parseSpiWorkbook],
  ] as const)("preserves %s model-sheet date state across malformed rows and resets it at totals", (process, sourceSheet, parse) => {
    const title = process === "AOI" ? "Data Theo Dõi Hiệu Suất Máy AOI" : "Hiệu Suất Máy SPI";
    const result = parse([{ sheet: sourceSheet, data: [
      [null, title],
      [],
      [],
      [],
      [null, null, "27.07.2026", "NIGHT", null, null, "MODEL-A", 10, 9],
      [null, null, null, null, null, null, "MODEL-B", 8, 7],
      [null, null, null, "TOTAL", null, null, null, 18, 16],
      [null, null, null, null, null, null, "MODEL-A", 6, 5],
      [null, null, "28.07.2026", "NIGHT", null, null, "MODEL-A", "bad", 4],
      [null, null, null, null, null, null, "MODEL-B", 5, 4],
      [null, null, null, "SECTION", null, null, null, 5, 4],
      [null, null, null, null, null, null, "MODEL-A", 4, 3],
    ] }]);

    expect(result.rows).toEqual([
      { sourceSheet, sourceRow: 5, productionDate: "2026-07-27", shiftCode: "NIGHT", timeSlotCode: null, lineCode: "LINE-1", modelCode: "MODEL-A", processCode: process, inputQty: 10, actualQty: 0, okQty: 9, ngQty: 1, downtimeMinutes: 0, downtimeReasonCode: null, note: "", dimensions: { production: null, quality: { inputQty: 10, okQty: 9, ngQty: 1 } }, warnings: [], defects: [] },
      { sourceSheet, sourceRow: 6, productionDate: "2026-07-27", shiftCode: "NIGHT", timeSlotCode: null, lineCode: "LINE-1", modelCode: "MODEL-B", processCode: process, inputQty: 8, actualQty: 0, okQty: 7, ngQty: 1, downtimeMinutes: 0, downtimeReasonCode: null, note: "", dimensions: { production: null, quality: { inputQty: 8, okQty: 7, ngQty: 1 } }, warnings: [], defects: [] },
      { sourceSheet, sourceRow: 10, productionDate: "2026-07-28", shiftCode: "NIGHT", timeSlotCode: null, lineCode: "LINE-1", modelCode: "MODEL-B", processCode: process, inputQty: 5, actualQty: 0, okQty: 4, ngQty: 1, downtimeMinutes: 0, downtimeReasonCode: null, note: "", dimensions: { production: null, quality: { inputQty: 5, okQty: 4, ngQty: 1 } }, warnings: [], defects: [] },
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ sourceSheet, sourceRow: 9, code: "invalid-count", field: "counts" }),
    ]);
    expect(result.diagnostics.some(({ sourceRow }) => sourceRow === 7 || sourceRow === 11)).toBe(false);
  });

  it.each([
    ["AOI", "aoi model", parseAoiWorkbook],
    ["SPI", "SPI MODEL", parseSpiWorkbook],
  ] as const)("ignores the secondary untargeted %s daily aggregate table", (process, sourceSheet, parse) => {
    const title = process === "AOI" ? "Data Theo Dõi Hiệu Suất Máy AOI" : "Hiệu Suất Máy SPI";
    const result = parse([{ sheet: sourceSheet, data: [
      [null, title],
      [],
      [],
      [null, null, "Date", "Shift", null, null, "Model.", "Input", "OK"],
      [null, null, "27.07.2026", "DAY", null, null, "MODEL-A", 10, 9],
      [null, new Date(2026, 6, 27), null, null, null, null, "MODEL-B", 20, 19],
      [null, null, null, null, null, null, "MODEL-C", 30, 29],
    ] }]);

    expect(result.diagnostics).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ modelCode: "MODEL-A", inputQty: 10, okQty: 9 });
  });

  it("returns row-specific diagnostics instead of throwing for malformed in-memory quality data", () => {
    const result = parseAoiWorkbook([{ sheet: "AOI Line", data: [["Date", "Shift", "Time", "Line", "Model", "Input", "OK", "Yield"], ["27.07.2026", "DAY", "A", "AOI Line 1", "MODEL-A", 8, 9, 1]] }]);
    expect(result.rows).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ sourceRow: 1, code: "missing-required-value", field: "headers" }));
  });
});
