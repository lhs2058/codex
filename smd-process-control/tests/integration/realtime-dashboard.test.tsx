import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DashboardFilters, DashboardSnapshot, MasterDataSnapshot } from "../../src/domain/types";
import { DashboardPage } from "../../src/features/dashboard/DashboardPage";
import { createDashboardRealtimeSubscription } from "../../src/data/repositories/dashboard-repository";

const initialFilters: DashboardFilters = {
  productionDate: "2026-07-28",
  shiftId: null,
  modelId: null,
  lineId: null,
  processCode: null,
};

const master: MasterDataSnapshot = {
  models: [
    { id: "model-a", code: "MODEL-A", name: "모델 A", active: true, version: 1 },
    { id: "model-b", code: "MODEL-B", name: "모델 B", active: true, version: 1 },
  ],
  processes: [{ id: "process-aoi", code: "AOI", name: "AOI", active: true }],
  lines: [{ id: "line-1", code: "L1", name: "1호선", active: true, version: 1 }],
  shifts: [{ id: "shift-day", code: "DAY", name: "주간", active: true, version: 1 }],
  timeSlots: [{ id: "slot-a", shiftId: "shift-day", code: "A", startsAt: "08:00", endsAt: "09:00", endDayOffset: 0, sequence: 1 }],
  downtimeReasons: [],
  standardTimes: [],
};

const snapshot: DashboardSnapshot = {
  totalActual: 0,
  weightedYield: { status: "not-calculable", reason: "zero-input" },
  weightedYieldTarget: null,
  weightedUtilization: { status: "not-calculable", reason: "zero-net-time" },
  attentionCount: 0,
  yields: [{ processCode: "AOI", lineId: "line-1", result: { status: "not-calculable", reason: "zero-input" }, targetPercent: null }],
  utilization: [{ lineId: "line-1", result: { status: "not-calculable", reason: "zero-net-time" } }],
  downtime: [],
  entryProgress: [{ timeSlotId: "slot-a", status: "waiting" }],
};

describe("DashboardPage realtime refresh", () => {
  it("reloads the current filters once 500ms after a production or quality event burst", async () => {
    vi.useFakeTimers();
    let onChange = () => undefined;
    const loadDashboard = vi.fn().mockResolvedValue(snapshot);
    render(<DashboardPage
      initialFilters={initialFilters}
      masterRepository={{ listMasterData: vi.fn().mockResolvedValue(master) }}
      dashboardRepository={{
        loadDashboard,
        subscribeDashboard: vi.fn((_filters, callback) => { onChange = callback; return () => undefined; }),
      }}
    />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(loadDashboard).toHaveBeenCalledTimes(1);

    act(() => { onChange(); onChange(); onChange(); vi.advanceTimersByTime(499); });
    expect(loadDashboard).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve(); });

    expect(loadDashboard).toHaveBeenCalledTimes(2);
    expect(loadDashboard).toHaveBeenLastCalledWith(initialFilters);
    vi.useRealTimers();
  });

  it("cleans up subscriptions on filter changes and unmount without resetting filter form state", async () => {
    const cleanups: Array<ReturnType<typeof vi.fn>> = [];
    const subscribeDashboard = vi.fn().mockImplementation(() => {
      const cleanup = vi.fn();
      cleanups.push(cleanup);
      return cleanup;
    });
    const view = render(<DashboardPage
      initialFilters={initialFilters}
      masterRepository={{ listMasterData: vi.fn().mockResolvedValue(master) }}
      dashboardRepository={{ loadDashboard: vi.fn().mockResolvedValue(snapshot), subscribeDashboard }}
    />);
    await screen.findByLabelText("모델");

    fireEvent.change(screen.getByLabelText("모델"), { target: { value: "model-b" } });
    await waitFor(() => expect(subscribeDashboard).toHaveBeenCalledTimes(2));
    expect(cleanups[0]).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("모델")).toHaveValue("model-b");

    view.unmount();
    expect(cleanups[1]).toHaveBeenCalledOnce();
  });

  it("ignores an event callback retained from the previous filter subscription", async () => {
    vi.useFakeTimers();
    const callbacks: Array<() => void> = [];
    const loadDashboard = vi.fn().mockResolvedValue(snapshot);
    render(<DashboardPage
      initialFilters={initialFilters}
      masterRepository={{ listMasterData: vi.fn().mockResolvedValue(master) }}
      dashboardRepository={{
        loadDashboard,
        subscribeDashboard: vi.fn((_filters, callback) => {
          callbacks.push(callback);
          return () => undefined;
        }),
      }}
    />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    fireEvent.change(screen.getByLabelText("모델"), { target: { value: "model-b" } });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(loadDashboard).toHaveBeenCalledTimes(2);

    act(() => { callbacks[0](); vi.advanceTimersByTime(500); });
    await act(async () => { await Promise.resolve(); });
    expect(loadDashboard).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("Supabase dashboard realtime subscription", () => {
  it("subscribes to production and quality table changes and removes both channels", () => {
    const handlers = new Map<string, () => void>();
    const removeChannel = vi.fn();
    const client = {
      channel: vi.fn((name: string) => {
        const channel = {
          on: vi.fn((_type: string, config: { table: string }, callback: () => void) => {
            handlers.set(config.table, callback);
            return channel;
          }),
          subscribe: vi.fn(() => channel),
        };
        return channel;
      }),
      removeChannel,
    };
    const onChange = vi.fn();

    const cleanup = createDashboardRealtimeSubscription(client, initialFilters, onChange);
    handlers.get("production_records")?.();
    handlers.get("quality_records")?.();

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(client.channel).toHaveBeenCalledTimes(2);
    cleanup();
    expect(removeChannel).toHaveBeenCalledTimes(2);
  });
});
