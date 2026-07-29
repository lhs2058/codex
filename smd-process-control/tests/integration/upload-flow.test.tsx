import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  MasterDataSnapshot,
  UploadReview,
} from "../../src/domain/types";
import type { ImportParseResult } from "../../src/excel/contracts";
import {
  createUploadRepository,
  parseDetectedWorkbook,
  type LegacyUploadReview,
  type UploadRepositoryClient,
} from "../../src/data/repositories/upload-repository";
import { UploadPage } from "../../src/features/upload/UploadPage";
import { UploadReviewTable } from "../../src/features/upload/UploadReviewTable";
import { UploadStandardTimeReview } from "../../src/features/upload/UploadStandardTimeReview";

const masterData: MasterDataSnapshot = {
  models: [{ id: "m", code: "MODEL-A", name: "Model A", active: true, version: 1 }],
  processes: [{ id: "p", code: "AOI", name: "AOI", active: true }],
  lines: [{ id: "l", code: "LINE-1", name: "Line 1", active: true }],
  shifts: [{ id: "s", code: "DAY", name: "Day", active: true }],
  timeSlots: [{ id: "t", shiftId: "s", code: "A", startsAt: "08:00", endsAt: "10:00", endDayOffset: 0, sequence: 1 }],
  downtimeReasons: [{ id: "d", code: "WAIT", name: "Waiting", active: true, version: 1 }],
  standardTimes: [],
};

const parsedRow = {
  sourceSheet: "Production",
  sourceRow: 3,
  productionDate: "2026-07-28",
  shiftCode: "DAY",
  timeSlotCode: "A",
  lineCode: "LINE-1",
  modelCode: "MODEL-A",
  processCode: "AOI" as const,
  inputQty: 10,
  actualQty: 9,
  okQty: 8,
  ngQty: 1,
  downtimeMinutes: 5,
  downtimeReasonCode: "WAIT",
  note: "",
  dimensions: {
    production: { inputQty: 10, actualQty: 9 },
    quality: { inputQty: 10, okQty: 8, ngQty: 1 },
  },
  warnings: [],
  defects: [],
};

function review(overrides: Partial<UploadReview> = {}): UploadReview {
  return {
    batchId: "batch-1",
    newCount: 1,
    conflictCount: 0,
    errorCount: 0,
    unknownMasterDataCount: 0,
    rows: [{ ...parsedRow, status: "new", messages: [] }],
    diagnostics: [],
    ...overrides,
  };
}

const masterCandidate = {
  key: "model|MODEL-1",
  entity: "model" as const,
  code: "MODEL-1",
  parentCode: null,
  proposedName: "MODEL-1",
  status: "new" as const,
  approved: false,
  conflictReason: null,
  currentName: null,
  resolvable: true,
  startsAt: null,
  endsAt: null,
  endDayOffset: null,
  sequence: null,
  messages: [],
  sources: [{ sheet: "Production", row: 8 }],
};

const standardTimeCandidate = {
  key: "MODEL-1|AOI-1|AOI",
  modelCode: "MODEL-1",
  lineCode: "AOI-1",
  processCode: "AOI" as const,
  status: "conflict" as const,
  approved: false,
  proposedSecondsPerUnit: null,
  approvedSecondsPerUnit: null,
  minimum: 10,
  median: 10.5,
  maximum: 11.1,
  effectiveFrom: "2026-07-28",
  effectiveTo: null,
  messages: ["CAPA evidence deviates by more than 5% from the median"],
  observations: [
    {
      productionDate: "2026-07-28",
      shiftCode: "DAY",
      timeSlotCode: "A",
      capacityQty: 720,
      plannedSeconds: 7200,
      secondsPerUnit: 10,
      sheet: "Production",
      row: 8,
    },
    {
      productionDate: "2026-07-29",
      shiftCode: "DAY",
      timeSlotCode: "A",
      capacityQty: 685.714,
      plannedSeconds: 7200,
      secondsPerUnit: 10.5,
      sheet: "Production",
      row: 9,
    },
    {
      productionDate: "2026-07-30",
      shiftCode: "DAY",
      timeSlotCode: "A",
      capacityQty: 648.649,
      plannedSeconds: 7200,
      secondsPerUnit: 11.1,
      sheet: "Production",
      row: 10,
    },
  ],
};

function legacyReview(overrides: Partial<LegacyUploadReview> = {}): LegacyUploadReview {
  return {
    ...review(),
    sourceFileName: "legacy-production.xlsx",
    sourceSha256: "a".repeat(64),
    workbookKind: "production",
    masterCandidates: [masterCandidate],
    standardTimeCandidates: [standardTimeCandidate],
    masterCandidateCount: 1,
    standardTimeCandidateCount: 1,
    stWarnings: [],
    defectCount: 0,
    detailTotal: 1,
    detailPage: 1,
    ...overrides,
  };
}

function file() {
  const workbook = new File(["xlsx"], "production.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  Object.defineProperty(workbook, "arrayBuffer", {
    value: async () => new TextEncoder().encode("xlsx").buffer,
  });
  return workbook;
}

function candidateRpc(events?: string[]) {
  return vi.fn(async (name: string) => {
    if (name === "find_completed_upload_by_hash") events?.push("hash-check");
    if (name === "stage_upload_candidates") events?.push("stage-candidates");
    if (name === "list_upload_detail_page") events?.push("detail-page");
    return {
      data: name === "stage_upload_candidates"
        ? { batchId: "batch-1", masterCandidateCount: 4, standardTimeCandidateCount: 0 }
        : name === "list_upload_detail_page"
          ? { total: 0, rows: [] }
        : null,
      error: null,
    };
  });
}

