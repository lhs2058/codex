import type React from "react";
import type { UploadApproval } from "../../data/repositories/upload-repository";
import type { AppRole, UploadStandardTimeCandidate } from "../../domain/types";
import { useI18n, type TranslationKey } from "../../i18n";
import { UploadStatusBadge } from "./UploadStatusBadge";

const legacy: Partial<Record<TranslationKey, string>> = {
  "upload.standardTimeCandidateReview": "Standard time candidate review",
  "upload.standardTime": "Standard time candidates",
  "upload.standardTimeFormula": "Formula: planned slot seconds / CAPA",
  "common.status": "Status",
  "upload.existing": "Existing",
  "upload.new": "New",
  "upload.conflict": "Conflict",
  "upload.error": "Error",
  "upload.minimum": "Minimum",
  "upload.median": "Median",
  "upload.maximum": "Maximum",
  "upload.effectiveFrom": "Effective from",
  "upload.effectiveTo": "Effective to",
  "upload.openEnded": "Open",
  "upload.approvedStandardTime": "Approved ST",
  "upload.approvedStandardTimeFor": "Approved ST {model} {line} {process}",
  "upload.approveStandardTime": "Approve ST {model} {line} {process}",
  "upload.approve": "Approve",
  "upload.evidence": "Evidence",
  "upload.evidenceRegion": "ST evidence {model} {line} {process}",
  "upload.select": "Select",
  "upload.slot": "Slot",
  "upload.plannedSeconds": "Planned seconds",
  "upload.capacity": "CAPA",
  "upload.calculatedStandardTime": "Calculated ST",
  "upload.sheet": "Sheet",
  "upload.row": "Row",
  "upload.useObservation": "Use {seconds} seconds from {sheet} row {row}",
};

export function isBlockedStandardTimeCandidate(candidate: UploadStandardTimeCandidate): boolean {
  return candidate.status === "error"
    || candidate.messages.some((message) => /overlap/i.test(message));
}

