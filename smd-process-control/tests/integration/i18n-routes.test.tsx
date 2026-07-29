import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../../src/app/routes";
import type { AuthState } from "../../src/auth/RequireRole";
import type { MasterDataSnapshot } from "../../src/domain/types";
import { ProductionEntryForm } from "../../src/features/entry/ProductionEntryForm";
import { UploadReviewTable } from "../../src/features/upload/UploadReviewTable";
import { I18nProvider, resolveBrowserLanguage, useI18n } from "../../src/i18n";
import { ko } from "../../src/i18n/ko";
import { vi as vietnamese } from "../../src/i18n/vi";

const session = { user: { id: "user-1" } } as Session;
const viewer: AuthState = {
  status: "ready",
  session,
  profile: { role: "viewer", isActive: true, language: "vi" },
};
const admin: AuthState = {
  status: "ready",
  session,
  profile: { role: "admin", isActive: true, language: "ko" },
};

const master: MasterDataSnapshot = {
  models: [{ id: "model-1", code: "M1", name: "Model 1", active: true, version: 1 }],
  processes: [{ id: "process-1", code: "AOI", name: "AOI", active: true }],
  lines: [{ id: "line-1", code: "L1", name: "Line 1", active: true, version: 1 }],
  shifts: [{ id: "shift-1", code: "D", name: "Day", active: true, version: 1 }],
  timeSlots: [{ id: "slot-1", shiftId: "shift-1", code: "A", startsAt: "08:00", endsAt: "09:00", endDayOffset: 0, sequence: 1 }],
  downtimeReasons: [{ id: "reason-1", code: "BREAK", name: "Breakdown", active: true, version: 1 }],
  standardTimes: [],
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function TranslationProbe() {
  const { t } = useI18n();
  return <p>{t("entry.save")}</p>;
}

function LanguageProbe() {
  const { error, language, setLanguage, t } = useI18n();
  return <>
    <button type="button" onClick={() => setLanguage("vi")}>{language}</button>
    {error && <p role="alert">{t("app.languageSaveError")}</p>}
  </>;
}

describe("bilingual route shell", () => {
  it("keeps the Vietnamese dictionary exactly key-complete with Korean", () => {
    expect(Object.keys(vietnamese).sort()).toEqual(Object.keys(ko).sort());
    expect(ko["process.xray"]).toBe("X-ray");
    expect(vietnamese["entry.save"]).toBe("Lưu");
  });

  it("uses Vietnamese browser preference before login", () => {
    expect(resolveBrowserLanguage(["vi-VN", "en-US"])).toBe("vi");
    render(<I18nProvider browserLanguages={["vi-VN"]}><TranslationProbe /></I18nProvider>);
    expect(screen.getByText("Lưu")).toBeInTheDocument();
  });

  it("marks the current route, hides admin navigation, and guards the admin URL for viewers", async () => {
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <I18nProvider profileLanguage="vi">
          <AppRoutes auth={viewer} />
          <LocationProbe />
        </I18nProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/"));
    expect(screen.queryByRole("link", { name: "Quản trị" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bảng điều khiển" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps operational admin subroutes inside the admin guard", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/audit"]}>
        <I18nProvider profileLanguage="ko">
          <AppRoutes auth={admin} />
          <LocationProbe />
        </I18nProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/audit"));
    expect(screen.getByRole("heading", { name: "기준정보 관리" })).toBeInTheDocument();
  });

  it("rolls back the picker and exposes a localized error when persistence fails", async () => {
    render(
      <I18nProvider profileLanguage="ko" onLanguageChange={() => Promise.reject(new Error("offline"))}>
        <LanguageProbe />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "ko" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "ko" })).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(ko["app.languageSaveError"]);
  });

  it("localizes all upload status labels without exposing internal enum values", () => {
    const baseRow = {
      sourceSheet: "Production",
      productionDate: "2026-07-28",
      shiftCode: "D",
      timeSlotCode: "A",
      lineCode: "L1",
      modelCode: "M1",
      processCode: "AOI" as const,
      inputQty: 1,
      actualQty: 1,
      okQty: 1,
      ngQty: 0,
      downtimeMinutes: 0,
      downtimeReasonCode: null,
      note: "",
      messages: [],
    };
    render(<I18nProvider profileLanguage="vi"><UploadReviewTable review={{
      batchId: "batch-1",
      newCount: 1,
      conflictCount: 1,
      errorCount: 2,
      unknownMasterDataCount: 0,
      rows: [
        { ...baseRow, sourceRow: 2, status: "new" },
        { ...baseRow, sourceRow: 3, status: "conflict" },
        { ...baseRow, sourceRow: 4, status: "error" },
      ],
      diagnostics: [{ sourceSheet: "Production", sourceRow: 5, messages: ["bad row"] }],
    }} /></I18nProvider>);

    expect(screen.getByText(vietnamese["upload.statusNew"])).toBeInTheDocument();
    expect(screen.getByText(vietnamese["upload.statusConflict"])).toBeInTheDocument();
    expect(screen.getAllByText(vietnamese["upload.statusError"])).toHaveLength(2);
    for (const internal of ["new", "conflict", "error"]) {
      expect(screen.queryByText(internal, { exact: true })).not.toBeInTheDocument();
    }
    expect(ko["upload.statusNew"]).toBe("신규");
    expect(ko["upload.statusConflict"]).toBe("중복");
    expect(ko["upload.statusError"]).toBe("오류");
  });
});

describe("production entry accessibility", () => {
  it("focuses the first invalid control and announces validation after a failed save", () => {
    render(
      <ProductionEntryForm
        masterData={master}
        repository={{ saveProductionRecord: vi.fn() }}
        onConflict={vi.fn()}
      />,
    );

    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form")!);

    expect(screen.getByRole("alert")).toHaveTextContent("required");
    expect(screen.getByLabelText("Production date")).toHaveFocus();
  });

  function fillRequiredEntryFields() {
    fireEvent.change(screen.getByLabelText("Production date"), { target: { value: "2026-07-28" } });
    fireEvent.change(screen.getByLabelText("Shift"), { target: { value: "shift-1" } });
    fireEvent.change(screen.getByLabelText("Time slot"), { target: { value: "slot-1" } });
    fireEvent.change(screen.getByLabelText("Line"), { target: { value: "line-1" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "model-1" } });
    fireEvent.change(screen.getByLabelText("Process"), { target: { value: "process-1" } });
  }

  it("marks and focuses an invalid downtime reason control", () => {
    render(<ProductionEntryForm masterData={master} repository={{ saveProductionRecord: vi.fn() }} onConflict={vi.fn()} />);
    fillRequiredEntryFields();
    fireEvent.click(screen.getByRole("button", { name: "Add downtime" }));

    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form")!);

    const reason = screen.getByLabelText("Downtime reason 1");
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(reason).toHaveAttribute("aria-describedby", "entry-validation-error");
    expect(reason).toHaveFocus();
  });

  it("marks and focuses downtime minutes when total downtime exceeds the slot", () => {
    render(<ProductionEntryForm masterData={master} repository={{ saveProductionRecord: vi.fn() }} onConflict={vi.fn()} />);
    fillRequiredEntryFields();
    fireEvent.click(screen.getByRole("button", { name: "Add downtime" }));
    fireEvent.change(screen.getByLabelText("Downtime reason 1"), { target: { value: "reason-1" } });
    fireEvent.change(screen.getByLabelText("Downtime minutes 1"), { target: { value: "61" } });

    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form")!);

    const minutes = screen.getByLabelText("Downtime minutes 1");
    expect(minutes).toHaveAttribute("aria-invalid", "true");
    expect(minutes).toHaveAttribute("aria-describedby", "entry-validation-error");
    expect(minutes).toHaveFocus();
  });
});
