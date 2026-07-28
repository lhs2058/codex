import type { AnalysisDataset } from "../../domain/types";

function yieldPercent(row: AnalysisDataset["yieldSeries"][number]): number | null {
  return row.inputQty === 0 ? null : (row.okQty / row.inputQty) * 100;
}

export function TrendChart({ rows }: { rows: AnalysisDataset["yieldSeries"] }) {
  const summary = rows.map((row) => {
    const value = yieldPercent(row);
    return `${row.period} ${value === null ? "산출 불가" : `${value.toFixed(1)}%`}${row.belowTarget ? " 목표 미달" : ""}`;
  }).join(", ");
  return <section className="dashboard-card analysis-trend" aria-label="수율 추이 (%)">
    <div className="dashboard-card-heading">
      <div><p className="dashboard-eyebrow">YIELD TREND</p><h2>수율 추이 (%)</h2></div>
    </div>
    <p className="analysis-summary">수율 추이 요약: {summary || "데이터 없음"}</p>
    <div className="trend-bars" aria-hidden="true">
      {rows.map((row) => {
        const value = yieldPercent(row);
        return <div className="trend-column" key={row.period}>
          <div className="trend-column-plot">
            {row.target !== null && <span className="trend-target" style={{ bottom: `${Math.min(100, row.target)}%` }} />}
            <span className={`trend-value${row.belowTarget ? " is-below" : ""}`} style={{ height: `${Math.min(100, value ?? 0)}%` }} />
          </div>
          <small>{row.period}</small>
          <strong>{value === null ? "—" : `${value.toFixed(1)}%`}</strong>
          {row.belowTarget && <em>목표 미달</em>}
        </div>;
      })}
    </div>
  </section>;
}
