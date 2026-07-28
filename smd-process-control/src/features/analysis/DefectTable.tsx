import type { AnalysisDataset } from "../../domain/types";
import { useI18n } from "../../i18n";

export function DefectTable({ rows }: { rows: AnalysisDataset["defects"] }) {
  const { language, t } = useI18n();
  const classificationLabel = {
    pseudo: t("analysis.pseudo"),
    real: t("analysis.real"),
    scrap: t("analysis.scrap"),
  } as const;
  return <section className="dashboard-card defect-detail">
    <div className="dashboard-card-heading">
      <div><p className="dashboard-eyebrow">DEFECT DETAIL</p><h2>{t("analysis.defects")}</h2></div>
    </div>
    <div className="analysis-table-scroll">
      <table aria-label={t("analysis.defects")}>
        <thead><tr><th>{t("analysis.defectType")}</th><th>{t("analysis.classification")}</th><th>{t("common.quantity")} (EA)</th></tr></thead>
        <tbody>{rows.map((row) =>
          <tr key={`${row.type}-${row.classification}`}>
            <th>{row.type}</th><td>{classificationLabel[row.classification]}</td><td>{row.quantity.toLocaleString(language === "vi" ? "vi-VN" : "ko-KR")}</td>
          </tr>)}</tbody>
      </table>
    </div>
    {rows.length === 0 && <p className="dashboard-empty">{t("analysis.defectEmpty")}</p>}
  </section>;
}
