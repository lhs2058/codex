import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import readXlsxFile from "read-excel-file/node";
import { describe, expect, it, vi } from "vitest";
import type { MasterDataSnapshot, ProcessCode, WorkbookKind } from "../../src/domain/types";
import {
  createUploadRepository,
  parseDetectedWorkbook,
  type UploadRepositoryClient,
} from "../../src/data/repositories/upload-repository";
import type { NormalizedImportRow, WorkbookSheet } from "../../src/excel/contracts";
import { detectWorkbook } from "../../src/excel/detect-workbook";

type Representative = {
  fileNameHash: string;
  contentHash: string;
  kind: Exclude<WorkbookKind, "standard" | "unknown">;
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
    contentHash: "b6b972f784d0dce2",
    kind: "aoi",
    sourceSheet: "aoi model",
    sourceRow: 43,
    timeSlotCode: null,
    productionDate: "2026-07-01",
    lineHash: "5907689dd92e",
    modelHash: "bea79b31a1e3",
    quantities: { inputQty: 17629, actualQty: 0, okQty: 17610, ngQty: 19 },
  },
  {
    fileNameHash: "0a1a76cc6379",
    contentHash: "b1a7ff34e021d9da",
    kind: "spi",
    sourceSheet: "SPI MODEL.",
    sourceRow: 48,
    timeSlotCode: null,
    productionDate: "2026-07-01",
    lineHash: "5907689dd92e",
    modelHash: "bea79b31a1e3",
    quantities: { inputQty: 17615, actualQty: 0, okQty: 17610, ngQty: 5 },
  },
  {
    fileNameHash: "31a742eed8cb",
    contentHash: "ae18cdfa6724be65",
    kind: "ict",
    sourceSheet: "ICT.",
    sourceRow: 12,
    timeSlotCode: null,
    productionDate: "2026-07-01",
    lineHash: "5907689dd92e",
    modelHash: "42365ea1c7b0",
    quantities: { inputQty: 4756, actualQty: 0, okQty: 4708, ngQty: 48 },
  },
  {
    fileNameHash: "2eb9f7de29d8",
    contentHash: "585a4d5647bc00fe",
    kind: "xray",
    sourceSheet: "Xray",
    sourceRow: 19,
    timeSlotCode: null,
    productionDate: "2026-07-01",
    lineHash: "775fea3acb6c",
    modelHash: "0ad240e66027",
    quantities: { inputQty: 10850, actualQty: 0, okQty: 10850, ngQty: 0 },
  },
  {
    fileNameHash: "64e74a99b3a2",
    contentHash: "f4cda2c1efeef78d",
    kind: "production",
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

function registeredMasters(rows: NormalizedImportRow[]): MasterDataSnapshot {
  const unique = <T,>(values: T[]) => [...new Set(values)];
  const models = unique(rows.map((row) => row.modelCode)).map((code, index) => ({
    id: `model-${index}`,
    code,
    name: code,
    active: true,
    version: 1,
  }));
  const lines = unique(rows.map((row) => row.lineCode)).map((code, index) => ({
    id: `line-${index}`,
    code,
    name: code,
    active: true,
  }));
  const processes = unique(rows.map((row) => row.processCode)).map((code, index) => ({
    id: `process-${index}`,
    code: code as ProcessCode,
    name: code,
    active: true,
  }));
  const shifts = unique(rows.map((row) => row.shiftCode)).map((code, index) => ({
    id: `shift-${index}`,
    code,
    name: code,
    active: true,
  }));
  const timeSlots = unique(rows.flatMap((row) => row.timeSlotCode ? [`${row.shiftCode}|${row.timeSlotCode}`] : []))
    .map((key, index) => {
      const [shiftCode, code] = key.split("|");
      return {
        id: `slot-${index}`,
        shiftId: shifts.find((shift) => shift.code === shiftCode)!.id,
        code: code!,
        startsAt: "00:00",
        endsAt: "01:00",
        endDayOffset: 0 as const,
        sequence: index + 1,
      };
    });
  return {
    models,
    lines,
    processes,
    shifts,
    timeSlots,
    downtimeReasons: [{
      id: "legacy-unspecified",
      code: "LEGACY_UNSPECIFIED",
      name: "Legacy unspecified",
      active: true,
      version: 1,
    }],
    standardTimes: [],
  };
}

function stagingClient(batchId: string): UploadRepositoryClient {
  const stagedRows: any[] = [];
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "reconciliation-user" } }, error: null }) },
    storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: `${batchId}.xlsx` }, error: null }) }) },
    from: vi.fn((table: string) => ({
      insert: table === "upload_batches"
        ? () => ({ select: () => ({ single: async () => ({ data: { id: batchId }, error: null }) }) })
        : (value: any[]) => {
          stagedRows.push(...value);
          return Promise.resolve({ data: null, error: null });
        },
    })) as UploadRepositoryClient["from"],
    rpc: vi.fn(async (name: string) => ({
      data: name === "stage_upload_candidates"
        ? { batchId, masterCandidateCount: 0, standardTimeCandidateCount: 0 }
        : name === "list_upload_detail_page"
          ? {
            total: stagedRows.length,
            rows: stagedRows.slice(0, 200).map((row) => ({
              sourceSheet: row.source_sheet,
              sourceRow: row.source_row,
              rowKind: row.row_kind,
              payload: row.payload,
              status: row.status,
              messages: row.messages,
              targetRecordId: row.target_record_id,
              expectedTargetVersion: row.expected_target_version,
            })),
          }
          : null,
      error: null,
    })),
  };
}

