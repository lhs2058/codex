import type { DashboardSnapshot, MasterDataSnapshot } from "../../domain/types";

const labels = {
  complete: "입력 완료",
  "in-progress": "입력 중",
  waiting: "대기",
} as const;

export function EntryProgress({
  rows,
  master,
}: {
  rows: DashboardSnapshot["entryProgress"];
  master: MasterDataSnapshot;
}) {
  return <section className="dashboard-card entry-progress-card" aria-label="시간대 입력 진행">
    <div className="dashboard-card-heading">
      <div><p className="dashboard-eyebrow">HOURLY ENTRY</p><h2>시간대 입력 진행</h2></div>
    </div>
    <ol className="entry-progress">
      {rows.map((row) => {
        const slot = master.timeSlots.find((candidate) => candidate.id === row.timeSlotId);
        return <li className={`entry-progress-item is-${row.status}`} key={row.timeSlotId}>
          <span className="entry-progress-code">{slot?.code ?? "—"}</span>
          <span><strong>{labels[row.status]}</strong><small>{slot ? `${slot.startsAt.slice(0, 5)}–${slot.endsAt.slice(0, 5)}` : "시간 미지정"}</small></span>
        </li>;
      })}
    </ol>
  </section>;
}
