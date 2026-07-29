import type React from "react";
import type { UploadApproval } from "../../data/repositories/upload-repository";
import type { AppRole, UploadStandardTimeCandidate } from "../../domain/types";

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

  return <section aria-label="Standard time candidate review">
    <h2>Standard time candidates</h2>
    <p>Formula: planned slot seconds / CAPA</p>
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
          <div><dt>Status</dt><dd>{candidate.status}</dd></div>
          <div><dt>Minimum</dt><dd>{candidate.minimum}</dd></div>
          <div><dt>Median</dt><dd>{candidate.median}</dd></div>
          <div><dt>Maximum</dt><dd>{candidate.maximum}</dd></div>
          <div><dt>Effective from</dt><dd>{candidate.effectiveFrom}</dd></div>
          <div><dt>Effective to</dt><dd>{candidate.effectiveTo ?? "Open"}</dd></div>
        </dl>
        {candidate.messages.length > 0 && <p>{candidate.messages.join("; ")}</p>}
        <label>
          Approved ST
          <input
            aria-label={`Approved ST ${labelSuffix}`}
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
            aria-label={`Approve ST ${labelSuffix}`}
            type="checkbox"
            checked={candidate.status === "existing" || approval.approved}
            disabled={!editable || !hasPositiveValue}
            onChange={(event) => update(candidate, { approved: event.target.checked })}
          />
          Approve
        </label>
        <details>
          <summary>Evidence</summary>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={`ST evidence ${labelSuffix}`}>
            <table className="upload-review-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Slot</th>
                  <th>Planned seconds</th>
                  <th>CAPA</th>
                  <th>Calculated ST</th>
                  <th>Sheet</th>
                  <th>Row</th>
                </tr>
              </thead>
              <tbody>
                {candidate.observations.map((observation) => <tr key={`${observation.sheet}-${observation.row}`}>
                  <td>
                    <input
                      aria-label={`Use ${observation.secondsPerUnit} seconds from ${observation.sheet} row ${observation.row}`}
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
  </section>;
}
