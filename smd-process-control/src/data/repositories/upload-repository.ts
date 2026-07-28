import readXlsxFile, { readSheetNames } from "read-excel-file";
import type {
  ImportParseResult,
  MasterDataSnapshot,
  NormalizedImportRow,
  UploadCommitResult,
  UploadReview,
  WorkbookSheet,
} from "../../domain/types";
import { parseAoiWorkbook } from "../../excel/adapters/aoi-adapter";
import { parseIctWorkbook } from "../../excel/adapters/ict-adapter";
import { parseProductionWorkbook } from "../../excel/adapters/production-adapter";
import { parseSpiWorkbook } from "../../excel/adapters/spi-adapter";
import { parseStandardWorkbook } from "../../excel/adapters/standard-adapter";
import { parseXrayWorkbook } from "../../excel/adapters/xray-adapter";
import { detectWorkbook } from "../../excel/detect-workbook";
import { getSupabaseClient } from "../supabase";
import { createMasterDataRepository } from "./master-data-repository";

export const UPLOAD_STORAGE_BUCKET = "smd-upload-originals";

type RequestError = { code?: string; message?: string };
type RequestResult<T> = { data: T; error: RequestError | null };

export interface UploadRepositoryClient {
  auth?: {
    getUser(): Promise<RequestResult<{ user: { id: string } | null }>>;
  };
  storage?: {
    from(bucket: string): {
      upload(path: string, file: File, options: { contentType: string; upsert: false }): Promise<RequestResult<{ path: string } | null>>;
    };
  };
  from(table: "upload_batches" | "upload_rows"): {
    insert(value: unknown): any;
  };
  from(table: "production_records"): {
    select(columns: "id"): {
      eq(column: string, value: unknown): any;
      is(column: string, value: null): any;
      maybeSingle(): PromiseLike<RequestResult<{ id: string } | null>>;
    };
  };
  rpc(
    name: "commit_upload_batch",
    params: { batch_id: string; replace_conflicts: boolean },
  ): PromiseLike<RequestResult<Record<string, unknown> | null>>;
}

export interface UploadRepository {
  stageUpload(file: File): Promise<UploadReview>;
  commitUpload(batchId: string, replaceConflicts: boolean): Promise<UploadCommitResult>;
}

interface UploadRepositoryOptions {
  createId(): string;
  readWorkbook(file: File): Promise<WorkbookSheet[]>;
  parseWorkbook(sheets: WorkbookSheet[]): ImportParseResult;
  listMasterData(): Promise<MasterDataSnapshot>;
  findExisting(input: {
    productionDate: string;
    shiftId: string;
    timeSlotId: string;
    lineId: string;
    modelId: string;
    processId: string;
  }): Promise<unknown | null>;
}

export class UploadRepositoryError extends Error {
  code?: string;

  constructor(error: RequestError | string) {
    super(typeof error === "string" ? error : error.message ?? "upload_request_failed");
    this.code = typeof error === "string" ? undefined : error.code;
  }
}

async function readWorkbook(file: File): Promise<WorkbookSheet[]> {
  const sheetNames = await readSheetNames(file);
  return Promise.all(sheetNames.map(async (sheet) => ({ sheet, data: await readXlsxFile(file, { sheet }) })));
}

function parseWorkbook(sheets: WorkbookSheet[]): ImportParseResult {
  const detection = detectWorkbook(sheets);
  if (detection.kind === "unknown") {
    const first = detection.diagnostics[0];
    throw new UploadRepositoryError(first?.message ?? "Unsupported workbook");
  }
  switch (detection.kind) {
    case "standard": return parseStandardWorkbook(sheets);
    case "aoi": return parseAoiWorkbook(sheets);
    case "spi": return parseSpiWorkbook(sheets);
    case "ict": return parseIctWorkbook(sheets);
    case "xray": return parseXrayWorkbook(sheets);
    case "production": return parseProductionWorkbook(sheets);
  }
}

