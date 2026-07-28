import type { ProductionEntryDraft } from "../../domain/types";
import { getSupabaseClient } from "../supabase";
import { chunkIds, readAllPages, type PaginatedQuery } from "./dashboard-pagination";

export interface DashboardProductionFilters {
  productionDate: string;
  shiftId: string | null;
  modelId: string | null;
  lineId: string | null;
  processId: string | null;
}
export interface DashboardProductionRecord {
  id: string;
  productionDate: string;
  shiftId: string;
  timeSlotId: string;
  lineId: string;
  modelId: string;
  processId: string;
  inputQty: number;
  actualQty: number;
  downtime: Array<{ reasonId: string; minutes: number }>;
}
export interface ProductionRepository {
  saveProductionRecord(draft: ProductionEntryDraft, expectedVersion: number): Promise<string>;
  listDashboardProduction(filters: DashboardProductionFilters): Promise<DashboardProductionRecord[]>;
}
export interface ProductionClient { rpc(name: "save_production_record", params: { payload: Record<string, unknown>; expected_version: number }): PromiseLike<{ data: string | null; error: { code?: string; message?: string } | null }>; }
type DashboardQuery = PaginatedQuery<Record<string, unknown>> & {
  select(columns: string): DashboardQuery;
  eq(column: string, value: unknown): DashboardQuery;
  is(column: string, value: null): DashboardQuery;
  in(column: string, values: string[]): DashboardQuery;
};
export interface DashboardProductionClient extends ProductionClient { from(table: "production_records" | "downtime_records"): DashboardQuery; }
export class ProductionRepositoryError extends Error { code?: string; constructor(error: { code?: string; message?: string }) { super(error.message ?? "production_save_failed"); this.code = error.code; } }

function mapDowntime(row: ProductionEntryDraft["downtime"][number]) { return { reason_id: row.reasonId, ...(row.minutes !== undefined ? { minutes: row.minutes } : { start_time: row.startTime, end_time: row.endTime }), note: row.note }; }
export function toProductionPayload(draft: ProductionEntryDraft): Record<string, unknown> { return { production_date: draft.productionDate, shift_id: draft.shiftId, time_slot_id: draft.timeSlotId, line_id: draft.lineId, model_id: draft.modelId, process_id: draft.processId, input_qty: draft.inputQty, actual_qty: draft.actualQty, ok_qty: draft.okQty, ng_qty: draft.ngQty, note: draft.note, downtime: draft.downtime.map(mapDowntime) }; }
function applyDashboardFilters(query: DashboardQuery, filters: DashboardProductionFilters): DashboardQuery {
  let filtered = query.eq("production_date", filters.productionDate).is("deleted_at", null);
  if (filters.shiftId) filtered = filtered.eq("shift_id", filters.shiftId);
  if (filters.modelId) filtered = filtered.eq("model_id", filters.modelId);
  if (filters.lineId) filtered = filtered.eq("line_id", filters.lineId);
  if (filters.processId) filtered = filtered.eq("process_id", filters.processId);
  return filtered;
}

export function createProductionRepository(client: ProductionClient = getSupabaseClient() as unknown as DashboardProductionClient): ProductionRepository {
  return {
    async saveProductionRecord(draft, expectedVersion) {
      const result = await client.rpc("save_production_record", { payload: toProductionPayload(draft), expected_version: expectedVersion });
      if (result.error) throw new ProductionRepositoryError(result.error);
      if (!result.data) throw new Error("production_save_failed");
      return result.data;
    },
    async listDashboardProduction(filters) {
      const dashboardClient = client as DashboardProductionClient;
      const rows = await readAllPages(
        () => applyDashboardFilters(
          dashboardClient.from("production_records").select("id,production_date,shift_id,time_slot_id,line_id,model_id,process_id,input_qty,actual_qty"),
          filters,
        ),
        "dashboard_production_lookup_failed",
      );
      const productionIds = rows.map((row) => String(row.id));
      let downtimeRows: Record<string, unknown>[] = [];
      for (const productionIdChunk of chunkIds(productionIds)) {
        downtimeRows.push(...await readAllPages(
          () => dashboardClient.from("downtime_records")
            .select("id,production_record_id,reason_id,minutes")
            .in("production_record_id", productionIdChunk)
            .is("deleted_at", null),
          "dashboard_downtime_lookup_failed",
        ));
      }
      return rows.map((row) => ({
        id: String(row.id),
        productionDate: String(row.production_date),
        shiftId: String(row.shift_id),
        timeSlotId: String(row.time_slot_id),
        lineId: String(row.line_id),
        modelId: String(row.model_id),
        processId: String(row.process_id),
        inputQty: Number(row.input_qty),
        actualQty: Number(row.actual_qty),
        downtime: downtimeRows
          .filter((downtime) => String(downtime.production_record_id) === String(row.id))
          .map((downtime) => ({ reasonId: String(downtime.reason_id), minutes: Number(downtime.minutes) })),
      }));
    },
  };
}
export const saveProductionRecord = (draft: ProductionEntryDraft, expectedVersion: number) => createProductionRepository().saveProductionRecord(draft, expectedVersion);
