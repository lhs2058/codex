import type { AnalysisDataset } from "../../domain/types";

const classificationLabel = {
  pseudo: "가성",
  real: "진성",
  scrap: "폐기",
} as const;

export function DefectTable({ rows }: { rows: AnalysisDataset["defects"] }) {
  return <section className="dashboard-card defect-detail">
    <div className="dashboard-card-heading">
      <div><p className="dashboard-eyebrow">DEFECT DETAIL</p><h2>불량 상세 (EA)</h2></div>
    </div>
    <div className="analysis-table-scroll">
      <table aria-label="불량 상세 (EA)">
        <thead><tr><th>불량 유형</th><th>분류</th><th>수량 (EA)</th></tr></thead>
        <tbody>{rows.map((row) =>
          <tr key={`${row.type}-${row.classification}`}>
            <th>{row.type}</th><td>{classificationLabel[row.classification]}</td><td>{row.quantity.toLocaleString("ko-KR")}</td>
          </tr>)}</tbody>
      </table>
    </div>
    {rows.length === 0 && <p className="dashboard-empty">등록된 불량이 없습니다.</p>}
  </section>;
}