describe("upload repository", () => {
  it("stores the original first, then persists the batch and normalized rows", async () => {
    const events: string[] = [];
    const inserted: Record<string, unknown> = {};
    const rpc = candidateRpc(events);
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: vi.fn().mockReturnValue({ upload: vi.fn().mockImplementation(async () => { events.push("storage"); return { data: { path: "user-1/upload-1-production.xlsx" }, error: null }; }) }) },
      from: vi.fn((table: string) => ({
        insert: (value: unknown) => {
          events.push(table);
          inserted[table] = value;
          return table === "upload_batches"
            ? { select: () => ({ single: async () => ({ data: { id: "batch-1" }, error: null }) }) }
            : Promise.resolve({ data: null, error: null });
        },
      })),
      rpc,
    } as unknown as UploadRepositoryClient;
    const parseResult: ImportParseResult = { kind: "standard", rows: [parsedRow], diagnostics: [], capacityEvidence: [], stWarnings: [] };
    const repository = createUploadRepository(client, {
      createId: () => "upload-1",
      readWorkbook: vi.fn().mockResolvedValue([{ sheet: "Production", data: [] }]),
      parseWorkbook: () => parseResult,
      listMasterData: vi.fn().mockResolvedValue(masterData),
      findExisting: vi.fn().mockResolvedValue(null),
    });

    await expect(repository.stageUpload(file())).resolves.toEqual(expect.objectContaining({
      batchId: "batch-1",
      newCount: 1,
      errorCount: 0,
    }));
    expect(events).toEqual(["hash-check", "storage", "upload_batches", "upload_rows", "stage-candidates", "detail-page"]);
    expect(inserted.upload_batches).toEqual(expect.objectContaining({
      storage_path: "user-1/upload-1-production.xlsx",
      workbook_kind: "standard",
      status: "validated",
      created_by: "user-1",
      source_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(inserted.upload_rows).toEqual([expect.objectContaining({
      batch_id: "batch-1",
      source_sheet: "Production",
      source_row: 3,
      row_kind: "production",
      target_record_id: null,
      expected_target_version: null,
      status: "new",
      payload: {
        contractVersion: 2,
        sourceTrace: { sheet: "Production", row: 3 },
        productionDate: "2026-07-28",
        shiftCode: "DAY",
        timeSlotCode: "A",
        lineCode: "LINE-1",
        modelCode: "MODEL-A",
        processCode: "AOI",
        note: "",
        production: { inputQty: 10, actualQty: 9 },
        quality: { inputQty: 10, okQty: 8, ngQty: 1 },
        downtime: { minutes: 5, reasonCode: "WAIT" },
        defects: [],
        warnings: [],
      },
    })]);
    expect(rpc).toHaveBeenCalledWith("stage_upload_candidates", expect.objectContaining({
      p_master_candidates: expect.arrayContaining([
        expect.objectContaining({
          key: "model|MODEL-A",
          conflictReason: "name-mismatch",
          currentName: "Model A",
          resolvable: true,
        }),
        expect.objectContaining({
          key: "time_slot|DAY|A",
          conflictReason: "slot-mismatch",
          currentName: "A",
          resolvable: false,
        }),
      ]),
    }));
  });

  it("returns a completed batch by SHA-256 without uploading or creating another batch", async () => {
    const storage = vi.fn();
    const batches = vi.fn();
    const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
      if (name === "find_completed_upload_by_hash") {
        expect(params.p_source_sha256).toMatch(/^[0-9a-f]{64}$/);
        return { data: {
          id: "completed-1", sourceFileName: "already.xlsx", workbookKind: "production", completedAt: "2026-07-29T00:00:00Z",
          newCount: 401, conflictCount: 10, errorCount: 2, defectCount: 33, detailTotal: 413,
        }, error: null };
      }
      if (name === "list_upload_detail_page") {
        expect(params).toEqual({ p_batch_id: "completed-1", p_offset: 0, p_limit: 200, p_status: null });
        return { data: { total: 1, rows: [{ sourceSheet: "Production", sourceRow: 3, rowKind: "production", status: "new", messages: [], targetRecordId: null, expectedTargetVersion: null, payload: {
          productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A", lineCode: "LINE-1", modelCode: "MODEL-A", processCode: "AOI", note: "", production: { inputQty: 10, actualQty: 9 }, quality: { inputQty: 10, okQty: 8, ngQty: 1 }, downtime: null, defects: [], warnings: [],
        } }] }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const repository = createUploadRepository({
      storage: { from: storage },
      from: batches,
      rpc,
    } as unknown as UploadRepositoryClient, {
      readWorkbook: vi.fn(),
      parseWorkbook: vi.fn(),
      listMasterData: vi.fn(),
      findExisting: vi.fn(),
    });

    await expect(repository.stageUpload(file())).resolves.toMatchObject({
      batchId: "completed-1",
      sourceFileName: "already.xlsx",
      duplicateCompletedBatch: true,
      detailTotal: 413,
      newCount: 401,
      conflictCount: 10,
      errorCount: 2,
      defectCount: 33,
      rows: [expect.objectContaining({ sourceRow: 3, status: "new" })],
    });
    expect(storage).not.toHaveBeenCalled();
    expect(batches).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "find_completed_upload_by_hash",
      "list_upload_detail_page",
    ]);
  });

  it("loads a 200-row status-filtered detail page from the server", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        total: 401,
        rows: [{ sourceSheet: "Production", sourceRow: 203, rowKind: "production", status: "error", messages: ["Invalid quantity"], targetRecordId: null, expectedTargetVersion: null, payload: {
          productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A", lineCode: "LINE-1", modelCode: "MODEL-A", processCode: "AOI", note: "", production: { inputQty: 10, actualQty: 9 }, quality: { inputQty: 10, okQty: 8, ngQty: 1 }, downtime: null, defects: [], warnings: [],
        } }],
      },
      error: null,
    });
    const repository = createUploadRepository({ rpc } as unknown as UploadRepositoryClient);

    await expect(repository.loadDetailPage("batch-1", 2, "error")).resolves.toEqual(expect.objectContaining({
      page: 2,
      pageSize: 200,
      total: 401,
      rows: [expect.objectContaining({ sourceRow: 203, status: "error", messages: ["Invalid quantity"] })],
      diagnostics: [],
    }));
    expect(rpc).toHaveBeenCalledWith("list_upload_detail_page", {
      p_batch_id: "batch-1",
      p_offset: 200,
      p_limit: 200,
      p_status: "error",
    });
  });

  it("returns only the first server detail page after staging while retaining parse aggregate counts", async () => {
    const insertedRows = vi.fn().mockResolvedValue({ data: null, error: null });
    const rpc = vi.fn(async (name: string) => {
      if (name === "find_completed_upload_by_hash") return { data: null, error: null };
      if (name === "stage_upload_candidates") return { data: { masterCandidateCount: 0, standardTimeCandidateCount: 0 }, error: null };
      if (name === "list_upload_detail_page") return { data: { total: 201, rows: [{ sourceSheet: "Production", sourceRow: 3, rowKind: "production", status: "new", messages: [], payload: {
        productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A", lineCode: "LINE-1", modelCode: "MODEL-A", processCode: "AOI", note: "", production: { inputQty: 10, actualQty: 9 }, quality: null, downtime: null, defects: [], warnings: [],
      } }] }, error: null };
      throw new Error(`unexpected RPC ${name}`);
    });
    const repository = createUploadRepository({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => ({ insert: table === "upload_batches"
        ? () => ({ select: () => ({ single: async () => ({ data: { id: "paged-batch" }, error: null }) }) })
        : insertedRows })),
      rpc,
    } as unknown as UploadRepositoryClient, {
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({ kind: "production", rows: [parsedRow, { ...parsedRow, sourceRow: 4, productionDate: "2026-07-29" }], diagnostics: [], capacityEvidence: [], stWarnings: [] }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
      findExisting: vi.fn().mockResolvedValue(null),
    });

    await expect(repository.stageUpload(file())).resolves.toMatchObject({
      newCount: 2,
      detailTotal: 201,
      detailPage: 1,
      rows: [expect.objectContaining({ sourceRow: 3 })],
    });
  });

  it("maps invalid candidate dimensions to source detail-row errors", async () => {
    const insertedRows = vi.fn().mockResolvedValue({ data: null, error: null });
    const rpc = vi.fn(async (name: string) => {
      if (name === "find_completed_upload_by_hash") return { data: null, error: null };
      if (name === "stage_upload_candidates") return { data: { masterCandidateCount: 0, standardTimeCandidateCount: 0 }, error: null };
      if (name === "list_upload_detail_page") return { data: { total: 1, rows: [] }, error: null };
      throw new Error(`unexpected RPC ${name}`);
    });
    const repository = createUploadRepository({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => ({ insert: table === "upload_batches"
        ? () => ({ select: () => ({ single: async () => ({ data: { id: "invalid-dimension" }, error: null }) }) })
        : insertedRows })),
      rpc,
    } as unknown as UploadRepositoryClient, {
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({ kind: "production", rows: [{ ...parsedRow, shiftCode: "WEEKEND" }], diagnostics: [], capacityEvidence: [], stWarnings: [] }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
      findExisting: vi.fn().mockResolvedValue(null),
    });

    await expect(repository.stageUpload(file())).resolves.toMatchObject({ errorCount: 1 });
    expect(insertedRows).toHaveBeenCalledWith([expect.objectContaining({
      source_row: 3,
      status: "error",
      row_kind: "diagnostic",
      messages: expect.arrayContaining(["Unsupported shiftCode: shift"]),
    })]);
  });

  it("keeps the persisted batch id when candidate staging throws a runtime error", async () => {
    const repository = createUploadRepository({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => ({ insert: table === "upload_batches"
        ? () => ({ select: () => ({ single: async () => ({ data: { id: "retry-batch" }, error: null }) }) })
        : vi.fn().mockResolvedValue({ data: null, error: null }) })),
      rpc: vi.fn(async (name: string) => {
        if (name === "find_completed_upload_by_hash") return { data: null, error: null };
        if (name === "stage_upload_candidates") throw new Error("network lost");
        throw new Error(`unexpected RPC ${name}`);
      }),
    } as unknown as UploadRepositoryClient, {
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({ kind: "production", rows: [parsedRow], diagnostics: [], capacityEvidence: [], stWarnings: [] }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
      findExisting: vi.fn().mockResolvedValue(null),
    });

    await expect(repository.stageUpload(file())).rejects.toMatchObject({ message: "network lost", batchId: "retry-batch" });
  });

  it("keeps the persisted batch id and RPC error details when the post-stage detail page fails", async () => {
    const repository = createUploadRepository({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => ({ insert: table === "upload_batches"
        ? () => ({ select: () => ({ single: async () => ({ data: { id: "page-retry-batch" }, error: null }) }) })
        : vi.fn().mockResolvedValue({ data: null, error: null }) })),
      rpc: vi.fn(async (name: string) => {
        if (name === "find_completed_upload_by_hash") return { data: null, error: null };
        if (name === "stage_upload_candidates") return { data: { masterCandidateCount: 0, standardTimeCandidateCount: 0 }, error: null };
        if (name === "list_upload_detail_page") return { data: null, error: { code: "57014", message: "detail page timed out" } };
        throw new Error(`unexpected RPC ${name}`);
      }),
    } as unknown as UploadRepositoryClient, {
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({ kind: "production", rows: [parsedRow], diagnostics: [], capacityEvidence: [], stWarnings: [] }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
      findExisting: vi.fn().mockResolvedValue(null),
    });

    await expect(repository.stageUpload(file())).rejects.toMatchObject({
      message: "detail page timed out",
      code: "57014",
      batchId: "page-retry-batch",
    });
  });

  it("stages derived master candidates while keeping rows with candidate masters committable", async () => {
    const insertedRows = vi.fn().mockResolvedValue({ data: null, error: null });
    const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
      if (name === "find_completed_upload_by_hash") return { data: null, error: null };
      if (name === "stage_upload_candidates") {
        expect(params.p_batch_id).toBe("batch-candidates");
        expect(params.p_master_candidates).toEqual(expect.arrayContaining([
          expect.objectContaining({ key: "model|MODEL-A", entity: "model", status: "new" }),
          expect.objectContaining({ key: "time_slot|DAY|A", entity: "time_slot", status: "new" }),
        ]));
        expect(params.p_standard_time_candidates).toEqual([]);
        return { data: { batchId: "batch-candidates", masterCandidateCount: 4, standardTimeCandidateCount: 0 }, error: null };
      }
      if (name === "list_upload_detail_page") return { data: { total: 1, rows: [] }, error: null };
      throw new Error(`unexpected RPC ${name}`);
    });
    const candidateMasterData = {
      ...masterData,
      models: [],
      lines: [],
      shifts: [],
      timeSlots: [],
      downtimeReasons: [],
    };
    const repository = createUploadRepository({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => ({
        insert: table === "upload_batches"
          ? () => ({ select: () => ({ single: async () => ({ data: { id: "batch-candidates" }, error: null }) }) })
          : insertedRows,
      })),
      rpc,
    } as unknown as UploadRepositoryClient, {
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({ kind: "production", rows: [parsedRow], diagnostics: [], capacityEvidence: [], stWarnings: [] }),
      listMasterData: vi.fn().mockResolvedValue(candidateMasterData),
      findExisting: vi.fn().mockResolvedValue(null),
    });

    const result = await repository.stageUpload(file());

    expect(result).toMatchObject({ newCount: 1, errorCount: 0, unknownMasterDataCount: 0, masterCandidateCount: 4 });
    expect(insertedRows).toHaveBeenCalledWith([expect.objectContaining({ status: "new", row_kind: "production" })]);
  });

  it("keeps source-located standard-time warnings out of row errors and detail diagnostics", async () => {
    const insertedRows = vi.fn().mockResolvedValue({ data: null, error: null });
    const repository = createUploadRepository({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => ({
        insert: table === "upload_batches"
          ? () => ({ select: () => ({ single: async () => ({ data: { id: "batch-warning" }, error: null }) }) })
          : insertedRows,
      })),
      rpc: candidateRpc(),
    } as unknown as UploadRepositoryClient, {
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({
        kind: "production",
        rows: [parsedRow],
        diagnostics: [],
        capacityEvidence: [],
        stWarnings: [{ sourceSheet: "Production", sourceRow: 3, code: "invalid-count", field: "capacityQty", message: "Invalid capacityQty" }],
      }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
      findExisting: vi.fn().mockResolvedValue(null),
    });

    await expect(repository.stageUpload(file())).resolves.toMatchObject({
      errorCount: 0,
      diagnostics: [],
      stWarnings: [{ sourceSheet: "Production", sourceRow: 3, message: "Invalid capacityQty" }],
    });
    expect(insertedRows).toHaveBeenCalledWith([expect.objectContaining({ status: "new" })]);
  });

  it("uses detector output for the single normal adapter dispatcher", () => {
    const sheets = [{
      sheet: "ICT.",
      data: [
        [null, "Data Theo Dõi Hiệu Suất công đoạn ICT"],
        [null, null, "Ngày", "Ca", "Model", null, "Time", "Input", "OK", null, null, null, "NG"],
        [null, null, new Date(2026, 6, 28), "DAY", "MODEL-A", null, null, 10, 9],
      ],
    }];

    expect(parseDetectedWorkbook(sheets)).toMatchObject({ kind: "ict" });
  });

  it("stages an untimed quality-only row without fabricating production or requiring a time slot", async () => {
    const insertedRows = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => ({
        insert: table === "upload_batches"
          ? () => ({ select: () => ({ single: async () => ({ data: { id: "batch-1" }, error: null }) }) })
          : insertedRows,
      })),
      rpc: candidateRpc(),
    } as unknown as UploadRepositoryClient;
    const qualityRow = {
      ...parsedRow,
      timeSlotCode: null,
      actualQty: 0,
      downtimeMinutes: 0,
      downtimeReasonCode: null,
      dimensions: {
        production: null,
        quality: { inputQty: 10, okQty: 8, ngQty: 2 },
      },
    };
    const findExisting = vi.fn().mockResolvedValue(null);
    const repository = createUploadRepository(client, {
      createId: () => "quality-only",
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({ kind: "ict", rows: [qualityRow], diagnostics: [] }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
      findExisting,
    });

    const result = await repository.stageUpload(file());

    expect(result).toMatchObject({ newCount: 1, errorCount: 0 });
    expect(findExisting).toHaveBeenCalledWith(expect.objectContaining({
      target: "quality",
      timeSlotId: null,
    }));
    expect(insertedRows).toHaveBeenCalledWith([
      expect.objectContaining({
        status: "new",
        row_kind: "daily_quality",
        target_record_id: null,
        expected_target_version: null,
        payload: expect.objectContaining({
          production: null,
          quality: { inputQty: 10, okQty: 8, ngQty: 2 },
          timeSlotCode: null,
        }),
      }),
    ]);
  });

  it("stages parser diagnostics with a valid non-committable row kind", async () => {
    const insertedRows = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => ({
        insert: table === "upload_batches"
          ? () => ({ select: () => ({ single: async () => ({ data: { id: "batch-1" }, error: null }) }) })
          : insertedRows,
      })),
      rpc: candidateRpc(),
    } as unknown as UploadRepositoryClient;
    const repository = createUploadRepository(client, {
      createId: () => "diagnostic",
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({
        kind: "standard",
        rows: [],
        diagnostics: [{
          sourceSheet: "Production",
          sourceRow: 4,
          code: "invalid-count",
          message: "Invalid NG quantity",
          field: "ngQty",
        }],
      }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
      findExisting: vi.fn().mockResolvedValue(null),
    });

    await expect(repository.stageUpload(file())).resolves.toMatchObject({
      errorCount: 1,
      diagnostics: [],
    });
    expect(insertedRows).toHaveBeenCalledWith([
      expect.objectContaining({
        row_kind: "diagnostic",
        status: "error",
        target_record_id: null,
        expected_target_version: null,
      }),
    ]);
  });

  it("preserves a real time slot on a quality-only observation", async () => {
    const insertedRows = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => ({
        insert: table === "upload_batches"
          ? () => ({ select: () => ({ single: async () => ({ data: { id: "batch-1" }, error: null }) }) })
          : insertedRows,
      })),
      rpc: candidateRpc(),
    } as unknown as UploadRepositoryClient;
    const qualityRow = {
      ...parsedRow,
      actualQty: 0,
      downtimeMinutes: 0,
      downtimeReasonCode: null,
      dimensions: {
        production: null,
        quality: { inputQty: 10, okQty: 8, ngQty: 2 },
      },
    };
    const findExisting = vi.fn().mockResolvedValue(null);
    const repository = createUploadRepository(client, {
      createId: () => "quality-with-slot",
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({ kind: "aoi", rows: [qualityRow], diagnostics: [] }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
      findExisting,
    });

    await expect(repository.stageUpload(file())).resolves.toMatchObject({
      newCount: 1,
      errorCount: 0,
    });
    expect(findExisting).toHaveBeenCalledWith(expect.objectContaining({
      target: "quality",
      timeSlotId: "t",
    }));
    expect(insertedRows).toHaveBeenCalledWith([
      expect.objectContaining({
        row_kind: "daily_quality",
        payload: expect.objectContaining({ production: null, timeSlotCode: "A" }),
      }),
    ]);
  });

  it("stages registered legacy downtime fallback as visible review metadata instead of an error", async () => {
    const insertedRows = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => ({
        insert: table === "upload_batches"
          ? () => ({ select: () => ({ single: async () => ({ data: { id: "batch-1" }, error: null }) }) })
          : insertedRows,
      })),
      rpc: candidateRpc(),
    } as unknown as UploadRepositoryClient;
    const fallbackMaster = {
      ...masterData,
      downtimeReasons: [
        ...masterData.downtimeReasons,
        { id: "legacy", code: "LEGACY_UNSPECIFIED", name: "Legacy unspecified", active: true, version: 1 },
      ],
    };
    const repository = createUploadRepository(client, {
      createId: () => "legacy-fallback",
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({
        kind: "production",
        rows: [{
          ...parsedRow,
          dimensions: { production: { inputQty: 10, actualQty: 9 }, quality: null },
          warnings: ["legacy-downtime-reason-unspecified"],
          downtimeReasonCode: "LEGACY_UNSPECIFIED",
        }],
        diagnostics: [],
      }),
      listMasterData: vi.fn().mockResolvedValue(fallbackMaster),
      findExisting: vi.fn().mockResolvedValue(null),
    });

    const result = await repository.stageUpload(file());

    expect(result).toMatchObject({ newCount: 1, errorCount: 0 });
    expect(insertedRows).toHaveBeenCalledWith([
      expect.objectContaining({
        status: "new",
        messages: ["Review required: legacy downtime reason was unspecified"],
      }),
    ]);
  });

  it("stages typed defects inside the same atomic row payload", async () => {
    const insertedRows = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => ({
        insert: table === "upload_batches"
          ? () => ({ select: () => ({ single: async () => ({ data: { id: "batch-1" }, error: null }) }) })
          : insertedRows,
      })),
      rpc: candidateRpc(),
    } as unknown as UploadRepositoryClient;
    const defect = {
      sourceSheet: "Defects" as const,
      sourceRow: 2,
      productionSourceRow: 3,
      defectType: "Short",
      classification: "real" as const,
      quantity: 1,
    };
    const repository = createUploadRepository(client, {
      createId: () => "defects",
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({ kind: "standard", rows: [{ ...parsedRow, defects: [defect] }], diagnostics: [] }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
      findExisting: vi.fn().mockResolvedValue(null),
    });

    const result = await repository.stageUpload(file());

    expect(result).toMatchObject({ defectCount: 1, errorCount: 0 });
    expect(insertedRows).toHaveBeenCalledWith([
      expect.objectContaining({
        payload: expect.objectContaining({ defects: [defect] }),
      }),
    ]);
  });

  it("classifies database conflicts while staging missing masters as candidates", async () => {
    const rowInsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => ({
        insert: table === "upload_batches"
          ? () => ({ select: () => ({ single: async () => ({ data: { id: "batch-1" }, error: null }) }) })
          : rowInsert,
      })),
      rpc: candidateRpc(),
    } as unknown as UploadRepositoryClient;
    const rows = [parsedRow, { ...parsedRow, sourceRow: 4, modelCode: "MISSING", note: "unknown" }];
    const repository = createUploadRepository(client, {
      createId: () => "upload-2",
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({ kind: "standard", rows, diagnostics: [] }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
      findExisting: vi.fn().mockResolvedValue({ id: "existing", version: 7 }),
    });

    const result = await repository.stageUpload(file());
    expect(result).toEqual(expect.objectContaining({ conflictCount: 1, errorCount: 0, unknownMasterDataCount: 0 }));
    expect(rowInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        status: "conflict",
        row_kind: "production",
        target_record_id: "existing",
        expected_target_version: 7,
      }),
      expect.objectContaining({
        status: "new",
        row_kind: "production",
        target_record_id: null,
        expected_target_version: null,
      }),
    ]);
  });

  it("looks up only unlinked quality rows for a daily-quality conflict target", async () => {
    const predicates: Array<[string, unknown]> = [];
    const qualityQuery = {
      select() { return this; },
      eq() { return this; },
      is(column: string, value: unknown) {
        predicates.push([column, value]);
        return this;
      },
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => {
        if (table === "quality_records") return qualityQuery;
        return {
          insert: table === "upload_batches"
            ? () => ({ select: () => ({ single: async () => ({ data: { id: "batch-1" }, error: null }) }) })
            : vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
      rpc: candidateRpc(),
    } as unknown as UploadRepositoryClient;
    const qualityRow = {
      ...parsedRow,
      dimensions: {
        production: null,
        quality: { inputQty: 10, okQty: 8, ngQty: 2 },
      },
    };
    const repository = createUploadRepository(client, {
      createId: () => "daily-quality-conflict",
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({ kind: "aoi", rows: [qualityRow], diagnostics: [] }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
    });

    await repository.stageUpload(file());

    expect(predicates).toContainEqual(["production_record_id", null]);
  });

  it("selects the exact production target identity and version for duplicate replacement", async () => {
    let selectedColumns = "";
    const productionQuery = {
      select(columns: string) { selectedColumns = columns; return this; },
      eq() { return this; },
      is() { return this; },
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const qualityQuery = {
      select() { return this; },
      eq() { return this; },
      is() { return this; },
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => {
        if (table === "production_records") return productionQuery;
        if (table === "quality_records") return qualityQuery;
        return {
          insert: table === "upload_batches"
            ? () => ({ select: () => ({ single: async () => ({ data: { id: "batch-1" }, error: null }) }) })
            : vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
      rpc: candidateRpc(),
    } as unknown as UploadRepositoryClient;
    const repository = createUploadRepository(client, {
      createId: () => "upload-duplicate-query",
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({ kind: "standard", rows: [parsedRow], diagnostics: [] }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
    });

    await repository.stageUpload(file());
    expect(selectedColumns).toBe("id,version");
  });

  it("does not create database staging records when original storage fails", async () => {
    const from = vi.fn();
    const repository = createUploadRepository({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: null, error: { message: "storage down" } }) }) },
      from,
      rpc: candidateRpc(),
    } as unknown as UploadRepositoryClient, {
      createId: () => "upload-3",
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({ kind: "standard", rows: [parsedRow], diagnostics: [] }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
      findExisting: vi.fn(),
    });

    await expect(repository.stageUpload(file())).rejects.toThrow("storage down");
    expect(from).not.toHaveBeenCalled();
  });

  it("commits exclusively through the atomic server RPC and maps its result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      batch_id: "batch-1", status: "completed", inserted: 2, replaced: 1, skipped: 3, masters_inserted: 4, standard_times_inserted: 5,
    }, error: null });
    const repository = createUploadRepository({ rpc } as unknown as UploadRepositoryClient);
    const approval = {
      masterCandidates: [{ key: "model|MODEL-A", approved: true, approvedName: "Model A", masterId: "must-not-leak" }],
      standardTimeCandidates: [{ key: "MODEL-A|LINE-1|AOI", approved: true, approvedSecondsPerUnit: 12.5, effectiveFrom: "2026-07-28", effectiveTo: null }],
    };
    await expect(repository.commitUpload("batch-1", true, approval)).resolves.toEqual({
      batchId: "batch-1", insertedCount: 2, replacedCount: 1, skippedCount: 3, masterInsertedCount: 4, standardTimeInsertedCount: 5,
    });
    expect(rpc).toHaveBeenCalledWith("commit_upload_batch_with_masters", {
      p_batch_id: "batch-1",
      p_replace_conflicts: true,
      p_master_approvals: [{ key: "model|MODEL-A", approved: true, approvedName: "Model A" }],
      p_standard_time_approvals: approval.standardTimeCandidates,
    });
  });

  it("prefetches large reviews once and inserts staging rows in bounded chunks", async () => {
    const insertedRows = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => ({
        insert: table === "upload_batches"
          ? () => ({ select: () => ({ single: async () => ({ data: { id: "batch-1" }, error: null }) }) })
          : insertedRows,
      })),
      rpc: candidateRpc(),
    } as unknown as UploadRepositoryClient;
    const rows = Array.from({ length: 14_708 }, (_, index) => ({
      ...parsedRow,
      sourceRow: index + 2,
      productionDate: `2026-${String(Math.floor(index / 28) % 12 + 1).padStart(2, "0")}-${String(index % 28 + 1).padStart(2, "0")}`,
    }));
    const prefetchExisting = vi.fn().mockResolvedValue(undefined);
    const repository = createUploadRepository(client, {
      createId: () => "large-upload",
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({ kind: "standard", rows, diagnostics: [] }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
      prefetchExisting,
      findExisting: vi.fn().mockResolvedValue(null),
    });

    await repository.stageUpload(file());

    expect(prefetchExisting).toHaveBeenCalledTimes(1);
    expect(prefetchExisting.mock.calls[0]?.[0]).toHaveLength(14_708);
    expect(insertedRows).toHaveBeenCalledTimes(30);
    expect(insertedRows.mock.calls.map(([chunk]) => chunk.length)).toEqual([
      ...Array.from({ length: 29 }, () => 500), 208,
    ]);
  });
});

