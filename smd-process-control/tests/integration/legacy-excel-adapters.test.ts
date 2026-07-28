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

async function readFixture(name: string): Promise<WorkbookSheet[]> {
  const file = path.join(import.meta.dirname, "..", "fixtures", name);
  const names = await readXlsxFile(await fs.readFile(file), { getSheets: true });
  return Promise.all(names.map(async ({ name: sheet }) => ({ sheet, data: await readXlsxFile(await fs.readFile(file), { sheet }) })));
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
    expect(ict.rows[0]).toMatchObject({ sourceSheet: "Data HS Công Đoạn ICT", sourceRow: 9, timeSlotCode: null, lineCode: "LINE-1", modelCode: "MODEL-A", inputQty: 20, okQty: 19, ngQty: 1 });
    expect(xray.rows).toHaveLength(1);
    expect(xray.rows[0]).toMatchObject({ sourceSheet: "Xray", sourceRow: 9, timeSlotCode: null, lineCode: "LINE-2", modelCode: "MODEL-A", inputQty: 20, okQty: 19, ngQty: 1 });
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
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ sourceRow: 14, code: "missing-required-value", field: "modelCode" })]));
  });

  it("returns row-specific diagnostics instead of throwing for malformed in-memory quality data", () => {
    const result = parseAoiWorkbook([{ sheet: "AOI Line", data: [["Date", "Shift", "Time", "Line", "Model", "Input", "OK", "Yield"], ["27.07.2026", "DAY", "A", "AOI Line 1", "MODEL-A", 8, 9, 1]] }]);
    expect(result.rows).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ sourceRow: 1, code: "missing-required-value", field: "headers" }));
  });
});
