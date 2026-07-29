import type React from "react";
import type { UploadApproval } from "../../data/repositories/upload-repository";
import type { AppRole, UploadMasterCandidate } from "../../domain/types";

function statusLabel(status: UploadMasterCandidate["status"]): string {
  return {
    existing: "Existing",
    new: "New",
    conflict: "Conflict",
    error: "Error",
  }[status];
}

export function UploadMasterReview(props: {
  candidates: UploadMasterCandidate[];
  role: AppRole;
  approvals: UploadApproval["masterCandidates"];
  onChange(next: UploadApproval["masterCandidates"]): void;
}): React.JSX.Element {
  const approvalFor = (candidate: UploadMasterCandidate) =>
    props.approvals.find((approval) => approval.key === candidate.key) ?? {
      key: candidate.key,
      approved: candidate.approved,
      approvedName: candidate.proposedName,
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

  return <section aria-label="Master candidate review">
    <h2>Master candidates</h2>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Master candidate review">
      <table className="upload-review-table">
        <thead>
          <tr>
            <th>Entity</th>
            <th>Code</th>
            <th>Parent shift</th>
            <th>Proposed name</th>
            <th>Approved name</th>
            <th>Status</th>
            <th>Messages</th>
            <th>Sources</th>
            <th>Approve</th>
          </tr>
        </thead>
        <tbody>
          {props.candidates.map((candidate) => {
            const approval = approvalFor(candidate);
            const editable = props.role === "admin"
              && (candidate.status === "new" || candidate.status === "conflict");
            return <tr key={candidate.key}>
              <td>{candidate.entity}</td>
              <td>{candidate.code}</td>
              <td>{candidate.parentCode ?? "—"}</td>
              <td>{candidate.proposedName}</td>
              <td>
                <label>
                  <span className="sr-only">Approved name {candidate.code}</span>
                  <input
                    aria-label={`Approved name ${candidate.code}`}
                    type="text"
                    value={approval.approvedName}
                    disabled={!editable}
                    onChange={(event) => update(candidate, { approvedName: event.target.value })}
                  />
                </label>
              </td>
              <td>{statusLabel(candidate.status)}</td>
              <td>{candidate.messages.join("; ") || "—"}</td>
              <td>{candidate.sources.map((source) => `${source.sheet} ${source.row}`).join(", ")}</td>
              <td>
                <input
                  aria-label={`Approve ${candidate.entity} ${candidate.code}`}
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
