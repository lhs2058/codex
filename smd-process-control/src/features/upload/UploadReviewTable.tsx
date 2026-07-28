import type { UploadReview } from "../../domain/types";

export function UploadReviewTable({ review }: { review: UploadReview }) {
  return <section aria-label="Upload row review">
    <h2>Row review</h2>
    <table className="upload-review-table">
      <thead>
        <tr>
          <th>Sheet</th>
          <th>Row</th>
          <th>Status</th>
          <th>Date</th>
          <th>Line</th>
          <th>Model</th>
          <th>Process</th>
          <th>Messages</th>
        </tr>
      </thead>
      <tbody>
        {review.rows.map((row) => <tr key={`${row.sourceSheet}-${row.sourceRow}`}>
          <td>{row.sourceSheet}</td>
          <td>{row.sourceRow}</td>
          <td>{row.status}</td>
          <td>{row.productionDate}</td>
          <td>{row.lineCode}</td>
          <td>{row.modelCode}</td>
          <td>{row.processCode}</td>
          <td>{row.messages.join("; ") || "—"}</td>
        </tr>)}
        {review.diagnostics.map((diagnostic) => <tr key={`diagnostic-${diagnostic.sourceSheet}-${diagnostic.sourceRow}`}>
          <td>{diagnostic.sourceSheet}</td>
          <td>{diagnostic.sourceRow}</td>
          <td>error</td>
          <td colSpan={4}>—</td>
          <td>{diagnostic.messages.join("; ")}</td>
        </tr>)}
      </tbody>
    </table>
  </section>;
}
