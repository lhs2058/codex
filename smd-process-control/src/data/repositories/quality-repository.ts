import { getSupabaseClient } from "../supabase";
import { chunkIds, readAllPages, type PaginatedQuery } from "./dashboard-pagination";

export interface ExistingProductionRecord { id: string; productionDate: string; shiftId: string; timeSlotId: string; lineId: string; modelId: string; processId: string; inputQty: number; actualQty: number; okQty: number; ngQty: number; version: number; downtimeMinutes: number; }
export interface DashboardQualityFilters {
  productionDate: string;
  shiftId: string | null;
  modelId: string | null;
  lineId: string | null;
  processId: string | null;
  productionRecordIds: string[];
}
export interface DashboardQualityRecord {
  productionRecordId: string;
  lineId: string;
  modelId: string;
  processId: string;
  inputQty: number;
  okQty: number;
}
type Query = PaginatedQuery<Record<string, unknown>> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
  in(column: string, values: string[]): Query;
  maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: { message?: string } | null }>;
};
export interface QualityClient { from(table: "production_records"): Query; }
export interface DashboardQualityClient extends QualityClient { from(table: "production_records" | "quality_records"): Query; }
export function createQualityRepository(client: QualityClient = getSupabaseClient() as unknown as DashboardQualityClient) {
  return {
    async findExisting(input: { productionDate: string; shiftId: string; timeSlotId: string; lineId: string; modelId: string; processId: string }): Promise<ExistingProductionRecord | null> {
      const result = await client.from("production_records").select("id,production_date,shift_id,time_slot_id,line_id,model_id,process_id,input_qty,actual_qty,ok_qty,ng_qty,version,downtime_minutes").eq("production_date", input.productionDate).eq("shift_id", input.shiftId).eq("time_slot_id", input.timeSlotId).eq("line_id", input.lineId).eq("model_id", input.modelId).eq("process_id", input.processId).is("deleted_at", null).maybeSingle();
      if (result.error) throw new Error(result.error.message ?? "existing_record_lookup_failed");
      if (!result.data) return null;
      const row = result.data;
      return { id: String(row.id), productionDate: String(row.production_date), shiftId: String(row.shift_id), timeSlotId: String(row.time_slot_id), lineId: String(row.line_id), modelId: String(row.model_id), processId: String(row.process_id), inputQty: Number(row.input_qty), actualQty: Number(row.actual_qty), okQty: Number(row.ok_qty), ngQty: Number(row.ng_qty), version: Number(row.version), downtimeMinutes: Number(row.downtime_minutes ?? 0) };
    },
    async listDashboardQuality(filters: DashboardQualityFilters): Promise<DashboardQualityRecord[]> {
      if (filters.productionRecordIds.length === 0) return [];
      const rows: Record<string, unknown>[] = [];
      for (const productionIdChunk of chunkIds(filters.productionRecordIds)) {
        rows.push(...await readAllPages(
          () => (client as DashboardQualityClient).from("quality_records")
            .select("id,production_record_id,line_id,model_id,process_id,input_qty,ok_qty")
            .eq("production_date", filters.productionDate)
            .in("production_record_id", productionIdChunk)
            .is("deleted_at", null),
          "dashboard_quality_lookup_failed",
        ));
      }
      return rows.map((row) => ({
        productionRecordId: String(row.production_record_id),
        lineId: String(row.line_id),
        modelId: String(row.model_id),
        processId: String(row.process_id),
        inputQty: Number(row.input_qty),
        okQty: Number(row.ok_qty),
      }));
    },
  };
}
