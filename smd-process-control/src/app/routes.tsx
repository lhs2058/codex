import { useState, type PropsWithChildren } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { LoginPage } from "../auth/LoginPage";
import { RequireRole, type AuthState } from "../auth/RequireRole";
import { AdminPage } from "../features/admin/AdminPage";
import { AnalysisPage } from "../features/analysis/AnalysisPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { ProductionEntryPage } from "../features/entry/ProductionEntryPage";
import { UploadPage } from "../features/upload/UploadPage";
import { useI18n, type TranslationKey } from "../i18n";
import type { DashboardFilters, DashboardSnapshot, MasterDataSnapshot } from "../domain/types";

const navItems: Array<{
  to: string;
  label: TranslationKey;
  icon: string;
  roles: Array<"viewer" | "operator" | "admin">;
}> = [
  { to: "/", label: "nav.dashboard", icon: "▦", roles: ["viewer", "operator", "admin"] },
  { to: "/analysis", label: "nav.analysis", icon: "⌁", roles: ["viewer", "operator", "admin"] },
  { to: "/entry", label: "nav.entry", icon: "＋", roles: ["operator", "admin"] },
  { to: "/upload", label: "nav.upload", icon: "⇧", roles: ["operator", "admin"] },
  { to: "/admin", label: "nav.admin", icon: "⚙", roles: ["admin"] },
];

function ApplicationShell({ auth, children }: PropsWithChildren<{ auth: AuthState }>) {
  const { error, language, setLanguage, t } = useI18n();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(true);
  const role = auth.profile?.role ?? "viewer";

  return <div className={`app-shell${menuOpen ? "" : " menu-collapsed"}`}>
    <button
      className="menu-toggle"
      type="button"
      aria-controls="application-sidebar"
      aria-expanded={menuOpen}
      onClick={() => setMenuOpen((open) => !open)}
    >
      {menuOpen ? t("app.menu.close") : t("app.menu.open")}
    </button>
    <aside className="dashboard-sidebar" id="application-sidebar">
      <NavLink className="dashboard-brand" to="/">
        <span aria-hidden="true" className="brand-mark">S</span>
        <span><strong>{t("app.name")}</strong><small>{t("app.subtitle")}</small></span>
      </NavLink>
      <nav aria-label={t("app.navigation")} className="dashboard-nav">
        {navItems.filter((item) => item.roles.includes(role)).map((item) =>
          <NavLink
            className={({ isActive }) => isActive ? "is-active" : undefined}
            end={item.to === "/"}
            key={item.to}
            to={item.to}
            aria-current={location.pathname === item.to ? "page" : undefined}
          >
            <span aria-hidden="true">{item.icon}</span> {t(item.label)}
          </NavLink>)}
      </nav>
      <label className="language-picker">
        <span>{t("app.language")}</span>
        <select value={language} onChange={(event) => setLanguage(event.target.value as "ko" | "vi")}>
          <option value="ko">{t("app.language.ko")}</option>
          <option value="vi">{t("app.language.vi")}</option>
        </select>
      </label>
      {error && <p role="alert" aria-live="assertive">{t("app.languageSaveError")}</p>}
      <p className="dashboard-sidebar-note">LIVE SYNC<br /><span>{t("app.live")}</span></p>
    </aside>
    <div className="app-content">{children}</div>
  </div>;
}

function Protected({
  auth,
  allow,
  children,
}: PropsWithChildren<{ auth: AuthState; allow: Array<"viewer" | "operator" | "admin"> }>) {
  return <RequireRole state={auth} allow={allow}>
    <ApplicationShell auth={auth}>{children}</ApplicationShell>
  </RequireRole>;
}

