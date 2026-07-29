import { calculateUtilization, calculateYield } from "../../domain/calculations";
import { slotDurationSeconds } from "../../domain/time";
import type { DashboardFilters, DashboardSnapshot, MasterDataSnapshot, MetricResult } from "../../domain/types";
import { createMasterDataRepository, findEffectiveStandardTime, type MasterDataRepository } from "./master-data-repository";
import {
  createProductionRepository,
  type DashboardProductionFilters,
  type DashboardProductionRecord,
  type ProductionRepository,
} from "./production-repository";
import {
  createQualityRepository,
  type DashboardQualityFilters,
  type DashboardQualityRecord,
} from "./quality-repository";
import {
  createYieldTargetRepository,
  weightedYieldTarget,
  type YieldTargetRepository,
} from "./yield-target-repository";
import { getSupabaseClient } from "../supabase";

export interface DashboardRepository {
  loadDashboard(filters: DashboardFilters): Promise<DashboardSnapshot>;
  subscribeDashboard(filters: DashboardFilters, onChange: () => void): () => void;
}

export interface DashboardDependencies {
  master: Pick<MasterDataRepository, "listMasterData">;
  production: Pick<ProductionRepository, "listDashboardProduction">;
  quality: { listDashboardQuality(filters: DashboardQualityFilters): Promise<DashboardQualityRecord[]> };
  targets: Pick<YieldTargetRepository, "listYieldTargets">;
  subscribe?: DashboardRepository["subscribeDashboard"];
  now?: () => Date;
}

interface RealtimeChannel {
  on(
    type: "postgres_changes",
    config: { event: "*"; schema: "public"; table: "production_records" | "quality_records"; filter: string },
    callback: () => void,
  ): RealtimeChannel;
  subscribe(): RealtimeChannel;
}

export interface DashboardRealtimeClient {
  channel(name: string): RealtimeChannel;
  removeChannel(channel: RealtimeChannel): unknown;
}

function notCalculable(reason: "zero-input" | "missing-st" | "zero-net-time"): MetricResult {
  return { status: "not-calculable", reason };
}

function processIdFor(filters: DashboardFilters, master: MasterDataSnapshot): string | null {
  if (!filters.processCode) return null;
  return master.processes.find((process) => process.code === filters.processCode)?.id ?? null;
}

function utilizationFor(
  records: DashboardProductionRecord[],
  master: MasterDataSnapshot,
  productionDate: string,
): MetricResult {
  let productiveSeconds = 0;
  let netSeconds = 0;
  let missingStandardTime = false;
  let invalidNetTime = false;
  for (const record of records) {
    const slot = master.timeSlots.find((candidate) => candidate.id === record.timeSlotId);
    const standardTime = findEffectiveStandardTime(
      master.standardTimes.filter((candidate) =>
        candidate.modelId === record.modelId
        && candidate.processId === record.processId
        && candidate.lineId === record.lineId),
      productionDate,
    );
    if (!standardTime) {
      missingStandardTime = true;
      continue;
    }
    if (!slot) {
      invalidNetTime = true;
      continue;
    }
    const plannedSeconds = slotDurationSeconds(slot.startsAt, slot.endsAt, slot.endDayOffset);
    const downtimeSeconds = record.downtime.reduce((total, row) => total + row.minutes * 60, 0);
    if (plannedSeconds - downtimeSeconds <= 0) {
      invalidNetTime = true;
      continue;
    }
    productiveSeconds += record.actualQty * standardTime.secondsPerUnit;
    netSeconds += plannedSeconds - downtimeSeconds;
  }
  if (missingStandardTime) return notCalculable("missing-st");
  if (invalidNetTime || netSeconds === 0) return notCalculable("zero-net-time");
  return calculateUtilization(productiveSeconds, 1, netSeconds, 0);
}

function attentionCount(records: DashboardProductionRecord[], master: MasterDataSnapshot, productionDate: string): number {
  return records.filter((record) => {
    const slot = master.timeSlots.find((candidate) => candidate.id === record.timeSlotId);
    const standardTime = findEffectiveStandardTime(
      master.standardTimes.filter((candidate) =>
        candidate.modelId === record.modelId
        && candidate.processId === record.processId
        && candidate.lineId === record.lineId),
      productionDate,
    );
    if (!slot || !standardTime || record.inputQty === 0) return true;
    const planned = slotDurationSeconds(slot.startsAt, slot.endsAt, slot.endDayOffset);
    return planned <= record.downtime.reduce((total, row) => total + row.minutes * 60, 0);
  }).length;
}

function aggregateYield(records: DashboardQualityRecord[]): MetricResult {
  return calculateYield(
    records.reduce((total, row) => total + row.inputQty, 0),
    records.reduce((total, row) => total + row.okQty, 0),
  );
}

function entryProgress(
  filters: DashboardFilters,
  records: DashboardProductionRecord[],
  master: MasterDataSnapshot,
  now: Date,
): DashboardSnapshot["entryProgress"] {
  const shiftId = filters.shiftId ?? master.shifts.find((shift) => shift.active)?.id;
  const slots = master.timeSlots
    .filter((slot) => !shiftId || slot.shiftId === shiftId)
    .sort((left, right) => left.sequence - right.sequence)
    .slice(0, 5);
  const instant = (time: string, dayOffset: 0 | 1) => {
    const normalized = time.length === 5 ? `${time}:00` : time;
    return Date.parse(`${filters.productionDate}T${normalized}+07:00`) + dayOffset * 24 * 60 * 60 * 1000;
  };
  return slots.map((slot) => ({
    timeSlotId: slot.id,
    status: records.some((record) => record.timeSlotId === slot.id)
      ? "complete"
      : now.getTime() >= instant(slot.startsAt, 0) && now.getTime() < instant(slot.endsAt, slot.endDayOffset)
        ? "in-progress"
        : "waiting",
  }));
}