describe("UploadReviewTable", () => {
  it("renders only the supplied server page and requests the next page", () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      ...parsedRow,
      sourceRow: index + 2,
      status: "new" as const,
      messages: [],
    }));
    const onPageChange = vi.fn();
    render(<UploadReviewTable
      review={review({ rows, newCount: 501 })}
      page={1}
      total={501}
      onPageChange={onPageChange}
    />);

    expect(screen.getByText("Showing 200 of 501 rows")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(201);
    expect(screen.queryByRole("button", { name: "Show more rows" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

describe("UploadPage", () => {
  it("shows a valid review and commits it once", async () => {
    const repository = { stageUpload: vi.fn().mockResolvedValue(review()), commitUpload: vi.fn().mockResolvedValue({ batchId: "batch-1", insertedCount: 1, replacedCount: 0 }) };
    render(<UploadPage repository={repository} role="operator" />);
    fireEvent.change(screen.getByLabelText("Workbook"), { target: { files: [file()] } });
    await screen.findAllByText("New: 1");
    expect(screen.getByText("Duplicates: 0")).toBeInTheDocument();
    expect(screen.getByText("Errors: 0")).toBeInTheDocument();
    expect(screen.getByText("Unregistered master data: 0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Commit upload" }));
    await waitFor(() => expect(repository.commitUpload).toHaveBeenCalledWith("batch-1", false, {
      masterCandidates: [],
      standardTimeCandidates: [],
    }));
  });

  it("keeps duplicate replacement admin-only", async () => {
    const duplicate = review({ newCount: 0, conflictCount: 1, rows: [{ ...parsedRow, status: "conflict", messages: ["Duplicate record"] }] });
    const operatorRepository = { stageUpload: vi.fn().mockResolvedValue(duplicate), commitUpload: vi.fn() };
    const operator = render(<UploadPage repository={operatorRepository} role="operator" />);
    fireEvent.change(screen.getByLabelText("Workbook"), { target: { files: [file()] } });
    await screen.findByText("Duplicates: 1");
    expect(screen.getByLabelText("Replace duplicate records")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Commit upload" })).toBeDisabled();
    operator.unmount();

    const adminRepository = { stageUpload: vi.fn().mockResolvedValue(duplicate), commitUpload: vi.fn().mockResolvedValue({ batchId: "batch-1", insertedCount: 0, replacedCount: 1 }) };
    render(<UploadPage repository={adminRepository} role="admin" />);
    fireEvent.change(screen.getByLabelText("Workbook"), { target: { files: [file()] } });
    const replace = await screen.findByLabelText("Replace duplicate records");
    fireEvent.click(replace);
    fireEvent.click(screen.getByRole("button", { name: "Commit upload" }));
    await waitFor(() => expect(adminRepository.commitUpload).toHaveBeenCalledWith("batch-1", true, {
      masterCandidates: [],
      standardTimeCandidates: [],
    }));
  });

  it("shows row diagnostics and disables commit when any invalid or unregistered row exists", async () => {
    const invalid = review({
      newCount: 0,
      errorCount: 2,
      unknownMasterDataCount: 1,
      rows: [{ ...parsedRow, status: "error", messages: ["Unknown model: MISSING"] }],
      diagnostics: [{ sourceSheet: "Production", sourceRow: 4, messages: ["Invalid NG quantity"] }],
    });
    const repository = { stageUpload: vi.fn().mockResolvedValue(invalid), commitUpload: vi.fn() };
    render(<UploadPage repository={repository} role="admin" />);
    fireEvent.change(screen.getByLabelText("Workbook"), { target: { files: [file()] } });
    await screen.findByText("Unknown model: MISSING");
    expect(screen.getByText("Invalid NG quantity")).toBeInTheDocument();
    expect(screen.getByText("Errors: 2")).toBeInTheDocument();
    expect(screen.getByText("Unregistered master data: 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit upload" })).toBeDisabled();
  });

  it("lets an operator inspect candidates and ST evidence without approving or replacing anything", async () => {
    const candidateReview = legacyReview({
      conflictCount: 1,
      rows: [{ ...parsedRow, status: "conflict", messages: ["Duplicate record"] }],
    });
    const repository = {
      stageUpload: vi.fn().mockResolvedValue(candidateReview),
      loadDetailPage: vi.fn(),
      commitUpload: vi.fn(),
    };

    render(<UploadPage repository={repository} role="operator" />);
    fireEvent.change(screen.getByLabelText("Workbook"), { target: { files: [file()] } });

    await screen.findByText("legacy-production.xlsx");
    expect(screen.getAllByText("MODEL-1").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Evidence"));
    expect(screen.getAllByText("7200")).toHaveLength(3);
    expect(screen.getByLabelText("Approved name MODEL-1")).toBeDisabled();
    expect(screen.getByLabelText("Approve model MODEL-1")).toBeDisabled();
    expect(screen.getByLabelText("Approved ST MODEL-1 AOI-1 AOI")).toBeDisabled();
    expect(screen.getByLabelText("Approve ST MODEL-1 AOI-1 AOI")).toBeDisabled();
    expect(screen.getByLabelText("Replace duplicate records")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Commit upload" })).toBeDisabled();
  });

  it("passes edited master and selected ST approvals when an admin commits", async () => {
    const candidateReview = legacyReview({
      conflictCount: 1,
      rows: [{ ...parsedRow, status: "conflict", messages: ["Duplicate record"] }],
    });
    const repository = {
      stageUpload: vi.fn().mockResolvedValue(candidateReview),
      loadDetailPage: vi.fn(),
      commitUpload: vi.fn().mockResolvedValue({
        batchId: "batch-1",
        insertedCount: 1,
        replacedCount: 1,
      }),
    };

    render(<UploadPage repository={repository} role="admin" />);
    fireEvent.change(screen.getByLabelText("Workbook"), { target: { files: [file()] } });

    const approvedName = await screen.findByLabelText("Approved name MODEL-1");
    fireEvent.change(approvedName, { target: { value: "Camera Main" } });
    fireEvent.click(screen.getByLabelText("Approve model MODEL-1"));
    fireEvent.click(screen.getByLabelText("Use 10.5 seconds from Production row 9"));
    fireEvent.click(screen.getByLabelText("Approve ST MODEL-1 AOI-1 AOI"));
    fireEvent.click(screen.getByLabelText("Replace duplicate records"));
    fireEvent.click(screen.getByRole("button", { name: "Commit upload" }));

    await waitFor(() => expect(repository.commitUpload).toHaveBeenCalledWith(
      "batch-1",
      true,
      expect.objectContaining({
        masterCandidates: [expect.objectContaining({
          key: "model|MODEL-1",
          approvedName: "Camera Main",
        })],
        standardTimeCandidates: [expect.objectContaining({
          key: "MODEL-1|AOI-1|AOI",
          approvedSecondsPerUnit: 10.5,
        })],
      }),
    ));
  });

  it.each([
    {
      name: "an unapproved new master",
      candidateReview: legacyReview({ standardTimeCandidates: [], standardTimeCandidateCount: 0 }),
    },
    {
      name: "an unresolved ST conflict",
      candidateReview: legacyReview({ masterCandidates: [], masterCandidateCount: 0 }),
    },
    {
      name: "an error candidate",
      candidateReview: legacyReview({
        masterCandidates: [{ ...masterCandidate, status: "error", messages: ["Unsupported master"] }],
        standardTimeCandidates: [],
        standardTimeCandidateCount: 0,
      }),
    },
    {
      name: "a detail error",
      candidateReview: legacyReview({
        masterCandidates: [],
        masterCandidateCount: 0,
        standardTimeCandidates: [],
        standardTimeCandidateCount: 0,
        newCount: 0,
        errorCount: 1,
        rows: [{ ...parsedRow, status: "error", messages: ["Invalid quantity"] }],
      }),
    },
  ])("keeps commit disabled for $name", async ({ candidateReview }) => {
    const repository = {
      stageUpload: vi.fn().mockResolvedValue(candidateReview),
      loadDetailPage: vi.fn(),
      commitUpload: vi.fn(),
    };

    render(<UploadPage repository={repository} role="admin" />);
    fireEvent.change(screen.getByLabelText("Workbook"), { target: { files: [file()] } });

    await screen.findByText(candidateReview.sourceFileName);
    expect(screen.getByRole("button", { name: "Commit upload" })).toBeDisabled();
  });

  it("loads server pages, resets filters to page one, and preserves candidate edits", async () => {
    const candidateReview = legacyReview({ detailTotal: 401 });
    const loadDetailPage = vi.fn()
      .mockResolvedValueOnce({
        page: 2,
        pageSize: 200,
        total: 401,
        rows: [{ ...parsedRow, sourceRow: 203, status: "new", messages: [] }],
        diagnostics: [],
      })
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 200,
        total: 3,
        rows: [{ ...parsedRow, sourceRow: 301, status: "error", messages: ["Invalid quantity"] }],
        diagnostics: [],
      });
    const repository = {
      stageUpload: vi.fn().mockResolvedValue(candidateReview),
      loadDetailPage,
      commitUpload: vi.fn(),
    };

    render(<UploadPage repository={repository} role="admin" />);
    fireEvent.change(screen.getByLabelText("Workbook"), { target: { files: [file()] } });

    const approvedName = await screen.findByLabelText("Approved name MODEL-1");
    fireEvent.change(approvedName, { target: { value: "Camera Main" } });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("203");
    expect(loadDetailPage).toHaveBeenNthCalledWith(1, "batch-1", 2, undefined);
    expect(screen.getByLabelText("Approved name MODEL-1")).toHaveValue("Camera Main");

    fireEvent.change(screen.getByLabelText("Detail status"), { target: { value: "error" } });
    await screen.findByText("Invalid quantity");
    expect(loadDetailPage).toHaveBeenNthCalledWith(2, "batch-1", 1, "error");
    expect(screen.getByText("Page 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Approved name MODEL-1")).toHaveValue("Camera Main");
  });

  it("allows an operator to commit when every candidate is already resolved as existing", async () => {
    const candidateReview = legacyReview({
      masterCandidates: [{
        ...masterCandidate,
        status: "existing",
        approved: true,
        currentName: "MODEL-1",
      }],
      standardTimeCandidates: [{
        ...standardTimeCandidate,
        status: "existing",
        approved: true,
        proposedSecondsPerUnit: 10.5,
        approvedSecondsPerUnit: 10.5,
        messages: [],
      }],
    });
    const repository = {
      stageUpload: vi.fn().mockResolvedValue(candidateReview),
      loadDetailPage: vi.fn(),
      commitUpload: vi.fn().mockResolvedValue({
        batchId: "batch-1",
        insertedCount: 1,
        replacedCount: 0,
      }),
    };

    render(<UploadPage repository={repository} role="operator" />);
    fireEvent.change(screen.getByLabelText("Workbook"), { target: { files: [file()] } });

    const commit = await screen.findByRole("button", { name: "Commit upload" });
    expect(commit).toBeEnabled();
    fireEvent.click(commit);
    await waitFor(() => expect(repository.commitUpload).toHaveBeenCalledWith(
      "batch-1",
      false,
      { masterCandidates: [], standardTimeCandidates: [] },
    ));
  });

  it("discards a stale detail page after another workbook is staged", async () => {
    let resolveOldPage!: (page: {
      page: number;
      pageSize: 200;
      total: number;
      rows: UploadReview["rows"];
      diagnostics: UploadReview["diagnostics"];
    }) => void;
    const oldPage = new Promise<Parameters<typeof resolveOldPage>[0]>((resolve) => {
      resolveOldPage = resolve;
    });
    const secondReview = legacyReview({
      batchId: "batch-2",
      sourceFileName: "second.xlsx",
      detailTotal: 1,
      rows: [{ ...parsedRow, sourceRow: 501, status: "new", messages: [] }],
    });
    const repository = {
      stageUpload: vi.fn()
        .mockResolvedValueOnce(legacyReview({ detailTotal: 401 }))
        .mockResolvedValueOnce(secondReview),
      loadDetailPage: vi.fn().mockReturnValue(oldPage),
      commitUpload: vi.fn(),
    };

    render(<UploadPage repository={repository} role="admin" />);
    const input = screen.getByLabelText("Workbook");
    fireEvent.change(input, { target: { files: [file()] } });
    await screen.findByText("legacy-production.xlsx");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(repository.loadDetailPage).toHaveBeenCalledWith("batch-1", 2, undefined));

    fireEvent.change(input, { target: { files: [new File(["second"], "second.xlsx")] } });
    await screen.findByText("second.xlsx");
    resolveOldPage({
      page: 2,
      pageSize: 200,
      total: 401,
      rows: [{ ...parsedRow, sourceRow: 203, status: "new", messages: [] }],
      diagnostics: [],
    });

    await waitFor(() => expect(screen.queryByText("203")).not.toBeInTheDocument());
    expect(screen.getByText("501")).toBeInTheDocument();
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });

  it("prefills reusable conflicts with the canonical name and blocks immutable conflicts", async () => {
    const canonicalConflict = {
      ...masterCandidate,
      status: "conflict" as const,
      conflictReason: "name-mismatch" as const,
      currentName: "Canonical Camera",
      resolvable: true,
      messages: ["Existing model name differs"],
    };
    const inactiveConflict = {
      ...masterCandidate,
      key: "line|LINE-1",
      entity: "line" as const,
      code: "LINE-1",
      proposedName: "LINE-1",
      status: "conflict" as const,
      conflictReason: "inactive" as const,
      currentName: "Inactive Line",
      resolvable: false,
      messages: ["Existing line is inactive"],
    };
    const slotConflict = {
      ...masterCandidate,
      key: "time_slot|DAY|A",
      entity: "time_slot" as const,
      code: "A",
      parentCode: "DAY",
      proposedName: "A",
      status: "conflict" as const,
      conflictReason: "slot-mismatch" as const,
      currentName: "A",
      resolvable: false,
      messages: ["Existing time slot configuration differs"],
    };
    const candidateReview = legacyReview({
      masterCandidates: [canonicalConflict, inactiveConflict, slotConflict],
      masterCandidateCount: 3,
      standardTimeCandidates: [],
      standardTimeCandidateCount: 0,
    });
    const repository = {
      stageUpload: vi.fn().mockResolvedValue(candidateReview),
      loadDetailPage: vi.fn(),
      commitUpload: vi.fn(),
    };

    render(<UploadPage repository={repository} role="admin" />);
    fireEvent.change(screen.getByLabelText("Workbook"), { target: { files: [file()] } });

    expect(await screen.findByLabelText("Approved name MODEL-1")).toHaveValue("Canonical Camera");
    expect(screen.getByText("Canonical Camera")).toBeInTheDocument();
    expect(screen.getByText("name-mismatch")).toBeInTheDocument();
    expect(screen.getByLabelText("Approved name LINE-1")).toBeDisabled();
    expect(screen.getByLabelText("Approve line LINE-1")).toBeDisabled();
    expect(screen.getByLabelText("Approved name A")).toBeDisabled();
    expect(screen.getByLabelText("Approve time_slot A")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Commit upload" })).toBeDisabled();
  });

  it("resolves a reusable name conflict only with the exact canonical name", async () => {
    const candidateReview = legacyReview({
      masterCandidates: [{
        ...masterCandidate,
        status: "conflict",
        conflictReason: "name-mismatch",
        currentName: "Canonical Camera",
        resolvable: true,
        messages: ["Existing model name differs"],
      }],
      standardTimeCandidates: [],
      standardTimeCandidateCount: 0,
    });
    const repository = {
      stageUpload: vi.fn().mockResolvedValue(candidateReview),
      loadDetailPage: vi.fn(),
      commitUpload: vi.fn(),
    };

    render(<UploadPage repository={repository} role="admin" />);
    fireEvent.change(screen.getByLabelText("Workbook"), { target: { files: [file()] } });

    const name = await screen.findByLabelText("Approved name MODEL-1");
    fireEvent.click(screen.getByLabelText("Approve model MODEL-1"));
    expect(screen.getByRole("button", { name: "Commit upload" })).toBeEnabled();

    fireEvent.change(name, { target: { value: "Changed Name" } });
    expect(screen.getByRole("button", { name: "Commit upload" })).toBeDisabled();

    fireEvent.change(name, { target: { value: "Canonical Camera" } });
    expect(screen.getByRole("button", { name: "Commit upload" })).toBeEnabled();
  });
});

describe("UploadStandardTimeReview", () => {
  it("uses stable distinct evidence rows for multiple slots from one source row", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const candidate = {
      ...standardTimeCandidate,
      observations: [
        standardTimeCandidate.observations[0]!,
        {
          ...standardTimeCandidate.observations[0]!,
          timeSlotCode: "B",
          plannedSeconds: 12600,
          secondsPerUnit: 17.5,
        },
      ],
    };

    render(<UploadStandardTimeReview
      candidates={[candidate]}
      role="admin"
      approvals={[]}
      onChange={vi.fn()}
    />);

    expect(screen.getByLabelText("Use 10 seconds from Production row 8")).toBeInTheDocument();
    expect(screen.getByLabelText("Use 17.5 seconds from Production row 8")).toBeInTheDocument();
    expect(consoleError.mock.calls.some(([message]) => String(message).includes("same key"))).toBe(false);
    consoleError.mockRestore();
  });
});
