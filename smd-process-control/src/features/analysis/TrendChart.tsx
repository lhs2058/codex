import type { AnalysisDataset } from "../../domain/types";
import { useI18n } from "../../i18n";

function yieldPercent(row: AnalysisDataset["yieldSeries"][number]): number | null {
  return row.inputQty === 0 ? null : (row.okQty / row.inputQty) * 100;
}

export function TrendChart({ rows }: { rows: AnalysisDataset["yieldSeries"] }) {
  const { t } = useI18n();
  const summary = rows.map((row) => {
    const value = yieldPercent(row);
    return `${row.period} ${value === null ? t("common.notAvailable") : `${value.toFixed(1)}%`}${row.belowTarget ? ` ${t("analysis.belowTarget")}` : ""}`;
  }).join(", ");
  return <section className="dashboard-card analysis-trend" aria-label={t("analysis.trend")}>
    <div className="dashboard-card-heading">
      <div><p className="dashboard-eyebrow">YIELD TREND</p><h2>{t("analysis.trend")}</h2></div>
    </div>
    <p className="analysis-summary">{t("analysis.trendSummary")}: {summary || t("analysis.noData")}</p>
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
          {row.belowTarget && <em>! {t("analysis.belowTarget")}</em>}
        </div>;
      })}
    </div>
  </section>;
}
