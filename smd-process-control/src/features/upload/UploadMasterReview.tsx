import type React from "react";
import type { UploadApproval } from "../../data/repositories/upload-repository";
import type { AppRole, UploadMasterCandidate } from "../../domain/types";
import { useI18n, type TranslationKey } from "../../i18n";

const legacy: Partial<Record<TranslationKey, string>> = {
  "upload.masterCandidateReview": "Master candidate review",
  "upload.masterCandidates": "Master candidates",
  "upload.entity": "Entity",
  "upload.code": "Code",
  "upload.parentShift": "Parent shift",
  "upload.proposedName": "Proposed name",
  "upload.currentName": "Current canonical name",
  "upload.approvedName": "Approved name",
  "common.status": "Status",
  "upload.conflictReason": "Conflict reason",
  "upload.resolution": "Resolution",
  "common.messages": "Messages",
  "upload.sources": "Sources",
  "upload.approve": "Approve",
  "upload.existing": "Existing",
  "upload.new": "New",
  "upload.conflict": "Conflict",
  "upload.error": "Error",
  "upload.resolvable": "Resolvable",
  "upload.blocked": "Blocked",
  "upload.approvedNameFor": "Approved name {code}",
  "upload.approveMaster": "Approve {entity} {code}",
};

export function UploadMasterReview(props: {
  candidates: UploadMasterCandidate[];
  role: AppRole;
  approvals: UploadApproval["masterCandidates"];
  onChange(next: UploadApproval["masterCandidates"]): void;
}): React.JSX.Element {
  const { t } = useI18n(legacy);
  const statusLabel = {
    existing: t("upload.existing"),
    new: t("upload.new"),
    conflict: t("upload.conflict"),
    error: t("upload.error"),
  } as const;
  const approvalFor = (candidate: UploadMasterCandidate) =>
    props.approvals.find((approval) => approval.key === candidate.key) ?? {
      key: candidate.key,
      approved: candidate.approved,
      approvedName: candidate.currentName ?? candidate.proposedName,
    };

  const update = (
    candidate: UploadMasterCandidate,
    values: Partial<UploadApproval["masterCandidates"][number]>,
  ) => {
    const nextApproval = { ...approvalFor(candidate), ...values };
    const existingIndex = props.approvals.findIndex((approval) => approval.key === candidate.key);
    const next = [...props.approvals];
    if (existingIndex >= 0) next[existingIndex] = nextApproval;
    else next.push(nextApproval);
    props.onChange(next);
  };

  return <section aria-label={t("upload.masterCandidateReview")}>
    <h2>{t("upload.masterCandidates")}</h2>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={t("upload.masterCandidateReview")}>
      <table className="upload-review-table">
        <thead>
          <tr>
            <th>{t("upload.entity")}</th>
            <th>{t("upload.code")}</th>
            <th>{t("upload.parentShift")}</th>
            <th>{t("upload.proposedName")}</th>
            <th>{t("upload.currentName")}</th>
            <th>{t("upload.approvedName")}</th>
            <th>{t("common.status")}</th>
            <th>{t("upload.conflictReason")}</th>
            <th>{t("upload.resolution")}</th>
            <th>{t("common.messages")}</th>
            <th>{t("upload.sources")}</th>
            <th>{t("upload.approve")}</th>
          </tr>
        </thead>
        <tbody>
          {props.candidates.map((candidate) => {
            const approval = approvalFor(candidate);
            const editable = props.role === "admin"
              && (
                candidate.status === "new"
                || (candidate.status === "conflict" && candidate.resolvable)
              );
            return <tr key={candidate.key}>
              <td>{candidate.entity}</td>
              <td>{candidate.code}</td>
              <td>{candidate.parentCode ?? "—"}</td>
              <td>{candidate.proposedName}</td>
              <td>{candidate.currentName ?? "—"}</td>
              <td>
                <label>
                  <span className="sr-only">{t("upload.approvedNameFor", { code: candidate.code })}</span>
                  <input
                    aria-label={t("upload.approvedNameFor", { code: candidate.code })}
                    type="text"
                    value={approval.approvedName}
                    disabled={!editable}
                    onChange={(event) => update(candidate, { approvedName: event.target.value })}
                  />
                </label>
              </td>
              <td><span className={`upload-status-badge is-${candidate.status}`}>{statusLabel[candidate.status]}</span></td>
              <td>{candidate.conflictReason ?? "—"}</td>
              <td>{candidate.resolvable ? t("upload.resolvable") : t("upload.blocked")}</td>
              <td>{candidate.messages.join("; ") || "—"}</td>
              <td>{candidate.sources.map((source) => `${source.sheet} ${source.row}`).join(", ")}</td>
              <td>
                <input
                  aria-label={t("upload.approveMaster", {
                    entity: candidate.entity,
                    code: candidate.code,
                  })}
                  type="checkbox"
                  checked={candidate.status === "existing" || approval.approved}
                  disabled={!editable || candidate.status === "error"}
                  onChange={(event) => update(candidate, { approved: event.target.checked })}
                />
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </section>;
}
