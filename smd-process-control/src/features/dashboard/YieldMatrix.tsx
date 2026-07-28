import type { MasterDataSnapshot, MetricResult, ProcessCode } from "../../domain/types";
import { useI18n } from "../../i18n";

function formatPercent(result: MetricResult): string {
  return result.status === "ok" ? `${result.value.toFixed(1)}%` : "—";
}

export function YieldMatrix({
  rows,
  master,
}: {
  rows: Array<{ processCode: ProcessCode; lineId: string; result: MetricResult }>;
  master: MasterDataSnapshot;
}) {
  const { t } = useI18n();
  const processes = master.processes.filter((process) => rows.some((row) => row.processCode === process.code));
  const lines = master.lines.filter((line) => rows.some((row) => row.lineId === line.id));
  return <section className="dashboard-card yield-matrix-card">
    <div className="dashboard-card-heading">
      <div><p className="dashboard-eyebrow">PROCESS QUALITY</p><h2>{t("yield.title")}</h2></div>
      <span className="dashboard-legend"><i aria-hidden="true" /> {t("yield.target")}</span>
    </div>
    <div className="yield-matrix-scroll">
      <table aria-label={t("yield.table")} className="yield-matrix">
        <thead><tr><th scope="col">{t("common.process")}</th>{lines.map((line) => <th scope="col" key={line.id}>{line.code}</th>)}</tr></thead>
        <tbody>{processes.map((process) => <tr key={process.id}>
          <th scope="row">{process.name}</th>
          {lines.map((line) => {
            const result = rows.find((row) => row.processCode === process.code && row.lineId === line.id)?.result;
            const value = result?.status === "ok" ? result.value : null;
            const status = value === null ? t("yield.unavailable") : value >= 95 ? t("yield.good") : value >= 90 ? t("yield.watch") : t("yield.low");
            return <td key={line.id}><span className={value === null ? "metric-empty" : value >= 95 ? "metric-good" : value >= 90 ? "metric-watch" : "metric-low"}><span className="metric-symbol" aria-hidden="true">{value === null ? "—" : value >= 95 ? "✓" : value >= 90 ? "!" : "↓"}</span>{result ? formatPercent(result) : "—"}<span className="sr-only"> — {status}</span></span></td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
