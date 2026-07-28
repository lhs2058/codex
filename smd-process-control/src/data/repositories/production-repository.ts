import type { ProductionEntryDraft } from "../../domain/types";
import { getSupabaseClient } from "../supabase";

export interface ProductionRepository { saveProductionRecord(draft: ProductionEntryDraft, expectedVersion: number): Promise<string>; }
export interface ProductionClient { rpc(name: "save_production_record", params: { payload: Record<string, unknown>; expected_version: number }): PromiseLike<{ data: string | null; error: { code?: string; message?: string } | null }>; }
export class ProductionRepositoryError extends Error { code?: string; constructor(error: { code?: string; message?: string }) { super(error.message ?? "production_save_failed"); this.code = error.code; } }

function mapDowntime(row: ProductionEntryDraft["downtime"][number]) { return { reason_id: row.reasonId, ...(row.minutes !== undefined ? { minutes: row.minutes } : { start_time: row.startTime, end_time: row.endTime }), note: row.note }; }
export function toProductionPayload(draft: ProductionEntryDraft): Record<string, unknown> { return { production_date: draft.productionDate, shift_id: draft.shiftId, time_slot_id: draft.timeSlotId, line_id: draft.lineId, model_id: draft.modelId, process_id: draft.processId, input_qty: draft.inputQty, actual_qty: draft.actualQty, ok_qty: draft.okQty, ng_qty: draft.ngQty, note: draft.note, downtime: draft.downtime.map(mapDowntime) }; }
export function createProductionRepository(client: ProductionClient = getSupabaseClient() as unknown as ProductionClient): ProductionRepository { return { async saveProductionRecord(draft, expectedVersion) { const result = await client.rpc("save_production_record", { payload: toProductionPayload(draft), expected_version: expectedVersion }); if (result.error) throw new ProductionRepositoryError(result.error); if (!result.data) throw new Error("production_save_failed"); return result.data; } }; }
export const saveProductionRecord = (draft: ProductionEntryDraft, expectedVersion: number) => createProductionRepository().saveProductionRecord(draft, expectedVersion);