function defaultOptions(client: UploadRepositoryClient): UploadRepositoryOptions {
  const masterRepository = createMasterDataRepository(client as never);
  return {
    createId: () => crypto.randomUUID(),
    readWorkbook,
    parseWorkbook,
    listMasterData: () => masterRepository.listMasterData(),
    async findExisting(input) {
      const result = await client.from("production_records")
        .select("id")
        .eq("production_date", input.productionDate)
        .eq("shift_id", input.shiftId)
        .eq("time_slot_id", input.timeSlotId)
        .eq("line_id", input.lineId)
        .eq("model_id", input.modelId)
        .eq("process_id", input.processId)
        .is("deleted_at", null)
        .maybeSingle();
      if (result.error) throw new UploadRepositoryError(result.error);
      return result.data;
    },
  };
}

function requestData<T>(result: RequestResult<T>, fallback: string): NonNullable<T> {
  if (result.error) throw new UploadRepositoryError(result.error);
  if (result.data === null || result.data === undefined) throw new UploadRepositoryError(fallback);
  return result.data as NonNullable<T>;
}

function safeFileName(name: string): string {
  const cleaned = name.normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "workbook.xlsx";
}

function masterMessages(row: NormalizedImportRow, masterData: MasterDataSnapshot): {
  messages: string[];
  ids: { modelId?: string; lineId?: string; processId?: string; shiftId?: string; timeSlotId?: string };
} {
  const messages: string[] = [];
  const model = masterData.models.find((item) => item.active && item.code === row.modelCode);
  const line = masterData.lines.find((item) => item.active && item.code === row.lineCode);
  const process = masterData.processes.find((item) => item.active && item.code === row.processCode);
  const shift = masterData.shifts.find((item) => item.active && item.code === row.shiftCode);
  const timeSlot = shift && row.timeSlotCode
    ? masterData.timeSlots.find((item) => item.shiftId === shift.id && item.code === row.timeSlotCode)
    : undefined;
  if (!model) messages.push(`Unknown model: ${row.modelCode}`);
  if (!line) messages.push(`Unknown line: ${row.lineCode}`);
  if (!process) messages.push(`Unknown process: ${row.processCode}`);
  if (!shift) messages.push(`Unknown shift: ${row.shiftCode}`);
  if (!timeSlot) messages.push(`Unknown time slot: ${row.timeSlotCode ?? "(blank)"}`);
  if (row.downtimeMinutes > 0 && !masterData.downtimeReasons.some((item) => item.active && item.code === row.downtimeReasonCode)) {
    messages.push(`Unknown downtime reason: ${row.downtimeReasonCode ?? "(blank)"}`);
  }
  return {
    messages,
    ids: {
      modelId: model?.id,
      lineId: line?.id,
      processId: process?.id,
      shiftId: shift?.id,
      timeSlotId: timeSlot?.id,
    },
  };
}

const rowKey = (row: NormalizedImportRow) => [
  row.productionDate,
  row.shiftCode,
  row.timeSlotCode,
  row.lineCode,
  row.modelCode,
  row.processCode,
].join("|");

function groupDiagnostics(result: ImportParseResult): UploadReview["diagnostics"] {
  const grouped = new Map<string, UploadReview["diagnostics"][number]>();
  for (const diagnostic of result.diagnostics) {
    const key = `${diagnostic.sourceSheet}|${diagnostic.sourceRow}`;
    const current = grouped.get(key) ?? { sourceSheet: diagnostic.sourceSheet, sourceRow: diagnostic.sourceRow, messages: [] };
    current.messages.push(diagnostic.message);
    grouped.set(key, current);
  }
  if (result.rows.length === 0 && result.diagnostics.length === 0) {
    grouped.set("Production|2", { sourceSheet: "Production", sourceRow: 2, messages: ["No production rows were found"] });
  }
  return [...grouped.values()];
}