const responsiveMaster: MasterDataSnapshot = {
  models: [{ id: "model-1", code: "M-100", name: "M-100", active: true, version: 1 }],
  processes: [
    { id: "process-spi", code: "SPI", name: "SPI", active: true },
    { id: "process-aoi", code: "AOI", name: "AOI", active: true },
    { id: "process-xray", code: "XRAY", name: "X-ray", active: true },
    { id: "process-ict", code: "ICT", name: "ICT", active: true },
    { id: "process-router", code: "ROUTER", name: "Router", active: true },
  ],
  lines: [
    { id: "line-1", code: "L1", name: "Line 1", active: true },
    { id: "line-2", code: "L2", name: "Line 2", active: true },
    { id: "line-3", code: "L3", name: "Line 3", active: true },
  ],
  shifts: [{ id: "shift-day", code: "DAY", name: "Day", active: true }],
  timeSlots: [
    { id: "slot-a", shiftId: "shift-day", code: "A", startsAt: "08:00", endsAt: "09:00", endDayOffset: 0, sequence: 1 },
    { id: "slot-b", shiftId: "shift-day", code: "B", startsAt: "09:00", endsAt: "10:00", endDayOffset: 0, sequence: 2 },
  ],
  downtimeReasons: [{ id: "reason-1", code: "BREAK", name: "Breakdown", active: true, version: 1 }],
  standardTimes: [{ id: "st-1", modelId: "model-1", processId: "process-aoi", lineId: "line-1", secondsPerUnit: 10, effectiveFrom: "2026-01-01", effectiveTo: null }],
};

const responsiveFilters: DashboardFilters = {
  productionDate: "2026-07-28",
  shiftId: null,
  modelId: null,
  lineId: null,
  processCode: null,
};

const responsiveSnapshot: DashboardSnapshot = {
  totalActual: 12480,
  weightedYield: { status: "ok", value: 96.8 },
  weightedYieldTarget: 95,
  weightedUtilization: { status: "ok", value: 84.2 },
  attentionCount: 2,
  yields: responsiveMaster.processes.flatMap((process, processIndex) =>
    responsiveMaster.lines.map((line, lineIndex) => ({
      processCode: process.code,
      lineId: line.id,
      result: { status: "ok" as const, value: 88 + processIndex * 2 + lineIndex },
      targetPercent: 95,
    }))),
  utilization: responsiveMaster.lines.map((line, index) => ({
    lineId: line.id,
    result: { status: "ok" as const, value: 78 + index * 7 },
  })),
  downtime: [{ reasonId: "reason-1", reasonName: "Breakdown", minutes: 35 }],
  entryProgress: responsiveMaster.timeSlots.map((slot, index) => ({
    timeSlotId: slot.id,
    status: index === 0 ? "complete" as const : "in-progress" as const,
  })),
};

export function AppRoutes({ auth, responsiveTest = false }: { auth: AuthState; responsiveTest?: boolean }) {
  const dashboard = responsiveTest
    ? <DashboardPage
        embedded
        initialFilters={responsiveFilters}
        masterRepository={{ listMasterData: async () => responsiveMaster }}
        dashboardRepository={{ loadDashboard: async () => responsiveSnapshot, subscribeDashboard: () => () => undefined }}
      />
    : <DashboardPage embedded />;
  const entry = responsiveTest
    ? <ProductionEntryPage
        masterRepository={{ listMasterData: async () => responsiveMaster }}
        productionRepository={{ saveProductionRecord: async () => "responsive-record", listDashboardProduction: async () => [] }}
        qualityRepository={{ findExisting: async () => null }}
      />
    : <ProductionEntryPage />;
  return <div data-responsive-fixture={responsiveTest ? "true" : undefined}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/" element={<Protected auth={auth} allow={["operator", "admin", "viewer"]}>{dashboard}</Protected>} />
    <Route path="/analysis" element={<Protected auth={auth} allow={["operator", "admin", "viewer"]}><AnalysisPage embedded /></Protected>} />
    <Route path="/entry" element={<Protected auth={auth} allow={["operator", "admin"]}>{entry}</Protected>} />
    <Route path="/upload" element={<Protected auth={auth} allow={["operator", "admin"]}><UploadPage /></Protected>} />
    <Route path="/admin/*" element={<Protected auth={auth} allow={["admin"]}><AdminPage /></Protected>} />
    <Route path="*" element={<Protected auth={auth} allow={["operator", "admin", "viewer"]}><Navigate to="/" replace /></Protected>} />
  </Routes></div>;
}
