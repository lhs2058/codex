import { DomainValidationError, type MasterDataSnapshot, type StandardTime, type StandardTimeInput } from "../../domain/types";
import { getSupabaseClient } from "../supabase";

type Result<T> = PromiseLike<{ data: T; error: { message?: string; code?: string } | null }>;
type Query = { select(columns: string): Query; eq(column: string, value: unknown): Query; is(column: string, value: null): Query; order(column: string, options?: { ascending?: boolean }): Result<unknown[]>; single(): Result<unknown>; insert(value: unknown): { select(columns: string): { single(): Result<unknown> } }; update(value: unknown): Query };
export interface MasterDataClient { from(table: string): Query; }
export interface MasterDataRepository {
  listMasterData(): Promise<MasterDataSnapshot>;
  createModel(input: { code: string; name: string }): Promise<void>;
  deactivateDowntimeReason(id: string): Promise<void>;
  saveStandardTime(input: StandardTimeInput): Promise<StandardTime>;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
function normalizeDate(value: string) {
  if (!isoDate.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new DomainValidationError("invalid_effective_date");
  return value;
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

export function createMasterDataRepository(client: MasterDataClient = getSupabaseClient() as unknown as MasterDataClient): MasterDataRepository {
  return {
    async listMasterData() {
      const [models, processes, lines, shifts, timeSlots, downtimeReasons, standardTimes] = await Promise.all([
        active(client.from("models").select("id,code,name,is_active")).order("code"), active(client.from("processes").select("id,code,name,is_active")).order("code"), active(client.from("lines").select("id,code,name,is_active")).order("code"), active(client.from("shifts").select("id,code,name,is_active")).order("code"), active(client.from("time_slots").select("id,shift_id,code,starts_at,ends_at,end_day_offset,sequence,is_active")).order("sequence"), active(client.from("downtime_reasons").select("id,code,name,is_active")).order("code"), client.from("standard_times").select("id,model_id,process_id,line_id,seconds_per_unit,effective_from,effective_to").is("deleted_at", null).order("effective_from", { ascending: false }),
      ]);
      const mapMaster = (r: unknown[]) => r.map((v: any) => ({ id: v.id, code: v.code, name: v.name, active: v.is_active }));
      return { models: mapMaster(rows(models)), processes: mapMaster(rows(processes)) as MasterDataSnapshot["processes"], lines: mapMaster(rows(lines)), shifts: mapMaster(rows(shifts)), timeSlots: rows(timeSlots).map((v: any) => ({ id: v.id, shiftId: v.shift_id, code: v.code, startsAt: v.starts_at, endsAt: v.ends_at, endDayOffset: v.end_day_offset, sequence: v.sequence })), downtimeReasons: mapMaster(rows(downtimeReasons)), standardTimes: rows(standardTimes).map((v: any) => ({ id: v.id, modelId: v.model_id, processId: v.process_id, lineId: v.line_id, secondsPerUnit: Number(v.seconds_per_unit), effectiveFrom: v.effective_from, effectiveTo: v.effective_to })) };
    },
    async createModel(input) { const result = await client.from("models").insert({ code: input.code.trim(), name: input.name.trim() }).select("id").single(); rows(result); },
    async deactivateDowntimeReason(id) { const result = await client.from("downtime_reasons").update({ is_active: false }).eq("id", id).select("id").single(); rows(result); },
    async saveStandardTime(input) { range(input); const result = await client.from("standard_times").insert({ model_id: input.modelId, process_id: input.processId, line_id: input.lineId, seconds_per_unit: input.secondsPerUnit, effective_from: input.effectiveFrom, effective_to: input.effectiveTo }).select("id,model_id,process_id,line_id,seconds_per_unit,effective_from,effective_to").single(); const value: any = rows(result); return { id: value.id, modelId: value.model_id, processId: value.process_id, lineId: value.line_id, secondsPerUnit: Number(value.seconds_per_unit), effectiveFrom: value.effective_from, effectiveTo: value.effective_to }; },
  };
}

export const listMasterData = () => createMasterDataRepository().listMasterData();
export const saveStandardTime = (input: StandardTimeInput) => createMasterDataRepository().saveStandardTime(input);