export function UploadStandardTimeReview(props: {
  candidates: UploadStandardTimeCandidate[];
  role: AppRole;
  approvals: UploadApproval["standardTimeCandidates"];
  onChange(next: UploadApproval["standardTimeCandidates"]): void;
}): React.JSX.Element {
  const { t } = useI18n(legacy);
  const statusLabel = {
    existing: t("upload.existing"),
    new: t("upload.new"),
    conflict: t("upload.conflict"),
    error: t("upload.error"),
  } as const;
  const approvalFor = (candidate: UploadStandardTimeCandidate) =>
    props.approvals.find((approval) => approval.key === candidate.key) ?? {
      key: candidate.key,
      approved: candidate.approved,
      approvedSecondsPerUnit: candidate.approvedSecondsPerUnit
        ?? candidate.proposedSecondsPerUnit,
      effectiveFrom: candidate.effectiveFrom,
      effectiveTo: candidate.effectiveTo,
    };

  const update = (
    candidate: UploadStandardTimeCandidate,
    values: Partial<UploadApproval["standardTimeCandidates"][number]>,
  ) => {
    const nextApproval = { ...approvalFor(candidate), ...values };
    const existingIndex = props.approvals.findIndex((approval) => approval.key === candidate.key);
    const next = [...props.approvals];
    if (existingIndex >= 0) next[existingIndex] = nextApproval;
    else next.push(nextApproval);
    props.onChange(next);
  };

  return <section aria-label={t("upload.standardTimeCandidateReview")}>
    <h2>{t("upload.standardTime")}</h2>
    <p>{t("upload.standardTimeFormula")}</p>
    <div className="upload-candidate-grid">
    {props.candidates.map((candidate) => {
      const approval = approvalFor(candidate);
      const blocked = isBlockedStandardTimeCandidate(candidate);
      const editable = props.role === "admin"
        && (candidate.status === "new" || candidate.status === "conflict")
        && !blocked;
      const hasPositiveValue = approval.approvedSecondsPerUnit !== null
        && Number.isFinite(approval.approvedSecondsPerUnit)
        && approval.approvedSecondsPerUnit > 0;
      const labelSuffix = `${candidate.modelCode} ${candidate.lineCode} ${candidate.processCode}`;
      return <article key={candidate.key} className="upload-standard-time-candidate">
        <h3>{labelSuffix}</h3>
        <dl>
          <div><dt>{t("common.status")}</dt><dd><UploadStatusBadge status={candidate.status}>{statusLabel[candidate.status]}</UploadStatusBadge></dd></div>
          <div><dt>{t("upload.minimum")}</dt><dd>{candidate.minimum}</dd></div>
          <div><dt>{t("upload.median")}</dt><dd>{candidate.median}</dd></div>
          <div><dt>{t("upload.maximum")}</dt><dd>{candidate.maximum}</dd></div>
          <div><dt>{t("upload.effectiveFrom")}</dt><dd>{candidate.effectiveFrom}</dd></div>
          <div><dt>{t("upload.effectiveTo")}</dt><dd>{candidate.effectiveTo ?? t("upload.openEnded")}</dd></div>
        </dl>
        {candidate.messages.length > 0 && <p>{candidate.messages.join("; ")}</p>}
        <label>
          {t("upload.approvedStandardTime")}
          <input
            aria-label={t("upload.approvedStandardTimeFor", {
              model: candidate.modelCode,
              line: candidate.lineCode,
              process: candidate.processCode,
            })}
            type="number"
            min="0"
            step="any"
            value={approval.approvedSecondsPerUnit ?? ""}
            disabled={!editable}
            onChange={(event) => {
              const value = event.target.value === "" ? null : Number(event.target.value);
              update(candidate, {
                approvedSecondsPerUnit: value,
                approved: value !== null && value > 0 ? approval.approved : false,
              });
            }}
          />
        </label>
        <label>
          <input
            aria-label={t("upload.approveStandardTime", {
              model: candidate.modelCode,
              line: candidate.lineCode,
              process: candidate.processCode,
            })}
            type="checkbox"
            checked={candidate.status === "existing" || approval.approved}
            disabled={!editable || !hasPositiveValue}
            onChange={(event) => update(candidate, { approved: event.target.checked })}
          />
          {t("upload.approve")}
        </label>
        <details>
          <summary>{t("upload.evidence")}</summary>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={t("upload.evidenceRegion", {
            model: candidate.modelCode,
            line: candidate.lineCode,
            process: candidate.processCode,
          })}>
            <table className="upload-review-table">
              <thead>
                <tr>
                  <th>{t("upload.select")}</th>
                  <th>{t("upload.slot")}</th>
                  <th>{t("upload.plannedSeconds")}</th>
                  <th>{t("upload.capacity")}</th>
                  <th>{t("upload.calculatedStandardTime")}</th>
                  <th>{t("upload.sheet")}</th>
                  <th>{t("upload.row")}</th>
                </tr>
              </thead>
              <tbody>
                {candidate.observations.map((observation) => <tr key={[
                  observation.sheet,
                  observation.row,
                  observation.productionDate,
                  observation.shiftCode,
                  observation.timeSlotCode,
                ].join("|")}>
                  <td>
                    <input
                      aria-label={t("upload.useObservation", {
                        seconds: observation.secondsPerUnit,
                        sheet: observation.sheet,
                        row: observation.row,
                      })}
                      type="radio"
                      name={`st-observation-${candidate.key}`}
                      checked={approval.approvedSecondsPerUnit === observation.secondsPerUnit}
                      disabled={!editable}
                      onChange={() => update(candidate, {
                        approved: false,
                        approvedSecondsPerUnit: observation.secondsPerUnit,
                      })}
                    />
                  </td>
                  <td>{observation.shiftCode} {observation.timeSlotCode}</td>
                  <td>{observation.plannedSeconds}</td>
                  <td>{observation.capacityQty}</td>
                  <td>{observation.secondsPerUnit}</td>
                  <td>{observation.sheet}</td>
                  <td>{observation.row}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </details>
      </article>;
    })}
    </div>
  </section>;
}
