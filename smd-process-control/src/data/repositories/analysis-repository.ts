import { calculateUtilization, calculateYield } from "../../domain/calculations";
import { slotDurationSeconds } from "../../domain/time";
import type {
  AnalysisDataset,
  AnalysisFilters,
  MasterDataSnapshot,
  MetricResult,
  ProcessCode,
} from "../../domain/types";
import { createMasterDataRepository, findEffectiveStandardTime, type HistoricalMasterDataRepository } from "./master-data-repository";
import {
  createProductionRepository,
  type DashboardProductionRecord,
  type ProductionRepository,
} from "./production-repository";
import {
  createQualityRepository,
  type AnalysisDefectRecord,
  type DashboardQualityFilters,
  type DashboardQualityRecord,
} from "./quality-repository";
import {
  createYieldTargetRepository,
  weightedYieldTarget,
  type YieldTarget,
  type YieldTargetRepository,
} from "./yield-target-repository";
import { getSupabaseClient } from "../supabase";

export interface AnalysisRepository {
  loadAnalysis(filters: AnalysisFilters, options?: AnalysisLoadOptions): Promise<AnalysisDataset>;
}

export interface AnalysisLoadOptions {
  signal?: AbortSignal;
}

interface AnalysisDependencies {
  master: HistoricalMasterDataRepository;
  production: Pick<ProductionRepository, "listDashboardProduction">;
  quality: {
    listDashboardQuality(filters: DashboardQualityFilters): Promise<DashboardQualityRecord[]>;
    listAnalysisDefects(qualityRecordIds: string[]): Promise<AnalysisDefectRecord[]>;
  };
  targets: Pick<YieldTargetRepository, "listYieldTargets">;
  generatedBy: () => Promise<string>;
}

interface DatedProduction {
  date: string;
  row: DashboardProductionRecord;
}

interface DatedQuality {
  date: string;
  row: DashboardQualityRecord;
}

export const ANALYSIS_DATE_CONCURRENCY = 4;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Analysis load aborted", "AbortError");
}

async function mapWithConcurrency<T, R>(
  values: T[],
  worker: (value: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < values.length) {
      throwIfAborted(signal);
      const index = nextIndex++;
      results[index] = await worker(values[index], index);
      throwIfAborted(signal);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(ANALYSIS_DATE_CONCURRENCY, values.length) },
    () => run(),
  ));
  return results;
}

function dates(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error("invalid_analysis_range");
  const values: string[] = [];
  for (let value = start; value <= end; value += 86_400_000) {
    values.push(new Date(value).toISOString().slice(0, 10));
  }
  return values;
}

