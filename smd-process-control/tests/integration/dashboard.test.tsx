import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DashboardFilters, DashboardSnapshot, MasterDataSnapshot } from "../../src/domain/types";
import { createDashboardRepository } from "../../src/data/repositories/dashboard-repository";
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
