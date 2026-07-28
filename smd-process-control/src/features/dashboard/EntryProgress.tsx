import type { DashboardSnapshot, MasterDataSnapshot } from "../../domain/types";
import { useI18n } from "../../i18n";

export function EntryProgress({
  rows,
  master,
}: {
  rows: DashboardSnapshot["entryProgress"];
  master: MasterDataSnapshot;
}) {
  const { t } = useI18n();
  const labels = {
    complete: t("progress.complete"),
    "in-progress": t("progress.inProgress"),
    waiting: t("progress.waiting"),
  } as const;
  return <section className="dashboard-card entry-progress-card" aria-label={t("progress.title")}>
    <div className="dashboard-card-heading">
      <div><p className="dashboard-eyebrow">HOURLY ENTRY</p><h2>{t("progress.title")}</h2></div>
    </div>
    <ol className="entry-progress">
      {rows.map((row) => {
        const slot = master.timeSlots.find((candidate) => candidate.id === row.timeSlotId);
        return <li className={`entry-progress-item is-${row.status}`} key={row.timeSlotId}>
          <span className="entry-progress-code">{slot?.code ?? "—"}</span>
          <span><strong>{row.status === "complete" ? "✓ " : row.status === "in-progress" ? "… " : "○ "}{labels[row.status]}</strong><small>{slot ? `${slot.startsAt.slice(0, 5)}–${slot.endsAt.slice(0, 5)}` : t("progress.unscheduled")}</small></span>
        </li>;
      })}
    </ol>
  </section>;
}
