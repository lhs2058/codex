import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DashboardFilters, DashboardSnapshot, MasterDataSnapshot } from "../../src/domain/types";
import { createDashboardRepository } from "../../src/data/repositories/dashboard-repository";
import { createProductionRepository, type DashboardProductionRecord } from "../../src/data/repositories/production-repository";
import { createQualityRepository } from "../../src/data/repositories/quality-repository";
import { DashboardPage } from "../../src/features/dashboard/DashboardPage";

const filters: DashboardFilters = {
  productionDate: "2026-07-28",
  shiftId: "shift-day",
  modelId: "model-a",
  lineId: "line-1",
  processCode: "AOI",
};

const master: MasterDataSnapshot = {
  models: [{ id: "model-a", code: "MODEL-A", name: "모델 A", active: true, version: 1 }],
  processes: [
    { id: "process-spi", code: "SPI", name: "SPI", active: true },
    { id: "process-aoi", code: "AOI", name: "AOI", active: true },
    { id: "process-xray", code: "XRAY", name: "X-RAY", active: true },
    { id: "process-ict", code: "ICT", name: "ICT", active: true },
    { id: "process-router", code: "ROUTER", name: "ROUTER", active: true },
  ],
  lines: [{ id: "line-1", code: "L1", name: "1호선", active: true, version: 1 }],
  shifts: [{ id: "shift-day", code: "DAY", name: "주간", active: true, version: 1 }],
  timeSlots: [
    { id: "slot-a", shiftId: "shift-day", code: "A", startsAt: "08:00", endsAt: "09:00", endDayOffset: 0, sequence: 1 },
    { id: "slot-b", shiftId: "shift-day", code: "B", startsAt: "09:00", endsAt: "10:00", endDayOffset: 0, sequence: 2 },
    { id: "slot-c", shiftId: "shift-day", code: "C", startsAt: "10:00", endsAt: "11:00", endDayOffset: 0, sequence: 3 },
    { id: "slot-d", shiftId: "shift-day", code: "D", startsAt: "11:00", endsAt: "12:00", endDayOffset: 0, sequence: 4 },
    { id: "slot-e", shiftId: "shift-day", code: "E", startsAt: "13:00", endsAt: "14:00", endDayOffset: 0, sequence: 5 },
  ],
  downtimeReasons: [{ id: "reason-breakdown", code: "BREAKDOWN", name: "설비 고장", active: true, version: 1 }],
  standardTimes: [{
    id: "st-aoi",
    modelId: "model-a",
    processId: "process-aoi",
    lineId: "line-1",
    secondsPerUnit: 10,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  }],
};

function productionRecord(overrides: Partial<DashboardProductionRecord> = {}): DashboardProductionRecord {
  return {
    id: "production-1",
    productionDate: "2026-07-28",
    shiftId: "shift-day",
    timeSlotId: "slot-a",
    lineId: "line-1",
    modelId: "model-a",
    processId: "process-aoi",
    inputQty: 10,
    actualQty: 9,
    downtime: [],
    ...overrides,
  };
}