describe("preserved source workbook reconciliation", () => {
  it("detects, normally dispatches, and normally stages all five read-only originals", async () => {
    const sourceDirectory = process.env.SMD_SOURCE_WORKBOOK_DIR;
    expect(
      sourceDirectory,
      "Set SMD_SOURCE_WORKBOOK_DIR to the read-only directory containing the five original workbooks.",
    ).toBeTruthy();

    const entries = await fs.readdir(sourceDirectory!);
    expect(entries.filter((name) => name.toLowerCase().endsWith(".xlsx"))).toHaveLength(5);
    const byHash = new Map(entries.map((name) => [hash(name), path.join(sourceDirectory!, name)]));
    const counts: Array<{
      kind: string;
      parsed: number;
    }> = [];

    for (const expected of representatives) {
      const sourceFile = byHash.get(expected.fileNameHash);
      expect(sourceFile, `missing preserved source workbook ${expected.fileNameHash}`).toBeDefined();
      const bytesBefore = await fs.readFile(sourceFile!);
      expect(hash(bytesBefore.toString("base64"))).not.toBe("");
      expect(crypto.createHash("sha256").update(bytesBefore).digest("hex").slice(0, 16)).toBe(expected.contentHash);
      const sheets = await readWorkbook(sourceFile!);
      expect(detectWorkbook(sheets)).toEqual({ kind: expected.kind, diagnostics: [] });
      const result = parseDetectedWorkbook(sheets);
      expect(result.kind).toBe(expected.kind);
      expect(result.diagnostics.every((diagnostic) =>
        diagnostic.sourceSheet.length > 0 && diagnostic.sourceRow > 0)).toBe(true);
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

      const repository = createUploadRepository(stagingClient(`${expected.fileNameHash}-batch`), {
        createId: () => expected.fileNameHash,
        readWorkbook: async () => sheets,
        listMasterData: async () => registeredMasters(result.rows),
        findExisting: async () => null,
      });
      const workbook = new File([bytesBefore], `${expected.fileNameHash}.xlsx`);
      Object.defineProperty(workbook, "arrayBuffer", { value: async () => bytesBefore.buffer.slice(bytesBefore.byteOffset, bytesBefore.byteOffset + bytesBefore.byteLength) });
      const review = await repository.stageUpload(workbook);
      expect(review.unknownMasterDataCount).toBe(0);
      expect(review.newCount + review.conflictCount + review.errorCount).toBe(result.rows.length + result.diagnostics.length);
      expect(review.rows.length + review.diagnostics.length).toBeLessThanOrEqual(200);
      counts.push({
        kind: expected.kind,
        parsed: result.rows.length,
      });
      if (expected.kind === "production") {
        expect(result.diagnostics).toEqual([]);
        expect(result.rows).toHaveLength(14_708);
        expect(review.newCount + review.errorCount).toBe(14_708);
      } else {
        expect(review.rows.every((candidate) =>
          candidate.dimensions.production === null
          && candidate.actualQty === 0)).toBe(true);
      }
      const bytesAfter = await fs.readFile(sourceFile!);
      expect(crypto.createHash("sha256").update(bytesAfter).digest("hex").slice(0, 16)).toBe(expected.contentHash);
    }
    expect(counts).toEqual([
      { kind: "aoi", parsed: 239 },
      { kind: "spi", parsed: 271 },
      { kind: "ict", parsed: 90 },
      { kind: "xray", parsed: 262 },
      { kind: "production", parsed: 14_708 },
    ]);
  }, 120_000);
});
