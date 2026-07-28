import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ImportParseResult,
  MasterDataSnapshot,
  UploadReview,
} from "../../src/domain/types";
import {
  createUploadRepository,
  type UploadRepositoryClient,
} from "../../src/data/repositories/upload-repository";
import { UploadPage } from "../../src/features/upload/UploadPage";

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

function file() {
  return new File(["xlsx"], "production.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

describe("upload repository", () => {
  it("stores the original first, then persists the batch and normalized rows", async () => {
    const events: string[] = [];
    const inserted: Record<string, unknown> = {};
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
      rpc: vi.fn(),
    } as unknown as UploadRepositoryClient;
    const parseResult: ImportParseResult = { kind: "standard", rows: [parsedRow], diagnostics: [] };
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
    expect(events).toEqual(["storage", "upload_batches", "upload_rows"]);
    expect(inserted.upload_batches).toEqual(expect.objectContaining({
      storage_path: "user-1/upload-1-production.xlsx",
      workbook_kind: "standard",
      status: "validated",
      created_by: "user-1",
    }));
    expect(inserted.upload_rows).toEqual([expect.objectContaining({
      batch_id: "batch-1",
      source_sheet: "Production",
      source_row: 3,
      status: "new",
      payload: parsedRow,
    })]);
  });

  it("classifies database conflicts and unregistered master data without bypassing staged persistence", async () => {
    const rowInsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => ({
        insert: table === "upload_batches"
          ? () => ({ select: () => ({ single: async () => ({ data: { id: "batch-1" }, error: null }) }) })
          : rowInsert,
      })),
      rpc: vi.fn(),
    } as unknown as UploadRepositoryClient;
    const rows = [parsedRow, { ...parsedRow, sourceRow: 4, modelCode: "MISSING", note: "unknown" }];
    const repository = createUploadRepository(client, {
      createId: () => "upload-2",
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({ kind: "standard", rows, diagnostics: [] }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
      findExisting: vi.fn().mockResolvedValue({ id: "existing" }),
    });

    const result = await repository.stageUpload(file());
    expect(result).toEqual(expect.objectContaining({ conflictCount: 1, errorCount: 1, unknownMasterDataCount: 1 }));
    expect(result.rows).toEqual([
      expect.objectContaining({ sourceRow: 3, status: "conflict" }),
      expect.objectContaining({ sourceRow: 4, status: "error", messages: expect.arrayContaining(["Unknown model: MISSING"]) }),
    ]);
    expect(rowInsert).toHaveBeenCalledWith([
      expect.objectContaining({ status: "conflict" }),
      expect.objectContaining({ status: "error" }),
    ]);
  });

  it("uses an existence-only production query for duplicate detection", async () => {
    let selectedColumns = "";
    const productionQuery = {
      select(columns: string) { selectedColumns = columns; return this; },
      eq() { return this; },
      is() { return this; },
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "stored.xlsx" }, error: null }) }) },
      from: vi.fn((table: string) => {
        if (table === "production_records") return productionQuery;
        return {
          insert: table === "upload_batches"
            ? () => ({ select: () => ({ single: async () => ({ data: { id: "batch-1" }, error: null }) }) })
            : vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
      rpc: vi.fn(),
    } as unknown as UploadRepositoryClient;
    const repository = createUploadRepository(client, {
      createId: () => "upload-duplicate-query",
      readWorkbook: vi.fn().mockResolvedValue([]),
      parseWorkbook: () => ({ kind: "standard", rows: [parsedRow], diagnostics: [] }),
      listMasterData: vi.fn().mockResolvedValue(masterData),
    });

    await repository.stageUpload(file());
    expect(selectedColumns).toBe("id");
  });

  it("does not create database staging records when original storage fails", async () => {
    const from = vi.fn();
    const repository = createUploadRepository({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: null, error: { message: "storage down" } }) }) },
      from,
      rpc: vi.fn(),
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
    const rpc = vi.fn().mockResolvedValue({ data: { batch_id: "batch-1", status: "committed", inserted: 2, replaced: 1 }, error: null });
    const repository = createUploadRepository({ rpc } as unknown as UploadRepositoryClient);
    await expect(repository.commitUpload("batch-1", true)).resolves.toEqual({ batchId: "batch-1", insertedCount: 2, replacedCount: 1 });
    expect(rpc).toHaveBeenCalledWith("commit_upload_batch", { batch_id: "batch-1", replace_conflicts: true });
  });
});

describe("UploadPage", () => {
  it("shows a valid review and commits it once", async () => {
    const repository = { stageUpload: vi.fn().mockResolvedValue(review()), commitUpload: vi.fn().mockResolvedValue({ batchId: "batch-1", insertedCount: 1, replacedCount: 0 }) };
    render(<UploadPage repository={repository} role="operator" />);
    fireEvent.change(screen.getByLabelText("Workbook"), { target: { files: [file()] } });
    await screen.findByText("New: 1");
    expect(screen.getByText("Duplicates: 0")).toBeInTheDocument();
    expect(screen.getByText("Errors: 0")).toBeInTheDocument();
    expect(screen.getByText("Unregistered master data: 0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Commit upload" }));
    await waitFor(() => expect(repository.commitUpload).toHaveBeenCalledWith("batch-1", false));
  });

  it("keeps duplicate replacement admin-only", async () => {
    const duplicate = review({ newCount: 0, conflictCount: 1, rows: [{ ...parsedRow, status: "conflict", messages: ["Duplicate record"] }] });
    const operatorRepository = { stageUpload: vi.fn().mockResolvedValue(duplicate), commitUpload: vi.fn() };
    const operator = render(<UploadPage repository={operatorRepository} role="operator" />);
    fireEvent.change(screen.getByLabelText("Workbook"), { target: { files: [file()] } });
    await screen.findByText("Duplicates: 1");
    expect(screen.queryByLabelText("Replace duplicate records")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit upload" })).toBeDisabled();
    operator.unmount();

    const adminRepository = { stageUpload: vi.fn().mockResolvedValue(duplicate), commitUpload: vi.fn().mockResolvedValue({ batchId: "batch-1", insertedCount: 0, replacedCount: 1 }) };
    render(<UploadPage repository={adminRepository} role="admin" />);
    fireEvent.change(screen.getByLabelText("Workbook"), { target: { files: [file()] } });
    const replace = await screen.findByLabelText("Replace duplicate records");
    fireEvent.click(replace);
    fireEvent.click(screen.getByRole("button", { name: "Commit upload" }));
    await waitFor(() => expect(adminRepository.commitUpload).toHaveBeenCalledWith("batch-1", true));
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
});
