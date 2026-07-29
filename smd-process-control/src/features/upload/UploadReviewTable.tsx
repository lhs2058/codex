import type { UploadReview } from "../../domain/types";
import { useI18n, type TranslationKey } from "../../i18n";

const legacy: Partial<Record<TranslationKey, string>> = {
  "upload.review": "Row review",
  "upload.reviewRegion": "Upload row review",
  "upload.sheet": "Sheet",
  "upload.row": "Row",
  "upload.statusNew": "New",
  "upload.statusConflict": "Conflict",
  "upload.statusError": "Error",
  "common.status": "Status",
  "common.date": "Date",
  "common.line": "Line",
  "common.model": "Model",
  "common.process": "Process",
  "common.messages": "Messages",
  "upload.showMoreRows": "Show more rows",
  "upload.showingRows": "Showing {shown} of {total} rows",
};

export function UploadReviewTable({
  review,
  page = 1,
  total = review.rows.length + review.diagnostics.length,
  pageSize = 200,
  busy = false,
  onPageChange,
}: {
  review: UploadReview;
  page?: number;
  total?: number;
  pageSize?: number;
  busy?: boolean;
  onPageChange?(page: number): void;
}) {
  const { t } = useI18n(legacy);
  const shown = Math.min((page - 1) * pageSize + review.rows.length + review.diagnostics.length, total);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const statusLabel = {
    new: t("upload.statusNew"),
    conflict: t("upload.statusConflict"),
    error: t("upload.statusError"),
  } as const;
  return <section aria-label={t("upload.reviewRegion")}>
    <h2>{t("upload.review")}</h2>
    <p>{t("upload.showingRows", {
      shown,
      total,
    })}</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={t("upload.reviewRegion")}>
    <table className="upload-review-table">
      <thead>
        <tr>
          <th>{t("upload.sheet")}</th>
          <th>{t("upload.row")}</th>
          <th>{t("common.status")}</th>
          <th>{t("common.date")}</th>
          <th>{t("common.line")}</th>
          <th>{t("common.model")}</th>
          <th>{t("common.process")}</th>
          <th>{t("common.messages")}</th>
        </tr>
      </thead>
      <tbody>
        {review.rows.map((row) => <tr key={`${row.sourceSheet}-${row.sourceRow}`}>
          <td>{row.sourceSheet}</td>
          <td>{row.sourceRow}</td>
          <td>{statusLabel[row.status]}</td>
          <td>{row.productionDate}</td>
          <td>{row.lineCode}</td>
          <td>{row.modelCode}</td>
          <td>{row.processCode}</td>
          <td>{row.messages.join("; ") || "—"}</td>
        </tr>)}
        {review.diagnostics.map((diagnostic) => <tr key={`diagnostic-${diagnostic.sourceSheet}-${diagnostic.sourceRow}`}>
          <td>{diagnostic.sourceSheet}</td>
          <td>{diagnostic.sourceRow}</td>
          <td>{t("upload.statusError")}</td>
          <td colSpan={4}>—</td>
          <td>{diagnostic.messages.join("; ")}</td>
        </tr>)}
      </tbody>
    </table></div>
    <nav aria-label="Detail pages">
      <button
        type="button"
        disabled={busy || page <= 1 || !onPageChange}
        onClick={() => onPageChange?.(page - 1)}
      >
        Previous page
      </button>
      <span>Page {page}</span>
      <button
        type="button"
        disabled={busy || page >= pageCount || !onPageChange}
        onClick={() => onPageChange?.(page + 1)}
      >
        Next page
      </button>
    </nav>
  </section>;
}