function isoWeek(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const year = value.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((value.getTime() - first.getTime()) / 86_400_000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function periodFor(date: string, groupBy: AnalysisFilters["groupBy"]): string {
  if (groupBy === "month") return date.slice(0, 7);
  if (groupBy === "week") return isoWeek(date);
  return date;
}

function processId(filters: AnalysisFilters, master: MasterDataSnapshot): string | null {
  if (!filters.processCode) return null;
  return master.processes.find((row) => row.code === filters.processCode)?.id ?? null;
}

function metricValue(result: MetricResult): number | null {
  return result.status === "ok" ? result.value : null;
}

function yieldValue(inputQty: number, okQty: number): number | null {
  return metricValue(calculateYield(inputQty, okQty));
}

function weightedTarget(rows: DatedQuality[], targets: YieldTarget[]): number | null {
  return weightedYieldTarget(rows.map(({ date, row }) => ({
    productionDate: date,
    modelId: row.modelId,
    processId: row.processId,
    lineId: row.lineId,
    inputQty: row.inputQty,
  })), targets);
}

function utilizationParts(
  rows: DatedProduction[],
  master: MasterDataSnapshot,
): { actualQty: number; productiveSeconds: number; netSeconds: number; utilizationPercent: number | null } {
  let actualQty = 0;
  let productiveSeconds = 0;
  let netSeconds = 0;
  let calculable = true;
  for (const { date, row } of rows) {
    actualQty += row.actualQty;
    const slot = master.timeSlots.find((candidate) => candidate.id === row.timeSlotId);
    const standardTime = findEffectiveStandardTime(
      master.standardTimes.filter((candidate) =>
        candidate.modelId === row.modelId
        && candidate.processId === row.processId
        && candidate.lineId === row.lineId),
      date,
    );
    if (!slot || !standardTime) {
      calculable = false;
      continue;
    }
    const planned = slotDurationSeconds(slot.startsAt, slot.endsAt, slot.endDayOffset);
    const downtime = row.downtime.reduce((total, item) => total + item.minutes * 60, 0);
    if (planned <= downtime) {
      calculable = false;
      continue;
    }
    productiveSeconds += row.actualQty * standardTime.secondsPerUnit;
    netSeconds += planned - downtime;
  }
  return {
    actualQty,
    productiveSeconds,
    netSeconds,
    utilizationPercent: calculable && netSeconds > 0
      ? metricValue(calculateUtilization(productiveSeconds, 1, netSeconds, 0))
      : null,
  };
}

function aggregateDefects(rows: AnalysisDefectRecord[]): AnalysisDataset["defects"] {
  const totals = new Map<string, AnalysisDataset["defects"][number]>();
  for (const row of rows) {
    const key = `${row.type}\u0000${row.classification}`;
    const current = totals.get(key);
    totals.set(key, {
      type: row.type,
      classification: row.classification,
      quantity: (current?.quantity ?? 0) + row.quantity,
    });
  }
  return [...totals.values()].sort((left, right) =>
    right.quantity - left.quantity || left.type.localeCompare(right.type));
}

async function defaultGeneratedBy(): Promise<string> {
  try {
    const { data, error } = await getSupabaseClient().auth.getUser();
    if (error || !data.user) return "Unknown user";
    const displayName = data.user.user_metadata?.display_name;
    return typeof displayName === "string" && displayName.trim()
      ? displayName.trim()
      : data.user.email ?? data.user.id;
  } catch {
    return "Unknown user";
  }
}

export function createAnalysisRepository(dependencies?: Partial<AnalysisDependencies>): AnalysisRepository {
  const masterRepository = dependencies?.master ?? createMasterDataRepository();
  const productionRepository = dependencies?.production ?? createProductionRepository();
  const qualityRepository = dependencies?.quality ?? createQualityRepository();
  const targetRepository = dependencies?.targets ?? createYieldTargetRepository();
  const generatedBy = dependencies?.generatedBy ?? defaultGeneratedBy;
  return {
    async loadAnalysis(filters, options = {}) {
      throwIfAborted(options.signal);
      const master = await masterRepository.listHistoricalMasterData();
      throwIfAborted(options.signal);
      const selectedProcessId = processId(filters, master);
      const byDate = await mapWithConcurrency(dates(filters.from, filters.to), async (date) => {
        const production = await productionRepository.listDashboardProduction({
          productionDate: date,
          shiftId: filters.shiftId,
          modelId: filters.modelId,
          lineId: filters.lineId,
          processId: selectedProcessId,
        });
        const quality = await qualityRepository.listDashboardQuality({
          productionDate: date,
          shiftId: filters.shiftId,
          modelId: filters.modelId,
          lineId: filters.lineId,
          processId: selectedProcessId,
          productionRecordIds: production.map((row) => row.id),
        });
        return { date, production, quality };
      }, options.signal);
      throwIfAborted(options.signal);
      const productionRows = byDate.flatMap(({ date, production }) =>
        production.map((row) => ({ date, row })));
      const qualityRows = byDate.flatMap(({ date, quality }) =>
        quality.map((row) => ({ date, row })));
      const [targets, defectRows, reportUser] = await Promise.all([
        targetRepository.listYieldTargets(filters, selectedProcessId),
        qualityRepository.listAnalysisDefects(
          qualityRows.flatMap(({ row }) => row.id ? [row.id] : []),
        ),
        generatedBy(),
      ]);
      throwIfAborted(options.signal);

      const yieldGroups = new Map<string, DatedQuality[]>();
      const utilizationGroups = new Map<string, DatedProduction[]>();
      for (const row of qualityRows) {
        const period = periodFor(row.date, filters.groupBy);
        yieldGroups.set(period, [...(yieldGroups.get(period) ?? []), row]);
      }
      for (const row of productionRows) {
        const period = periodFor(row.date, filters.groupBy);
        utilizationGroups.set(period, [...(utilizationGroups.get(period) ?? []), row]);
      }
      const periods = [...new Set([...yieldGroups.keys(), ...utilizationGroups.keys()])].sort();
      const yieldSeries = periods.map((period) => {
        const rows = yieldGroups.get(period) ?? [];
        const inputQty = rows.reduce((total, { row }) => total + row.inputQty, 0);
        const okQty = rows.reduce((total, { row }) => total + row.okQty, 0);
        const target = weightedTarget(rows, targets);
        const value = yieldValue(inputQty, okQty);
        return { period, inputQty, okQty, target, belowTarget: value !== null && target !== null && value < target };
      });
      const utilizationSeries = periods.map((period) => ({
        period,
        ...utilizationParts(utilizationGroups.get(period) ?? [], master),
      }));

      const processLineGroups = new Map<string, DatedQuality[]>();
      for (const row of qualityRows) {
        const key = `${row.row.processId}\u0000${row.row.lineId}`;
        processLineGroups.set(key, [...(processLineGroups.get(key) ?? []), row]);
      }
      const processLines = [...processLineGroups.entries()].map(([key, rows]) => {
        const [rowProcessId, lineId] = key.split("\u0000");
        const inputQty = rows.reduce((total, item) => total + item.row.inputQty, 0);
        const okQty = rows.reduce((total, item) => total + item.row.okQty, 0);
        const value = yieldValue(inputQty, okQty);
        const target = weightedTarget(rows, targets);
        return {
          processCode: master.processes.find((item) => item.id === rowProcessId)?.code ?? "AOI" as ProcessCode,
          lineId,
          lineCode: master.lines.find((item) => item.id === lineId)?.code ?? lineId,
          inputQty,
          okQty,
          yieldPercent: value,
          target,
          belowTarget: value !== null && target !== null && value < target,
        };
      }).sort((left, right) =>
        left.processCode.localeCompare(right.processCode) || left.lineCode.localeCompare(right.lineCode));

      const timeSlotGroups = new Map<string, DatedProduction[]>();
      for (const row of productionRows) {
        timeSlotGroups.set(row.row.timeSlotId, [...(timeSlotGroups.get(row.row.timeSlotId) ?? []), row]);
      }
      const timeSlots = [...timeSlotGroups.entries()].map(([timeSlotId, rows]) => ({
        timeSlotId,
        timeSlotCode: master.timeSlots.find((item) => item.id === timeSlotId)?.code ?? timeSlotId,
        ...utilizationParts(rows, master),
      })).sort((left, right) => {
        const leftSequence = master.timeSlots.find((item) => item.id === left.timeSlotId)?.sequence ?? 0;
        const rightSequence = master.timeSlots.find((item) => item.id === right.timeSlotId)?.sequence ?? 0;
        return leftSequence - rightSequence;
      });

      const downtime = new Map<string, { reason: string; minutes: number; lostUnits: number }>();
      for (const { date, row } of productionRows) {
        const standardTime = findEffectiveStandardTime(
          master.standardTimes.filter((candidate) =>
            candidate.modelId === row.modelId
            && candidate.processId === row.processId
            && candidate.lineId === row.lineId),
          date,
        );
        for (const entry of row.downtime) {
          const reason = master.downtimeReasons.find((item) => item.id === entry.reasonId)?.name ?? "Unclassified";
          const current = downtime.get(reason) ?? { reason, minutes: 0, lostUnits: 0 };
          current.minutes += entry.minutes;
          current.lostUnits += standardTime ? (entry.minutes * 60) / standardTime.secondsPerUnit : 0;
          downtime.set(reason, current);
        }
      }

      return {
        filters,
        yieldSeries,
        utilizationSeries,
        processLines,
        timeSlots,
        downtime: [...downtime.values()].sort((left, right) => right.minutes - left.minutes),
        defects: aggregateDefects(defectRows),
        generatedBy: reportUser,
      };
    },
  };
}

export function loadAnalysis(filters: AnalysisFilters, options?: AnalysisLoadOptions): Promise<AnalysisDataset> {
  return createAnalysisRepository().loadAnalysis(filters, options);
}
