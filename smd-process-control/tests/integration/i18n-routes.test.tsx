import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../../src/app/routes";
import type { AuthState } from "../../src/auth/RequireRole";
import type { MasterDataSnapshot } from "../../src/domain/types";
import { ProductionEntryForm } from "../../src/features/entry/ProductionEntryForm";
import { I18nProvider, resolveBrowserLanguage, useI18n } from "../../src/i18n";
import { ko } from "../../src/i18n/ko";
import { vi as vietnamese } from "../../src/i18n/vi";

const session = { user: { id: "user-1" } } as Session;
const viewer: AuthState = {
  status: "ready",
  session,
  profile: { role: "viewer", isActive: true, language: "vi" },
};

const master: MasterDataSnapshot = {
  models: [{ id: "model-1", code: "M1", name: "Model 1", active: true, version: 1 }],
  processes: [{ id: "process-1", code: "AOI", name: "AOI", active: true }],
  lines: [{ id: "line-1", code: "L1", name: "Line 1", active: true, version: 1 }],
  shifts: [{ id: "shift-1", code: "D", name: "Day", active: true, version: 1 }],
  timeSlots: [{ id: "slot-1", shiftId: "shift-1", code: "A", startsAt: "08:00", endsAt: "09:00", endDayOffset: 0, sequence: 1 }],
  downtimeReasons: [],
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
});
