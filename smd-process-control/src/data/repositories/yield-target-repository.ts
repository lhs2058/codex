import { getSupabaseClient } from "../supabase";
import type { AnalysisFilters } from "../../domain/types";
import { readAllPages, type PaginatedQuery } from "./dashboard-pagination";

export interface YieldTarget {
  id: string;
  modelId: string | null;
  processId: string;
  lineId: string | null;
  targetPercent: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

type Query = PaginatedQuery<Record<string, unknown>> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
  lte(column: string, value: string): Query;
};

export interface YieldTargetClient {
  from(table: "yield_targets"): Query;
}

export interface YieldTargetRepository {
  listYieldTargets(filters: AnalysisFilters, processId: string | null): Promise<YieldTarget[]>;
}

export interface YieldTargetSubject {
  productionDate: string;
  modelId: string;
  processId: string;
  lineId: string;
  inputQty: number;
}

export function resolveYieldTarget(
  row: Omit<YieldTargetSubject, "inputQty">,
  targets: YieldTarget[],
): number | null {
  const precedence = (target: YieldTarget) =>
    target.modelId !== null
      ? target.lineId !== null ? 3 : 2
      : target.lineId !== null ? 1 : 0;
  const matches = targets
    .filter((target) =>
      target.processId === row.processId
      && (target.modelId === null || target.modelId === row.modelId)
      && (target.lineId === null || target.lineId === row.lineId)
      && target.effectiveFrom <= row.productionDate
      && (target.effectiveTo === null || target.effectiveTo >= row.productionDate))
    .sort((left, right) =>
      precedence(right) - precedence(left)
      || right.effectiveFrom.localeCompare(left.effectiveFrom));
  return matches[0]?.targetPercent ?? null;
}

export function weightedYieldTarget(rows: YieldTargetSubject[], targets: YieldTarget[]): number | null {
  let quantity = 0;
  let weighted = 0;
  for (const row of rows) {
    if (row.inputQty <= 0) continue;
    const target = resolveYieldTarget(row, targets);
    if (target === null) return null;
    quantity += row.inputQty;
    weighted += row.inputQty * target;
  }
  return quantity === 0 ? null : weighted / quantity;
}

export function createYieldTargetRepository(
  client: YieldTargetClient = getSupabaseClient() as unknown as YieldTargetClient,
): YieldTargetRepository {
  return {
    async listYieldTargets(filters, processId) {
      const rows = await readAllPages(
        () => {
          let query = client.from("yield_targets")
            .select("id,model_id,process_id,line_id,target_percent,effective_from,effective_to")
            .is("deleted_at", null)
            .lte("effective_from", filters.to);
          if (processId) query = query.eq("process_id", processId);
          return query;
        },
        "analysis_yield_target_lookup_failed",
        (row) => String(row.id),
      );
      return rows
        .map((row) => ({
          id: String(row.id),
          modelId: row.model_id === null ? null : String(row.model_id),
          processId: String(row.process_id),
          lineId: row.line_id === null ? null : String(row.line_id),
          targetPercent: Number(row.target_percent),
          effectiveFrom: String(row.effective_from),
          effectiveTo: row.effective_to === null ? null : String(row.effective_to),
        }))
        .filter((row) => row.effectiveTo === null || row.effectiveTo >= filters.from)
        .filter((row) => filters.modelId === null || row.modelId === null || row.modelId === filters.modelId)
        .filter((row) => filters.lineId === null || row.lineId === null || row.lineId === filters.lineId);
    },
  };
}
