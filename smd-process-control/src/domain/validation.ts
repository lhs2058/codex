import { z } from "zod";
import { calculateUtilization, calculateYield } from "./calculations";
import { slotDurationSeconds } from "./time";
import type { DowntimeDraft, MasterDataSnapshot, ProductionEntryDraft, ProductionPreview } from "./types";
import { findEffectiveStandardTime } from "../data/repositories/master-data-repository";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const localTime = /^([01]\d|2[0-3]):[0-5]\d$/;
const id = z.string().trim().min(1);
const quantity = z.number().finite().int().nonnegative();
const downtime = z.object({ reasonId: id, minutes: z.number().finite().int().nonnegative().optional(), startTime: z.string().regex(localTime).optional(), endTime: z.string().regex(localTime).optional(), note: z.string().max(1000) }).superRefine((value, ctx) => {
  const minutesMode = value.minutes !== undefined;
  const rangeMode = value.startTime !== undefined || value.endTime !== undefined;
  if (minutesMode === rangeMode || (rangeMode && (!value.startTime || !value.endTime))) ctx.addIssue({ code: "custom", message: "downtime_requires_exactly_one_mode" });
});

function validDate(value: string) {
  if (!isoDate.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= days;
}

export const productionEntrySchema: z.ZodType<ProductionEntryDraft> = z.object({ productionDate: z.string().refine(validDate, "invalid_date"), shiftId: id, timeSlotId: id, lineId: id, modelId: id, processId: id, inputQty: quantity, actualQty: quantity, okQty: quantity, ngQty: quantity, note: z.string().max(1000), downtime: z.array(downtime) }).superRefine((value, ctx) => {
  if (value.okQty > value.inputQty) ctx.addIssue({ code: "custom", path: ["okQty"], message: "ok_exceeds_input" });
  if (value.okQty + value.ngQty > value.inputQty) ctx.addIssue({ code: "custom", path: ["ngQty"], message: "quality_exceeds_input" });
});

function downtimeSeconds(row: DowntimeDraft): number | null {
  if (row.minutes !== undefined) return Number.isFinite(row.minutes) && row.minutes >= 0 ? row.minutes * 60 : null;
  if (!row.startTime || !row.endTime || !localTime.test(row.startTime) || !localTime.test(row.endTime)) return null;
  const [sh, sm] = row.startTime.split(":").map(Number); const [eh, em] = row.endTime.split(":").map(Number);
  const start = sh * 3600 + sm * 60; const end = eh * 3600 + em * 60;
  return end >= start ? end - start : end + 86400 - start;
}

export function validateDowntime(rows: DowntimeDraft[], plannedSeconds: number): { ok: true } | { ok: false; code: "downtime-exceeds-planned-time" } {
  if (!Number.isFinite(plannedSeconds) || plannedSeconds < 0) return { ok: false, code: "downtime-exceeds-planned-time" };
  let total = 0;
  for (const row of rows) { const parsed = downtime.safeParse(row); const seconds = downtimeSeconds(row); if (!parsed.success || seconds === null) return { ok: false, code: "downtime-exceeds-planned-time" }; total += seconds; }
  return total <= plannedSeconds ? { ok: true } : { ok: false, code: "downtime-exceeds-planned-time" };
}

export function previewProductionMetrics(input: ProductionEntryDraft, masterData: MasterDataSnapshot): ProductionPreview {
  const slot = masterData.timeSlots.find((candidate) => candidate.id === input.timeSlotId && candidate.shiftId === input.shiftId) ?? null;
  const plannedSeconds = slot ? slotDurationSeconds(slot.startsAt, slot.endsAt, slot.endDayOffset) : null;
  const selected = masterData.standardTimes.filter((st) => st.modelId === input.modelId && st.processId === input.processId && st.lineId === input.lineId);
  const standardTime = findEffectiveStandardTime(selected, input.productionDate);
  const downtimeSeconds = input.downtime.reduce((total, row) => total + (downtimeSecondsForPreview(row) ?? 0), 0);
  return { standardTime, plannedSeconds, downtimeSeconds, yieldResult: calculateYield(input.inputQty, input.okQty), utilizationResult: plannedSeconds === null ? { status: "not-calculable", reason: "missing-st" } : calculateUtilization(input.actualQty, standardTime?.secondsPerUnit ?? null, plannedSeconds, downtimeSeconds) };
}
function downtimeSecondsForPreview(row: DowntimeDraft) { return downtimeSeconds(row); }
