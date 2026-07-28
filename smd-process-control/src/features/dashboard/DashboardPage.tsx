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
}

export { loadDashboard, subscribeDashboard };

export function DashboardPage({
  initialFilters = defaultFilters(),
  masterRepository,
  dashboardRepository,
}: DashboardPageProps) {
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
      setError("생산 서비스 연결 설정을 확인해 주세요.");
      setLoading(false);
      return () => { current = false; };
    }
    masterRef.current.listMasterData()
      .then((value) => { if (current) setMaster(value); })
      .catch(() => { if (current) setError("기준정보를 불러오지 못했습니다."); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    try {
      dashboardRef.current ??= createDashboardRepository();
    } catch {
      setError("생산 서비스 연결 설정을 확인해 주세요.");
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
        setError("대시보드를 불러오지 못했습니다.");
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
      setError("생산 서비스 연결 설정을 확인해 주세요.");
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

  return <div className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <a className="dashboard-brand" href="/"><span className="brand-mark">S</span><span><strong>SMD CONTROL</strong><small>생산 공정 관리</small></span></a>
      <nav aria-label="대시보드 메뉴" className="dashboard-nav">
        <a className="is-active" href="/"><span>▦</span> 통합 대시보드</a>
        <a href="/entry"><span>＋</span> 생산 실적 입력</a>
        <a href="/upload"><span>⇧</span> 엑셀 업로드</a>
        <a href="/admin"><span>⚙</span> 기준정보 관리</a>
      </nav>
      <p className="dashboard-sidebar-note">LIVE SYNC<br /><span>Supabase 실시간 연결</span></p>
    </aside>
    <main className="dashboard-main">
      <header className="dashboard-topbar">
        <div><p className="dashboard-eyebrow">SMD PROCESS CONTROL</p><h1>통합 생산 대시보드</h1><p>공정 현황을 실시간으로 확인합니다.</p></div>
        <span className="dashboard-live"><i /> LIVE</span>
      </header>

      {master && <form className="dashboard-filters" aria-label="대시보드 필터" onSubmit={(event) => event.preventDefault()}>
        <label>생산일<input type="date" aria-label="생산일" value={filters.productionDate} onChange={(event) => setFilter("productionDate", event.target.value)} /></label>
        <label>조<select aria-label="조" value={filters.shiftId ?? ""} onChange={(event) => setFilter("shiftId", event.target.value || null)}><option value="">전체</option>{master.shifts.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>모델<select aria-label="모델" value={filters.modelId ?? ""} onChange={(event) => setFilter("modelId", event.target.value || null)}><option value="">전체</option>{master.models.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <label>라인<select aria-label="라인" value={filters.lineId ?? ""} onChange={(event) => setFilter("lineId", event.target.value || null)}><option value="">전체</option>{master.lines.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>공정<select aria-label="공정" value={filters.processCode ?? ""} onChange={(event) => setFilter("processCode", (event.target.value || null) as ProcessCode | null)}><option value="">전체</option>{master.processes.filter((item) => item.active).map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></label>
      </form>}

      {error && <p className="dashboard-error" role="alert">{error}</p>}
      {loading && !snapshot && <p className="dashboard-loading" role="status">생산 현황을 불러오는 중입니다…</p>}
      {snapshot && master && <>
        <section className="dashboard-kpis" aria-label="핵심 지표">
          <article><span className="kpi-icon is-blue">▤</span><div><p>금일 총 실적</p><strong>{compactNumber(snapshot.totalActual)}<small> EA</small></strong><span>선택 조건 누계</span></div></article>
          <article><span className="kpi-icon is-green">✓</span><div><p>평균 공정 수율</p><strong>{metric(snapshot.weightedYield)}</strong><span>OK 수량 가중 평균</span></div></article>
          <article><span className="kpi-icon is-violet">↗</span><div><p>평균 라인 가동률</p><strong>{metric(snapshot.weightedUtilization)}</strong><span>순가동시간 기준</span></div></article>
          <article><span className="kpi-icon is-orange">!</span><div><p>확인 필요</p><strong>{compactNumber(snapshot.attentionCount)}<small> 건</small></strong><span>미입력·기준 누락</span></div></article>
        </section>

        <div className="dashboard-grid dashboard-grid-top">
          <YieldMatrix rows={snapshot.yields} master={master} />
          <UtilizationBars rows={snapshot.utilization} master={master} />
        </div>
        <div className="dashboard-grid dashboard-grid-bottom">
          <section className="dashboard-card downtime-card" aria-label="비가동 요약">
            <div className="dashboard-card-heading"><div><p className="dashboard-eyebrow">DOWNTIME</p><h2>비가동 요약</h2></div></div>
            {snapshot.downtime.length === 0
              ? <p className="dashboard-empty">등록된 비가동이 없습니다.</p>
              : <ul>{snapshot.downtime.map((row) => <li key={row.reasonId}><span>{row.reasonName}</span><strong>{compactNumber(row.minutes)}분</strong></li>)}</ul>}
          </section>
          <EntryProgress rows={snapshot.entryProgress} master={master} />
        </div>
      </>}
    </main>
  </div>;
}
