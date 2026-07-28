import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisDataset, AnalysisFilters, MasterDataSnapshot } from "../../src/domain/types";
import { createAnalysisRepository } from "../../src/data/repositories/analysis-repository";
import { AnalysisPage } from "../../src/features/analysis/AnalysisPage";

const filters: AnalysisFilters = {
  from: "2026-07-27",
  to: "2026-08-03",
  groupBy: "day",
  shiftId: "shift-day",
  modelId: "model-a",
  lineId: "line-1",
  processCode: "AOI",
};

const master: MasterDataSnapshot = {
  models: [{ id: "model-a", code: "MODEL-A", name: "Model A", active: true, version: 1 }],
  processes: [{ id: "process-aoi", code: "AOI", name: "AOI", active: true }],
  lines: [{ id: "line-1", code: "L1", name: "Line 1", active: true, version: 1 }],
  shifts: [{ id: "shift-day", code: "DAY", name: "Day", active: true, version: 1 }],
  timeSlots: [
    { id: "slot-a", shiftId: "shift-day", code: "A", startsAt: "08:00", endsAt: "09:00", endDayOffset: 0, sequence: 1 },
  ],
  downtimeReasons: [{ id: "reason-stop", code: "STOP", name: "Stopped", active: true, version: 1 }],
  standardTimes: [{
    id: "st-a",
    modelId: "model-a",
    processId: "process-aoi",
    lineId: "line-1",
    secondsPerUnit: 30,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  }],
};

function production(id: string, productionDate: string, inputQty: number, actualQty: number) {
  return {
    id,
    productionDate,
    shiftId: "shift-day",
    timeSlotId: "slot-a",
    lineId: "line-1",
    modelId: "model-a",
    processId: "process-aoi",
    inputQty,
    actualQty,
    downtime: productionDate === "2026-07-27" ? [{ reasonId: "reason-stop", minutes: 10 }] : [],
  };
}

describe("analysis repository", () => {
  it("groups day, ISO week, and month while preserving filter contracts and target misses", async () => {
    const records = new Map([
      ["2026-07-27", [production("p-1", "2026-07-27", 100, 80)]],
      ["2026-08-03", [production("p-2", "2026-08-03", 200, 120)]],
    ]);
    const qualities = new Map([
      ["p-1", { id: "q-1", productionRecordId: "p-1", lineId: "line-1", modelId: "model-a", processId: "process-aoi", inputQty: 100, okQty: 90 }],
      ["p-2", { id: "q-2", productionRecordId: "p-2", lineId: "line-1", modelId: "model-a", processId: "process-aoi", inputQty: 200, okQty: 196 }],
    ]);
    const listDashboardProduction = vi.fn(({ productionDate }) => Promise.resolve(records.get(productionDate) ?? []));
    const listDashboardQuality = vi.fn(({ productionRecordIds }) =>
      Promise.resolve(productionRecordIds.map((id: string) => qualities.get(id)).filter(Boolean)));
    const repository = createAnalysisRepository({
      master: { listMasterData: vi.fn().mockResolvedValue(master) },
      production: { listDashboardProduction },
      quality: {
        listDashboardQuality,
        listAnalysisDefects: vi.fn().mockResolvedValue([
          { id: "d-1", qualityRecordId: "q-1", type: "Bridge", classification: "real", quantity: 2 },
        ]),
      },
      targets: {
        listYieldTargets: vi.fn().mockResolvedValue([{
          id: "target-a",
          modelId: "model-a",
          processId: "process-aoi",
          lineId: "line-1",
          targetPercent: 95,
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
        }]),
      },
    });

    const daily = await repository.loadAnalysis(filters);
    const weekly = await repository.loadAnalysis({ ...filters, groupBy: "week" });
    const monthly = await repository.loadAnalysis({ ...filters, groupBy: "month" });

    expect(daily.yieldSeries).toEqual([
      expect.objectContaining({ period: "2026-07-27", inputQty: 100, okQty: 90, target: 95, belowTarget: true }),
      expect.objectContaining({ period: "2026-08-03", inputQty: 200, okQty: 196, target: 95, belowTarget: false }),
    ]);
    expect(weekly.yieldSeries.map((row) => row.period)).toEqual(["2026-W31", "2026-W32"]);
    expect(monthly.yieldSeries.map((row) => row.period)).toEqual(["2026-07", "2026-08"]);
    expect(listDashboardProduction).toHaveBeenCalledWith(expect.objectContaining({
      productionDate: "2026-07-27",
      shiftId: "shift-day",
      modelId: "model-a",
      lineId: "line-1",
      processId: "process-aoi",
    }));
    expect(daily.processLines[0]).toEqual(expect.objectContaining({
      processCode: "AOI",
      lineCode: "L1",
      inputQty: 300,
      okQty: 286,
    }));
    expect(daily.timeSlots[0]).toEqual(expect.objectContaining({
      timeSlotCode: "A",
      actualQty: 200,
      utilizationPercent: 90.9090909090909,
    }));
    expect(daily.downtime).toEqual([
      expect.objectContaining({ reason: "Stopped", minutes: 10, lostUnits: 20 }),
    ]);
  });

  it("sorts aggregated defect quantities descending", async () => {
    const repository = createAnalysisRepository({
      master: { listMasterData: vi.fn().mockResolvedValue(master) },
      production: { listDashboardProduction: vi.fn(({ productionDate }) =>
        Promise.resolve(productionDate === "2026-07-27" ? [production("p-1", productionDate, 100, 80)] : [])) },
      quality: {
        listDashboardQuality: vi.fn().mockResolvedValue([
          { id: "q-1", productionRecordId: "p-1", lineId: "line-1", modelId: "model-a", processId: "process-aoi", inputQty: 100, okQty: 90 },
        ]),
        listAnalysisDefects: vi.fn().mockResolvedValue([
          { id: "d-1", qualityRecordId: "q-1", type: "Solder", classification: "pseudo", quantity: 2 },
          { id: "d-2", qualityRecordId: "q-1", type: "Bridge", classification: "real", quantity: 7 },
          { id: "d-3", qualityRecordId: "q-1", type: "Solder", classification: "pseudo", quantity: 4 },
        ]),
      },
      targets: { listYieldTargets: vi.fn().mockResolvedValue([]) },
    });

    const dataset = await repository.loadAnalysis(filters);

    expect(dataset.defects).toEqual([
      { type: "Bridge", classification: "real", quantity: 7 },
      { type: "Solder", classification: "pseudo", quantity: 6 },
    ]);
  });
});

