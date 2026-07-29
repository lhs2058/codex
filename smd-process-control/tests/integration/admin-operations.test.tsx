import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createMasterDataRepository,
  type AdminOverview,
  type MasterDataClient,
  type MasterDataRepository,
} from "../../src/data/repositories/master-data-repository";
import type { MasterDataSnapshot } from "../../src/domain/types";
import { AdminPage } from "../../src/features/admin/AdminPage";

const snapshot: MasterDataSnapshot = {
  models: [{ id: "model-1", code: "MODEL-1", name: "Model 1", active: true, version: 3 }],
  processes: [{ id: "process-aoi", code: "AOI", name: "AOI", active: true, version: 2 }],
  lines: [{ id: "line-1", code: "LINE-1", name: "Line 1", active: true, version: 4 }],
  shifts: [{ id: "shift-1", code: "DAY", name: "Day", active: true, version: 2 }],
  timeSlots: [{
    id: "slot-1",
    shiftId: "shift-1",
    code: "A",
    startsAt: "08:00",
    endsAt: "09:00",
    endDayOffset: 0,
    sequence: 1,
    active: true,
    version: 5,
  }],
  downtimeReasons: [{ id: "reason-1", code: "WAIT", name: "Waiting", active: false, version: 6 }],
  standardTimes: [],
};

const overview: AdminOverview = {
  masters: {
    model: snapshot.models,
    process: snapshot.processes,
    line: snapshot.lines,
    shift: snapshot.shifts,
    time_slot: snapshot.timeSlots,
    downtime_reason: snapshot.downtimeReasons,
    yield_target: [{
      id: "target-1",
      modelId: null,
      processId: "process-aoi",
      lineId: null,
      targetPercent: 97,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      active: true,
      version: 1,
    }],
    standard_time: [{
      id: "standard-time-1",
      modelId: "model-1",
      processId: "process-aoi",
      lineId: "line-1",
      secondsPerUnit: 2.5,
      effectiveFrom: "2099-01-01",
      effectiveTo: null,
      active: true,
      version: 9,
    }],
  },
  profiles: [{
    id: "user-1",
    employeeId: "1001",
    displayName: "Operator One",
    role: "operator",
    active: true,
    version: 2,
  }],
  uploads: [{
    id: "upload-1",
    fileName: "source.xlsx",
    storagePath: "uploads/admin/source.xlsx",
    workbookKind: "standard",
    status: "committed",
    createdAt: "2026-07-28T00:00:00Z",
  }],
  audits: [{
    id: "audit-1",
    actorId: "admin-1",
    tableName: "models",
    recordId: "model-1",
    action: "update",
    before: { name: "Old" },
    after: { name: "Model 1" },
    createdAt: "2026-07-28T00:01:00Z",
  }],
  production: [{
    id: "production-1",
    productionDate: "2026-07-28",
    lineId: "line-1",
    modelId: "model-1",
    processId: "process-aoi",
    actualQty: 10,
    version: 7,
  }],
};

describe("admin hardened repository", () => {
  it("routes every privileged mutation through hardened RPCs with optimistic versions", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://storage.example/original" },
      error: null,
    });
    const rpc = vi.fn(async (name: string) => {
      if (name === "admin_list_operational_data") return { data: overview, error: null };
      return { data: { id: "result-id", version: 8 }, error: null };
    });
    const repository = createMasterDataRepository({
      rpc,
      from: vi.fn(() => { throw new Error("direct DML must not be used"); }),
      storage: { from: vi.fn().mockReturnValue({ createSignedUrl }) },
    } as unknown as MasterDataClient);

    await expect(repository.listAdminOverview()).resolves.toEqual(overview);
    await repository.manageConfiguration({
      entity: "line",
      action: "update",
      id: "line-1",
      expectedVersion: 4,
      values: { code: "LINE-1", name: "Line One" },
    });
    await repository.manageProfile({
      profileId: "user-1",
      role: "viewer",
      active: false,
      expectedVersion: 2,
    });
    await repository.softDeleteProduction("production-1", 7);
    await expect(repository.createUploadOriginalUrl("uploads/admin/source.xlsx")).resolves.toBe(
      "https://storage.example/original",
    );

    expect(rpc).toHaveBeenCalledWith("admin_manage_configuration", {
      p_entity: "line",
      p_action: "update",
      p_record_id: "line-1",
      p_expected_version: 4,
      p_values: { code: "LINE-1", name: "Line One" },
    });
    expect(rpc).toHaveBeenCalledWith("admin_manage_profile", {
      p_profile_id: "user-1",
      p_role: "viewer",
      p_is_active: false,
      p_expected_version: 2,
    });
    expect(rpc).toHaveBeenCalledWith("admin_soft_delete_production", {
      p_record_id: "production-1",
      p_expected_version: 7,
    });
    expect(createSignedUrl).toHaveBeenCalledWith("uploads/admin/source.xlsx", 60);
  });
});

