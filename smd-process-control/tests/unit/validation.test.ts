import { describe, expect, it } from "vitest";
import { downtimeDurationMinutes, previewProductionMetrics, productionEntrySchema, validateDowntime } from "../../src/domain/validation";
import type { MasterDataSnapshot, ProductionEntryDraft } from "../../src/domain/types";

const validDraft: ProductionEntryDraft = { productionDate: "2026-07-28", shiftId: "shift-day", timeSlotId: "slot-a", lineId: "line-1", modelId: "model-a", processId: "process-aoi", inputQty: 10, actualQty: 9, okQty: 9, ngQty: 1, note: "", downtime: [] };
const master: MasterDataSnapshot = { models: [], processes: [], lines: [], shifts: [], downtimeReasons: [], timeSlots: [{ id: "slot-a", shiftId: "shift-day", code: "A", startsAt: "08:00", endsAt: "09:00", endDayOffset: 0, sequence: 1 }], standardTimes: [{ id: "st", modelId: "model-a", processId: "process-aoi", lineId: "line-1", secondsPerUnit: 10, effectiveFrom: "2026-01-01", effectiveTo: null }] };

describe("productionEntrySchema", () => {
  it("rejects impossible quantities, invalid dates, IDs, and non-finite values", () => {
    expect(productionEntrySchema.safeParse({ ...validDraft, okQty: 11 }).success).toBe(false);
    expect(productionEntrySchema.safeParse({ ...validDraft, ngQty: 2 }).success).toBe(false);
    expect(productionEntrySchema.safeParse({ ...validDraft, productionDate: "2026-02-30" }).success).toBe(false);
    expect(productionEntrySchema.safeParse({ ...validDraft, lineId: "" }).success).toBe(false);
    expect(productionEntrySchema.safeParse({ ...validDraft, inputQty: Number.NaN }).success).toBe(false);
  });
  it("rejects an overlong note", () => expect(productionEntrySchema.safeParse({ ...validDraft, note: "x".repeat(1001) }).success).toBe(false));
});

describe("validateDowntime", () => {
  it("rejects downtime beyond planned time", () => expect(validateDowntime([{ reasonId: "breakdown", minutes: 61, note: "" }], 3600)).toEqual({ ok: false, code: "downtime-exceeds-planned-time" }));
  it("accepts valid Bangkok-local overnight start/end times and rejects mixed modes", () => {
    expect(validateDowntime([{ reasonId: "breakdown", startTime: "23:30", endTime: "00:15", note: "" }], 3600)).toEqual({ ok: true });
    expect(validateDowntime([{ reasonId: "breakdown", minutes: 1, startTime: "08:00", endTime: "08:01", note: "" }], 3600).ok).toBe(false);
  });
  it("rejects fractional manual minutes", () => expect(productionEntrySchema.safeParse({ ...validDraft, downtime: [{ reasonId: "breakdown", minutes: 1.5, note: "" }] }).success).toBe(false));
  it("shares overnight minute duration for range and manual rows", () => expect([downtimeDurationMinutes({ reasonId: "a", startTime: "23:30", endTime: "00:15", note: "" }), downtimeDurationMinutes({ reasonId: "b", minutes: 5, note: "" })]).toEqual([45, 5]));
  it("treats mixed, incomplete, fractional, and negative downtime modes as invalid", () => expect([downtimeDurationMinutes({ reasonId: "a", minutes: 1, startTime: "08:00", endTime: "08:01", note: "" }), downtimeDurationMinutes({ reasonId: "a", startTime: "08:00", note: "" }), downtimeDurationMinutes({ reasonId: "a", minutes: 1.5, note: "" }), downtimeDurationMinutes({ reasonId: "a", minutes: -1, note: "" })]).toEqual([null, null, null, null]));
});

describe("previewProductionMetrics", () => {
  it("uses the effective exact-dimension standard time and calculation engine", () => {
    expect(previewProductionMetrics({ ...validDraft, downtime: [{ reasonId: "breakdown", minutes: 10, note: "" }] }, master)).toMatchObject({ plannedSeconds: 3600, downtimeSeconds: 600, yieldResult: { status: "ok", value: 90 }, utilizationResult: { status: "ok", value: 3 } });
  });
  it("does not fabricate a zero result when ST or time slot is missing", () => {
    expect(previewProductionMetrics(validDraft, { ...master, standardTimes: [] }).utilizationResult).toEqual({ status: "not-calculable", reason: "missing-st" });
    expect(previewProductionMetrics(validDraft, { ...master, timeSlots: [] }).plannedSeconds).toBeNull();
  });
});