export function createDashboardRealtimeSubscription(
  client: DashboardRealtimeClient,
  filters: DashboardFilters,
  onChange: () => void,
): () => void {
  const dateFilter = `production_date=eq.${filters.productionDate}`;
  const production = client.channel(`dashboard-production-${filters.productionDate}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "production_records", filter: dateFilter }, onChange)
    .subscribe();
  const quality = client.channel(`dashboard-quality-${filters.productionDate}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "quality_records", filter: dateFilter }, onChange)
    .subscribe();
  return () => {
    void client.removeChannel(production);
    void client.removeChannel(quality);
  };
}

export function createDashboardRepository(dependencies?: Partial<DashboardDependencies>): DashboardRepository {
  const master = dependencies?.master ?? createMasterDataRepository();
  const production = dependencies?.production ?? createProductionRepository();
  const quality = dependencies?.quality ?? createQualityRepository();
  const targets = dependencies?.targets ?? createYieldTargetRepository();
  const now = dependencies?.now ?? (() => new Date());
  const subscribe = dependencies?.subscribe
    ?? ((filters: DashboardFilters, onChange: () => void) =>
      createDashboardRealtimeSubscription(getSupabaseClient() as unknown as DashboardRealtimeClient, filters, onChange));
  return {
    async loadDashboard(filters) {
      const masterData = await master.listMasterData();
      const processId = processIdFor(filters, masterData);
      const repositoryFilters: DashboardProductionFilters = {
        productionDate: filters.productionDate,
        shiftId: filters.shiftId,
        modelId: filters.modelId,
        lineId: filters.lineId,
        processId,
      };
      const productionRecords = await production.listDashboardProduction(repositoryFilters);
      const qualityRecords = await quality.listDashboardQuality({
        ...repositoryFilters,
        productionRecordIds: productionRecords.map((record) => record.id),
      });
      const yieldTargets = await targets.listYieldTargets({
        from: filters.productionDate,
        to: filters.productionDate,
        groupBy: "day",
        shiftId: filters.shiftId,
        modelId: filters.modelId,
        lineId: filters.lineId,
        processCode: filters.processCode,
      }, processId);
      const lines = masterData.lines.filter((line) => line.active && (!filters.lineId || line.id === filters.lineId));
      const processes = masterData.processes.filter((process) =>
        process.active && (!filters.processCode || process.code === filters.processCode));
      const targetRows = (rows: DashboardQualityRecord[]) => rows.map((row) => ({
        productionDate: filters.productionDate,
        modelId: row.modelId,
        processId: row.processId,
        lineId: row.lineId,
        inputQty: row.inputQty,
      }));
      const yields = processes.flatMap((process) => lines.map((line) => {
        const rows = qualityRecords.filter((row) => row.processId === process.id && row.lineId === line.id);
        return {
          processCode: process.code,
          lineId: line.id,
          result: aggregateYield(rows),
          targetPercent: weightedYieldTarget(targetRows(rows), yieldTargets),
        };
      }));
      const utilization = lines.map((line) => ({
        lineId: line.id,
        result: utilizationFor(productionRecords.filter((record) => record.lineId === line.id), masterData, filters.productionDate),
      }));
      const downtimeByReason = new Map<string, number>();
      for (const record of productionRecords) {
        for (const row of record.downtime) {
          downtimeByReason.set(row.reasonId, (downtimeByReason.get(row.reasonId) ?? 0) + row.minutes);
        }
      }
      const downtime = [...downtimeByReason.entries()]
        .map(([reasonId, minutes]) => ({
          reasonId,
          reasonName: masterData.downtimeReasons.find((reason) => reason.id === reasonId)?.name ?? "미분류",
          minutes,
        }))
        .sort((left, right) => right.minutes - left.minutes);
      return {
        totalActual: productionRecords.reduce((total, record) => total + record.actualQty, 0),
        weightedYield: aggregateYield(qualityRecords),
        weightedYieldTarget: weightedYieldTarget(targetRows(qualityRecords), yieldTargets),
        weightedUtilization: utilizationFor(productionRecords, masterData, filters.productionDate),
        attentionCount: attentionCount(productionRecords, masterData, filters.productionDate),
        yields,
        utilization,
        downtime,
        entryProgress: entryProgress(filters, productionRecords, masterData, now()),
      };
    },
    subscribeDashboard: subscribe,
  };
}

let defaultRepository: DashboardRepository | null = null;
function dashboardRepository(): DashboardRepository {
  defaultRepository ??= createDashboardRepository();
  return defaultRepository;
}

export function loadDashboard(filters: DashboardFilters): Promise<DashboardSnapshot> {
  return dashboardRepository().loadDashboard(filters);
}

export function subscribeDashboard(filters: DashboardFilters, onChange: () => void): () => void {
  return dashboardRepository().subscribeDashboard(filters, onChange);
}