describe("admin operational workspace", () => {
  it("configures every operational entity and exposes audit/original inspection", async () => {
    const manageConfiguration = vi.fn().mockResolvedValue({ id: "created", version: 1 });
    const repository: MasterDataRepository = {
      listMasterData: vi.fn().mockResolvedValue(snapshot),
      listAdminOverview: vi.fn().mockResolvedValue(overview),
      manageConfiguration,
      manageProfile: vi.fn(),
      softDeleteProduction: vi.fn(),
      createUploadOriginalUrl: vi.fn(),
      createModel: vi.fn(),
      deactivateDowntimeReason: vi.fn(),
      saveStandardTime: vi.fn(),
    };
    render(<AdminPage repository={repository} createUser={vi.fn()} />);

    const type = await screen.findByLabelText("Configuration type");
    expect(within(type).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Models", "Lines", "Processes", "Shifts", "Time slots", "Downtime reasons", "Yield targets",
      "Standard times",
    ]);
    fireEvent.change(type, { target: { value: "line" } });
    fireEvent.change(screen.getByLabelText("Configuration code"), { target: { value: "LINE-2" } });
    fireEvent.change(screen.getByLabelText("Configuration name"), { target: { value: "Line 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create configuration" }));
    await waitFor(() => expect(manageConfiguration).toHaveBeenCalledWith({
      entity: "line",
      action: "create",
      id: null,
      expectedVersion: null,
      values: { code: "LINE-2", name: "Line 2" },
    }));

    expect(screen.getByRole("region", { name: "Upload originals" })).toHaveTextContent(
      "source.xlsxuploads/admin/source.xlsxcommitted",
    );
    expect(screen.getByRole("region", { name: "Audit history" })).toHaveTextContent(
      "admin-12026-07-28T00:01:00ZmodelsupdateOldModel 1",
    );
  });

  it("opens a short-lived admin URL for an upload original", async () => {
    const createUploadOriginalUrl = vi.fn().mockResolvedValue("https://storage.example/original");
    const replace = vi.fn();
    const popup = { opener: window, location: { replace }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const repository: MasterDataRepository = {
      listMasterData: vi.fn().mockResolvedValue(snapshot),
      listAdminOverview: vi.fn().mockResolvedValue(overview),
      manageConfiguration: vi.fn(),
      manageProfile: vi.fn(),
      softDeleteProduction: vi.fn(),
      createUploadOriginalUrl,
      createModel: vi.fn(),
      deactivateDowntimeReason: vi.fn(),
      saveStandardTime: vi.fn(),
    };
    render(<AdminPage repository={repository} createUser={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Inspect original source.xlsx" }));

    await waitFor(() => expect(createUploadOriginalUrl).toHaveBeenCalledWith(
      "uploads/admin/source.xlsx",
    ));
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(popup.opener).toBeNull();
    expect(replace).toHaveBeenCalledWith("https://storage.example/original");
    open.mockRestore();
  });

  it("updates and deactivates an existing standard time with its reviewed version", async () => {
    const manageConfiguration = vi.fn().mockResolvedValue({ id: "standard-time-1", version: 10 });
    const repository: MasterDataRepository = {
      listMasterData: vi.fn().mockResolvedValue(snapshot),
      listAdminOverview: vi.fn().mockResolvedValue(overview),
      manageConfiguration,
      manageProfile: vi.fn(),
      softDeleteProduction: vi.fn(),
      createUploadOriginalUrl: vi.fn(),
      createModel: vi.fn(),
      deactivateDowntimeReason: vi.fn(),
      saveStandardTime: vi.fn(),
    };
    render(<AdminPage repository={repository} createUser={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText("Configuration type"), {
      target: { value: "standard_time" },
    });
    const operations = screen.getByRole("region", { name: "Operational configuration" });
    fireEvent.click(within(operations).getByRole("button", { name: "Edit ST 2.5s" }));
    fireEvent.change(within(operations).getByRole("spinbutton"), { target: { value: "2.75" } });
    fireEvent.click(within(operations).getByRole("button", { name: "Update configuration" }));

    await waitFor(() => expect(manageConfiguration).toHaveBeenCalledWith({
      entity: "standard_time",
      action: "update",
      id: "standard-time-1",
      expectedVersion: 9,
      values: {
        model_id: "model-1",
        process_id: "process-aoi",
        line_id: "line-1",
        seconds_per_unit: 2.75,
        effective_from: "2099-01-01",
        effective_to: null,
      },
    }));

    fireEvent.click(within(operations).getByRole("button", { name: "Deactivate ST 2.5s" }));
    await waitFor(() => expect(manageConfiguration).toHaveBeenCalledWith({
      entity: "standard_time",
      action: "deactivate",
      id: "standard-time-1",
      expectedVersion: 9,
      values: {},
    }));
  });

  it("reactivates an inactive standard time with its reviewed version", async () => {
    const manageConfiguration = vi.fn().mockResolvedValue({ id: "standard-time-1", version: 11 });
    const inactiveOverview: AdminOverview = {
      ...overview,
      masters: {
        ...overview.masters,
        standard_time: [{
          ...overview.masters.standard_time[0]!,
          active: false,
          version: 10,
        }],
      },
    };
    const repository: MasterDataRepository = {
      listMasterData: vi.fn().mockResolvedValue(snapshot),
      listAdminOverview: vi.fn().mockResolvedValue(inactiveOverview),
      manageConfiguration,
      manageProfile: vi.fn(),
      softDeleteProduction: vi.fn(),
      createUploadOriginalUrl: vi.fn(),
      createModel: vi.fn(),
      deactivateDowntimeReason: vi.fn(),
      saveStandardTime: vi.fn(),
    };
    render(<AdminPage repository={repository} createUser={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText("Configuration type"), {
      target: { value: "standard_time" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reactivate ST 2.5s" }));

    await waitFor(() => expect(manageConfiguration).toHaveBeenCalledWith({
      entity: "standard_time",
      action: "reactivate",
      id: "standard-time-1",
      expectedVersion: 10,
      values: {},
    }));
  });

  it("does not offer in-place editing for a standard time that has taken effect", async () => {
    const historicalOverview: AdminOverview = {
      ...overview,
      masters: {
        ...overview.masters,
        standard_time: [{
          ...overview.masters.standard_time[0]!,
          effectiveFrom: "2020-01-01",
        }],
      },
    };
    const repository: MasterDataRepository = {
      listMasterData: vi.fn().mockResolvedValue(snapshot),
      listAdminOverview: vi.fn().mockResolvedValue(historicalOverview),
      manageConfiguration: vi.fn(),
      manageProfile: vi.fn(),
      softDeleteProduction: vi.fn(),
      createUploadOriginalUrl: vi.fn(),
      createModel: vi.fn(),
      deactivateDowntimeReason: vi.fn(),
      saveStandardTime: vi.fn(),
    };
    render(<AdminPage repository={repository} createUser={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText("Configuration type"), {
      target: { value: "standard_time" },
    });

    expect(screen.queryByRole("button", { name: "Edit ST 2.5s" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate ST 2.5s" })).toBeEnabled();
  });

  it("reactivates masters, changes/deactivates users, and soft-deletes production", async () => {
    const manageConfiguration = vi.fn().mockResolvedValue({ id: "reason-1", version: 7 });
    const manageProfile = vi.fn().mockResolvedValue({ id: "user-1", version: 3 });
    const softDeleteProduction = vi.fn().mockResolvedValue({ id: "production-1", version: 8 });
    const repository: MasterDataRepository = {
      listMasterData: vi.fn().mockResolvedValue(snapshot),
      listAdminOverview: vi.fn().mockResolvedValue(overview),
      manageConfiguration,
      manageProfile,
      softDeleteProduction,
      createUploadOriginalUrl: vi.fn(),
      createModel: vi.fn(),
      deactivateDowntimeReason: vi.fn(),
      saveStandardTime: vi.fn(),
    };
    render(<AdminPage repository={repository} createUser={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText("Configuration type"), { target: { value: "downtime_reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Reactivate Waiting" }));
    await waitFor(() => expect(manageConfiguration).toHaveBeenCalledWith({
      entity: "downtime_reason",
      action: "reactivate",
      id: "reason-1",
      expectedVersion: 6,
      values: {},
    }));

    fireEvent.change(screen.getByLabelText("Role for Operator One"), { target: { value: "viewer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save role for Operator One" }));
    await waitFor(() => expect(manageProfile).toHaveBeenNthCalledWith(1, {
      profileId: "user-1",
      role: "viewer",
      active: true,
      expectedVersion: 2,
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Deactivate Operator One" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Deactivate Operator One" }));
    await waitFor(() => expect(manageProfile).toHaveBeenNthCalledWith(2, {
      profileId: "user-1",
      role: "operator",
      active: false,
      expectedVersion: 2,
    }));

    fireEvent.click(screen.getByRole("button", { name: "Delete production production-1" }));
    await waitFor(() => expect(softDeleteProduction).toHaveBeenCalledWith("production-1", 7));
  });
});