export function createUploadRepository(
  client: UploadRepositoryClient = getSupabaseClient() as unknown as UploadRepositoryClient,
  overrides: Partial<UploadRepositoryOptions> = {},
): UploadRepository {
  const options = { ...defaultOptions(client), ...overrides };
  return {
    async stageUpload(file) {
      const sheets = await options.readWorkbook(file);
      const parsed = options.parseWorkbook(sheets);
      if (parsed.diagnostics.some((item) => item.code === "unsupported-template-version")) {
        throw new UploadRepositoryError(parsed.diagnostics.find((item) => item.code === "unsupported-template-version")!.message);
      }
      const masterData = await options.listMasterData();
      const seen = new Set<string>();
      const reviewedRows: UploadReview["rows"] = [];
      let unknownMasterDataCount = 0;
      for (const row of parsed.rows) {
        const master = masterMessages(row, masterData);
        let messages = master.messages;
        let status: UploadReview["rows"][number]["status"] = "new";
        if (messages.length) {
          status = "error";
          unknownMasterDataCount += 1;
        } else if (seen.has(rowKey(row))) {
          status = "error";
          messages = ["Duplicate record in workbook"];
        } else {
          const existing = await options.findExisting({
            productionDate: row.productionDate,
            shiftId: master.ids.shiftId!,
            timeSlotId: master.ids.timeSlotId!,
            lineId: master.ids.lineId!,
            modelId: master.ids.modelId!,
            processId: master.ids.processId!,
          });
          if (existing) {
            status = "conflict";
            messages = ["Duplicate record"];
          }
        }
        seen.add(rowKey(row));
        reviewedRows.push({ ...row, status, messages });
      }
      const diagnostics = groupDiagnostics(parsed);
      const errorCount = reviewedRows.filter((row) => row.status === "error").length + diagnostics.length;
      const conflictCount = reviewedRows.filter((row) => row.status === "conflict").length;
      const newCount = reviewedRows.filter((row) => row.status === "new").length;

      const actor = requestData(await client.auth!.getUser(), "unauthenticated").user;
      if (!actor) throw new UploadRepositoryError("unauthenticated");
      const requestedPath = `${actor.id}/${options.createId()}-${safeFileName(file.name)}`;
      const stored = requestData(await client.storage!.from(UPLOAD_STORAGE_BUCKET).upload(requestedPath, file, {
        contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      }), "original_file_storage_failed");
      const batchResult = await client.from("upload_batches").insert({
        source_file_name: file.name,
        storage_path: stored.path,
        workbook_kind: parsed.kind,
        status: errorCount === 0 ? "validated" : "staged",
        created_by: actor.id,
        updated_by: actor.id,
      }).select("id").single();
      const batch = requestData(batchResult, "upload_batch_create_failed") as { id: string };
      const stagedRows = [
        ...reviewedRows.map((row) => ({
          batch_id: batch.id,
          source_sheet: row.sourceSheet,
          source_row: row.sourceRow,
          payload: {
            sourceSheet: row.sourceSheet,
            sourceRow: row.sourceRow,
            productionDate: row.productionDate,
            shiftCode: row.shiftCode,
            timeSlotCode: row.timeSlotCode,
            lineCode: row.lineCode,
            modelCode: row.modelCode,
            processCode: row.processCode,
            inputQty: row.inputQty,
            actualQty: row.actualQty,
            okQty: row.okQty,
            ngQty: row.ngQty,
            downtimeMinutes: row.downtimeMinutes,
            downtimeReasonCode: row.downtimeReasonCode,
            note: row.note,
          },
          status: row.status,
          messages: row.messages,
          created_by: actor.id,
          updated_by: actor.id,
        })),
        ...diagnostics.map((item) => ({
          batch_id: batch.id,
          source_sheet: item.sourceSheet,
          source_row: item.sourceRow,
          payload: {},
          status: "error",
          messages: item.messages,
          created_by: actor.id,
          updated_by: actor.id,
        })),
      ];
      if (stagedRows.length > 0) {
        const rowResult = await client.from("upload_rows").insert(stagedRows);
        if (rowResult.error) throw new UploadRepositoryError(rowResult.error);
      }
      return { batchId: batch.id, newCount, conflictCount, errorCount, unknownMasterDataCount, rows: reviewedRows, diagnostics };
    },

    async commitUpload(batchId, replaceConflicts) {
      const result = await client.rpc("commit_upload_batch", { batch_id: batchId, replace_conflicts: replaceConflicts });
      const data = requestData(result, "upload_commit_failed");
      return {
        batchId: String(data.batch_id),
        insertedCount: Number(data.inserted ?? 0),
        replacedCount: Number(data.replaced ?? 0),
      };
    },
  };
}

export const stageUpload = (file: File) => createUploadRepository().stageUpload(file);
export const commitUpload = (batchId: string, replaceConflicts: boolean) => createUploadRepository().commitUpload(batchId, replaceConflicts);