const dataset: AnalysisDataset = {
  filters,
  yieldSeries: [
    { period: "2026-07-27", inputQty: 100, okQty: 90, target: 95, belowTarget: true },
    { period: "2026-07-28", inputQty: 100, okQty: 97, target: 95, belowTarget: false },
  ],
  utilizationSeries: [
    { period: "2026-07-27", actualQty: 80, productiveSeconds: 2400, netSeconds: 3000, utilizationPercent: 80 },
  ],
  processLines: [{ processCode: "AOI", lineId: "line-1", lineCode: "L1", inputQty: 200, okQty: 187, yieldPercent: 93.5, target: 95, belowTarget: true }],
  timeSlots: [{ timeSlotId: "slot-a", timeSlotCode: "A", actualQty: 80, productiveSeconds: 2400, netSeconds: 3000, utilizationPercent: 80 }],
  downtime: [{ reason: "Stopped", minutes: 10, lostUnits: 20 }],
  defects: [
    { type: "Bridge", classification: "real", quantity: 7 },
    { type: "Solder", classification: "pseudo", quantity: 6 },
  ],
  generatedBy: "QA User",
};

describe("AnalysisPage", () => {
  it("reloads on grouping and process, line, model, and date filter changes", async () => {
    const loadAnalysis = vi.fn().mockResolvedValue(dataset);
    render(<AnalysisPage
      initialFilters={filters}
      masterRepository={{ listMasterData: vi.fn().mockResolvedValue(master) }}
      analysisRepository={{ loadAnalysis }}
      excelDownloader={vi.fn().mockResolvedValue(undefined)}
      pdfDownloader={vi.fn().mockResolvedValue(undefined)}
    />);
    await screen.findByRole("heading", { name: "상세 분석" });

    fireEvent.change(screen.getByLabelText("집계"), { target: { value: "week" } });
    fireEvent.change(screen.getByLabelText("공정"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("라인"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("모델"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-07-28" } });
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-08-02" } });

    await waitFor(() => expect(loadAnalysis).toHaveBeenLastCalledWith(expect.objectContaining({
      from: "2026-07-28",
      to: "2026-08-02",
      groupBy: "week",
      processCode: null,
      lineId: null,
      modelId: null,
    })));
  });

  it("shows units, accessible summaries, target misses, time-slot loss, and sorted defect detail", async () => {
    render(<AnalysisPage
      initialFilters={filters}
      masterRepository={{ listMasterData: vi.fn().mockResolvedValue(master) }}
      analysisRepository={{ loadAnalysis: vi.fn().mockResolvedValue(dataset) }}
      excelDownloader={vi.fn().mockResolvedValue(undefined)}
      pdfDownloader={vi.fn().mockResolvedValue(undefined)}
    />);

    expect(await screen.findByRole("region", { name: "수율 추이 (%)" })).toHaveTextContent("목표 미달");
    expect(screen.getByText(/수율 추이 요약/)).toHaveTextContent("2026-07-27 90.0%");
    expect(screen.getByRole("region", { name: "공정·라인 비교 (%)" })).toHaveTextContent("AOI");
    expect(screen.getByRole("region", { name: "시간대 실적 및 가동률 (%)" })).toHaveTextContent("80 EA");
    expect(screen.getByRole("region", { name: "비가동 손실 (분·EA)" })).toHaveTextContent("10분");
    const defects = within(screen.getByRole("table", { name: "불량 상세 (EA)" }));
    expect(defects.getAllByRole("row")[1]).toHaveTextContent("Bridge");
    expect(defects.getAllByRole("row")[2]).toHaveTextContent("Solder");
  });
});
