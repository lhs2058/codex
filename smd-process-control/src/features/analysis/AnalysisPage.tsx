import { useEffect, useRef, useState } from "react";
import type { AnalysisDataset, AnalysisFilters, MasterDataSnapshot, ProcessCode } from "../../domain/types";
import { createMasterDataRepository, type MasterDataRepository } from "../../data/repositories/master-data-repository";
import { createAnalysisRepository, type AnalysisRepository } from "../../data/repositories/analysis-repository";
import { TrendChart } from "./TrendChart";
import { DefectTable } from "./DefectTable";
import { downloadAnalysisExcel } from "../../exports/excel-report";
import { downloadAnalysisPdf } from "../../exports/pdf-report";
import { useI18n } from "../../i18n";

export interface AnalysisPageProps {
  initialFilters?: AnalysisFilters;
  masterRepository?: Pick<MasterDataRepository, "listMasterData">;
  analysisRepository?: AnalysisRepository;
  excelDownloader?: (dataset: AnalysisDataset, language: "ko" | "vi") => Promise<void>;
  pdfDownloader?: (dataset: AnalysisDataset, language: "ko" | "vi") => Promise<void>;
  embedded?: boolean;
}

function bangkokDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function defaultFilters(): AnalysisFilters {
  const to = bangkokDate();
  const fromDate = new Date(`${to}T00:00:00Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - 29);
  return { from: fromDate.toISOString().slice(0, 10), to, groupBy: "day", shiftId: null, modelId: null, lineId: null, processCode: null };
}

const percent = (value: number | null) => value === null ? "—" : `${value.toFixed(1)}%`;
const filterKey = (filters: AnalysisFilters) => JSON.stringify([
  filters.from,
  filters.to,
  filters.groupBy,
  filters.shiftId,
  filters.modelId,
  filters.lineId,
  filters.processCode,
]);

export function AnalysisPage({
  initialFilters = defaultFilters(),
  masterRepository,
  analysisRepository,
  excelDownloader = downloadAnalysisExcel,
  pdfDownloader = downloadAnalysisPdf,
  embedded = false,
}: AnalysisPageProps) {
  const { language, t } = useI18n();
  const masterRef = useRef(masterRepository ?? null);
  const analysisRef = useRef(analysisRepository ?? null);
  const [master, setMaster] = useState<MasterDataSnapshot | null>(null);
  const [filters, setFilters] = useState(initialFilters);
  const [loaded, setLoaded] = useState<{ key: string; dataset: AnalysisDataset } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"excel" | "pdf" | null>(null);
  const currentFilterKey = filterKey(filters);
  const dataset = loaded?.key === currentFilterKey ? loaded.dataset : null;

  useEffect(() => {
    let current = true;
    try {
      masterRef.current ??= createMasterDataRepository();
    } catch {
      setError(t("analysis.connectionError"));
      return () => { current = false; };
    }
    masterRef.current.listMasterData()
      .then((value) => { if (current) setMaster(value); })
      .catch(() => { if (current) setError(t("analysis.masterError")); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const requestedKey = filterKey(filters);
    setError("");
    try {
      analysisRef.current ??= createAnalysisRepository();
    } catch {
      setError(t("analysis.connectionError"));
      return () => controller.abort();
    }
    analysisRef.current.loadAnalysis(filters, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setLoaded({ key: requestedKey, dataset: value });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && (!(cause instanceof DOMException) || cause.name !== "AbortError")) {
          setError(t("analysis.loadError"));
        }
      });
    return () => controller.abort();
  }, [filters]);

  const setFilter = <K extends keyof AnalysisFilters>(key: K, value: AnalysisFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const download = async (kind: "excel" | "pdf") => {
    if (!dataset) return;
    const downloader = kind === "excel" ? excelDownloader : pdfDownloader;
    if (!downloader) return;
    setBusy(kind);
    setError("");
    try {
      await downloader(dataset, language);
    } catch {
      setError(t("analysis.reportError"));
    } finally {
      setBusy(null);
    }
  };

  return <div className={embedded ? "analysis-route" : "dashboard-shell"}>
    {!embedded && <aside className="dashboard-sidebar">
      <a className="dashboard-brand" href="/"><span className="brand-mark">S</span><span><strong>{t("app.name")}</strong><small>{t("app.subtitle")}</small></span></a>
      <nav aria-label={t("app.navigation")} className="dashboard-nav">
        <a href="/"><span>▦</span> {t("nav.dashboard")}</a>
        <a className="is-active" href="/analysis"><span>⌁</span> {t("nav.analysis")}</a>
        <a href="/entry"><span>＋</span> {t("nav.entry")}</a>
        <a href="/upload"><span>⇧</span> {t("nav.upload")}</a>
        <a href="/admin"><span>⚙</span> {t("nav.admin")}</a>
      </nav>
    </aside>}
    <main className="dashboard-main analysis-main">
      <header className="dashboard-topbar">
        <div><p className="dashboard-eyebrow">PROCESS INTELLIGENCE</p><h1>{t("analysis.title")}</h1><p>{t("analysis.description")}</p></div>
        <div className="analysis-actions">
          <button type="button" disabled={!dataset || busy !== null || !excelDownloader} onClick={() => void download("excel")}>Excel</button>
          <button type="button" disabled={!dataset || busy !== null || !pdfDownloader} onClick={() => void download("pdf")}>PDF</button>
        </div>
      </header>
      {master && <form className="dashboard-filters analysis-filters" aria-label={t("analysis.filters")} onSubmit={(event) => event.preventDefault()}>
        <label>{t("filter.from")}<input type="date" value={filters.from} onChange={(event) => setFilter("from", event.target.value)} /></label>
        <label>{t("filter.to")}<input type="date" value={filters.to} onChange={(event) => setFilter("to", event.target.value)} /></label>
        <label>{t("filter.groupBy")}<select value={filters.groupBy} onChange={(event) => setFilter("groupBy", event.target.value as AnalysisFilters["groupBy"])}><option value="day">{t("filter.day")}</option><option value="week">{t("filter.week")}</option><option value="month">{t("filter.month")}</option></select></label>
        <label>{t("common.shift")}<select value={filters.shiftId ?? ""} onChange={(event) => setFilter("shiftId", event.target.value || null)}><option value="">{t("common.all")}</option>{master.shifts.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</select></label>
        <label>{t("common.model")}<select value={filters.modelId ?? ""} onChange={(event) => setFilter("modelId", event.target.value || null)}><option value="">{t("common.all")}</option>{master.models.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</select></label>
        <label>{t("common.line")}<select value={filters.lineId ?? ""} onChange={(event) => setFilter("lineId", event.target.value || null)}><option value="">{t("common.all")}</option>{master.lines.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</select></label>
        <label>{t("common.process")}<select value={filters.processCode ?? ""} onChange={(event) => setFilter("processCode", (event.target.value || null) as ProcessCode | null)}><option value="">{t("common.all")}</option>{master.processes.map((item) => <option key={item.id} value={item.code}>{item.code}</option>)}</select></label>
      </form>}
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {dataset && <>
        <TrendChart rows={dataset.yieldSeries} />
        <div className="dashboard-grid analysis-comparison-grid">
          <section className="dashboard-card" aria-label={t("analysis.processLine")}>
            <div className="dashboard-card-heading"><div><p className="dashboard-eyebrow">PROCESS · LINE</p><h2>{t("analysis.processLine")}</h2></div></div>
            <ul className="analysis-metric-list">{dataset.processLines.map((row) =>
              <li key={`${row.processCode}-${row.lineId}`}><span>{row.processCode} · {row.lineCode}</span><strong>{percent(row.yieldPercent)}</strong>{row.belowTarget && <em>! {t("analysis.belowTarget")}</em>}</li>)}</ul>
            <p className="analysis-summary">{t("analysis.processSummary")}: {dataset.processLines.map((row) => `${row.processCode} ${row.lineCode} ${percent(row.yieldPercent)}`).join(", ") || t("analysis.noData")}</p>
          </section>
          <section className="dashboard-card" aria-label={t("analysis.timeSlot")}>
            <div className="dashboard-card-heading"><div><p className="dashboard-eyebrow">TIME SLOT</p><h2>{t("analysis.timeSlot")}</h2></div></div>
            <ul className="analysis-metric-list">{dataset.timeSlots.map((row) =>
              <li key={row.timeSlotId}><span>{row.timeSlotCode}</span><strong>{row.actualQty.toLocaleString("ko-KR")} EA · {percent(row.utilizationPercent)}</strong></li>)}</ul>
            <p className="analysis-summary">{t("analysis.timeSummary")}: {dataset.timeSlots.map((row) => `${row.timeSlotCode} ${row.actualQty} EA ${percent(row.utilizationPercent)}`).join(", ") || t("analysis.noData")}</p>
          </section>
        </div>
        <div className="dashboard-grid analysis-detail-grid">
          <section className="dashboard-card downtime-card" aria-label={t("analysis.downtimeLoss")}>
            <div className="dashboard-card-heading"><div><p className="dashboard-eyebrow">DOWNTIME LOSS</p><h2>{t("analysis.downtimeLoss")}</h2></div></div>
            <ul>{dataset.downtime.map((row) => <li key={row.reason}><span>{row.reason}</span><strong>{row.minutes.toLocaleString(language === "vi" ? "vi-VN" : "ko-KR")}{language === "vi" ? " " : ""}{t("unit.minute")} · {row.lostUnits.toFixed(1)} EA</strong></li>)}</ul>
            <p className="analysis-summary">{t("analysis.downtimeSummary")}: {dataset.downtime.map((row) => `${row.reason} ${row.minutes}${language === "vi" ? " " : ""}${t("unit.minute")} ${row.lostUnits.toFixed(1)} EA`).join(", ") || t("analysis.noData")}</p>
          </section>
          <DefectTable rows={dataset.defects} />
        </div>
      </>}
    </main>
  </div>;
}