function cappedClient(
  tables: Record<string, Array<Record<string, unknown>>>,
  { overlapPages = false }: { overlapPages?: boolean } = {},
) {
  return {
    rpc: vi.fn(),
    from: vi.fn((table: string) => {
      const equals = new Map<string, unknown>();
      const included = new Map<string, unknown[]>();
      let start = 0;
      let end = 999;
      let orderColumn: string | null = null;
      let oversizedIn = false;
      const query: any = {
        select: () => query,
        eq: (column: string, value: unknown) => { equals.set(column, value); return query; },
        is: (column: string, value: unknown) => { equals.set(column, value); return query; },
        in: (column: string, values: unknown[]) => {
          included.set(column, values);
          if (values.length > 100) oversizedIn = true;
          return query;
        },
        order: (column: string) => { orderColumn = column; return query; },
        range: (from: number, to: number) => { start = from; end = to; return query; },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          if (oversizedIn) return Promise.resolve({ data: null, error: { message: "request_uri_too_long" } }).then(resolve, reject);
          let rows = [...(tables[table] ?? [])]
            .filter((row) => [...equals].every(([column, value]) => (row[column] ?? null) === value))
            .filter((row) => [...included].every(([column, values]) => values.includes(row[column])));
          if (orderColumn) rows.sort((left, right) => String(left[orderColumn!]).localeCompare(String(right[orderColumn!])));
          const pageStart = overlapPages && start > 0 ? start - 1 : start;
          rows = rows.slice(pageStart, Math.min(end + 1, pageStart + 1000));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    }),
  };
}

describe("dashboard repository", () => {
  it("propagates every filter and calculates yield from summed quantities", async () => {
    const listDashboardProduction = vi.fn().mockResolvedValue([
      {
        id: "production-1",
        productionDate: "2026-07-28",
        shiftId: "shift-day",
        timeSlotId: "slot-a",
        lineId: "line-1",
        modelId: "model-a",
        processId: "process-aoi",
        inputQty: 100,
        actualQty: 90,
        downtime: [{ reasonId: "reason-breakdown", minutes: 5 }],
      },
      {
        id: "production-2",
        productionDate: "2026-07-28",
        shiftId: "shift-day",
        timeSlotId: "slot-b",
        lineId: "line-1",
        modelId: "model-a",
        processId: "process-aoi",
        inputQty: 10,
        actualQty: 1,
        downtime: [],
      },
    ]);
    const listDashboardQuality = vi.fn().mockResolvedValue([
      { productionRecordId: "production-1", lineId: "line-1", modelId: "model-a", processId: "process-aoi", inputQty: 100, okQty: 90 },
      { productionRecordId: "production-2", lineId: "line-1", modelId: "model-a", processId: "process-aoi", inputQty: 10, okQty: 1 },
    ]);
    const repository = createDashboardRepository({
      master: { listMasterData: vi.fn().mockResolvedValue(master) },
      production: { listDashboardProduction },
      quality: { listDashboardQuality },
    });

    const snapshot = await repository.loadDashboard(filters);

    expect(listDashboardProduction).toHaveBeenCalledWith({
      productionDate: "2026-07-28",
      shiftId: "shift-day",
      modelId: "model-a",
      lineId: "line-1",
      processId: "process-aoi",
    });
    expect(listDashboardQuality).toHaveBeenCalledWith({
      productionDate: "2026-07-28",
      shiftId: "shift-day",
      modelId: "model-a",
      lineId: "line-1",
      processId: "process-aoi",
      productionRecordIds: ["production-1", "production-2"],
    });
    expect(snapshot.weightedYield).toEqual({ status: "ok", value: (91 / 110) * 100 });
    expect(snapshot.yields.find((row) => row.processCode === "AOI" && row.lineId === "line-1")?.result)
      .toEqual({ status: "ok", value: (91 / 110) * 100 });
    expect(snapshot.totalActual).toBe(91);
    expect(snapshot.downtime).toEqual([{ reasonId: "reason-breakdown", reasonName: "설비 고장", minutes: 5 }]);
  });

  it("keeps missing denominators explicitly not calculable", async () => {
    const repository = createDashboardRepository({
      master: { listMasterData: vi.fn().mockResolvedValue(master) },
      production: { listDashboardProduction: vi.fn().mockResolvedValue([]) },
      quality: { listDashboardQuality: vi.fn().mockResolvedValue([]) },
    });

    const snapshot = await repository.loadDashboard(filters);

    expect(snapshot.weightedYield).toEqual({ status: "not-calculable", reason: "zero-input" });
    expect(snapshot.weightedUtilization.status).toBe("not-calculable");
    expect(snapshot.yields).toHaveLength(1);
    expect(snapshot.yields[0].result.status).toBe("not-calculable");
    expect(snapshot.utilization[0].result.status).toBe("not-calculable");
  });

  it("does not publish partial utilization when one selected record lacks standard time", async () => {
    const repository = createDashboardRepository({
      master: { listMasterData: vi.fn().mockResolvedValue(master) },
      production: {
        listDashboardProduction: vi.fn().mockResolvedValue([
          productionRecord(),
          productionRecord({ id: "production-2", modelId: "model-without-st", timeSlotId: "slot-b" }),
        ]),
      },
      quality: { listDashboardQuality: vi.fn().mockResolvedValue([]) },
    });

    const snapshot = await repository.loadDashboard({ ...filters, modelId: null });

    expect(snapshot.weightedUtilization).toEqual({ status: "not-calculable", reason: "missing-st" });
    expect(snapshot.utilization).toEqual([{ lineId: "line-1", result: { status: "not-calculable", reason: "missing-st" } }]);
    expect(snapshot.attentionCount).toBe(1);
  });

  it("does not publish partial utilization when one selected record has zero net time", async () => {
    const repository = createDashboardRepository({
      master: { listMasterData: vi.fn().mockResolvedValue(master) },
      production: {
        listDashboardProduction: vi.fn().mockResolvedValue([
          productionRecord(),
          productionRecord({
            id: "production-2",
            timeSlotId: "slot-b",
            downtime: [{ reasonId: "reason-breakdown", minutes: 60 }],
          }),
        ]),
      },
      quality: { listDashboardQuality: vi.fn().mockResolvedValue([]) },
    });

    const snapshot = await repository.loadDashboard(filters);

    expect(snapshot.weightedUtilization).toEqual({ status: "not-calculable", reason: "zero-net-time" });
    expect(snapshot.utilization).toEqual([{ lineId: "line-1", result: { status: "not-calculable", reason: "zero-net-time" } }]);
    expect(snapshot.attentionCount).toBe(1);
  });

  it("keeps C complete without inventing completion for missing A and B entries", async () => {
    const repository = createDashboardRepository({
      master: { listMasterData: vi.fn().mockResolvedValue(master) },
      production: { listDashboardProduction: vi.fn().mockResolvedValue([productionRecord({ timeSlotId: "slot-c" })]) },
      quality: { listDashboardQuality: vi.fn().mockResolvedValue([]) },
      now: () => new Date("2026-07-27T23:30:00.000Z"),
    });

    const snapshot = await repository.loadDashboard(filters);

    expect(snapshot.entryProgress.map((row) => row.status)).toEqual(["waiting", "waiting", "complete", "waiting", "waiting"]);
  });

  it("marks only the unentered current slot in progress across an out-of-order gap", async () => {
    const repository = createDashboardRepository({
      master: { listMasterData: vi.fn().mockResolvedValue(master) },
      production: {
        listDashboardProduction: vi.fn().mockResolvedValue([
          productionRecord({ id: "production-a", timeSlotId: "slot-a" }),
          productionRecord({ id: "production-c", timeSlotId: "slot-c" }),
        ]),
      },
      quality: { listDashboardQuality: vi.fn().mockResolvedValue([]) },
      now: () => new Date("2026-07-28T02:30:00.000Z"),
    });

    const snapshot = await repository.loadDashboard(filters);

    expect(snapshot.entryProgress.map((row) => row.status)).toEqual(["complete", "in-progress", "complete", "waiting", "waiting"]);
  });
});

describe("dashboard repository pagination", () => {
  it("counts overlapping production, quality, and downtime pages exactly once", async () => {
    const productionRows = Array.from({ length: 1001 }, (_, index) => ({
      id: `production-${String(index).padStart(4, "0")}`,
      production_date: "2026-07-28",
      shift_id: "shift-day",
      time_slot_id: "slot-a",
      line_id: "line-1",
      model_id: "model-a",
      process_id: "process-aoi",
      input_qty: 1,
      actual_qty: 1,
      deleted_at: null,
    }));
    const qualityRows = productionRows.map((row, index) => ({
      id: `quality-${String(index).padStart(4, "0")}`,
      production_record_id: row.id,
      production_date: "2026-07-28",
      line_id: "line-1",
      model_id: "model-a",
      process_id: "process-aoi",
      input_qty: index === 1000 ? 1000 : 1,
      ok_qty: index === 1000 ? 0 : 1,
      deleted_at: null,
    }));
    const downtimeRows = Array.from({ length: 1001 }, (_, index) => ({
      id: `downtime-${String(index).padStart(4, "0")}`,
      production_record_id: "production-0000",
      reason_id: "reason-breakdown",
      minutes: index === 999 ? 5 : index === 1000 ? 7 : 0,
      deleted_at: null,
    }));
    const client = cappedClient({
      production_records: productionRows,
      quality_records: qualityRows,
      downtime_records: downtimeRows,
    }, { overlapPages: true });
    const repository = createDashboardRepository({
      master: { listMasterData: vi.fn().mockResolvedValue(master) },
      production: createProductionRepository(client as never),
      quality: createQualityRepository(client as never),
    });

    const snapshot = await repository.loadDashboard(filters);

    expect(snapshot.totalActual).toBe(1001);
    expect(snapshot.weightedYield).toEqual({ status: "ok", value: 50 });
    expect(snapshot.yields[0].result).toEqual({ status: "ok", value: 50 });
    expect(snapshot.downtime).toEqual([{ reasonId: "reason-breakdown", reasonName: "설비 고장", minutes: 12 }]);
  });

  it("counts quality rows once when repeated production IDs would cross chunk boundaries", async () => {
    const productionIds = Array.from({ length: 101 }, (_, index) => `production-${String(index).padStart(4, "0")}`);
    const client = cappedClient({
      quality_records: productionIds.map((productionRecordId, index) => ({
        id: `quality-${String(index).padStart(4, "0")}`,
        production_record_id: productionRecordId,
        production_date: "2026-07-28",
        line_id: "line-1",
        model_id: "model-a",
        process_id: "process-aoi",
        input_qty: 1,
        ok_qty: 1,
        deleted_at: null,
      })),
    });
    const quality = createQualityRepository(client as never);

    const rows = await quality.listDashboardQuality({
      productionDate: "2026-07-28",
      shiftId: "shift-day",
      modelId: "model-a",
      lineId: "line-1",
      processId: "process-aoi",
      productionRecordIds: [...productionIds.slice(0, 100), productionIds[0], productionIds[100]],
    });

    expect(rows).toHaveLength(101);
    expect(rows.reduce((total, row) => total + row.okQty, 0)).toBe(101);
  });
});

describe("DashboardPage", () => {
  it("reports unavailable production services instead of throwing during route render", async () => {
    expect(() => render(<DashboardPage initialFilters={filters} />)).not.toThrow();
    expect(await screen.findByRole("alert")).toHaveTextContent("연결");
  });

  it("renders the approved core regions, downtime, and A-E entry progress", async () => {
    const snapshot: DashboardSnapshot = {
      totalActual: 1234,
      weightedYield: { status: "ok", value: 97.5 },
      weightedUtilization: { status: "ok", value: 82 },
      attentionCount: 3,
      yields: master.processes.map((process) => ({
        processCode: process.code,
        lineId: "line-1",
        result: process.code === "XRAY" ? { status: "not-calculable", reason: "zero-input" } : { status: "ok", value: 95 },
      })),
      utilization: [{ lineId: "line-1", result: { status: "ok", value: 82 } }],
      downtime: [{ reasonId: "reason-breakdown", reasonName: "설비 고장", minutes: 25 }],
      entryProgress: master.timeSlots.map((slot, index) => ({
        timeSlotId: slot.id,
        status: index < 3 ? "complete" : index === 3 ? "in-progress" : "waiting",
      })),
    };
    render(<DashboardPage
      initialFilters={filters}
      masterRepository={{ listMasterData: vi.fn().mockResolvedValue(master) }}
      dashboardRepository={{
        loadDashboard: vi.fn().mockResolvedValue(snapshot),
        subscribeDashboard: vi.fn().mockReturnValue(() => undefined),
      }}
    />);

    expect(await screen.findByRole("heading", { name: "통합 생산 대시보드" })).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-main")).toHaveAttribute("data-dashboard-state", "ready");
    expect(screen.getByTestId("dashboard-main")).toHaveAttribute("data-dashboard-date", "2026-07-28");
    expect(screen.getByTestId("dashboard-main")).toHaveAttribute("data-dashboard-total-actual", "1234");
    expect(screen.getByLabelText("대시보드 메뉴")).toBeInTheDocument();
    expect(screen.getByText("금일 총 실적")).toBeInTheDocument();
    expect(screen.getByText("평균 공정 수율")).toBeInTheDocument();
    expect(screen.getByText("평균 라인 가동률")).toBeInTheDocument();
    expect(screen.getByText("확인 필요")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "공정별 라인 수율" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "라인 가동률" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "비가동 요약" })).toHaveTextContent("설비 고장25분");
    const progress = within(screen.getByRole("region", { name: "시간대 입력 진행" }));
    for (const code of ["A", "B", "C", "D", "E"]) expect(progress.getByText(code)).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });
});
