import readXlsxFile, { readSheetNames } from "read-excel-file";
import type {
  LegacyUploadReview as DomainLegacyUploadReview,
  MasterDataSnapshot,
  UploadCommitResult,
  UploadReview,
} from "../../domain/types";
import type {
  ImportParseResult,
  NormalizedImportRow,
  StagedUploadPayloadV2,
  WorkbookSheet,
} from "../../excel/contracts";
import { parseAoiWorkbook } from "../../excel/adapters/aoi-adapter";
import { parseIctWorkbook } from "../../excel/adapters/ict-adapter";
import { parseProductionWorkbook } from "../../excel/adapters/production-adapter";
import { parseSpiWorkbook } from "../../excel/adapters/spi-adapter";
import { parseStandardWorkbook } from "../../excel/adapters/standard-adapter";
import { parseXrayWorkbook } from "../../excel/adapters/xray-adapter";
import { detectWorkbook } from "../../excel/detect-workbook";
import { getSupabaseClient } from "../supabase";
import { createMasterDataRepository } from "./master-data-repository";
import { deriveLegacyCandidates } from "../../upload/legacy-master-candidates";

export const UPLOAD_STORAGE_BUCKET = "smd-upload-originals";
export const UPLOAD_EXISTING_PREFETCH_THRESHOLD = 100;
export const UPLOAD_ROW_INSERT_CHUNK_SIZE = 500;
export const DETAIL_PAGE_SIZE = 200;

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
  from(table: "production_records" | "quality_records"): any;
  rpc(name: string, params: Record<string, unknown>): PromiseLike<RequestResult<any>>;
}

export type UploadReviewV2 = Omit<UploadReview, "rows"> & {
  defectCount: number;
  rows: Array<NormalizedImportRow & {
    status: UploadReview["rows"][number]["status"];
    messages: string[];
    reviewRequired: boolean;
    rowKind: "production" | "daily_quality";
    targetRecordId: string | null;
    expectedTargetVersion: number | null;
  }>;
};

export type LegacyUploadReview = DomainLegacyUploadReview & {
  defectCount: number;
  masterCandidateCount: number;
  standardTimeCandidateCount: number;
  stWarnings: ImportParseResult["stWarnings"];
  duplicateCompletedBatch?: boolean;
};

export interface UploadDetailPage {
  page: number;
  pageSize: 200;
  total: number;
  rows: UploadReviewV2["rows"];
  diagnostics: UploadReview["diagnostics"];
}

export interface UploadApproval {
  masterCandidates: Array<{ key: string; approved: boolean; approvedName: string }>;
  standardTimeCandidates: Array<{
    key: string;
    approved: boolean;
    approvedSecondsPerUnit: number | null;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
}

export interface UploadRepository {
  stageUpload(file: File): Promise<LegacyUploadReview>;
  loadDetailPage(batchId: string, page: number, status?: string): Promise<UploadDetailPage>;
  commitUpload(batchId: string, replaceConflicts: boolean, approval?: UploadApproval): Promise<UploadCommitResult & {
    skippedCount: number;
    masterInsertedCount: number;
    standardTimeInsertedCount: number;
  }>;
}

interface ExistingLookupInput {
  target: "production" | "quality";
  productionDate: string;
  shiftId: string;
  timeSlotId: string | null;
  lineId: string;
  modelId: string;
  processId: string;
  includesQuality: boolean;
}

interface ExistingLookupResult {
  id: string;
  version: number;
  blocked?: boolean;
}

interface UploadRepositoryOptions {
  createId(): string;
  readWorkbook(file: File): Promise<WorkbookSheet[]>;
  parseWorkbook(sheets: WorkbookSheet[]): ImportParseResult;
  listMasterData(): Promise<MasterDataSnapshot>;
  prefetchExisting?(inputs: ExistingLookupInput[]): Promise<void>;
  findExisting(input: ExistingLookupInput): Promise<ExistingLookupResult | null>;
}

export class UploadRepositoryError extends Error {
  code?: string;
  batchId?: string;

