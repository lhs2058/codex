import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminPage } from "../../src/features/admin/AdminPage";
import type { MasterDataSnapshot } from "../../src/domain/types";

const snapshot: MasterDataSnapshot = {
  models: [], processes: [{ id: "p1", code: "SPI", name: "SPI", active: true }], lines: [{ id: "l1", code: "L1", name: "Line 1", active: true }], shifts: [], timeSlots: [],
  downtimeReasons: [{ id: "d1", code: "WAIT", name: "Wait", active: true, version: 1 }], standardTimes: [],
};

describe("AdminPage", () => {
  it("submits the selected ST dimensions and bounded end date", async () => {
    const saveStandardTime = vi.fn().mockResolvedValue({ id: "st" });
    const rich = { ...snapshot, models: [{ id: "m2", code: "M2", name: "M2", active: true, version: 1 }], processes: [...snapshot.processes, { id: "p2", code: "AOI" as const, name: "AOI", active: true }], lines: [...snapshot.lines, { id: "l2", code: "L2", name: "L2", active: true }] };
    render(<AdminPage repository={{ listMasterData: vi.fn().mockResolvedValue(rich), createModel: vi.fn(), deactivateDowntimeReason: vi.fn(), saveStandardTime }} createUser={vi.fn()} />);
    await screen.findByText("Wait");
    fireEvent.change(screen.getByLabelText("ST model"), { target: { value: "m2" } }); fireEvent.change(screen.getByLabelText("Process"), { target: { value: "p2" } }); fireEvent.change(screen.getByLabelText("Line"), { target: { value: "l2" } }); fireEvent.change(screen.getByLabelText("Seconds per unit"), { target: { value: "1.2" } }); fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "2026-01-01" } }); fireEvent.change(screen.getByLabelText("Effective to"), { target: { value: "2026-12-31" } }); fireEvent.click(screen.getByRole("button", { name: "Save standard time" }));
    await waitFor(() => expect(saveStandardTime).toHaveBeenCalledWith({ modelId: "m2", processId: "p2", lineId: "l2", secondsPerUnit: 1.2, effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" }));
  });
  it("adds a model, soft-disables a downtime reason, and refreshes after saving an ST", async () => {
    const listMasterData = vi.fn().mockResolvedValue(snapshot);
    const createModel = vi.fn().mockResolvedValue(undefined);
    const deactivateDowntimeReason = vi.fn().mockResolvedValue(undefined);
    const saveStandardTime = vi.fn().mockResolvedValue({ id: "st1" });
    render(<AdminPage repository={{ listMasterData, createModel, deactivateDowntimeReason, saveStandardTime }} createUser={vi.fn()} />);
    await screen.findByText("Wait");
    fireEvent.change(screen.getByLabelText("Model code"), { target: { value: "M-1" } });
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "Model One" } });
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    await waitFor(() => expect(createModel).toHaveBeenCalledWith({ code: "M-1", name: "Model One" }));
    fireEvent.click(screen.getByRole("button", { name: "Deactivate Wait" }));
    await waitFor(() => expect(deactivateDowntimeReason).toHaveBeenCalledWith("d1", 1));
    fireEvent.change(screen.getByLabelText("ST model"), { target: { value: "m1" } });
    fireEvent.change(screen.getByLabelText("Process"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText("Line"), { target: { value: "l1" } });
    fireEvent.change(screen.getByLabelText("Seconds per unit"), { target: { value: "0.82" } });
    fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save standard time" }));
    await waitFor(() => expect(saveStandardTime).toHaveBeenCalled());
    expect(listMasterData).toHaveBeenCalledTimes(4);
  });

  it("shows the overlap error and sends only the intended admin-create-user body", async () => {
    const createUser = vi.fn().mockResolvedValue({ id: "u1", employeeId: "1234", displayName: "Kim", role: "viewer" });
    const saveStandardTime = vi.fn().mockRejectedValue(new Error("overlapping-effective-period"));
    render(<AdminPage repository={{ listMasterData: vi.fn().mockResolvedValue(snapshot), createModel: vi.fn(), deactivateDowntimeReason: vi.fn(), saveStandardTime }} createUser={createUser} />);
    await screen.findByText("Wait");
    fireEvent.change(screen.getByLabelText("ST model"), { target: { value: "m1" } });
    fireEvent.change(screen.getByLabelText("Process"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText("Line"), { target: { value: "l1" } });
    fireEvent.change(screen.getByLabelText("Seconds per unit"), { target: { value: "0.82" } });
    fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save standard time" }));
    expect(await screen.findByText("Effective period overlaps an existing standard time.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Employee ID"), { target: { value: "1234" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Kim" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "a secure password" } });
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    await waitFor(() => expect(createUser).toHaveBeenCalledWith({ employeeId: "1234", displayName: "Kim", role: "viewer", temporaryPassword: "a secure password" }));
    expect(screen.queryByDisplayValue("a secure password")).not.toBeInTheDocument();
  });

  it("does not call mutations for invalid model or zero-second ST input", async () => {
    const createModel = vi.fn(); const saveStandardTime = vi.fn();
    render(<AdminPage repository={{ listMasterData: vi.fn().mockResolvedValue(snapshot), createModel, deactivateDowntimeReason: vi.fn(), saveStandardTime }} createUser={vi.fn()} />);
    await screen.findByText("Wait");
    fireEvent.change(screen.getByLabelText("Model code"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    expect(createModel).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("ST model"), { target: { value: "m1" } });
    fireEvent.change(screen.getByLabelText("Seconds per unit"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save standard time" }));
    expect(saveStandardTime).not.toHaveBeenCalled();
  });
});
