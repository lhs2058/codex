import { useEffect, useRef, useState } from "react";
import type { AnalysisDataset, AnalysisFilters, MasterDataSnapshot, ProcessCode } from "../../domain/types";
import { createMasterDataRepository, type MasterDataRepository } from "../../data/repositories/master-data-repository";
import { createAnalysisRepository, type AnalysisRepository } from "../../data/repositories/analysis-repository";
import { TrendChart } from "./TrendChart";
import { DefectTable } from "./DefectTable";
import { downloadAnalysisExcel } from "../../exports/excel-report";
import { downloadAnalysisPdf } from "../../exports/pdf-report";

export interface AnalysisPageProps {
  initialFilters?: AnalysisFilters;
  masterRepository?: Pick<MasterDataRepository, "listMasterData">;
  analysisRepository?: AnalysisRepository;
  excelDownloader?: (dataset: AnalysisDataset, language: "ko" | "vi") => Promise<void>;
  pdfDownloader?: (dataset: AnalysisDataset, language: "ko" | "vi") => Promise<void>;
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
}: AnalysisPageProps) {
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
      setError("분석 서비스 연결 설정을 확인해 주세요.");
      return () => { current = false; };
    }
    masterRef.current.listMasterData()
      .then((value) => { if (current) setMaster(value); })
      .catch(() => { if (current) setError("기준정보를 불러오지 못했습니다."); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const requestedKey = filterKey(filters);
    setError("");
    try {
      analysisRef.current ??= createAnalysisRepository();
    } catch {
      setError("분석 서비스 연결 설정을 확인해 주세요.");
      return () => controller.abort();
    }
    analysisRef.current.loadAnalysis(filters, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setLoaded({ key: requestedKey, dataset: value });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && (!(cause instanceof DOMException) || cause.name !== "AbortError")) {
          setError("분석 데이터를 불러오지 못했습니다.");
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
      await downloader(dataset, "ko");
    } catch {
      setError("보고서를 생성하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  return <div className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <a className="dashboard-brand" href="/"><span className="brand-mark">S</span><span><strong>SMD CONTROL</strong><small>생산 공정 관리</small></span></a>
      <nav aria-label="분석 메뉴" className="dashboard-nav">
        <a href="/"><span>▦</span> 통합 대시보드</a>
        <a className="is-active" href="/analysis"><span>⌁</span> 상세 분석</a>
        <a href="/entry"><span>＋</span> 생산 실적 입력</a>
        <a href="/upload"><span>⇧</span> 엑셀 업로드</a>
        <a href="/admin"><span>⚙</span> 기준정보 관리</a>
      </nav>
    </aside>
    <main className="dashboard-main analysis-main">
      <header className="dashboard-topbar">
        <div><p className="dashboard-eyebrow">PROCESS INTELLIGENCE</p><h1>상세 분석</h1><p>기간별 공정 성과와 손실·불량 원인을 조회합니다.</p></div>
        <div className="analysis-actions">
          <button type="button" disabled={!dataset || busy !== null || !excelDownloader} onClick={() => void download("excel")}>Excel</button>
          <button type="button" disabled={!dataset || busy !== null || !pdfDownloader} onClick={() => void download("pdf")}>PDF</button>
        </div>
      </header>
      {master && <form className="dashboard-filters analysis-filters" aria-label="분석 필터" onSubmit={(event) => event.preventDefault()}>
        <label>시작일<input aria-label="시작일" type="date" value={filters.from} onChange={(event) => setFilter("from", event.target.value)} /></label>
        <label>종료일<input aria-label="종료일" type="date" value={filters.to} onChange={(event) => setFilter("to", event.target.value)} /></label>
        <label>집계<select aria-label="집계" value={filters.groupBy} onChange={(event) => setFilter("groupBy", event.target.value as AnalysisFilters["groupBy"])}><option value="day">일</option><option value="week">주</option><option value="month">월</option></select></label>
        <label>조<select aria-label="조" value={filters.shiftId ?? ""} onChange={(event) => setFilter("shiftId", event.target.value || null)}><option value="">전체</option>{master.shifts.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</select></label>
        <label>모델<select aria-label="모델" value={filters.modelId ?? ""} onChange={(event) => setFilter("modelId", event.target.value || null)}><option value="">전체</option>{master.models.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</select></label>
        <label>라인<select aria-label="라인" value={filters.lineId ?? ""} onChange={(event) => setFilter("lineId", event.target.value || null)}><option value="">전체</option>{master.lines.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</select></label>
        <label>공정<select aria-label="공정" value={filters.processCode ?? ""} onChange={(event) => setFilter("processCode", (event.target.value || null) as ProcessCode | null)}><option value="">전체</option>{master.processes.map((item) => <option key={item.id} value={item.code}>{item.code}</option>)}</select></label>
      </form>}
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {dataset && <>
        <TrendChart rows={dataset.yieldSeries} />
        <div className="dashboard-grid analysis-comparison-grid">
          <section className="dashboard-card" aria-label="공정·라인 비교 (%)">
            <div className="dashboard-card-heading"><div><p className="dashboard-eyebrow">PROCESS · LINE</p><h2>공정·라인 비교 (%)</h2></div></div>
            <ul className="analysis-metric-list">{dataset.processLines.map((row) =>
              <li key={`${row.processCode}-${row.lineId}`}><span>{row.processCode} · {row.lineCode}</span><strong>{percent(row.yieldPercent)}</strong>{row.belowTarget && <em>목표 미달</em>}</li>)}</ul>
            <p className="analysis-summary">공정·라인 요약: {dataset.processLines.map((row) => `${row.processCode} ${row.lineCode} ${percent(row.yieldPercent)}`).join(", ") || "데이터 없음"}</p>
          </section>
          <section className="dashboard-card" aria-label="시간대 실적 및 가동률 (%)">
            <div className="dashboard-card-heading"><div><p className="dashboard-eyebrow">TIME SLOT</p><h2>시간대 실적 및 가동률 (%)</h2></div></div>
            <ul className="analysis-metric-list">{dataset.timeSlots.map((row) =>
              <li key={row.timeSlotId}><span>{row.timeSlotCode}</span><strong>{row.actualQty.toLocaleString("ko-KR")} EA · {percent(row.utilizationPercent)}</strong></li>)}</ul>
            <p className="analysis-summary">시간대 요약: {dataset.timeSlots.map((row) => `${row.timeSlotCode} ${row.actualQty} EA ${percent(row.utilizationPercent)}`).join(", ") || "데이터 없음"}</p>
          </section>
        </div>
        <div className="dashboard-grid analysis-detail-grid">
          <section className="dashboard-card downtime-card" aria-label="비가동 손실 (분·EA)">
            <div className="dashboard-card-heading"><div><p className="dashboard-eyebrow">DOWNTIME LOSS</p><h2>비가동 손실 (분·EA)</h2></div></div>
            <ul>{dataset.downtime.map((row) => <li key={row.reason}><span>{row.reason}</span><strong>{row.minutes.toLocaleString("ko-KR")}분 · {row.lostUnits.toFixed(1)} EA</strong></li>)}</ul>
            <p className="analysis-summary">비가동 손실 요약: {dataset.downtime.map((row) => `${row.reason} ${row.minutes}분 ${row.lostUnits.toFixed(1)} EA`).join(", ") || "데이터 없음"}</p>
          </section>
          <DefectTable rows={dataset.defects} />
        </div>
      </>}
    </main>
  </div>;
}