  constructor(error: RequestError | string) {
    super(typeof error === "string" ? error : error.message ?? "upload_request_failed");
    this.code = typeof error === "string" ? undefined : error.code;
  }
}

function withBatchId(error: unknown, batchId: string): UploadRepositoryError {
  const retryError = error instanceof UploadRepositoryError
    ? error
    : new UploadRepositoryError(error instanceof Error ? error.message : String(error));
  if (!retryError.code && typeof error === "object" && error !== null && "code" in error) {
    retryError.code = String((error as { code: unknown }).code);
  }
  retryError.batchId = batchId;
  return retryError;
}

async function forPersistedBatch<T>(batchId: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw withBatchId(error, batchId);
  }
}

export async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readWorkbookSheets(file: File): Promise<WorkbookSheet[]> {
  const sheetNames = await readSheetNames(file);
  return Promise.all(sheetNames.map(async (sheet) => ({ sheet, data: await readXlsxFile(file, { sheet }) })));
}

export function parseDetectedWorkbook(sheets: WorkbookSheet[]): ImportParseResult {
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
  const existingCache = new Map<string, ExistingLookupResult | null>();

  const fetchExistingRows = async (
    target: "production" | "quality",
    inputs: ExistingLookupInput[],
    unlinkedQualityOnly: boolean,
  ) => {
    const found = new Map<string, ExistingLookupResult & { productionRecordId?: string | null }>();
    const byDate = new Map<string, ExistingLookupInput[]>();
    for (const input of inputs) {
      const group = byDate.get(input.productionDate) ?? [];
      group.push(input);
      byDate.set(input.productionDate, group);
    }

    await Promise.all([...byDate.entries()].map(async ([productionDate, candidates]) => {
      const values = (field: keyof ExistingLookupInput) =>
        [...new Set(candidates.map((candidate) => String(candidate[field])))];
      for (let from = 0; ; from += 1000) {
        let query = client.from(target === "production" ? "production_records" : "quality_records")
          .select(target === "quality"
            ? "id,version,production_record_id,production_date,shift_id,time_slot_id,line_id,model_id,process_id"
            : "id,version,production_date,shift_id,time_slot_id,line_id,model_id,process_id")
          .eq("production_date", productionDate)
          .in("shift_id", values("shiftId"))
          .in("line_id", values("lineId"))
          .in("model_id", values("modelId"))
          .in("process_id", values("processId"))
          .is("deleted_at", null);
        if (target === "quality" && unlinkedQualityOnly) {
          query = query.is("production_record_id", null);
        }
        const result = await query
          .order("id", { ascending: true })
          .range(from, from + 999);
        if (result.error) throw new UploadRepositoryError(result.error);
        const page = result.data ?? [];
        for (const row of page) {
          const key = existingKey({
            target,
            productionDate: String(row.production_date),
            shiftId: String(row.shift_id),
            timeSlotId: row.time_slot_id === null ? null : String(row.time_slot_id),
            lineId: String(row.line_id),
            modelId: String(row.model_id),
            processId: String(row.process_id),
          });
          found.set(key, {
            id: String(row.id),
            version: Number(row.version),
            productionRecordId: target === "quality"
              ? row.production_record_id === null ? null : String(row.production_record_id)
              : undefined,
          });
        }
        if (page.length < 1000) break;
      }
    }));

    return found;
  };

  return {
    createId: () => crypto.randomUUID(),
    readWorkbook: readWorkbookSheets,
    parseWorkbook: parseDetectedWorkbook,
    listMasterData: () => masterRepository.listMasterData(),
    async prefetchExisting(inputs) {
      const unique = [...new Map(inputs.map((input) => [
        `${existingKey(input)}|${input.includesQuality}`,
        input,
      ])).values()];
      const productionInputs = unique.filter((input) => input.target === "production");
      const qualityInputs = unique.filter((input) => input.target === "quality");
      const productionQualityInputs = productionInputs.filter((input) => input.includesQuality);
      const [productionRows, unlinkedQualityRows, allQualityRows] = await Promise.all([
        fetchExistingRows("production", productionInputs, false),
        fetchExistingRows(
          "quality",
          [...qualityInputs, ...productionQualityInputs],
          true,
        ),
        fetchExistingRows("quality", qualityInputs, false),
      ]);

      for (const input of unique) {
        const key = existingKey(input);
        if (input.target === "quality") {
          const unlinked = unlinkedQualityRows.get(key);
          const anyQuality = allQualityRows.get(key);
          existingCache.set(key, unlinked ?? (anyQuality
            ? { id: anyQuality.id, version: anyQuality.version, blocked: true }
            : null));
          continue;
        }
        const unlinkedQuality = input.includesQuality
          ? unlinkedQualityRows.get(existingKey({ ...input, target: "quality" }))
          : null;
        existingCache.set(key, unlinkedQuality
          ? { id: unlinkedQuality.id, version: unlinkedQuality.version, blocked: true }
          : productionRows.get(key) ?? null);
      }
    },
    async findExisting(input) {
      const cacheKey = existingKey(input);
      if (existingCache.has(cacheKey)) return existingCache.get(cacheKey) ?? null;
      const lookup = async (
        target: "production" | "quality",
        unlinkedQualityOnly: boolean,
      ): Promise<{ id: string; version: number; production_record_id?: string | null } | null> => {
        let query = client.from(target === "production" ? "production_records" : "quality_records")
        .select(target === "quality" ? "id,version,production_record_id" : "id,version")
        .eq("production_date", input.productionDate)
        .eq("shift_id", input.shiftId)
        .eq("line_id", input.lineId)
        .eq("model_id", input.modelId)
        .eq("process_id", input.processId)
        .is("deleted_at", null);
      query = input.timeSlotId === null
        ? query.is("time_slot_id", null)
        : query.eq("time_slot_id", input.timeSlotId);
      if (target === "quality" && unlinkedQualityOnly) {
        query = query.is("production_record_id", null);
      }
      const result = await query.maybeSingle();
      if (result.error) throw new UploadRepositoryError(result.error);
      return result.data;
      };

      if (input.target === "quality") {
        const unlinked = await lookup("quality", true);
        if (unlinked) return unlinked;
        const anyQuality = await lookup("quality", false);
        return anyQuality ? { ...anyQuality, blocked: true } : null;
      }

      if (input.includesQuality) {
        const unlinkedQuality = await lookup("quality", true);
        if (unlinkedQuality) return { ...unlinkedQuality, blocked: true };
      }
      return lookup("production", false);
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

function existingKey(input: Omit<ExistingLookupInput, "includesQuality">): string {
  return [
    input.target,
    input.productionDate,
    input.shiftId,
    input.timeSlotId ?? "",
    input.lineId,
    input.modelId,
    input.processId,
  ].join("|");
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
  if ((row.dimensions.production !== null || row.timeSlotCode !== null) && !timeSlot) {
    messages.push(`Unknown time slot: ${row.timeSlotCode ?? "(blank)"}`);
  }
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

function existingMasterIds(row: NormalizedImportRow, masterData: MasterDataSnapshot): {
  modelId: string | undefined;
  lineId: string | undefined;
  processId: string | undefined;
  shiftId: string | undefined;
  timeSlotId: string | undefined;
} {
  const model = masterData.models.find((item) => item.active && item.code === row.modelCode);
  const line = masterData.lines.find((item) => item.active && item.code === row.lineCode);
  const process = masterData.processes.find((item) => item.active && item.code === row.processCode);
  const shift = masterData.shifts.find((item) => item.active && item.code === row.shiftCode);
  const timeSlot = shift && row.timeSlotCode
    ? masterData.timeSlots.find((item) => item.shiftId === shift.id && item.code === row.timeSlotCode)
    : undefined;
  return {
    modelId: model?.id,
    lineId: line?.id,
    processId: process?.id,
    shiftId: shift?.id,
    timeSlotId: timeSlot?.id,
  };
}

function structuralMessages(row: NormalizedImportRow, masterData: MasterDataSnapshot): string[] {
  const messages: string[] = [];
  if (!masterData.processes.some((item) => item.active && item.code === row.processCode)) {
    messages.push(`Unknown process: ${row.processCode}`);
  }
  return messages;
}

const rowKey = (row: NormalizedImportRow) => [
  row.dimensions.production ? "production" : "quality",
  row.productionDate,
  row.shiftCode,
  row.timeSlotCode,
  row.lineCode,
  row.modelCode,
  row.processCode,
].join("|");

function groupDiagnostics(result: ImportParseResult, addEmptyWorkbookDiagnostic = true): UploadReview["diagnostics"] {
  const grouped = new Map<string, UploadReview["diagnostics"][number]>();
  for (const diagnostic of result.diagnostics) {
    const key = `${diagnostic.sourceSheet}|${diagnostic.sourceRow}`;
    const current = grouped.get(key) ?? { sourceSheet: diagnostic.sourceSheet, sourceRow: diagnostic.sourceRow, messages: [] };
    current.messages.push(diagnostic.message);
    grouped.set(key, current);
  }
  if (addEmptyWorkbookDiagnostic && result.rows.length === 0 && result.diagnostics.length === 0) {
    grouped.set("Production|2", { sourceSheet: "Production", sourceRow: 2, messages: ["No production rows were found"] });
  }
  return [...grouped.values()];
}

function stagedPayload(row: NormalizedImportRow): StagedUploadPayloadV2 {
  return {
    contractVersion: 2,
    sourceTrace: { sheet: row.sourceSheet, row: row.sourceRow },
    productionDate: row.productionDate,
    shiftCode: row.shiftCode,
    timeSlotCode: row.timeSlotCode,
    lineCode: row.lineCode,
    modelCode: row.modelCode,
    processCode: row.processCode,
    note: row.note,
    production: row.dimensions.production,
    quality: row.dimensions.quality,
    downtime: row.downtimeMinutes > 0
      ? { minutes: row.downtimeMinutes, reasonCode: row.downtimeReasonCode! }
      : null,
    defects: row.defects,
    warnings: row.warnings,
  };
}

function detailRow(value: any): UploadReviewV2["rows"][number] | null {
  if (value?.rowKind === "diagnostic") return null;
  const payload = value?.payload ?? {};
  const production = payload.production ?? null;
  const quality = payload.quality ?? null;
  const downtime = payload.downtime ?? null;
  const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
  return {
    sourceSheet: String(value?.sourceSheet ?? ""),
    sourceRow: Number(value?.sourceRow ?? 0),
    productionDate: String(payload.productionDate ?? ""),
    shiftCode: String(payload.shiftCode ?? ""),
    timeSlotCode: payload.timeSlotCode == null ? null : String(payload.timeSlotCode),
    lineCode: String(payload.lineCode ?? ""),
    modelCode: String(payload.modelCode ?? ""),
    processCode: payload.processCode,
    inputQty: Number(production?.inputQty ?? quality?.inputQty ?? 0),
    actualQty: Number(production?.actualQty ?? 0),
    okQty: Number(quality?.okQty ?? 0),
    ngQty: Number(quality?.ngQty ?? 0),
    downtimeMinutes: Number(downtime?.minutes ?? 0),
    downtimeReasonCode: downtime?.reasonCode == null ? null : String(downtime.reasonCode),
    note: String(payload.note ?? ""),
    dimensions: { production, quality },
    warnings,
    defects: Array.isArray(payload.defects) ? payload.defects : [],
    status: value.status,
    messages: Array.isArray(value.messages) ? value.messages.map(String) : [],
    reviewRequired: warnings.length > 0,
    rowKind: value.rowKind === "daily_quality" ? "daily_quality" : "production",
    targetRecordId: value.targetRecordId == null ? null : String(value.targetRecordId),
    expectedTargetVersion: value.expectedTargetVersion == null ? null : Number(value.expectedTargetVersion),
  } as UploadReviewV2["rows"][number];
}

function detailDiagnostics(values: any[]): UploadReview["diagnostics"] {
  return values
    .filter((value) => value?.rowKind === "diagnostic")
    .map((value) => ({
      sourceSheet: String(value.sourceSheet ?? ""),
      sourceRow: Number(value.sourceRow ?? 0),
      messages: Array.isArray(value.messages) ? value.messages.map(String) : [],
    }));
}

export function createUploadRepository(
  client: UploadRepositoryClient = getSupabaseClient() as unknown as UploadRepositoryClient,
  overrides: Partial<UploadRepositoryOptions> = {},
): UploadRepository {
  const options: UploadRepositoryOptions = { ...defaultOptions(client), ...overrides };
  if (overrides.findExisting && overrides.prefetchExisting === undefined) {
    options.prefetchExisting = undefined;
  }
  const loadDetailPage = async (batchId: string, page: number, status?: string): Promise<UploadDetailPage> => {
    const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
    const result = requestData(await client.rpc("list_upload_detail_page", {
      p_batch_id: batchId,
      p_offset: (safePage - 1) * DETAIL_PAGE_SIZE,
      p_limit: DETAIL_PAGE_SIZE,
      p_status: status ?? null,
    }), "upload_detail_page_failed") as { rows?: any[]; total?: number };
    const values = Array.isArray(result.rows) ? result.rows : [];
    return {
      page: safePage,
      pageSize: DETAIL_PAGE_SIZE,
      total: Number(result.total ?? 0),
      rows: values.map(detailRow).filter((row): row is UploadReviewV2["rows"][number] => row !== null),
      diagnostics: detailDiagnostics(values),
    };
  };
  return {
    async stageUpload(file) {
      const sourceSha256 = await sha256File(file);
      const completed = await client.rpc("find_completed_upload_by_hash", {
        p_source_sha256: sourceSha256,
      });
      if (completed.error) throw new UploadRepositoryError(completed.error);
      if (completed.data) {
        const duplicate = completed.data as {
          id: string;
          sourceFileName: string;
          workbookKind: DomainLegacyUploadReview["workbookKind"];
          newCount?: number;
          conflictCount?: number;
          errorCount?: number;
          defectCount?: number;
          detailTotal?: number;
        };
        const detail = await loadDetailPage(String(duplicate.id), 1);
        return {
          batchId: String(duplicate.id),
          sourceFileName: String(duplicate.sourceFileName),
          sourceSha256,
          workbookKind: duplicate.workbookKind,
          newCount: Number(duplicate.newCount ?? 0),
          conflictCount: Number(duplicate.conflictCount ?? 0),
          errorCount: Number(duplicate.errorCount ?? 0),
          unknownMasterDataCount: 0,
          defectCount: Number(duplicate.defectCount ?? 0),
          rows: detail.rows,
          diagnostics: detail.diagnostics,
          masterCandidates: [],
          standardTimeCandidates: [],
          masterCandidateCount: 0,
          standardTimeCandidateCount: 0,
          stWarnings: [],
          detailTotal: Number(duplicate.detailTotal ?? detail.total),
          detailPage: detail.page,
          duplicateCompletedBatch: true,
        };
      }
      const sheets = await options.readWorkbook(file);
      const parsedResult = options.parseWorkbook(sheets);
      const parsed = {
        ...parsedResult,
        capacityEvidence: parsedResult.capacityEvidence ?? [],
        stWarnings: parsedResult.stWarnings ?? [],
      } as ImportParseResult;
      if (parsed.diagnostics.some((item) => item.code === "unsupported-template-version")) {
        throw new UploadRepositoryError(parsed.diagnostics.find((item) => item.code === "unsupported-template-version")!.message);
      }
      const masterData = await options.listMasterData();
      const candidates = deriveLegacyCandidates(parsed, masterData);
      const candidateMessages = new Map<string, string[]>();
      for (const diagnostic of candidates.diagnostics) {
        const key = `${diagnostic.sourceSheet}|${diagnostic.sourceRow}`;
        const messages = candidateMessages.get(key) ?? [];
        messages.push(diagnostic.message);
        candidateMessages.set(key, messages);
      }
      if (
        parsed.rows.length >= UPLOAD_EXISTING_PREFETCH_THRESHOLD
        && options.prefetchExisting
      ) {
        const candidates: ExistingLookupInput[] = [];
        for (const row of parsed.rows) {
          const ids = existingMasterIds(row, masterData);
          if (structuralMessages(row, masterData).length > 0
            || !ids.modelId || !ids.lineId || !ids.processId || !ids.shiftId
            || (row.timeSlotCode !== null && !ids.timeSlotId)) continue;
          candidates.push({
            target: row.dimensions.production ? "production" : "quality",
            productionDate: row.productionDate,
            shiftId: ids.shiftId,
            timeSlotId: ids.timeSlotId ?? null,
            lineId: ids.lineId,
            modelId: ids.modelId,
            processId: ids.processId,
            includesQuality: row.dimensions.quality !== null,
          });
        }
        await options.prefetchExisting(candidates);
      }
      const seen = new Set<string>();
      const reviewedRows: UploadReviewV2["rows"] = [];
      let unknownMasterDataCount = 0;
      for (const row of parsed.rows) {
        const ids = existingMasterIds(row, masterData);
        const structural = structuralMessages(row, masterData);
        let messages = [...structural, ...(candidateMessages.get(`${row.sourceSheet}|${row.sourceRow}`) ?? [])];
        let status: UploadReview["rows"][number]["status"] = "new";
        const target = row.dimensions.production ? "production" : "quality";
        const rowKind = target === "production" ? "production" : "daily_quality";
        let targetRecordId: string | null = null;
        let expectedTargetVersion: number | null = null;
        if (messages.length) {
          status = "error";
          unknownMasterDataCount += structural.length > 0 ? 1 : 0;
        } else if (seen.has(rowKey(row))) {
          status = "error";
          messages = ["Duplicate record in workbook"];
        } else if (ids.modelId && ids.lineId && ids.processId && ids.shiftId
          && (row.timeSlotCode === null || ids.timeSlotId)) {
          const existing = await options.findExisting({
            target,
            productionDate: row.productionDate,
            shiftId: ids.shiftId,
            timeSlotId: ids.timeSlotId ?? null,
            lineId: ids.lineId,
            modelId: ids.modelId,
            processId: ids.processId,
            includesQuality: row.dimensions.quality !== null,
          });
          if (existing) {
            if (existing.blocked) {
              status = "error";
              messages = ["Quality observation already exists for this production identity"];
            } else {
              status = "conflict";
              messages = ["Duplicate record"];
              targetRecordId = existing.id;
              expectedTargetVersion = existing.version;
            }
          }
        }
        seen.add(rowKey(row));
        const reviewRequired = row.warnings.length > 0;
        if (reviewRequired) messages = [...messages, "Review required: legacy downtime reason was unspecified"];
        reviewedRows.push({
          ...row,
          status,
          messages,
          reviewRequired,
          rowKind,
          targetRecordId,
          expectedTargetVersion,
        });
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
        source_sha256: sourceSha256,
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
          row_kind: row.status === "error" ? "diagnostic" : row.rowKind,
          target_record_id: row.targetRecordId,
          expected_target_version: row.expectedTargetVersion,
          payload: stagedPayload(row),
          status: row.status,
          messages: row.messages,
          created_by: actor.id,
          updated_by: actor.id,
        })),
        ...diagnostics.map((item) => ({
          batch_id: batch.id,
          source_sheet: item.sourceSheet,
          source_row: item.sourceRow,
          row_kind: "diagnostic",
          target_record_id: null,
          expected_target_version: null,
          payload: {},
          status: "error",
          messages: item.messages,
          created_by: actor.id,
          updated_by: actor.id,
        })),
      ];
      if (stagedRows.length > 0) {
        for (let from = 0; from < stagedRows.length; from += UPLOAD_ROW_INSERT_CHUNK_SIZE) {
          const rowResult = await client.from("upload_rows").insert(
            stagedRows.slice(from, from + UPLOAD_ROW_INSERT_CHUNK_SIZE),
          );
          if (rowResult.error) throw new UploadRepositoryError(rowResult.error);
        }
      }
      const stagedCandidates = await forPersistedBatch(batch.id, async () =>
        requestData(await client.rpc("stage_upload_candidates", {
          p_batch_id: batch.id,
          p_master_candidates: candidates.masterCandidates,
          p_standard_time_candidates: candidates.standardTimeCandidates,
        }), "upload_candidate_stage_failed") as { masterCandidateCount?: number; standardTimeCandidateCount?: number },
      );
      const defectCount = reviewedRows.reduce((total, row) => total + row.defects.length, 0);
      const detail = await forPersistedBatch(batch.id, () => loadDetailPage(batch.id, 1));
      return {
        batchId: batch.id,
        sourceFileName: file.name,
        sourceSha256,
        workbookKind: parsed.kind,
        newCount,
        conflictCount,
        errorCount,
        unknownMasterDataCount,
        defectCount,
        rows: detail.rows,
        diagnostics: detail.diagnostics,
        masterCandidates: candidates.masterCandidates,
        standardTimeCandidates: candidates.standardTimeCandidates,
        masterCandidateCount: Number(stagedCandidates.masterCandidateCount ?? 0),
        standardTimeCandidateCount: Number(stagedCandidates.standardTimeCandidateCount ?? 0),
        stWarnings: candidates.stWarnings,
        detailTotal: detail.total,
        detailPage: detail.page,
      };
    },

    loadDetailPage,

    async commitUpload(batchId, replaceConflicts, approval = { masterCandidates: [], standardTimeCandidates: [] }) {
      const masterApprovals = approval.masterCandidates.map(({ key, approved, approvedName }) => ({ key, approved, approvedName }));
      const standardTimeApprovals = approval.standardTimeCandidates.map(({
        key,
        approved,
        approvedSecondsPerUnit,
        effectiveFrom,
        effectiveTo,
      }) => ({ key, approved, approvedSecondsPerUnit, effectiveFrom, effectiveTo }));
      const result = await client.rpc("commit_upload_batch_with_masters", {
        p_batch_id: batchId,
        p_replace_conflicts: replaceConflicts,
        p_master_approvals: masterApprovals,
        p_standard_time_approvals: standardTimeApprovals,
      });
      const data = requestData(result, "upload_commit_failed");
      return {
        batchId: String(data.batch_id),
        insertedCount: Number(data.inserted ?? 0),
        replacedCount: Number(data.replaced ?? 0),
        skippedCount: Number(data.skipped ?? 0),
        masterInsertedCount: Number(data.masters_inserted ?? data.masterInsertedCount ?? 0),
        standardTimeInsertedCount: Number(data.standard_times_inserted ?? data.standardTimeInsertedCount ?? 0),
      };
    },
  };
}

export const stageUpload = (file: File) => createUploadRepository().stageUpload(file);
export const commitUpload = (batchId: string, replaceConflicts: boolean, approval?: UploadApproval) => createUploadRepository().commitUpload(batchId, replaceConflicts, approval);
