import { describe, expect, it, vi } from "vitest";
import { createProductionRepository } from "../../src/data/repositories/production-repository";
import type { ProductionEntryDraft } from "../../src/domain/types";

const draft: ProductionEntryDraft = { productionDate: "2026-07-28", shiftId: "s", timeSlotId: "t", lineId: "l", modelId: "m", processId: "p", inputQty: 10, actualQty: 9, okQty: 8, ngQty: 1, note: "note", downtime: [{ reasonId: "d", minutes: 3, note: "pause" }] };
describe("production repository", () => {
  it("maps the complete draft to the atomic snake_case RPC payload", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "record-id", error: null });
    await expect(createProductionRepository({ rpc }).saveProductionRecord(draft, 0)).resolves.toBe("record-id");
    expect(rpc).toHaveBeenCalledWith("save_production_record", { payload: { production_date: "2026-07-28", shift_id: "s", time_slot_id: "t", line_id: "l", model_id: "m", process_id: "p", input_qty: 10, actual_qty: 9, ok_qty: 8, ng_qty: 1, note: "note", downtime: [{ reason_id: "d", minutes: 3, note: "pause" }] }, expected_version: 0 });
  });
  it("normalizes RPC error codes for form conflict handling", async () => {
    await expect(createProductionRepository({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "40001", message: "conflict" } }) }).saveProductionRecord(draft, 0)).rejects.toMatchObject({ code: "40001" });
  });
});
