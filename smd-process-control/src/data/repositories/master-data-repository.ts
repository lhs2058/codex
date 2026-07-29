import {
  DomainValidationError,
  type AppRole,
  type MasterDataSnapshot,
  type StandardTime,
  type StandardTimeInput,
} from "../../domain/types";
import { getSupabaseClient } from "../supabase";

type Result<T> = PromiseLike<{ data: T; error: { message?: string; code?: string } | null }>;
type Query = { select(columns: string): Query; eq(column: string, value: unknown): Query; is(column: string, value: null): Query; order(column: string, options?: { ascending?: boolean }): Result<unknown[]>; single(): Result<unknown>; insert(value: unknown): { select(columns: string): { single(): Result<unknown> } }; update(value: unknown): Query };
interface HistoricalMasterDataPayload {
  models: unknown[];
  processes: unknown[];
  lines: unknown[];
  shifts: unknown[];
  time_slots: unknown[];
  downtime_reasons: unknown[];
  standard_times: unknown[];
}
export interface MasterDataClient {
  from(table: string): Query;
  rpc(name: string, args?: Record<string, unknown>): Result<unknown>;
  auth?: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  storage?: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Result<{ signedUrl: string } | null>;
    };
  };
}
export type AdminConfigurationEntity =
  | "model"
  | "process"
  | "line"
  | "shift"
  | "time_slot"
  | "downtime_reason"
  | "yield_target"
  | "standard_time";
