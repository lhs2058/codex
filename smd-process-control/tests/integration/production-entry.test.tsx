import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductionEntryPage } from "../../src/features/entry/ProductionEntryPage";
import type { MasterDataSnapshot } from "../../src/domain/types";
const master: MasterDataSnapshot = { models: [{ id: "m", code: "M", name: "Model", active: true, version: 1 }], processes: [{ id: "p", code: "AOI", name: "AOI", active: true }], lines: [{ id: "l", code: "L", name: "Line", active: true, version: 1 }], shifts: [{ id: "s", code: "D", name: "Day", active: true, version: 1 }], timeSlots: [{ id: "t", shiftId: "s", code: "A", startsAt: "08:00", endsAt: "09:00", endDayOffset: 0, sequence: 1 }], downtimeReasons: [{ id: "d", code: "BD", name: "Breakdown", active: true, version: 1 }], standardTimes: [{ id: "st", modelId: "m", processId: "p", lineId: "l", secondsPerUnit: 10, effectiveFrom: "2026-01-01", effectiveTo: null }] };
describe("ProductionEntryPage", () => {
  it("shows preview and prevents double submit", async () => {
    let resolve!: (value: string) => void; const saveProductionRecord = vi.fn().mockImplementation(() => new Promise<string>((done) => { resolve = done; }));
    render(<ProductionEntryPage masterRepository={{ listMasterData: vi.fn().mockResolvedValue(master) }} productionRepository={{ saveProductionRecord }} />);
    await screen.findByLabelText("Shift");
    for (const [label, value] of [["Production date", "2026-07-28"], ["Shift", "s"], ["Time slot", "t"], ["Line", "l"], ["Model", "m"], ["Process", "p"], ["Input", "10"], ["Actual", "9"], ["OK", "9"], ["NG", "1"]] as const) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(await screen.findByText("Standard time: 10 sec/unit")).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: "Save" }); fireEvent.click(saveButton); fireEvent.click(saveButton);
    await waitFor(() => expect(saveProductionRecord).toHaveBeenCalledTimes(1)); resolve("r1");
  });
  it("preserves draft and shows Korean conflict message and comparison", async () => {
    render(<ProductionEntryPage masterRepository={{ listMasterData: vi.fn().mockResolvedValue(master) }} productionRepository={{ saveProductionRecord: vi.fn().mockRejectedValue({ code: "40001" }) }} qualityRepository={{ findExisting: vi.fn().mockResolvedValue({ id: "old", inputQty: 8, actualQty: 7, okQty: 7, ngQty: 1, version: 2 }) }} />);
    await screen.findByLabelText("Shift");
    for (const [label, value] of [["Production date", "2026-07-28"], ["Shift", "s"], ["Time slot", "t"], ["Line", "l"], ["Model", "m"], ["Process", "p"], ["Input", "10"], ["Actual", "9"], ["OK", "9"], ["NG", "1"]] as const) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("다른 사용자가 수정했습니다")).toBeInTheDocument(); expect(screen.getByText("Existing input: 8")).toBeInTheDocument(); expect(screen.getByLabelText("Input")).toHaveValue(10);
  });
});
