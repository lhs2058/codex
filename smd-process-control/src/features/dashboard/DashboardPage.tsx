import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardFilters, DashboardSnapshot, MasterDataSnapshot, MetricResult, ProcessCode } from "../../domain/types";
import { createMasterDataRepository, type MasterDataRepository } from "../../data/repositories/master-data-repository";
import {
  createDashboardRepository,
  loadDashboard,
  subscribeDashboard,
  type DashboardRepository,
} from "../../data/repositories/dashboard-repository";
import { EntryProgress } from "./EntryProgress";
import { UtilizationBars } from "./UtilizationBars";
import { YieldMatrix } from "./YieldMatrix";
import { useI18n } from "../../i18n";

function bangkokDate(): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

const defaultFilters = (): DashboardFilters => ({
  productionDate: bangkokDate(),
  shiftId: null,
  modelId: null,
  lineId: null,
  processCode: null,
});

function metric(result: MetricResult): string {
  return result.status === "ok" ? `${result.value.toFixed(1)}%` : "—";
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

export interface DashboardPageProps {
  initialFilters?: DashboardFilters;
  masterRepository?: Pick<MasterDataRepository, "listMasterData">;
  dashboardRepository?: DashboardRepository;
  embedded?: boolean;
}

export { loadDashboard, subscribeDashboard };

export function DashboardPage({
  initialFilters = defaultFilters(),
  masterRepository,
  dashboardRepository,
  embedded = false,
}: DashboardPageProps) {
  const { language, t } = useI18n();
  const masterRef = useRef<Pick<MasterDataRepository, "listMasterData"> | null>(masterRepository ?? null);
  const dashboardRef = useRef<DashboardRepository | null>(dashboardRepository ?? null);
  const [master, setMaster] = useState<MasterDataSnapshot | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>(initialFilters);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let current = true;
    try {
      masterRef.current ??= createMasterDataRepository();
    } catch {
      setError(t("dashboard.connectionError"));
      setLoading(false);
      return () => { current = false; };
    }
    masterRef.current.listMasterData()
      .then((value) => { if (current) setMaster(value); })
      .catch(() => { if (current) setError(t("dashboard.masterError")); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    try {
      dashboardRef.current ??= createDashboardRepository();
    } catch {
      setError(t("dashboard.connectionError"));
      setLoading(false);
      return () => { current = false; };
    }
    dashboardRef.current.loadDashboard(filters)
      .then((value) => {
        if (!current) return;
        setSnapshot(value);
        setLoading(false);
      })
      .catch(() => {
        if (!current) return;
        setError(t("dashboard.loadError"));
        setLoading(false);
      });
    return () => { current = false; };
  }, [filters, refresh]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      dashboardRef.current ??= createDashboardRepository();
    } catch {
      setError(t("dashboard.connectionError"));
      return;
    }
    const cleanup = dashboardRef.current.subscribeDashboard(filters, () => {
      if (!active) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setRefresh((value) => value + 1), 500);
    });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      cleanup();
    };
  }, [filters]);

  const setFilter = useCallback(<K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const content = <main className="dashboard-main">
    <header className="dashboard-topbar">
      <div><p className="dashboard-eyebrow">SMD PROCESS CONTROL</p><h1>{t("dashboard.title")}</h1><p>{t("dashboard.description")}</p></div>
      <span className="dashboard-live"><i aria-hidden="true" /> LIVE</span>
    </header>

    {master && <form className="dashboard-filters" aria-label={t("dashboard.filters")} onSubmit={(event) => event.preventDefault()}>
      <label>{t("filter.productionDate")}<input type="date" value={filters.productionDate} onChange={(event) => setFilter("productionDate", event.target.value)} /></label>
      <label>{t("common.shift")}<select value={filters.shiftId ?? ""} onChange={(event) => setFilter("shiftId", event.target.value || null)}><option value="">{t("common.all")}</option>{master.shifts.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>{t("common.model")}<select value={filters.modelId ?? ""} onChange={(event) => setFilter("modelId", event.target.value || null)}><option value="">{t("common.all")}</option>{master.models.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
      <label>{t("common.line")}<select value={filters.lineId ?? ""} onChange={(event) => setFilter("lineId", event.target.value || null)}><option value="">{t("common.all")}</option>{master.lines.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>{t("common.process")}<select value={filters.processCode ?? ""} onChange={(event) => setFilter("processCode", (event.target.value || null) as ProcessCode | null)}><option value="">{t("common.all")}</option>{master.processes.filter((item) => item.active).map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></label>
    </form>}

    {error && <p className="dashboard-error" role="alert">{error}</p>}
    {loading && !snapshot && <p className="dashboard-loading" role="status" aria-live="polite">{t("dashboard.loading")}</p>}
    {snapshot && master && <>
      <section className="dashboard-kpis" aria-label={t("kpi.region")}>
        <article><span aria-hidden="true" className="kpi-icon is-blue">▤</span><div><p>{t("kpi.totalActual")}</p><strong>{new Intl.NumberFormat(language === "vi" ? "vi-VN" : "ko-KR").format(snapshot.totalActual)}<small> EA</small></strong><span>{t("kpi.totalActualHint")}</span></div></article>
        <article><span aria-hidden="true" className="kpi-icon is-green">✓</span><div><p>{t("kpi.averageYield")}</p><strong>{metric(snapshot.weightedYield)}</strong><span>{t("kpi.averageYieldHint")}</span></div></article>
        <article><span aria-hidden="true" className="kpi-icon is-violet">↗</span><div><p>{t("kpi.averageUtilization")}</p><strong>{metric(snapshot.weightedUtilization)}</strong><span>{t("kpi.averageUtilizationHint")}</span></div></article>
        <article><span aria-hidden="true" className="kpi-icon is-orange">!</span><div><p>{t("kpi.attention")}</p><strong>{new Intl.NumberFormat(language === "vi" ? "vi-VN" : "ko-KR").format(snapshot.attentionCount)}<small> {t("unit.item")}</small></strong><span>{t("kpi.attentionHint")}</span></div></article>
      </section>

      <div className="dashboard-grid dashboard-grid-top">
        <YieldMatrix rows={snapshot.yields} master={master} />
        <UtilizationBars rows={snapshot.utilization} master={master} />
      </div>
      <div className="dashboard-grid dashboard-grid-bottom">
        <section className="dashboard-card downtime-card" aria-label={t("downtime.summary")}>
          <div className="dashboard-card-heading"><div><p className="dashboard-eyebrow">DOWNTIME</p><h2>{t("downtime.summary")}</h2></div></div>
          {snapshot.downtime.length === 0
            ? <p className="dashboard-empty">{t("downtime.empty")}</p>
            : <ul>{snapshot.downtime.map((row) => <li key={row.reasonId}><span>{row.reasonName}</span><strong>{compactNumber(row.minutes)}{language === "vi" ? " " : ""}{t("unit.minute")}</strong></li>)}</ul>}
        </section>
        <EntryProgress rows={snapshot.entryProgress} master={master} />
      </div>
    </>}
  </main>;

  if (embedded) return content;

  return <div className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <a className="dashboard-brand" href="/"><span className="brand-mark">S</span><span><strong>{t("app.name")}</strong><small>{t("app.subtitle")}</small></span></a>
      <nav aria-label="대시보드 메뉴" className="dashboard-nav">
        <a className="is-active" href="/"><span>▦</span> {t("nav.dashboard")}</a>
        <a href="/analysis"><span>⌁</span> {t("nav.analysis")}</a>
        <a href="/entry"><span>＋</span> {t("nav.entry")}</a>
        <a href="/upload"><span>⇧</span> {t("nav.upload")}</a>
        <a href="/admin"><span>⚙</span> {t("nav.admin")}</a>
      </nav>
      <p className="dashboard-sidebar-note">LIVE SYNC<br /><span>Supabase 실시간 연결</span></p>
    </aside>
    {content}
  </div>;
}
