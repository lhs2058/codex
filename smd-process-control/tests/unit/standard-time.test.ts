import { describe, expect, it, vi } from "vitest";
import { createMasterDataRepository, findEffectiveStandardTime, validateStandardTimeOverlap } from "../../src/data/repositories/master-data-repository";
import type { StandardTime, StandardTimeInput } from "../../src/domain/types";

const record = (overrides: Partial<StandardTime> = {}): StandardTime => ({
  id: "st-1", modelId: "model-1", processId: "process-1", lineId: "line-1",
  secondsPerUnit: 0.82, effectiveFrom: "2026-07-01", effectiveTo: "2026-07-31", ...overrides,
});

it("adds trusted actor metadata and uses an optimistic version predicate when deactivating", async () => {
  const calls: unknown[] = [];
  const chain: any = { select: () => chain, is: () => chain, eq: (...args: unknown[]) => { calls.push(args); return chain; }, order: () => Promise.resolve({ data: [], error: null }), single: () => Promise.resolve({ data: { id: "d1" }, error: null }) };
  const client: any = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "actor-1" } }, error: null }) }, from: vi.fn(() => ({ ...chain, update: (value: unknown) => { calls.push(value); return chain; } })) };
  const repository = createMasterDataRepository(client);
  await repository.deactivateDowntimeReason("d1", 4);
  expect(calls).toContainEqual(["version", 4]);
  expect(calls).toContainEqual({ is_active: false, version: 5, updated_by: "actor-1", updated_at: expect.any(String) });
});

describe("standard-time effective periods", () => {
  it("uses inclusive ISO date boundaries and deterministically selects the effective record", () => {
    const records = [record({ id: "later", effectiveFrom: "2026-08-01", effectiveTo: null, secondsPerUnit: 0.9 }), record()];
    expect(findEffectiveStandardTime(records, "2026-07-01")?.secondsPerUnit).toBe(0.82);
    expect(findEffectiveStandardTime(records, "2026-07-31")?.secondsPerUnit).toBe(0.82);
    expect(findEffectiveStandardTime(records, "2026-08-01")?.secondsPerUnit).toBe(0.9);
  });

  it("rejects invalid production dates and invariant-violating effective records", () => {
    expect(() => findEffectiveStandardTime([record()], "2026-02-30")).toThrow("invalid_effective_date");
    expect(() => findEffectiveStandardTime([record(), record({ id: "duplicate" })], "2026-07-10")).toThrow("standard_time_invariant_violation");
  });

  it("only flags overlapping inclusive periods for the same model, process, and line", () => {
    const candidate: StandardTimeInput = { ...record(), effectiveFrom: "2026-07-31", effectiveTo: "2026-08-15" };
    expect(validateStandardTimeOverlap([record()], candidate)).toEqual({ ok: false, code: "overlapping-effective-period" });
    expect(validateStandardTimeOverlap([record({ lineId: "line-2" })], candidate)).toEqual({ ok: true });
  });

  it("rejects invalid or reversed candidate ranges", () => {
    expect(() => validateStandardTimeOverlap([], { ...record(), effectiveFrom: "2026-02-30" })).toThrow("invalid_effective_date");
    expect(() => validateStandardTimeOverlap([], { ...record(), effectiveFrom: "2026-08-02", effectiveTo: "2026-08-01" })).toThrow("invalid_effective_range");
  });
});
