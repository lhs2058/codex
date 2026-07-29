import { getSupabaseClient } from "../supabase";
import type { DowntimeDraft, ProductionEntryDraft } from "../../domain/types";
import { chunkIds, readAllPages, type PaginatedQuery } from "./dashboard-pagination";

export interface ExistingProductionRecord extends ProductionEntryDraft {
  id: string;
  version: number;
  downtimeMinutes: number;
}
export interface DashboardQualityFilters {
  productionDate: string;
  shiftId: string | null;
  modelId: string | null;
  lineId: string | null;
  processId: string | null;
  productionRecordIds: string[];
}
export interface DashboardQualityRecord {
  id?: string;
  productionRecordId: string | null;
  lineId: string;
  modelId: string;
  processId: string;
  inputQty: number;
  okQty: number;
}
export interface AnalysisDefectRecord {
  id: string;
  qualityRecordId: string;
  type: string;
  classification: "pseudo" | "real" | "scrap";
  quantity: number;
}
type Query = PaginatedQuery<Record<string, unknown>> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
  in(column: string, values: string[]): Query;
  maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: { message?: string } | null }>;
};
export interface QualityClient { from(table: "production_records" | "quality_records" | "downtime_records"): Query; }
export interface DashboardQualityClient extends QualityClient { from(table: "production_records" | "downtime_records" | "quality_records" | "defect_records"): Query; }
export function createQualityRepository(client: QualityClient = getSupabaseClient() as unknown as DashboardQualityClient) {
  return {
    async findExisting(input: { productionDate: string; shiftId: string; timeSlotId: string; lineId: string; modelId: string; processId: string }): Promise<ExistingProductionRecord | null> {
      const result = await client.from("production_records").select("id,production_date,shift_id,time_slot_id,line_id,model_id,process_id,input_qty,actual_qty,note,version").eq("production_date", input.productionDate).eq("shift_id", input.shiftId).eq("time_slot_id", input.timeSlotId).eq("line_id", input.lineId).eq("model_id", input.modelId).eq("process_id", input.processId).is("deleted_at", null).maybeSingle();
      if (result.error) throw new Error(result.error.message ?? "existing_record_lookup_failed");
      if (!result.data) return null;
      const row = result.data;
      const qualityResult = await client.from("quality_records")
        .select("input_qty,ok_qty,ng_qty")
        .eq("production_record_id", String(row.id))
        .is("deleted_at", null)
        .maybeSingle();
      if (qualityResult.error || !qualityResult.data) {
        throw new Error(qualityResult.error?.message ?? "existing_quality_lookup_failed");
      }
      const quality = qualityResult.data;
      const downtimeRows = await readAllPages(
        () => client.from("downtime_records")
          .select("id,reason_id,minutes,note")
          .eq("production_record_id", String(row.id))
          .is("deleted_at", null),
        "existing_downtime_lookup_failed",
        (downtime) => String(downtime.id),
      );
      const downtime: DowntimeDraft[] = downtimeRows.map((item) => ({
        reasonId: String(item.reason_id),
        minutes: Number(item.minutes),
        note: String(item.note ?? ""),
      }));
      return {
        id: String(row.id),
        productionDate: String(row.production_date),
        shiftId: String(row.shift_id),
        timeSlotId: String(row.time_slot_id),
        lineId: String(row.line_id),
        modelId: String(row.model_id),
        processId: String(row.process_id),
        inputQty: Number(quality.input_qty),
        actualQty: Number(row.actual_qty),
        okQty: Number(quality.ok_qty),
        ngQty: Number(quality.ng_qty),
        note: String(row.note ?? ""),
        downtime,
        version: Number(row.version),
        downtimeMinutes: downtime.reduce((total, item) => total + Number(item.minutes ?? 0), 0),
      };
    },
    async listDashboardQuality(filters: DashboardQualityFilters): Promise<DashboardQualityRecord[]> {
      const rows: Record<string, unknown>[] = [];
      rows.push(...await readAllPages(
        () => {
          let query = (client as DashboardQualityClient).from("quality_records")
            .select("id,production_record_id,line_id,model_id,process_id,input_qty,ok_qty")
            .eq("production_date", filters.productionDate)
            .is("production_record_id", null)
            .is("deleted_at", null);
          if (filters.shiftId) query = query.eq("shift_id", filters.shiftId);
          if (filters.modelId) query = query.eq("model_id", filters.modelId);
          if (filters.lineId) query = query.eq("line_id", filters.lineId);
          if (filters.processId) query = query.eq("process_id", filters.processId);
          return query;
        },
        "dashboard_daily_quality_lookup_failed",
        (row) => String(row.id),
      ));
      for (const productionIdChunk of chunkIds(filters.productionRecordIds)) {
        rows.push(...await readAllPages(
          () => (client as DashboardQualityClient).from("quality_records")
            .select("id,production_record_id,line_id,model_id,process_id,input_qty,ok_qty")
            .eq("production_date", filters.productionDate)
            .in("production_record_id", productionIdChunk)
            .is("deleted_at", null),
          "dashboard_quality_lookup_failed",
          (row) => String(row.id),
        ));
      }
      return [...new Map(rows.map((row) => [String(row.id), row])).values()].map((row) => ({
        id: String(row.id),
        productionRecordId: row.production_record_id === null ? null : String(row.production_record_id),
        lineId: String(row.line_id),
        modelId: String(row.model_id),
        processId: String(row.process_id),
        inputQty: Number(row.input_qty),
        okQty: Number(row.ok_qty),
      }));
    },
    async listAnalysisDefects(qualityRecordIds: string[]): Promise<AnalysisDefectRecord[]> {
      if (qualityRecordIds.length === 0) return [];
      const rows: Record<string, unknown>[] = [];
      for (const qualityIdChunk of chunkIds(qualityRecordIds)) {
        rows.push(...await readAllPages(
          () => (client as DashboardQualityClient).from("defect_records")
            .select("id,quality_record_id,defect_type,classification,quantity")
            .in("quality_record_id", qualityIdChunk)
            .is("deleted_at", null),
          "analysis_defect_lookup_failed",
          (row) => String(row.id),
        ));
      }
      return rows.map((row) => ({
        id: String(row.id),
        qualityRecordId: String(row.quality_record_id),
        type: String(row.defect_type),
        classification: row.classification as AnalysisDefectRecord["classification"],
        quantity: Number(row.quantity),
      }));
    },
  };
}
