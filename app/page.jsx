"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import readExcelFile from "read-excel-file/browser";
import attendanceData from "./attendance-data.json";
import { parseAttendanceSheets } from "./attendance-import.js";
import { downloadExcelReport } from "./excel-report.js";
import { downloadPdfReport } from "./pdf-report.js";
import { getTranslation } from "./translations.js";

const STORAGE_KEY = "acm-attendance-import";
const LANGUAGE_KEY = "acm-attendance-language";

const Icon = ({ name, size = 20 }) => {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    chart: <><path d="M3 3v18h18" /><path d="m7 16 4-5 4 3 5-7" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 20h14" /></>,
    edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
    close: <><path d="M18 6 6 18M6 6l12 12" /></>,
    sheet: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8M8 13v4M12 13v4" /></>,
    pdf: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 15h1a2 2 0 0 0 0-4H8v6M13 17v-6h2a2 2 0 0 1 0 4h-2M18 11h3M18 14h2" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
};

const formatDate = (date, language = "ko") =>
  new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T00:00:00`));

const MiniTrend = ({ records, selectedIndex, label }) => {
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
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
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

const AttendanceRing = ({ rate, label }) => (
  <div className="ring" style={{ "--rate": `${rate * 3.6}deg` }}>
    <div>
      <strong>{rate.toFixed(1)}%</strong>
      <span>{label}</span>
    </div>
  </div>
);

const getUnitRate = (unit) => (unit.total ? (unit.present / unit.total) * 100 : 0);

const getManualForm = (record) => {
  const units = Object.fromEntries(record.units.map((unit) => [unit.name, unit]));
  return {
    date: record.date,
    v0Total: units["ACM V0"]?.total ?? 0,
    v0Present: units["ACM V0"]?.present ?? 0,
    v5Total: units["ACM V5"]?.total ?? 0,
    v5Present: units["ACM V5"]?.present ?? 0,
    ackTotal: units.ACK?.total ?? 0,
    ackPresent: units.ACK?.present ?? 0,
    dayTotal: record.shifts.dayTotal,
    dayAbsent: record.shifts.dayAbsent,
    nightTotal: record.shifts.nightTotal,
    nightAbsent: record.shifts.nightAbsent,
    ...record.reasons,
  };
};

const manualFields = {
  units: [
    ["v0Total", "v0Total"], ["v0Present", "v0Present"],
    ["v5Total", "v5Total"], ["v5Present", "v5Present"],
    ["ackTotal", "ackTotal"], ["ackPresent", "ackPresent"],
  ],
  shifts: [
    ["dayTotal", "dayTotal"], ["dayAbsent", "dayAbsent"],
    ["nightTotal", "nightTotal"], ["nightAbsent", "nightAbsent"],
  ],
  reasons: [
    ["unplanned", "unplanned"], ["approved", "approved"],
    ["late", "late"], ["earlyLeave", "earlyLeave"],
    ["maternity", "maternity"], ["transfer", "transfer"], ["resigned", "resigned"],
  ],
};

const ManualEntryModal = ({ record, language, onClose, onSave }) => {
  const t = getTranslation(language);
  const [form, setForm] = useState(() => getManualForm(record));
  const [error, setError] = useState("");
  const numberValue = (key) => Math.max(0, Number(form[key]) || 0);
  const total = numberValue("v0Total") + numberValue("v5Total") + numberValue("ackTotal");
  const present = numberValue("v0Present") + numberValue("v5Present") + numberValue("ackPresent");
  const absent = Math.max(0, total - present);
  const rate = total ? (present / total) * 100 : 0;

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  };

  const submit = (event) => {
    event.preventDefault();
    const invalidUnit = [
      ["v0Total", "v0Present", "ACM V0"],
      ["v5Total", "v5Present", "ACM V5"],
      ["ackTotal", "ackPresent", "ACK"],
    ].find(([totalKey, presentKey]) => numberValue(presentKey) > numberValue(totalKey));
    if (invalidUnit) {
      setError(t.unitValidation(invalidUnit[2]));
      return;
    }
    if (numberValue("dayAbsent") > numberValue("dayTotal") || numberValue("nightAbsent") > numberValue("nightTotal")) {
      setError(t.shiftValidation);
      return;
    }
    if (numberValue("dayTotal") + numberValue("nightTotal") !== total) {
      setError(t.shiftTotalValidation(total));
      return;
    }

    const date = form.date;
    onSave({
      sheet: `${date.slice(8, 10)}.${date.slice(5, 7)}`,
      date,
      total,
      present,
      absent,
      rate: Number(rate.toFixed(1)),
      units: [
        { name: "ACM V0", total: numberValue("v0Total"), present: numberValue("v0Present") },
        { name: "ACM V5", total: numberValue("v5Total"), present: numberValue("v5Present") },
        { name: "ACK", total: numberValue("ackTotal"), present: numberValue("ackPresent") },
      ],
      shifts: {
        dayTotal: numberValue("dayTotal"),
        dayAbsent: numberValue("dayAbsent"),
        nightTotal: numberValue("nightTotal"),
        nightAbsent: numberValue("nightAbsent"),
      },
      reasons: Object.fromEntries(manualFields.reasons.map(([key]) => [key, numberValue(key)])),
    });
  };

  const renderFields = (fields) => fields.map(([key, labelKey]) => (
    <label className="manual-field" key={key}>
      <span>{t[labelKey]}</span>
      <input
        type="number"
        min="0"
        step="1"
        inputMode="numeric"
        value={form[key]}
        onChange={(event) => update(key, event.target.value)}
      />
    </label>
  ));

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="manual-modal" role="dialog" aria-modal="true" aria-labelledby="manual-title">
        <header className="manual-modal-head">
          <div><p className="eyebrow">MANUAL ENTRY</p><h2 id="manual-title">{t.manualTitle}</h2></div>
          <button type="button" aria-label={t.close} onClick={onClose}><Icon name="close" /></button>
        </header>
        <form onSubmit={submit}>
          <div className="manual-date-row">
            <label className="manual-field">
              <span>{t.baseDate}</span>
              <input type="date" required value={form.date} onChange={(event) => update("date", event.target.value)} />
            </label>
            <div className="manual-summary" aria-live="polite">
              <span>{t.totalShort} <strong>{total}</strong>{t.people}</span>
              <span>{t.presentShort} <strong>{present}</strong>{t.people}</span>
              <span>{t.absentShort} <strong>{absent}</strong>{t.people}</span>
              <span>{t.attendanceRate} <strong>{rate.toFixed(1)}</strong>%</span>
            </div>
          </div>
          <div className="manual-sections">
            <fieldset><legend>{t.unitPeople}</legend><div className="manual-grid">{renderFields(manualFields.units)}</div></fieldset>
            <fieldset><legend>{t.shifts}</legend><div className="manual-grid">{renderFields(manualFields.shifts)}</div></fieldset>
            <fieldset className="reason-fields"><legend>{t.reasons}</legend><div className="manual-grid">{renderFields(manualFields.reasons)}</div></fieldset>
          </div>
          {error && <p className="manual-error" role="alert">{error}</p>}
          <footer className="manual-modal-foot">
            <p>{t.manualHint}</p>
            <div><button type="button" className="cancel" onClick={onClose}>{t.cancel}</button><button type="submit" className="save">{t.saveData}</button></div>
          </footer>
        </form>
      </section>
    </div>
  );
};

export default function AttendanceDashboard() {
  const [records, setRecords] = useState(attendanceData);
  const [selectedDate, setSelectedDate] = useState(attendanceData.at(-1).date);
  const [sourceName, setSourceName] = useState("7월 인력 현황.xlsx");
  const [importState, setImportState] = useState({ type: "", message: "" });
  const [reportState, setReportState] = useState({ type: "", message: "" });
  const [manualOpen, setManualOpen] = useState(false);
  const [language, setLanguage] = useState("ko");
  const fileInputRef = useRef(null);
  const reportRef = useRef(null);

  useEffect(() => {
    try {
      const savedLanguage = localStorage.getItem(LANGUAGE_KEY);
      if (savedLanguage === "vi") setLanguage("vi");
      const savedTranslation = getTranslation(savedLanguage);
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.records?.length) {
        setRecords(saved.records);
        setSourceName(saved.sourceName || "업데이트 파일.xlsx");
        setSelectedDate(saved.records.at(-1).date);
        setImportState({
          type: "success",
          message: savedTranslation.savedFile,
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

  const t = getTranslation(language);
  const toggleLanguage = () => {
    const nextLanguage = language === "ko" ? "vi" : "ko";
    setLanguage(nextLanguage);
    try {
      localStorage.setItem(LANGUAGE_KEY, nextLanguage);
    } catch {
      // The language still changes for the current session.
    }
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportState({ type: "loading", message: t.loadingExcel });

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
        message: t.updated(nextRecords.length, savedForRefresh),
      });
    } catch (error) {
      setImportState({
        type: "error",
        message: error instanceof Error ? error.message : t.fileError,
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
    setImportState({ type: "success", message: t.restored });
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
      downloadExcelReport({ current, records, sourceName, language });
      setReportState({
        type: "success",
        message: `${formatDate(current.date, language)} ${t.excelSaved}`,
      });
    } catch {
      setReportState({ type: "error", message: t.reportError("Excel") });
    }
  };

  const exportPdf = async () => {
    if (!reportRef.current) return;
    setReportState({ type: "loading", message: t.pdfCreating });
    try {
      await downloadPdfReport(reportRef.current, current.date, language);
      setReportState({
        type: "success",
        message: `${formatDate(current.date, language)} ${t.pdfSaved}`,
      });
    } catch {
      setReportState({ type: "error", message: t.reportError("PDF") });
    }
  };

  const saveManualRecord = (record) => {
    const nextRecords = [...records.filter((item) => item.date !== record.date), record]
      .sort((a, b) => a.date.localeCompare(b.date));
    const nextSourceName = sourceName.includes("직접 수정") ? sourceName : `${sourceName} · 직접 수정`;
    setRecords(nextRecords);
    setSelectedDate(record.date);
    setSourceName(nextSourceName);
    setManualOpen(false);
    let savedForRefresh = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ records: nextRecords, sourceName: nextSourceName }));
    } catch {
      savedForRefresh = false;
    }
    setImportState({
      type: "success",
      message: t.manualSaved(formatDate(record.date, language), savedForRefresh),
    });
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
          <a className="active" href="#overview"><Icon name="grid" />{t.dailyStatus}</a>
          <a href="#units"><Icon name="users" />{t.byUnit}</a>
          <a href="#trend"><Icon name="chart" />{t.trend}</a>
          <a href="#reasons"><Icon name="calendar" />{t.reasons}</a>
        </nav>
        <div className="source-card">
          <Icon name="file" />
          <div><span>{t.dataSource}</span><strong title={sourceName}>{sourceName}</strong><small>{records.length}{t.workdays}</small></div>
        </div>
        <div className="sidebar-foot">ACM People Operations<br /><span>Internal dashboard</span></div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">DAILY ATTENDANCE</p>
            <h1>{t.title}</h1>
          </div>
          <div className="top-actions">
            <button
              className="upload-button"
              type="button"
              aria-label={t.chooseFile}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="upload" size={17} />
              <span>{t.chooseFile}</span>
            </button>
            <button
              className="manual-button"
              type="button"
              aria-label={t.manualEntryLabel}
              onClick={() => setManualOpen(true)}
            >
              <Icon name="edit" size={17} />
              <span>{t.manualEntry}</span>
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
              <span className="sr-only">{t.chooseDate}</span>
              <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>
                {[...records].reverse().map((record) => (
                  <option key={record.date} value={record.date}>{formatDate(record.date, language)}</option>
                ))}
              </select>
            </label>
            <button
              className="report-button excel"
              type="button"
              aria-label={t.excelReport}
              onClick={exportExcel}
            >
              <Icon name="sheet" size={17} />
              <span>{t.excelReport}</span>
            </button>
            <button
              className="report-button pdf"
              type="button"
              aria-label={t.pdfReport}
              disabled={reportState.type === "loading"}
              onClick={exportPdf}
            >
              <Icon name="pdf" size={17} />
              <span>{t.pdfReport}</span>
            </button>
            <button className="language-button" type="button" aria-label={t.languageLabel} onClick={toggleLanguage}>
              {t.language}
            </button>
            <button className="icon-button" aria-label="알림"><Icon name="bell" /></button>
            <div className="profile">HR</div>
          </div>
        </header>

        {importState.message && (
          <div className={`import-notice ${importState.type}`} role="status" aria-live="polite">
            <span>{importState.message}</span>
            {records !== attendanceData && importState.type !== "loading" && (
              <button type="button" onClick={resetData}>{t.restore}</button>
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
              <p className="eyebrow light">{formatDate(current.date, language)} · {t.confirmed}</p>
              <h2><span>{current.present}</span>{t.together}</h2>
              <p>{t.heroSummary(current)}</p>
              <div className="hero-tags">
                <span>{t.monthAverage} {monthAverage.toFixed(1)}%</span>
                <span className={delta >= 0 ? "positive" : "negative"}>{t.versusPrevious} {delta >= 0 ? "+" : ""}{delta}%p</span>
              </div>
            </div>
            <AttendanceRing rate={current.rate} label={t.attendanceRate} />
          </section>

          <section className="kpi-grid">
            <article className="kpi-card primary">
              <span>{t.present}</span><strong>{current.present}<small>{t.people}</small></strong>
              <p>Present employees</p>
            </article>
            <article className="kpi-card">
              <span>{t.total}</span><strong>{current.total}<small>{t.people}</small></strong>
              <p>Total workforce</p>
            </article>
            <article className="kpi-card warning">
              <span>{t.absent}</span><strong>{current.absent}<small>{t.people}</small></strong>
              <p>Absent today</p>
            </article>
            <article className="kpi-card">
              <span>{t.attendanceRate}</span><strong>{current.rate.toFixed(1)}<small>%</small></strong>
              <p className={delta >= 0 ? "up" : "down"}>{delta >= 0 ? "↑" : "↓"} {Math.abs(delta)}%p vs. 전일</p>
            </article>
          </section>

          <section className="panel trend-panel" id="trend">
            <div className="panel-head">
              <div><p className="eyebrow">ATTENDANCE TREND</p><h3>{t.recentTrend}</h3></div>
              <div className="trend-stat"><span>{t.selectedDate}</span><strong>{current.rate.toFixed(1)}%</strong></div>
            </div>
            <MiniTrend records={records} selectedIndex={selectedIndex} label={t.recentTrend} />
          </section>

          <section className="panel units-panel" id="units">
            <div className="panel-head">
              <div><p className="eyebrow">BY ORGANIZATION</p><h3>{t.byUnit}</h3></div>
              <span className="status-pill">LIVE SNAPSHOT</span>
            </div>
            <div className="unit-table">
              <div className="unit-row table-head"><span>{t.organization}</span><span>{t.presentTotal}</span><span>{t.absent}</span><span>{t.attendanceRate}</span></div>
              {current.units.map((unit) => {
                const rate = getUnitRate(unit);
                return (
                  <div className="unit-row" key={unit.name}>
                    <span className="unit-name"><i style={{ background: unitAccent[unit.name] }} />{unit.name}</span>
                    <span><strong>{unit.present}</strong> / {unit.total}{t.people}</span>
                    <span>{unit.total - unit.present}{t.people}</span>
                    <span className="unit-rate"><b>{rate.toFixed(1)}%</b><i><em style={{ width: `${rate}%`, background: unitAccent[unit.name] }} /></i></span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel shift-panel">
            <div className="panel-head">
              <div><p className="eyebrow">SHIFT BALANCE</p><h3>{t.shiftBalance}</h3></div>
            </div>
            {[
              { name: t.dayShift, total: current.shifts.dayTotal, absent: current.shifts.dayAbsent, color: "#d8ff3e" },
              { name: t.nightShift, total: current.shifts.nightTotal, absent: current.shifts.nightAbsent, color: "#77a8ff" },
            ].map((shift) => {
              const present = shift.total - shift.absent;
              const rate = shift.total ? (present / shift.total) * 100 : 0;
              return (
                <div className="shift-row" key={shift.name}>
                  <div className="shift-title"><span>{shift.name}</span><strong>{present}<small> / {shift.total}{t.people}</small></strong></div>
                  <div className="bar"><span style={{ width: `${rate}%`, background: shift.color }} /></div>
                  <p>{t.shiftSummary({ absent: shift.absent, rate: rate.toFixed(1) })}</p>
                </div>
              );
            })}
          </section>

          <section className="panel reasons-panel" id="reasons">
            <div className="panel-head">
              <div><p className="eyebrow">ATTENDANCE REASONS</p><h3>{t.reasons}</h3></div>
              <span className="total-absence">{t.totalAbsent} {current.absent}{t.people}</span>
            </div>
            <div className="reason-grid">
              <div className="reason-main"><strong>{current.reasons.unplanned}</strong><span>{t.unplanned}</span><small>Unplanned absence</small></div>
              <div><strong>{current.reasons.approved}</strong><span>{t.approved}</span></div>
              <div><strong>{current.reasons.late}</strong><span>{t.late}</span></div>
              <div><strong>{current.reasons.earlyLeave}</strong><span>{t.earlyLeave}</span></div>
            </div>
          </section>

          <section className="insight-card">
            <span className="insight-index">01</span>
            <div>
              <p className="eyebrow light">{t.todayNote}</p>
              <h3>{t.bestUnit({ name: strongestUnit.name })}</h3>
              <p>{t.bestUnitNote({ best: strongestUnit.name, bestRate: getUnitRate(strongestUnit).toFixed(1), critical: criticalUnit.name, absent: criticalUnit.total - criticalUnit.present })}</p>
            </div>
            <a href="#units" aria-label={t.byUnit}><Icon name="arrow" /></a>
          </section>
        </div>
      </section>
    </main>
    {manualOpen && <ManualEntryModal record={current} language={language} onClose={() => setManualOpen(false)} onSave={saveManualRecord} />}
    <section ref={reportRef} className="pdf-report" aria-hidden="true">
      <header className="pdf-report-head">
        <div>
          <p>ACM PEOPLE OPERATIONS</p>
          <h2>{t.title}</h2>
        </div>
        <span>{formatDate(current.date, language)}</span>
      </header>
      <div className="pdf-source">{t.reportSource}: {sourceName}</div>
      <div className="pdf-kpis">
        <article><span>{t.total}</span><strong>{current.total}<small>{t.people}</small></strong></article>
        <article className="accent"><span>{t.present}</span><strong>{current.present}<small>{t.people}</small></strong></article>
        <article><span>{t.absent}</span><strong>{current.absent}<small>{t.people}</small></strong></article>
        <article><span>{t.attendanceRate}</span><strong>{current.rate.toFixed(1)}<small>%</small></strong></article>
      </div>
      <div className="pdf-columns">
        <article className="pdf-block">
          <h3>{t.byUnit}</h3>
          <table>
            <thead><tr><th>{t.organization}</th><th>{t.presentTotal}</th><th>{t.absent}</th><th>{t.attendanceRate}</th></tr></thead>
            <tbody>
              {current.units.map((unit) => (
                <tr key={unit.name}>
                  <td>{unit.name}</td>
                  <td>{unit.present} / {unit.total}{t.people}</td>
                  <td>{unit.total - unit.present}{t.people}</td>
                  <td>{getUnitRate(unit).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
        <article className="pdf-block">
          <h3>{t.shiftBalance}</h3>
          <table>
            <thead><tr><th>{t.category}</th><th>{t.presentTotal}</th><th>{t.absent}</th><th>{t.attendanceRate}</th></tr></thead>
            <tbody>
              {[
                { name: t.dayShift, total: current.shifts.dayTotal, absent: current.shifts.dayAbsent },
                { name: t.nightShift, total: current.shifts.nightTotal, absent: current.shifts.nightAbsent },
              ].map((shift) => (
                <tr key={shift.name}>
                  <td>{shift.name}</td>
                  <td>{shift.total - shift.absent} / {shift.total}{t.people}</td>
                  <td>{shift.absent}{t.people}</td>
                  <td>{shift.total ? (((shift.total - shift.absent) / shift.total) * 100).toFixed(1) : "0.0"}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </div>
      <article className="pdf-block">
        <h3>{t.reasons}</h3>
        <div className="pdf-reasons">
          {[
            [t.unplanned, current.reasons.unplanned],
            [t.approved, current.reasons.approved],
            [t.late, current.reasons.late],
            [t.earlyLeave, current.reasons.earlyLeave],
            [t.maternity, current.reasons.maternity],
            [t.transfer, current.reasons.transfer],
            [t.resigned, current.reasons.resigned],
          ].map(([label, value]) => (
            <div key={label}><strong>{value}</strong><span>{label}</span></div>
          ))}
        </div>
      </article>
      <article className="pdf-block">
        <h3>{t.recentTrend}</h3>
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
        {t.bestUnitNote({ best: strongestUnit.name, bestRate: getUnitRate(strongestUnit).toFixed(1), critical: criticalUnit.name, absent: criticalUnit.total - criticalUnit.present })}
        <span>ACM Attendance Dashboard</span>
      </footer>
    </section>
    </>
  );
}
