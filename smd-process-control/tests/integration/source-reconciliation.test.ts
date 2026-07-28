import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import readXlsxFile from "read-excel-file/node";
import { describe, expect, it } from "vitest";
import { parseAoiWorkbook } from "../../src/excel/adapters/aoi-adapter";
import { parseIctWorkbook } from "../../src/excel/adapters/ict-adapter";
import { parseProductionWorkbook } from "../../src/excel/adapters/production-adapter";
import { parseSpiWorkbook } from "../../src/excel/adapters/spi-adapter";
import { parseXrayWorkbook } from "../../src/excel/adapters/xray-adapter";
import type { ImportParseResult, WorkbookSheet } from "../../src/excel/contracts";

type Representative = {
  fileNameHash: string;
  parse(sheets: WorkbookSheet[]): ImportParseResult;
  sourceSheet: string;
  sourceRow: number;
  timeSlotCode: string | null;
  productionDate: string;
  lineHash: string;
  modelHash: string;
  quantities: { inputQty: number; actualQty: number; okQty: number; ngQty: number };
};

const hash = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);

const representatives: Representative[] = [
  {
    fileNameHash: "64859e73b980",
    parse: parseAoiWorkbook,
    sourceSheet: "aoi model",
    sourceRow: 43,
    timeSlotCode: null,
    productionDate: "2026-07-01",
    lineHash: "5907689dd92e",
    modelHash: "bea79b31a1e3",
    quantities: { inputQty: 17629, actualQty: 17610, okQty: 17610, ngQty: 19 },
  },
  {
    fileNameHash: "0a1a76cc6379",
    parse: parseSpiWorkbook,
    sourceSheet: "SPI MODEL.",
    sourceRow: 48,
    timeSlotCode: null,
    productionDate: "2026-07-01",
    lineHash: "5907689dd92e",
    modelHash: "bea79b31a1e3",
    quantities: { inputQty: 17615, actualQty: 17610, okQty: 17610, ngQty: 5 },
  },
  {
    fileNameHash: "31a742eed8cb",
    parse: parseIctWorkbook,
    sourceSheet: "ICT.",
    sourceRow: 12,
    timeSlotCode: null,
    productionDate: "2026-07-01",
    lineHash: "5907689dd92e",
    modelHash: "42365ea1c7b0",
    quantities: { inputQty: 4756, actualQty: 4708, okQty: 4708, ngQty: 48 },
  },
  {
    fileNameHash: "2eb9f7de29d8",
    parse: parseXrayWorkbook,
    sourceSheet: "Xray",
    sourceRow: 19,
    timeSlotCode: null,
    productionDate: "2026-07-01",
    lineHash: "775fea3acb6c",
    modelHash: "0ad240e66027",
    quantities: { inputQty: 10850, actualQty: 10850, okQty: 10850, ngQty: 0 },
  },
  {
    fileNameHash: "64e74a99b3a2",
    parse: parseProductionWorkbook,
    sourceSheet: "25.07",
    sourceRow: 7,
    timeSlotCode: "A",
    productionDate: "2026-07-25",
    lineHash: "5907689dd92e",
    modelHash: "42365ea1c7b0",
    quantities: { inputQty: 0, actualQty: 2970, okQty: 0, ngQty: 0 },
  },
];

async function readWorkbook(file: string): Promise<WorkbookSheet[]> {
  const bytes = await fs.readFile(file);
  const sheetNames = await readXlsxFile(bytes, { getSheets: true });
  return Promise.all(sheetNames.map(async ({ name }) => ({
    sheet: name,
    data: await readXlsxFile(bytes, { sheet: name }),
  })));
}

describe("preserved source workbook reconciliation", () => {
  it("matches one anonymized date/model/line quantity record in each of the five read-only originals", async () => {
    const sourceDirectory = process.env.SMD_SOURCE_WORKBOOK_DIR;
    expect(
      sourceDirectory,
      "Set SMD_SOURCE_WORKBOOK_DIR to the read-only directory containing the five original workbooks.",
    ).toBeTruthy();

    const entries = await fs.readdir(sourceDirectory!);
    expect(entries.filter((name) => name.toLowerCase().endsWith(".xlsx"))).toHaveLength(5);
    const byHash = new Map(entries.map((name) => [hash(name), path.join(sourceDirectory!, name)]));

    for (const expected of representatives) {
      const sourceFile = byHash.get(expected.fileNameHash);
      expect(sourceFile, `missing preserved source workbook ${expected.fileNameHash}`).toBeDefined();
      const result = expected.parse(await readWorkbook(sourceFile!));
      const row = result.rows.find((candidate) =>
        candidate.sourceSheet === expected.sourceSheet
        && candidate.sourceRow === expected.sourceRow
        && candidate.timeSlotCode === expected.timeSlotCode);
      expect(row, `missing representative row for ${expected.fileNameHash}`).toBeDefined();
      expect({
        productionDate: row!.productionDate,
        lineHash: hash(row!.lineCode),
        modelHash: hash(row!.modelCode),
        inputQty: row!.inputQty,
        actualQty: row!.actualQty,
        okQty: row!.okQty,
        ngQty: row!.ngQty,
      }).toEqual({
        productionDate: expected.productionDate,
        lineHash: expected.lineHash,
        modelHash: expected.modelHash,
        ...expected.quantities,
      });
    }
  }, 120_000);
});
