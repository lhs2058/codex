import type { MasterDataSnapshot, MetricResult } from "../../domain/types";

function percent(result: MetricResult): string {
  return result.status === "ok" ? `${result.value.toFixed(1)}%` : "—";
}

export function UtilizationBars({
  rows,
  master,
}: {
  rows: Array<{ lineId: string; result: MetricResult }>;
  master: MasterDataSnapshot;
}) {
  return <section className="dashboard-card utilization-card" aria-label="라인 가동률">
    <div className="dashboard-card-heading">
      <div><p className="dashboard-eyebrow">LINE CAPACITY</p><h2>라인 가동률</h2></div>
    </div>
    <div className="utilization-list">
      {rows.map((row) => {
        const line = master.lines.find((candidate) => candidate.id === row.lineId);
        const value = row.result.status === "ok" ? row.result.value : null;
        return <div className="utilization-row" key={row.lineId}>
          <div className="utilization-label"><span>{line?.name ?? row.lineId}</span><strong>{percent(row.result)}</strong></div>
          <div className="utilization-track" aria-hidden="true"><span style={{ width: `${Math.min(Math.max(value ?? 0, 0), 100)}%` }} /></div>
        </div>;
      })}
    </div>
  </section>;
}
