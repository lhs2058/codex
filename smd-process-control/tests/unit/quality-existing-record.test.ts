import { describe, expect, it, vi } from "vitest";
import { createQualityRepository } from "../../src/data/repositories/quality-repository";

function clientFor(tables: Record<string, Array<Record<string, unknown>>>) {
  const selected = new Map<string, string[]>();
  return {
    selected,
    client: {
      from: vi.fn((table: string) => {
        const equals = new Map<string, unknown>();
        let columns = "";
        const query: any = {
          select: (value: string) => { columns = value; selected.set(table, [...(selected.get(table) ?? []), value]); return query; },
          eq: (column: string, value: unknown) => { equals.set(column, value); return query; },
          is: (column: string, value: unknown) => { equals.set(column, value); return query; },
          in: () => query,
          order: () => query,
          range: () => query,
          maybeSingle: () => {
            const rows = (tables[table] ?? []).filter((row) => [...equals].every(([column, value]) => (row[column] ?? null) === value));
            return Promise.resolve({ data: rows.length === 1 ? rows[0] : null, error: rows.length > 1 ? { message: "multiple" } : null });
          },
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
            const rows = (tables[table] ?? []).filter((row) => [...equals].every(([column, value]) => (row[column] ?? null) === value));
            return Promise.resolve({ data: rows, error: null, columns }).then(resolve, reject);
          },
        };
        return query;
      }),
    },
  };
}

describe("quality repository existing-record lookup", () => {
  it("loads edit state from production, active quality, and downtime tables", async () => {
    const fixture = clientFor({
      production_records: [{
        id: "record", production_date: "2026-07-28", shift_id: "shift", time_slot_id: "slot",
        line_id: "line", model_id: "model", process_id: "process", input_qty: 10, actual_qty: 9,
        note: "production note", version: 6, deleted_at: null,
      }],
      quality_records: [{
        production_record_id: "record", input_qty: 10, ok_qty: 8, ng_qty: 1, deleted_at: null,
      }],
      downtime_records: [{
        id: "downtime", production_record_id: "record", reason_id: "reason", minutes: 5,
        start_time: null, end_time: null, note: "wait", deleted_at: null,
      }],
    });

    const record = await createQualityRepository(fixture.client as never).findExisting({
      productionDate: "2026-07-28",
      shiftId: "shift",
      timeSlotId: "slot",
      lineId: "line",
      modelId: "model",
      processId: "process",
    });

    expect(record).toEqual(expect.objectContaining({
      id: "record",
      version: 6,
      inputQty: 10,
      actualQty: 9,
      okQty: 8,
      ngQty: 1,
      note: "production note",
      downtime: [{ reasonId: "reason", minutes: 5, note: "wait" }],
      downtimeMinutes: 5,
    }));
    expect(fixture.selected.get("production_records")?.[0]).not.toMatch(/ok_qty|ng_qty|downtime_minutes/);
    expect(fixture.selected.get("quality_records")?.[0]).toBe("input_qty,ok_qty,ng_qty");
    expect(fixture.selected.get("downtime_records")?.[0]).toBe("id,reason_id,minutes,note");
  });
});
