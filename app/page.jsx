"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import readExcelFile from "read-excel-file/browser";
import attendanceData from "./attendance-data.json";
import { parseAttendanceSheets } from "./attendance-import.js";
import { downloadExcelReport } from "./excel-report.js";
import { downloadPdfReport } from "./pdf-report.js";

const STORAGE_KEY = "acm-attendance-import";

const Icon = ({ name, size = 20 }) => {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    chart: <><path d="M3 3v18h18" /><path d="m7 16 4-5 4 3 5-7" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 20h14" /></>,
    sheet: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8M8 13v4M12 13v4" /></>,
    pdf: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 15h1a2 2 0 0 0 0-4H8v6M13 17v-6h2a2 2 0 0 1 0 4h-2M18 11h3M18 14h2" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
};

const formatDate = (date) =>
  new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T00:00:00`));

const MiniTrend = ({ records, selectedIndex }) => {
  const points = records.slice(Math.max(0, selectedIndex - 9), selectedIndex + 1);
  const width = 660;
  const height = 210;
  const pad = 26;
  const min = Math.min(...points.map((d) => d.rate)) - 1;
  const max = Math.max(...points.map((d) => d.rate)) + 1;
  const x = (i) => pad + (i * (width - pad * 2)) / Math.max(points.length - 1, 1);
  const y = (v) => height - pad - ((v - min) / Math.max(max - min, 1)) * (height - pad * 2);
  const line = points.map((d, i) => `${x(i)},${y(d.rate)}`).join(" ");
  const area = `${pad},${height - pad} ${line} ${x(points.length - 1)},${height - pad}`;

  return (
    <div className="trend-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="최근 출근율 추이">
        {[0, 1, 2, 3].map((lineIndex) => {
          const lineY = pad + (lineIndex * (height - pad * 2)) / 3;
          return <line key={lineIndex} x1={pad} x2={width - pad} y1={lineY} y2={lineY} className="grid-line" />;
        })}
        <polygon points={area} className="trend-area" />
        <polyline points={line} className="trend-line" />
        {points.map((d, i) => (
          <g key={d.date}>
            <circle cx={x(i)} cy={y(d.rate)} r={i === points.length - 1 ? 5 : 3} className={i === points.length - 1 ? "trend-dot active" : "trend-dot"} />
            {(i === 0 || i === points.length - 1 || i % 2 === 0) && (
              <text x={x(i)} y={height - 5} textAnchor="middle" className="axis-label">{d.sheet}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
};

const AttendanceRing = ({ rate }) => (
  <div className="ring" style={{ "--rate": `${rate * 3.6}deg` }}>
    <div>
      <strong>{rate.toFixed(1)}%</strong>
      <span>출근율</span>
    </div>
  </div>
);

const getUnitRate = (unit) => (unit.total ? (unit.present / unit.total) * 100 : 0);

export default function AttendanceDashboard() {
  const [records, setRecords] = useState(attendanceData);
  const [selectedDate, setSelectedDate] = useState(attendanceData.at(-1).date);
  const [sourceName, setSourceName] = useState("7월 인력 현황.xlsx");
  const [importState, setImportState] = useState({ type: "", message: "" });
  const [reportState, setReportState] = useState({ type: "", message: "" });
  const fileInputRef = useRef(null);
  const reportRef = useRef(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.records?.length) {
        setRecords(saved.records);
        setSourceName(saved.sourceName || "업데이트 파일.xlsx");
        setSelectedDate(saved.records.at(-1).date);
        setImportState({
          type: "success",
          message: "저장된 파일 데이터를 사용하고 있습니다.",
        });
      }
    } catch {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Some browsers restrict storage for file:// pages.
      }
    }
  }, []);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportState({ type: "loading", message: "엑셀 데이터를 읽고 있습니다…" });

    try {
      const sheets = await readExcelFile(file);
      const nextRecords = parseAttendanceSheets(sheets);
      setRecords(nextRecords);
      setSourceName(file.name);
      setSelectedDate(nextRecords.at(-1).date);
      let savedForRefresh = true;
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ records: nextRecords, sourceName: file.name }),
        );
      } catch {
        savedForRefresh = false;
      }
      setImportState({
        type: "success",
        message: `${nextRecords.length}개 근무일 데이터를 업데이트했습니다.${savedForRefresh ? "" : " 현재 실행 중인 화면에만 적용됩니다."}`,
      });
    } catch (error) {
      setImportState({
        type: "error",
        message: error instanceof Error ? error.message : "파일을 읽지 못했습니다.",
      });
    } finally {
      event.target.value = "";
    }
  };

  const resetData = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // The in-memory data can still be reset when storage is unavailable.
    }
    setRecords(attendanceData);
    setSourceName("7월 인력 현황.xlsx");
    setSelectedDate(attendanceData.at(-1).date);
    setImportState({ type: "success", message: "기본 데이터로 복원했습니다." });
  };

  const selectedIndex = records.findIndex((record) => record.date === selectedDate);
  const current = records[selectedIndex] || records.at(-1);
  const previous = records[Math.max(0, selectedIndex - 1)] || current;
  const delta = Number((current.rate - previous.rate).toFixed(1));

  const monthRecords = useMemo(
    () => records.filter((record) => record.date.slice(0, 7) === current.date.slice(0, 7)),
    [current.date, records],
  );
  const monthAverage = monthRecords.reduce((sum, item) => sum + item.rate, 0) / monthRecords.length;
  const strongestUnit = [...current.units].sort(
    (a, b) => getUnitRate(b) - getUnitRate(a),
  )[0];
  const criticalUnit = [...current.units].sort(
    (a, b) => getUnitRate(a) - getUnitRate(b),
  )[0];
  const unitAccent = { "ACM V0": "#1f4d3a", "ACM V5": "#d8ff3e", ACK: "#77a8ff" };
  const recentRecords = records.slice(Math.max(0, selectedIndex - 6), selectedIndex + 1);

  const exportExcel = () => {
    try {
      downloadExcelReport({ current, records, sourceName });
      setReportState({
        type: "success",
        message: `${formatDate(current.date)} Excel 보고서를 저장했습니다.`,
      });
    } catch {
      setReportState({ type: "error", message: "Excel 보고서를 만들지 못했습니다." });
    }
  };

  const exportPdf = async () => {
    if (!reportRef.current) return;
    setReportState({ type: "loading", message: "PDF 보고서를 만들고 있습니다…" });
    try {
      await downloadPdfReport(reportRef.current, current.date);
      setReportState({
        type: "success",
        message: `${formatDate(current.date)} PDF 보고서를 저장했습니다.`,
      });
    } catch {
      setReportState({ type: "error", message: "PDF 보고서를 만들지 못했습니다." });
    }
  };

  return (
    <>
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <div><strong>ACM · ACK</strong><small>WORKFORCE CONTROL</small></div>
        </div>
        <nav>
          <a className="active" href="#overview"><Icon name="grid" />일일 현황</a>
          <a href="#units"><Icon name="users" />조직별 현황</a>
          <a href="#trend"><Icon name="chart" />출근 추이</a>
          <a href="#reasons"><Icon name="calendar" />근태 사유</a>
        </nav>
        <div className="source-card">
          <Icon name="file" />
          <div><span>데이터 소스</span><strong title={sourceName}>{sourceName}</strong><small>{records.length}개 근무일 반영</small></div>
        </div>
        <div className="sidebar-foot">ACM People Operations<br /><span>Internal dashboard</span></div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">DAILY ATTENDANCE</p>
            <h1>ACM 일일 출근 현황</h1>
          </div>
          <div className="top-actions">
            <button
              className="upload-button"
              type="button"
              aria-label="데이터 파일 선택"
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="upload" size={17} />
              <span>데이터 파일 선택</span>
            </button>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFileChange}
            />
            <label className="date-picker">
              <Icon name="calendar" />
              <span className="sr-only">기준일 선택</span>
              <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>
                {[...records].reverse().map((record) => (
                  <option key={record.date} value={record.date}>{formatDate(record.date)}</option>
                ))}
              </select>
            </label>
            <button
              className="report-button excel"
              type="button"
              aria-label="Excel 보고서 저장"
              onClick={exportExcel}
            >
              <Icon name="sheet" size={17} />
              <span>Excel 보고서</span>
            </button>
            <button
              className="report-button pdf"
              type="button"
              aria-label="PDF 보고서 저장"
              disabled={reportState.type === "loading"}
              onClick={exportPdf}
            >
              <Icon name="pdf" size={17} />
              <span>PDF 보고서</span>
            </button>
            <button className="icon-button" aria-label="알림"><Icon name="bell" /></button>
            <div className="profile">HR</div>
          </div>
        </header>

        {importState.message && (
          <div className={`import-notice ${importState.type}`} role="status" aria-live="polite">
            <span>{importState.message}</span>
            {records !== attendanceData && importState.type !== "loading" && (
              <button type="button" onClick={resetData}>기본 데이터 복원</button>
            )}
          </div>
        )}

        {reportState.message && (
          <div className={`import-notice report-notice ${reportState.type}`} role="status" aria-live="polite">
            <span>{reportState.message}</span>
          </div>
        )}

        <div className="dashboard" id="overview">
          <section className="hero-card">
            <div className="hero-copy">
              <p className="eyebrow light">{formatDate(current.date)} · 확정 현황</p>
              <h2><span>{current.present}</span>명이<br />오늘 함께합니다.</h2>
              <p>재적인원 {current.total}명 중 {current.present}명이 출근했습니다. 미출근 인원은 {current.absent}명입니다.</p>
              <div className="hero-tags">
                <span>월 평균 {monthAverage.toFixed(1)}%</span>
                <span className={delta >= 0 ? "positive" : "negative"}>전일 대비 {delta >= 0 ? "+" : ""}{delta}%p</span>
              </div>
            </div>
            <AttendanceRing rate={current.rate} />
          </section>

          <section className="kpi-grid">
            <article className="kpi-card primary">
              <span>출근 인원</span><strong>{current.present}<small>명</small></strong>
              <p>Present employees</p>
            </article>
            <article className="kpi-card">
              <span>재적 인원</span><strong>{current.total}<small>명</small></strong>
              <p>Total workforce</p>
            </article>
            <article className="kpi-card warning">
              <span>미출근</span><strong>{current.absent}<small>명</small></strong>
              <p>Absent today</p>
            </article>
            <article className="kpi-card">
              <span>출근율</span><strong>{current.rate.toFixed(1)}<small>%</small></strong>
              <p className={delta >= 0 ? "up" : "down"}>{delta >= 0 ? "↑" : "↓"} {Math.abs(delta)}%p vs. 전일</p>
            </article>
          </section>

          <section className="panel trend-panel" id="trend">
            <div className="panel-head">
              <div><p className="eyebrow">ATTENDANCE TREND</p><h3>최근 출근율 추이</h3></div>
              <div className="trend-stat"><span>선택일</span><strong>{current.rate.toFixed(1)}%</strong></div>
            </div>
            <MiniTrend records={records} selectedIndex={selectedIndex} />
          </section>

          <section className="panel units-panel" id="units">
            <div className="panel-head">
              <div><p className="eyebrow">BY ORGANIZATION</p><h3>조직별 출근 현황</h3></div>
              <span className="status-pill">LIVE SNAPSHOT</span>
            </div>
            <div className="unit-table">
              <div className="unit-row table-head"><span>조직</span><span>출근 / 재적</span><span>미출근</span><span>출근율</span></div>
              {current.units.map((unit) => {
                const rate = getUnitRate(unit);
                return (
                  <div className="unit-row" key={unit.name}>
                    <span className="unit-name"><i style={{ background: unitAccent[unit.name] }} />{unit.name}</span>
                    <span><strong>{unit.present}</strong> / {unit.total}명</span>
                    <span>{unit.total - unit.present}명</span>
                    <span className="unit-rate"><b>{rate.toFixed(1)}%</b><i><em style={{ width: `${rate}%`, background: unitAccent[unit.name] }} /></i></span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel shift-panel">
            <div className="panel-head">
              <div><p className="eyebrow">SHIFT BALANCE</p><h3>주간 · 야간 운영</h3></div>
            </div>
            {[
              { name: "주간 근무", total: current.shifts.dayTotal, absent: current.shifts.dayAbsent, color: "#d8ff3e" },
              { name: "야간 근무", total: current.shifts.nightTotal, absent: current.shifts.nightAbsent, color: "#77a8ff" },
            ].map((shift) => {
              const present = shift.total - shift.absent;
              const rate = shift.total ? (present / shift.total) * 100 : 0;
              return (
                <div className="shift-row" key={shift.name}>
                  <div className="shift-title"><span>{shift.name}</span><strong>{present}<small> / {shift.total}명</small></strong></div>
                  <div className="bar"><span style={{ width: `${rate}%`, background: shift.color }} /></div>
                  <p>미출근 {shift.absent}명 · 출근율 {rate.toFixed(1)}%</p>
                </div>
              );
            })}
          </section>

          <section className="panel reasons-panel" id="reasons">
            <div className="panel-head">
              <div><p className="eyebrow">ATTENDANCE REASONS</p><h3>근태 사유</h3></div>
              <span className="total-absence">총 {current.absent}명</span>
            </div>
            <div className="reason-grid">
              <div className="reason-main"><strong>{current.reasons.unplanned}</strong><span>일반 결근</span><small>Unplanned absence</small></div>
              <div><strong>{current.reasons.approved}</strong><span>휴가 신청</span></div>
              <div><strong>{current.reasons.late}</strong><span>지각</span></div>
              <div><strong>{current.reasons.earlyLeave}</strong><span>조퇴</span></div>
            </div>
          </section>

          <section className="insight-card">
            <span className="insight-index">01</span>
            <div>
              <p className="eyebrow light">TODAY&apos;S NOTE</p>
              <h3>{strongestUnit.name} 출근율이 가장 안정적입니다.</h3>
              <p>{strongestUnit.name}은(는) {getUnitRate(strongestUnit).toFixed(1)}% 출근율을 기록했습니다. {criticalUnit.name} 미출근 {criticalUnit.total - criticalUnit.present}명을 우선 확인해 주세요.</p>
            </div>
            <a href="#units" aria-label="조직별 현황 보기"><Icon name="arrow" /></a>
          </section>
        </div>
      </section>
    </main>
    <section ref={reportRef} className="pdf-report" aria-hidden="true">
      <header className="pdf-report-head">
        <div>
          <p>ACM PEOPLE OPERATIONS</p>
          <h2>ACM 일일 출근 현황</h2>
        </div>
        <span>{formatDate(current.date)}</span>
      </header>
      <div className="pdf-source">데이터 소스: {sourceName}</div>
      <div className="pdf-kpis">
        <article><span>재적 인원</span><strong>{current.total}<small>명</small></strong></article>
        <article className="accent"><span>출근 인원</span><strong>{current.present}<small>명</small></strong></article>
        <article><span>미출근</span><strong>{current.absent}<small>명</small></strong></article>
        <article><span>출근율</span><strong>{current.rate.toFixed(1)}<small>%</small></strong></article>
      </div>
      <div className="pdf-columns">
        <article className="pdf-block">
          <h3>조직별 출근 현황</h3>
          <table>
            <thead><tr><th>조직</th><th>출근 / 재적</th><th>미출근</th><th>출근율</th></tr></thead>
            <tbody>
              {current.units.map((unit) => (
                <tr key={unit.name}>
                  <td>{unit.name}</td>
                  <td>{unit.present} / {unit.total}명</td>
                  <td>{unit.total - unit.present}명</td>
                  <td>{getUnitRate(unit).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
        <article className="pdf-block">
          <h3>주간 · 야간 운영</h3>
          <table>
            <thead><tr><th>구분</th><th>출근 / 재적</th><th>미출근</th><th>출근율</th></tr></thead>
            <tbody>
              {[
                { name: "주간 근무", total: current.shifts.dayTotal, absent: current.shifts.dayAbsent },
                { name: "야간 근무", total: current.shifts.nightTotal, absent: current.shifts.nightAbsent },
              ].map((shift) => (
                <tr key={shift.name}>
                  <td>{shift.name}</td>
                  <td>{shift.total - shift.absent} / {shift.total}명</td>
                  <td>{shift.absent}명</td>
                  <td>{shift.total ? (((shift.total - shift.absent) / shift.total) * 100).toFixed(1) : "0.0"}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </div>
      <article className="pdf-block">
        <h3>근태 사유</h3>
        <div className="pdf-reasons">
          {[
            ["일반 결근", current.reasons.unplanned],
            ["휴가 신청", current.reasons.approved],
            ["지각", current.reasons.late],
            ["조퇴", current.reasons.earlyLeave],
            ["출산 휴가", current.reasons.maternity],
            ["부서 이동", current.reasons.transfer],
            ["퇴사", current.reasons.resigned],
          ].map(([label, value]) => (
            <div key={label}><strong>{value}</strong><span>{label}</span></div>
          ))}
        </div>
      </article>
      <article className="pdf-block">
        <h3>최근 출근율 추이</h3>
        <div className="pdf-trend">
          {recentRecords.map((record) => (
            <div key={record.date}>
              <span>{record.sheet}</span>
              <i><em style={{ width: `${record.rate}%` }} /></i>
              <strong>{record.rate.toFixed(1)}%</strong>
            </div>
          ))}
        </div>
      </article>
      <footer>
        <strong>{strongestUnit.name}</strong> 출근율이 {getUnitRate(strongestUnit).toFixed(1)}%로 가장 높습니다.
        <span>ACM Attendance Dashboard</span>
      </footer>
    </section>
    </>
  );
}
