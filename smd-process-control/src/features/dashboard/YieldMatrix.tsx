import type { MasterDataSnapshot, MetricResult, ProcessCode } from "../../domain/types";

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
  const processes = master.processes.filter((process) => rows.some((row) => row.processCode === process.code));
  const lines = master.lines.filter((line) => rows.some((row) => row.lineId === line.id));
  return <section className="dashboard-card yield-matrix-card">
    <div className="dashboard-card-heading">
      <div><p className="dashboard-eyebrow">PROCESS QUALITY</p><h2>공정별 라인 수율</h2></div>
      <span className="dashboard-legend"><i /> 목표 95% 이상</span>
    </div>
    <div className="yield-matrix-scroll">
      <table aria-label="공정별 라인 수율" className="yield-matrix">
        <thead><tr><th scope="col">공정</th>{lines.map((line) => <th scope="col" key={line.id}>{line.code}</th>)}</tr></thead>
        <tbody>{processes.map((process) => <tr key={process.id}>
          <th scope="row">{process.name}</th>
          {lines.map((line) => {
            const result = rows.find((row) => row.processCode === process.code && row.lineId === line.id)?.result;
            const value = result?.status === "ok" ? result.value : null;
            return <td key={line.id}><span className={value === null ? "metric-empty" : value >= 95 ? "metric-good" : value >= 90 ? "metric-watch" : "metric-low"}>{result ? formatPercent(result) : "—"}</span></td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
