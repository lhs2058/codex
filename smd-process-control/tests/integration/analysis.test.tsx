import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisDataset, AnalysisFilters, MasterDataSnapshot } from "../../src/domain/types";
import { createAnalysisRepository } from "../../src/data/repositories/analysis-repository";
import { createMasterDataRepository } from "../../src/data/repositories/master-data-repository";
import { AnalysisPage } from "../../src/features/analysis/AnalysisPage";
import { deriveLegacyCandidates } from "../../src/upload/legacy-master-candidates";

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
  shifts: [
    { id: "shift-day", code: "DAY", name: "Day", active: true, version: 1 },
    { id: "shift-night", code: "NIGHT", name: "Night", active: true, version: 1 },
  ],
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
  it("loads inactive historical masters through the dedicated RPC contract", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        models: [{ id: "model-old", code: "OLD", name: "Old model", is_active: false, version: 2 }],
        processes: [{ id: "process-old", code: "ICT", name: "Old process", is_active: false, version: 2 }],
        lines: [{ id: "line-old", code: "OLD", name: "Old line", is_active: false, version: 2 }],
        shifts: [{ id: "shift-old", code: "OLD", name: "Old shift", is_active: false, version: 2 }],
        time_slots: [{ id: "slot-old", shift_id: "shift-old", code: "Z", starts_at: "08:00:00", ends_at: "09:00:00", end_day_offset: 0, sequence: 9 }],
        downtime_reasons: [{ id: "reason-old", code: "OLD", name: "Legacy stop", is_active: false, version: 2 }],
        standard_times: [{ id: "st-old", model_id: "model-old", process_id: "process-old", line_id: "line-old", seconds_per_unit: 60, effective_from: "2025-01-01", effective_to: null }],
      },
      error: null,
    });
    const client = { rpc, from: vi.fn(() => { throw new Error("history_must_not_query_tables"); }) };

    const result = await createMasterDataRepository(client as any).listHistoricalMasterData();

    expect(rpc).toHaveBeenCalledWith("list_historical_master_data");
    expect(result).toEqual(expect.objectContaining({
      models: [expect.objectContaining({ code: "OLD", active: false })],
      processes: [expect.objectContaining({ code: "ICT", active: false })],
      lines: [expect.objectContaining({ code: "OLD", active: false })],
      shifts: [expect.objectContaining({ code: "OLD", active: false })],
      timeSlots: [expect.objectContaining({ code: "Z", startsAt: "08:00", endsAt: "09:00" })],
      downtimeReasons: [expect.objectContaining({ name: "Legacy stop", active: false })],
      standardTimes: [expect.objectContaining({ secondsPerUnit: 60 })],
    }));
  });

  it("provides an all-status import snapshot without changing the active-only selector contract", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        models: [{ id: "model-inactive", code: "MODEL-X", name: "Retired model", is_active: false, version: 3 }],
        processes: [{ id: "process-aoi", code: "AOI", name: "AOI", is_active: true, version: 1 }],
        lines: [{ id: "line-1", code: "LINE-1", name: "Line 1", is_active: true, version: 1 }],
        shifts: [{ id: "shift-day", code: "DAY", name: "Day", is_active: true, version: 1 }],
        time_slots: [{ id: "slot-a", shift_id: "shift-day", code: "A", starts_at: "07:30", ends_at: "09:30", end_day_offset: 0, sequence: 1, is_active: true, version: 1 }],
        downtime_reasons: [],
        standard_times: [{
          id: "st-live",
          model_id: "model-inactive",
          process_id: "process-aoi",
          line_id: "line-1",
          seconds_per_unit: 12,
          effective_from: "2026-01-01",
          effective_to: "2026-06-30",
        }],
      },
      error: null,
    });
    const client = { rpc, from: vi.fn(() => { throw new Error("import_snapshot_must_not_query_active_tables"); }) };

    const result = await createMasterDataRepository(client as any).listImportMasterData();

    expect(rpc).toHaveBeenCalledWith("list_import_master_data");
    expect(result.models).toEqual([
      expect.objectContaining({ code: "MODEL-X", name: "Retired model", active: false }),
    ]);
    expect(result.standardTimes).toEqual([
      expect.objectContaining({ id: "st-live", secondsPerUnit: 12 }),
    ]);
    const derived = deriveLegacyCandidates({
      kind: "production",
      rows: [{
        sourceSheet: "Production",
        sourceRow: 2,
        productionDate: "2026-07-29",
        shiftCode: "DAY",
        timeSlotCode: "A",
        lineCode: "LINE-1",
        modelCode: "MODEL-X",
        processCode: "AOI",
        inputQty: 10,
        actualQty: 9,
        okQty: 0,
        ngQty: 0,
        downtimeMinutes: 0,
        downtimeReasonCode: null,
        note: "",
        dimensions: { production: { inputQty: 10, actualQty: 9 }, quality: null },
        warnings: [],
        defects: [],
      }],
      diagnostics: [],
      capacityEvidence: [],
      stWarnings: [],
    }, result);
    expect(derived.masterCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity: "model",
        code: "MODEL-X",
        status: "conflict",
        conflictReason: "inactive",
        currentName: "Retired model",
        resolvable: false,
      }),
    ]));
  });

  it("keeps the normal master snapshot on active-only table reads", async () => {
    const activeFilters: string[] = [];
    const rowsByTable: Record<string, unknown[]> = {
      models: [{ id: "model-a", code: "A", name: "Active model", is_active: true, version: 1 }],
      processes: [{ id: "process-a", code: "AOI", name: "Active process", is_active: true, version: 1 }],
      lines: [{ id: "line-a", code: "A", name: "Active line", is_active: true, version: 1 }],
      shifts: [{ id: "shift-a", code: "A", name: "Active shift", is_active: true, version: 1 }],
      time_slots: [{ id: "slot-a", shift_id: "shift-a", code: "A", starts_at: "08:00", ends_at: "09:00", end_day_offset: 0, sequence: 1 }],
      downtime_reasons: [{ id: "reason-a", code: "A", name: "Active reason", is_active: true, version: 1 }],
      standard_times: [],
    };
    const client = {
      rpc: vi.fn(() => { throw new Error("active_snapshot_must_not_call_history_rpc"); }),
      from: vi.fn((table: string) => {
        const query: any = {
          select: vi.fn(() => query),
          is: vi.fn(() => query),
          eq: vi.fn((column: string) => {
            if (column === "is_active") activeFilters.push(table);
            return query;
          }),
          order: vi.fn(() => Promise.resolve({ data: rowsByTable[table], error: null })),
        };
        return query;
      }),
    };

    const result = await createMasterDataRepository(client as any).listMasterData();

    expect(activeFilters.sort()).toEqual([
      "downtime_reasons", "lines", "models", "processes", "shifts", "time_slots",
    ]);
    expect(result.models).toEqual([expect.objectContaining({ code: "A", active: true })]);
  });

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
      master: { listHistoricalMasterData: vi.fn().mockResolvedValue(master) },
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
      master: { listHistoricalMasterData: vi.fn().mockResolvedValue(master) },
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

  it("bounds date-query concurrency to four and keeps period output deterministic", async () => {
    let active = 0;
    let maxActive = 0;
    const completions: string[] = [];
    const listDashboardProduction = vi.fn(async ({ productionDate }: { productionDate: string }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, productionDate.endsWith("01") ? 12 : 2));
      completions.push(productionDate);
      active -= 1;
      return [production(`p-${productionDate}`, productionDate, 10, 8)];
    });
    const repository = createAnalysisRepository({
      master: { listHistoricalMasterData: vi.fn().mockResolvedValue(master) },
      production: { listDashboardProduction },
      quality: {
        listDashboardQuality: vi.fn(({ productionDate }) => Promise.resolve([{
          id: `q-${productionDate}`,
          productionRecordId: `p-${productionDate}`,
          lineId: "line-1",
          modelId: "model-a",
          processId: "process-aoi",
          inputQty: 10,
          okQty: 9,
        }])),
        listAnalysisDefects: vi.fn().mockResolvedValue([]),
      },
      targets: { listYieldTargets: vi.fn().mockResolvedValue([]) },
    });

    const result = await repository.loadAnalysis({
      ...filters,
      from: "2026-07-01",
      to: "2026-07-12",
    });

    expect(maxActive).toBeLessThanOrEqual(4);
    expect(completions[0]).not.toBe("2026-07-01");
    expect(result.yieldSeries.map((row) => row.period)).toEqual(
      Array.from({ length: 12 }, (_, index) => `2026-07-${String(index + 1).padStart(2, "0")}`),
    );
  });

  it("stops scheduling date queries and rejects with AbortError when aborted", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const listDashboardProduction = vi.fn(async () => {
      await gate;
      return [];
    });
    const repository = createAnalysisRepository({
      master: { listHistoricalMasterData: vi.fn().mockResolvedValue(master) },
      production: { listDashboardProduction },
      quality: {
        listDashboardQuality: vi.fn().mockResolvedValue([]),
        listAnalysisDefects: vi.fn().mockResolvedValue([]),
      },
      targets: { listYieldTargets: vi.fn().mockResolvedValue([]) },
    });
    const controller = new AbortController();

    const pending = repository.loadAnalysis({
      ...filters,
      from: "2026-07-01",
      to: "2026-07-20",
    }, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    release();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(listDashboardProduction.mock.calls.length).toBeLessThan(20);
  });

  it("uses inactive historical labels, time slots, reasons, and standard times", async () => {
    const history: MasterDataSnapshot = {
      ...master,
      models: [...master.models, { id: "model-old", code: "MODEL-OLD", name: "Old model", active: false, version: 2 }],
      processes: [...master.processes, { id: "process-old", code: "ICT", name: "Legacy ICT", active: false }],
      lines: [...master.lines, { id: "line-old", code: "OLD", name: "Old line", active: false, version: 2 }],
      shifts: [...master.shifts, { id: "shift-old", code: "OLD", name: "Old shift", active: false, version: 2 }],
      timeSlots: [...master.timeSlots, { id: "slot-old", shiftId: "shift-old", code: "Z", startsAt: "08:00", endsAt: "09:00", endDayOffset: 0, sequence: 99 }],
      downtimeReasons: [...master.downtimeReasons, { id: "reason-old", code: "OLD", name: "Legacy stop", active: false, version: 2 }],
      standardTimes: [...master.standardTimes, {
        id: "st-old",
        modelId: "model-old",
        processId: "process-old",
        lineId: "line-old",
        secondsPerUnit: 60,
        effectiveFrom: "2025-01-01",
        effectiveTo: null,
      }],
    };
    const historicalRecord = {
      id: "p-old",
      productionDate: "2026-07-27",
      shiftId: "shift-old",
      timeSlotId: "slot-old",
      lineId: "line-old",
      modelId: "model-old",
      processId: "process-old",
      inputQty: 100,
      actualQty: 50,
      downtime: [{ reasonId: "reason-old", minutes: 10 }],
    };
    const repository = createAnalysisRepository({
      master: { listHistoricalMasterData: vi.fn().mockResolvedValue(history) },
      production: { listDashboardProduction: vi.fn().mockResolvedValue([historicalRecord]) },
      quality: {
        listDashboardQuality: vi.fn().mockResolvedValue([{
          id: "q-old",
          productionRecordId: "p-old",
          lineId: "line-old",
          modelId: "model-old",
          processId: "process-old",
          inputQty: 100,
          okQty: 95,
        }]),
        listAnalysisDefects: vi.fn().mockResolvedValue([]),
      },
      targets: { listYieldTargets: vi.fn().mockResolvedValue([]) },
    });

    const result = await repository.loadAnalysis({ ...filters, from: "2026-07-27", to: "2026-07-27", shiftId: null, modelId: null, lineId: null, processCode: null });

    expect(result.processLines).toEqual([expect.objectContaining({ processCode: "ICT", lineCode: "OLD" })]);
    expect(result.timeSlots).toEqual([expect.objectContaining({ timeSlotCode: "Z", utilizationPercent: 100 })]);
    expect(result.downtime).toEqual([{ reason: "Legacy stop", minutes: 10, lostUnits: 10 }]);
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
  it("reloads on grouping and shift, process, line, model, and date filter changes", async () => {
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
    fireEvent.change(screen.getByLabelText("조"), { target: { value: "shift-night" } });
    fireEvent.change(screen.getByLabelText("공정"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("라인"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("모델"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-07-28" } });
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-08-02" } });

    await waitFor(() => expect(loadAnalysis).toHaveBeenLastCalledWith(expect.objectContaining({
      from: "2026-07-28",
      to: "2026-08-02",
      groupBy: "week",
      shiftId: "shift-night",
      processCode: null,
      lineId: null,
      modelId: null,
    }), expect.objectContaining({ signal: expect.any(AbortSignal) })));
  });

  it("invalidates stale data immediately and cannot export it while new filters load", async () => {
    let resolveLatest!: (value: AnalysisDataset) => void;
    const latest = new Promise<AnalysisDataset>((resolve) => { resolveLatest = resolve; });
    const loadAnalysis = vi.fn()
      .mockResolvedValueOnce(dataset)
      .mockReturnValueOnce(latest);
    const excelDownloader = vi.fn().mockResolvedValue(undefined);
    render(<AnalysisPage
      initialFilters={filters}
      masterRepository={{ listMasterData: vi.fn().mockResolvedValue(master) }}
      analysisRepository={{ loadAnalysis }}
      excelDownloader={excelDownloader}
      pdfDownloader={vi.fn().mockResolvedValue(undefined)}
    />);
    await screen.findByRole("region", { name: "수율 추이 (%)" });
    const excel = screen.getByRole("button", { name: "Excel" });
    expect(excel).toBeEnabled();

    fireEvent.change(screen.getByLabelText("집계"), { target: { value: "week" } });
    expect(excel).toBeDisabled();
    fireEvent.click(excel);
    expect(excelDownloader).not.toHaveBeenCalled();

    resolveLatest({ ...dataset, filters: { ...filters, groupBy: "week" } });
    await waitFor(() => expect(excel).toBeEnabled());
  });

  it("aborts the previous request and ignores its late response after filter changes", async () => {
    let resolveInitial!: (value: AnalysisDataset) => void;
    let resolveLatest!: (value: AnalysisDataset) => void;
    const initial = new Promise<AnalysisDataset>((resolve) => { resolveInitial = resolve; });
    const latest = new Promise<AnalysisDataset>((resolve) => { resolveLatest = resolve; });
    const loadAnalysis = vi.fn()
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(latest);
    render(<AnalysisPage
      initialFilters={filters}
      masterRepository={{ listMasterData: vi.fn().mockResolvedValue(master) }}
      analysisRepository={{ loadAnalysis }}
      excelDownloader={vi.fn().mockResolvedValue(undefined)}
      pdfDownloader={vi.fn().mockResolvedValue(undefined)}
    />);
    await screen.findByLabelText("집계");

    fireEvent.change(screen.getByLabelText("집계"), { target: { value: "week" } });
    const initialSignal = loadAnalysis.mock.calls[0][1]?.signal as AbortSignal | undefined;
    expect(initialSignal?.aborted).toBe(true);
    await act(async () => {
      resolveLatest({
        ...dataset,
        filters: { ...filters, groupBy: "week" },
        defects: [{ type: "LATEST", classification: "real", quantity: 1 }],
      });
    });
    expect(await screen.findByText("LATEST")).toBeInTheDocument();

    await act(async () => {
      resolveInitial({
        ...dataset,
        defects: [{ type: "STALE", classification: "real", quantity: 999 }],
      });
    });
    expect(screen.queryByText("STALE")).not.toBeInTheDocument();
    expect(screen.getByText("LATEST")).toBeInTheDocument();
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
