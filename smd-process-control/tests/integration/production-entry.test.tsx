import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductionEntryPage } from "../../src/features/entry/ProductionEntryPage";
import type { MasterDataSnapshot } from "../../src/domain/types";
const master: MasterDataSnapshot = { models: [{ id: "m", code: "M", name: "Model", active: true, version: 1 }], processes: [{ id: "p", code: "AOI", name: "AOI", active: true }], lines: [{ id: "l", code: "L", name: "Line", active: true, version: 1 }], shifts: [{ id: "s", code: "D", name: "Day", active: true, version: 1 }], timeSlots: [{ id: "t", shiftId: "s", code: "A", startsAt: "08:00", endsAt: "09:00", endDayOffset: 0, sequence: 1 }], downtimeReasons: [{ id: "d", code: "BD", name: "Breakdown", active: true, version: 1 }], standardTimes: [{ id: "st", modelId: "m", processId: "p", lineId: "l", secondsPerUnit: 10, effectiveFrom: "2026-01-01", effectiveTo: null }] };
const existing = {
  id: "existing-record",
  productionDate: "2026-07-28",
  shiftId: "s",
  timeSlotId: "t",
  lineId: "l",
  modelId: "m",
  processId: "p",
  inputQty: 8,
  actualQty: 7,
  okQty: 7,
  ngQty: 1,
  note: "loaded note",
  downtime: [{ reasonId: "d", minutes: 5, note: "loaded downtime" }],
  version: 4,
  downtimeMinutes: 5,
};
async function selectNaturalKey() {
  await screen.findByLabelText("Shift");
  for (const [label, value] of [["Production date", "2026-07-28"], ["Shift", "s"], ["Time slot", "t"], ["Line", "l"], ["Model", "m"], ["Process", "p"]] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  await waitFor(() => expect(screen.getByTestId("production-entry-form")).toHaveAttribute("data-record-state", "existing"));
}
describe("ProductionEntryPage", () => {
  it("shows preview and prevents double submit", async () => {
    let resolve!: (value: string) => void; const saveProductionRecord = vi.fn().mockImplementation(() => new Promise<string>((done) => { resolve = done; }));
    render(<ProductionEntryPage masterRepository={{ listMasterData: vi.fn().mockResolvedValue(master) }} productionRepository={{ saveProductionRecord }} qualityRepository={{ findExisting: vi.fn().mockResolvedValue(null) }} />);
    await screen.findByLabelText("Shift");
    for (const [label, value] of [["Production date", "2026-07-28"], ["Shift", "s"], ["Time slot", "t"], ["Line", "l"], ["Model", "m"], ["Process", "p"], ["Input", "10"], ["Actual", "9"], ["OK", "9"], ["NG", "1"]] as const) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(await screen.findByText("Standard time: 10 sec/unit")).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: "Save" }); fireEvent.click(saveButton); fireEvent.click(saveButton);
    await waitFor(() => expect(saveProductionRecord).toHaveBeenCalledTimes(1));
    expect(saveProductionRecord).toHaveBeenCalledWith(expect.not.objectContaining({ id: expect.anything() }), 0);
    await act(async () => { resolve("r1"); });
  });
  it("loads an existing record, submits its exact version, and advances local version after save", async () => {
    const saveProductionRecord = vi.fn().mockResolvedValue(existing.id);
    const findExisting = vi.fn().mockResolvedValue(existing);
    render(<ProductionEntryPage
      masterRepository={{ listMasterData: vi.fn().mockResolvedValue(master) }}
      productionRepository={{ saveProductionRecord }}
      qualityRepository={{ findExisting }}
    />);
    await selectNaturalKey();
    await waitFor(() => expect(screen.getByLabelText("Input")).toHaveValue(8));
    expect(screen.getByLabelText("Note")).toHaveValue("loaded note");
    expect(screen.getByLabelText("Downtime minutes 1")).toHaveValue(5);
    expect(screen.getByTestId("production-entry-form")).toHaveAttribute("data-record-id", existing.id);
    expect(screen.getByTestId("production-entry-form")).toHaveAttribute("data-record-version", "4");

    fireEvent.change(screen.getByLabelText("Input"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Actual"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("OK"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("NG"), { target: { value: "0" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });

    await waitFor(() => expect(saveProductionRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: existing.id, inputQty: 10, actualQty: 9, okQty: 9 }),
      4,
    ));
    await waitFor(() => expect(screen.getByTestId("production-entry-form")).toHaveAttribute("data-record-version", "5"));
    expect(screen.getByLabelText("Input")).toHaveValue(10);
  });
  it("preserves draft and shows Korean conflict message and comparison", async () => {
    const current = { ...existing, inputQty: 12, actualQty: 11, okQty: 11, ngQty: 1, version: 5 };
    const findExisting = vi.fn()
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(current);
    const saveProductionRecord = vi.fn().mockRejectedValue({ code: "40001" });
    render(<ProductionEntryPage masterRepository={{ listMasterData: vi.fn().mockResolvedValue(master) }} productionRepository={{ saveProductionRecord }} qualityRepository={{ findExisting }} />);
    await selectNaturalKey();
    await waitFor(() => expect(screen.getByLabelText("Input")).toHaveValue(8));
    fireEvent.change(screen.getByLabelText("Input"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Actual"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("OK"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("NG"), { target: { value: "0" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(await screen.findByText("다른 사용자가 수정했습니다")).toBeInTheDocument();
    expect(saveProductionRecord).toHaveBeenCalledWith(expect.objectContaining({ id: existing.id, inputQty: 10 }), 4);
    expect(screen.getByRole("heading", { name: "Draft" })).toBeInTheDocument();
    expect(screen.getByText("Current record")).toBeInTheDocument();
    expect(screen.getByLabelText("Input")).toHaveValue(10);
    expect(screen.getByTestId("production-entry-form")).toHaveAttribute("data-record-version", "4");
    expect(screen.getAllByText("D — Day")).toHaveLength(2);
    expect(findExisting).toHaveBeenCalledTimes(2);
  });
});