export type AdminConfigurationAction = "create" | "update" | "deactivate" | "reactivate";
export interface AdminConfigurationCommand {
  entity: AdminConfigurationEntity;
  action: AdminConfigurationAction;
  id: string | null;
  expectedVersion: number | null;
  values: Record<string, unknown>;
}
export interface AdminMasterRecord {
  id: string;
  code: string;
  name: string;
  active: boolean;
  version: number;
}
export interface AdminTimeSlotRecord {
  id: string;
  shiftId: string;
  code: string;
  startsAt: string;
  endsAt: string;
  endDayOffset: 0 | 1;
  sequence: number;
  active: boolean;
  version: number;
}
export interface AdminYieldTargetRecord {
  id: string;
  modelId: string | null;
  processId: string;
  lineId: string | null;
  targetPercent: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  version: number;
}
export interface AdminStandardTimeRecord {
  id: string;
  modelId: string;
  processId: string;
  lineId: string;
  secondsPerUnit: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  version: number;
}
export interface AdminOverview {
  masters: {
    model: AdminMasterRecord[];
    process: AdminMasterRecord[];
    line: AdminMasterRecord[];
    shift: AdminMasterRecord[];
    time_slot: AdminTimeSlotRecord[];
    downtime_reason: AdminMasterRecord[];
    yield_target: AdminYieldTargetRecord[];
    standard_time: AdminStandardTimeRecord[];
  };
  profiles: Array<{
    id: string;
    employeeId: string;
    displayName: string;
    role: AppRole;
    active: boolean;
    version: number;
  }>;
  uploads: Array<{
    id: string;
    fileName: string;
    storagePath: string;
    workbookKind: string;
    status: string;
    createdAt: string;
  }>;
  audits: Array<{
    id: string;
    actorId: string | null;
    tableName: string;
    recordId: string;
    action: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    createdAt: string;
  }>;
  production: Array<{
    id: string;
    productionDate: string;
    lineId: string;
    modelId: string;
    processId: string;
    actualQty: number;
    version: number;
  }>;
}
export interface MasterDataRepository {
  listMasterData(): Promise<MasterDataSnapshot>;
  listAdminOverview(): Promise<AdminOverview>;
  manageConfiguration(command: AdminConfigurationCommand): Promise<{ id: string; version: number }>;
  manageProfile(input: { profileId: string; role: AppRole; active: boolean; expectedVersion: number }): Promise<{ id: string; version: number }>;
  softDeleteProduction(id: string, expectedVersion: number): Promise<{ id: string; version: number }>;
  createUploadOriginalUrl(storagePath: string): Promise<string>;
  createModel(input: { code: string; name: string }): Promise<void>;
  deactivateDowntimeReason(id: string, expectedVersion: number): Promise<void>;
  saveStandardTime(input: StandardTimeInput): Promise<StandardTime>;
}
export interface HistoricalMasterDataRepository {
  listHistoricalMasterData(): Promise<MasterDataSnapshot>;
}
export interface ImportMasterDataRepository {
  listImportMasterData(): Promise<MasterDataSnapshot>;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
function normalizeDate(value: string) {
  if (!isoDate.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new DomainValidationError("invalid_effective_date");
  return value;
}

function bangkokDateFromTimestamp(value: unknown): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(String(value)));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function range(input: Pick<StandardTime, "effectiveFrom" | "effectiveTo">) {
  const from = normalizeDate(input.effectiveFrom);
  const to = input.effectiveTo === null ? null : normalizeDate(input.effectiveTo);
  if (to !== null && to < from) throw new DomainValidationError("invalid_effective_range");
  return { from, to };
}
function overlaps(a: ReturnType<typeof range>, b: ReturnType<typeof range>) { return (a.to === null || b.from <= a.to) && (b.to === null || a.from <= b.to); }
function mapError(error: { message?: string; code?: string }) { return error.code === "23P01" ? new Error("overlapping-effective-period") : new Error(error.message || "master_data_request_failed"); }

export function findEffectiveStandardTime(records: StandardTime[], productionDate: string): StandardTime | null {
  const date = normalizeDate(productionDate);
  const matches = records.filter((record) => { const period = range(record); return record.effectiveFrom <= date && (period.to === null || date <= period.to); });
  if (matches.length > 1) throw new DomainValidationError("standard_time_invariant_violation");
  return matches[0] ?? null;
}

export function validateStandardTimeOverlap(records: StandardTime[], candidate: StandardTimeInput): { ok: true } | { ok: false; code: "overlapping-effective-period" } {
  const candidateRange = range(candidate);
  for (const record of records) {
    if (record.modelId === candidate.modelId && record.processId === candidate.processId && record.lineId === candidate.lineId && overlaps(range(record), candidateRange)) return { ok: false, code: "overlapping-effective-period" };
  }
  return { ok: true };
}

function rows<T>(result: { data: T; error: { message?: string; code?: string } | null }): T { if (result.error) throw mapError(result.error); return result.data; }
const active = (query: Query) => query.is("deleted_at", null).eq("is_active", true);

function mapSnapshot(payload: HistoricalMasterDataPayload): MasterDataSnapshot {
  const mapMaster = (values: unknown[]) => values.map((value: any) => ({
    id: value.id,
    code: value.code,
    name: value.name,
    active: value.is_active,
    version: Number(value.version),
  }));
  return {
    models: mapMaster(payload.models),
    processes: mapMaster(payload.processes) as MasterDataSnapshot["processes"],
    lines: mapMaster(payload.lines),
    shifts: mapMaster(payload.shifts),
    timeSlots: payload.time_slots.map((value: any) => ({
      id: value.id,
      shiftId: value.shift_id,
      code: value.code,
      startsAt: value.starts_at,
      endsAt: value.ends_at,
      endDayOffset: value.end_day_offset,
      sequence: value.sequence,
      active: value.is_active,
      version: Number(value.version),
    })),
    downtimeReasons: mapMaster(payload.downtime_reasons),
    standardTimes: payload.standard_times.map((value: any) => ({
      id: value.id,
      modelId: value.model_id,
      processId: value.process_id,
      lineId: value.line_id,
      secondsPerUnit: Number(value.seconds_per_unit),
      effectiveFrom: value.effective_from,
      effectiveTo: value.effective_to,
    })),
  };
}

function property(value: any, camel: string, snake: string = camel): any {
  return value?.[camel] ?? value?.[snake];
}

function mapAdminOverview(payload: any): AdminOverview {
  const master = (values: any[] = []): AdminMasterRecord[] => values.map((value) => ({
    id: String(value.id),
    code: String(value.code),
    name: String(value.name),
    active: Boolean(property(value, "active", "is_active")) && property(value, "deletedAt", "deleted_at") == null,
    version: Number(value.version),
  }));
  const timeSlots = (payload?.masters?.time_slot ?? payload?.time_slots ?? []).map((value: any) => ({
    id: String(value.id),
    shiftId: String(property(value, "shiftId", "shift_id")),
    code: String(value.code),
    startsAt: String(property(value, "startsAt", "starts_at")),
    endsAt: String(property(value, "endsAt", "ends_at")),
    endDayOffset: Number(property(value, "endDayOffset", "end_day_offset")) as 0 | 1,
    sequence: Number(value.sequence),
    active: Boolean(property(value, "active", "is_active")) && property(value, "deletedAt", "deleted_at") == null,
    version: Number(value.version),
  }));
  const targets = (payload?.masters?.yield_target ?? payload?.yield_targets ?? []).map((value: any) => ({
    id: String(value.id),
    modelId: property(value, "modelId", "model_id") == null ? null : String(property(value, "modelId", "model_id")),
    processId: String(property(value, "processId", "process_id")),
    lineId: property(value, "lineId", "line_id") == null ? null : String(property(value, "lineId", "line_id")),
    targetPercent: Number(property(value, "targetPercent", "target_percent")),
    effectiveFrom: String(property(value, "effectiveFrom", "effective_from")),
    effectiveTo: property(value, "effectiveTo", "effective_to") == null ? null : String(property(value, "effectiveTo", "effective_to")),
    active: property(value, "active", "is_active") !== false && property(value, "deletedAt", "deleted_at") == null,
    version: Number(value.version),
  }));
  const standardTimes = (payload?.masters?.standard_time ?? payload?.standard_times ?? []).map((value: any) => ({
    id: String(value.id),
    modelId: String(property(value, "modelId", "model_id")),
    processId: String(property(value, "processId", "process_id")),
    lineId: String(property(value, "lineId", "line_id")),
    secondsPerUnit: Number(property(value, "secondsPerUnit", "seconds_per_unit")),
    effectiveFrom: String(property(value, "effectiveFrom", "effective_from")),
    effectiveTo: property(value, "effectiveTo", "effective_to") == null ? null : String(property(value, "effectiveTo", "effective_to")),
    active: property(value, "active", "is_active") !== false && property(value, "deletedAt", "deleted_at") == null,
    version: Number(value.version),
  }));
  const masters = payload?.masters ?? payload ?? {};
  return {
    masters: {
      model: master(masters.model ?? payload?.models),
      process: master(masters.process ?? payload?.processes),
      line: master(masters.line ?? payload?.lines),
      shift: master(masters.shift ?? payload?.shifts),
      time_slot: timeSlots,
      downtime_reason: master(masters.downtime_reason ?? payload?.downtime_reasons),
      yield_target: targets,
      standard_time: standardTimes,
    },
    profiles: (payload?.profiles ?? []).map((value: any) => ({
      id: String(value.id),
      employeeId: String(property(value, "employeeId", "employee_id")),
      displayName: String(property(value, "displayName", "display_name")),
      role: value.role as AppRole,
      active: Boolean(property(value, "active", "is_active")),
      version: Number(value.version),
    })),
    uploads: (payload?.uploads ?? payload?.upload_batches ?? []).map((value: any) => ({
      id: String(value.id),
      fileName: String(property(value, "fileName", "source_file_name")),
      storagePath: String(property(value, "storagePath", "storage_path")),
      workbookKind: String(property(value, "workbookKind", "workbook_kind")),
      status: String(value.status),
      createdAt: String(property(value, "createdAt", "created_at")),
    })),
    audits: (payload?.audits ?? payload?.audit_logs ?? []).map((value: any) => ({
      id: String(value.id),
      actorId: property(value, "actorId", "actor_id") == null ? null : String(property(value, "actorId", "actor_id")),
      tableName: String(property(value, "tableName", "table_name")),
      recordId: String(property(value, "recordId", "record_id")),
      action: String(value.action),
      before: property(value, "before", "before_data") ?? null,
      after: property(value, "after", "after_data") ?? null,
      createdAt: String(property(value, "createdAt", "created_at")),
    })),
    production: (payload?.production ?? payload?.production_records ?? []).map((value: any) => ({
      id: String(value.id),
      productionDate: String(property(value, "productionDate", "production_date")),
      lineId: String(property(value, "lineId", "line_id")),
      modelId: String(property(value, "modelId", "model_id")),
      processId: String(property(value, "processId", "process_id")),
      actualQty: Number(property(value, "actualQty", "actual_qty")),
      version: Number(value.version),
    })),
  };
}

async function rpcResult<T>(client: MasterDataClient, name: string, args?: Record<string, unknown>): Promise<T> {
  const result = args === undefined ? await client.rpc(name) : await client.rpc(name, args);
  return rows(result as { data: T; error: { message?: string; code?: string } | null });
}

export function createMasterDataRepository(client: MasterDataClient = getSupabaseClient() as unknown as MasterDataClient): MasterDataRepository & HistoricalMasterDataRepository & ImportMasterDataRepository {
  const loadActiveSnapshot = async (): Promise<MasterDataSnapshot> => {
    const [models, processes, lines, shifts, timeSlots, downtimeReasons, standardTimes] = await Promise.all([
      active(client.from("models").select("id,code,name,is_active,version")).order("code"),
      active(client.from("processes").select("id,code,name,is_active,version")).order("code"),
      active(client.from("lines").select("id,code,name,is_active,version")).order("code"),
      active(client.from("shifts").select("id,code,name,is_active,version")).order("code"),
      active(client.from("time_slots").select("id,shift_id,code,starts_at,ends_at,end_day_offset,sequence,is_active,version")).order("sequence"),
      active(client.from("downtime_reasons").select("id,code,name,is_active,version")).order("code"),
      client.from("standard_times").select("id,model_id,process_id,line_id,seconds_per_unit,effective_from,effective_to,deleted_at").order("effective_from", { ascending: false }),
    ]);
    return mapSnapshot({
      models: rows(models),
      processes: rows(processes),
      lines: rows(lines),
      shifts: rows(shifts),
      time_slots: rows(timeSlots),
      downtime_reasons: rows(downtimeReasons),
      standard_times: rows(standardTimes).filter((standardTime: any) =>
        standardTime.deleted_at == null
        || String(standardTime.effective_from)
          <= bangkokDateFromTimestamp(standardTime.deleted_at)),
    });
  };
  return {
    listMasterData: loadActiveSnapshot,
    async listImportMasterData() {
      return mapSnapshot(await rpcResult<HistoricalMasterDataPayload>(client, "list_import_master_data"));
    },
    async listHistoricalMasterData() {
      return mapSnapshot(await rpcResult<HistoricalMasterDataPayload>(client, "list_historical_master_data"));
    },
    async listAdminOverview() {
      return mapAdminOverview(await rpcResult<unknown>(client, "admin_list_operational_data"));
    },
    async manageConfiguration(command) {
      return rpcResult(client, "admin_manage_configuration", {
        p_entity: command.entity,
        p_action: command.action,
        p_record_id: command.id,
        p_expected_version: command.expectedVersion,
        p_values: command.values,
      });
    },
    async manageProfile(input) {
      return rpcResult(client, "admin_manage_profile", {
        p_profile_id: input.profileId,
        p_role: input.role,
        p_is_active: input.active,
        p_expected_version: input.expectedVersion,
      });
    },
    async softDeleteProduction(id, expectedVersion) {
      return rpcResult(client, "admin_soft_delete_production", {
        p_record_id: id,
        p_expected_version: expectedVersion,
      });
    },
    async createUploadOriginalUrl(storagePath) {
      if (!client.storage) throw new Error("upload_storage_unavailable");
      const result = await client.storage
        .from("smd-upload-originals")
        .createSignedUrl(storagePath, 60);
      const value = rows(result);
      if (!value?.signedUrl) throw new Error("upload_original_url_unavailable");
      return value.signedUrl;
    },
    async createModel(input) {
      await this.manageConfiguration({
        entity: "model",
        action: "create",
        id: null,
        expectedVersion: null,
        values: { code: input.code.trim(), name: input.name.trim() },
      });
    },
    async deactivateDowntimeReason(id, expectedVersion) {
      await this.manageConfiguration({
        entity: "downtime_reason",
        action: "deactivate",
        id,
        expectedVersion,
        values: {},
      });
    },
    async saveStandardTime(input) {
      range(input);
      if (!Number.isFinite(input.secondsPerUnit) || input.secondsPerUnit <= 0) throw new DomainValidationError("invalid_seconds_per_unit");
      const value: any = await this.manageConfiguration({
        entity: "standard_time",
        action: "create",
        id: null,
        expectedVersion: null,
        values: {
          model_id: input.modelId,
          process_id: input.processId,
          line_id: input.lineId,
          seconds_per_unit: input.secondsPerUnit,
          effective_from: input.effectiveFrom,
          effective_to: input.effectiveTo,
        },
      });
      return {
        id: value.id,
        modelId: value.modelId ?? value.model_id ?? input.modelId,
        processId: value.processId ?? value.process_id ?? input.processId,
        lineId: value.lineId ?? value.line_id ?? input.lineId,
        secondsPerUnit: Number(value.secondsPerUnit ?? value.seconds_per_unit ?? input.secondsPerUnit),
        effectiveFrom: value.effectiveFrom ?? value.effective_from ?? input.effectiveFrom,
        effectiveTo: value.effectiveTo ?? value.effective_to ?? input.effectiveTo,
      };
    },
  };
}

export const listMasterData = () => createMasterDataRepository().listMasterData();
export const saveStandardTime = (input: StandardTimeInput) => createMasterDataRepository().saveStandardTime(input);
