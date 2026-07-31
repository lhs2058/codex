import { useEffect, useRef, useState } from "react";
import { useAuthState } from "../../auth/AuthProvider";
import { createMasterDataRepository, type MasterDataRepository } from "../../data/repositories/master-data-repository";
import {
  createUploadRepository,
  type LegacyUploadReview,
  type UploadApproval,
  type UploadRepository,
} from "../../data/repositories/upload-repository";
import type { AppRole, UploadReview } from "../../domain/types";
import { downloadStandardTemplate } from "../../excel/template";
import { useI18n, type TranslationKey } from "../../i18n";
import { UploadMasterReview } from "./UploadMasterReview";
import { UploadReviewTable } from "./UploadReviewTable";
import {
  isBlockedStandardTimeCandidate,
  UploadStandardTimeReview,
} from "./UploadStandardTimeReview";
import { UploadStatusBadge } from "./UploadStatusBadge";

const legacy: Partial<Record<TranslationKey, string>> = {
  "upload.title": "Workbook upload",
  "upload.downloadTemplate": "Download standard template",
  "upload.workbook": "Workbook",
  "upload.reviewableBatches": "Reviewable workbooks",
  "upload.reviewableBatchesLoading": "Loading reviewable workbooks…",
  "upload.openStagedWorkbook": "Open staged workbook {name}",
  "upload.validating": "Validating workbook…",
  "upload.preparing": "Preparing template…",
  "upload.stagingFailed": "Workbook staging failed",
  "upload.commitFailed": "Upload commit failed",
  "upload.templateFailed": "Template download failed",
  "upload.summary": "Upload summary",
  "upload.new": "New",
  "upload.duplicates": "Duplicates",
  "upload.errors": "Errors",
  "upload.unknownMaster": "Unregistered master data",
  "upload.replace": "Replace duplicate records",
  "upload.commit": "Commit upload",
  "upload.committing": "Committing…",
  "upload.committed": "Committed: {inserted} inserted, {replaced} replaced",
  "upload.sourceWorkbook": "Source workbook",
  "upload.sourceFile": "Source file",
  "upload.workbookKind": "Workbook kind",
  "upload.sourceHash": "File hash (SHA-256)",
  "upload.duplicateCompleted": "This workbook was already completed.",
  "upload.masterData": "Master data",
  "upload.masterStatusCounts": "Master status counts",
  "upload.existing": "Existing",
  "upload.conflict": "Conflict",
  "upload.error": "Error",
  "upload.detailStatusCounts": "Detail status counts",
  "upload.detailStatus": "Detail status",
  "upload.allStatuses": "All",
  "upload.duplicatePolicy": "Duplicate policy",
  "upload.skipDuplicates": "Skip duplicate records",
  "upload.commitFinal": "Commit upload",
  "upload.committedDetailed": "Committed: {inserted} inserted, {replaced} replaced, {skipped} skipped, {masters} masters, {standardTimes} standard times",
};

let defaultUploadRepository: UploadRepository | undefined;
let defaultMasterRepository: Pick<MasterDataRepository, "listMasterData"> | undefined;

const uploadRepository = () => defaultUploadRepository ??= createUploadRepository();
const masterRepository = () => defaultMasterRepository ??= createMasterDataRepository();

function isLegacyReview(review: UploadReview): review is LegacyUploadReview {
  return "masterCandidates" in review
    && "standardTimeCandidates" in review
    && "sourceFileName" in review;
}

function initialApproval(review: UploadReview): UploadApproval {
  if (!isLegacyReview(review)) return { masterCandidates: [], standardTimeCandidates: [] };
  return {
    masterCandidates: review.masterCandidates
      .filter((candidate) => candidate.status === "new" || candidate.status === "conflict")
      .map((candidate) => ({
        key: candidate.key,
        approved: candidate.approved,
        approvedName: candidate.currentName ?? candidate.proposedName,
      })),
    standardTimeCandidates: review.standardTimeCandidates
      .filter((candidate) => candidate.status === "new" || candidate.status === "conflict")
      .map((candidate) => ({
        key: candidate.key,
        approved: candidate.approved,
        approvedSecondsPerUnit: candidate.approvedSecondsPerUnit
          ?? candidate.proposedSecondsPerUnit,
        effectiveFrom: candidate.effectiveFrom,
        effectiveTo: candidate.effectiveTo,
      })),
  };
}

function candidatesResolved(review: UploadReview, approval: UploadApproval): boolean {
  if (!isLegacyReview(review)) return true;
  if (review.masterCandidates.some((candidate) => candidate.status === "error")) return false;
  if (review.standardTimeCandidates.some(isBlockedStandardTimeCandidate)) return false;

  const mastersResolved = review.masterCandidates.every((candidate) => {
    if (candidate.status === "existing") return true;
    if (!candidate.resolvable) return false;
    const selected = approval.masterCandidates.find((item) => item.key === candidate.key);
    return candidate.status !== "error"
      && selected?.approved === true
      && selected.approvedName.trim().length > 0
      && (
        candidate.conflictReason !== "name-mismatch"
        || selected.approvedName === candidate.currentName
      );
  });
  const standardTimesResolved = review.standardTimeCandidates.every((candidate) => {
    if (candidate.status === "existing") return true;
    const selected = approval.standardTimeCandidates.find((item) => item.key === candidate.key);
    return candidate.status !== "error"
      && selected?.approved === true
      && selected.approvedSecondsPerUnit !== null
      && Number.isFinite(selected.approvedSecondsPerUnit)
      && selected.approvedSecondsPerUnit > 0;
  });
  return mastersResolved && standardTimesResolved;
}

function requiresAdminApproval(review: UploadReview): boolean {
  return isLegacyReview(review) && (
    review.masterCandidates.some((candidate) =>
      candidate.status === "new" || candidate.status === "conflict")
    || review.standardTimeCandidates.some((candidate) =>
      candidate.status === "new" || candidate.status === "conflict")
  );
}

export function UploadPage({
  repository,
  masterDataRepository,
  templateDownloader = downloadStandardTemplate,
  role,
}: {
  repository?: UploadRepository;
  masterDataRepository?: Pick<MasterDataRepository, "listMasterData">;
  templateDownloader?: typeof downloadStandardTemplate;
  role?: AppRole;
}) {
  const { t } = useI18n(legacy);
  const auth = useAuthState();
  const currentRole = role ?? auth.profile?.role ?? "viewer";
  const repositoryRef = useRef(repository ?? uploadRepository()).current;
  const masterRepositoryRef = useRef(masterDataRepository).current;
  const requestGenerationRef = useRef(0);
  const [review, setReview] = useState<UploadReview | null>(null);
  const [reviewableBatches, setReviewableBatches] = useState<Array<{
    batchId: string;
    sourceFileName: string;
  }>>([]);
  const [batchListLoading, setBatchListLoading] = useState(false);
  const [approval, setApproval] = useState<UploadApproval>({
    masterCandidates: [],
    standardTimeCandidates: [],
  });
  const [replaceConflicts, setReplaceConflicts] = useState(false);
  const [detailStatus, setDetailStatus] = useState("");
  const [pageBusy, setPageBusy] = useState(false);
  const [busy, setBusy] = useState<"stage" | "commit" | "download" | null>(null);
  const [error, setError] = useState("");
  const [commitMessage, setCommitMessage] = useState("");

  useEffect(() => {
    let active = true;
    if (!repositoryRef.listReviewableBatches) return () => { active = false; };
    setBatchListLoading(true);
    repositoryRef.listReviewableBatches()
      .then((batches) => {
        if (active) setReviewableBatches(batches);
      })
      .catch((listError) => {
        if (active) setError(listError instanceof Error ? listError.message : "upload_batch_list_failed");
      })
      .finally(() => {
        if (active) setBatchListLoading(false);
      });
    return () => { active = false; };
  }, [repositoryRef]);

  const stage = async (file: File | undefined) => {
    if (!file || busy) return;
    requestGenerationRef.current += 1;
    setPageBusy(false);
    setBusy("stage");
    setError("");
    setCommitMessage("");
    setReview(null);
    setApproval({ masterCandidates: [], standardTimeCandidates: [] });
    setReplaceConflicts(false);
    setDetailStatus("");
    try {
      const nextReview = await repositoryRef.stageUpload(file);
      setReview(nextReview);
      setApproval(initialApproval(nextReview));
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : t("upload.stagingFailed"));
    } finally {
      setBusy(null);
    }
  };

  const loadPage = async (page: number, status = detailStatus) => {
    if (!review || pageBusy) return;
    const requestedBatchId = review.batchId;
    const requestedGeneration = requestGenerationRef.current;
    setPageBusy(true);
    setError("");
    try {
      const detail = await repositoryRef.loadDetailPage(
        requestedBatchId,
        page,
        status || undefined,
      );
      if (requestGenerationRef.current !== requestedGeneration) return;
      setReview((current) => {
        if (!current || current.batchId !== requestedBatchId) return current;
        return {
          ...current,
          rows: detail.rows,
          diagnostics: detail.diagnostics,
          ...(isLegacyReview(current)
            ? { detailPage: detail.page, detailTotal: detail.total }
            : {}),
        };
      });
    } catch (pageError) {
      if (requestGenerationRef.current === requestedGeneration) {
        setError(pageError instanceof Error ? pageError.message : t("upload.stagingFailed"));
      }
    } finally {
      if (requestGenerationRef.current === requestedGeneration) setPageBusy(false);
    }
  };

  const openBatch = async (batchId: string) => {
    if (!repositoryRef.openUploadReview || busy || pageBusy) return;
    requestGenerationRef.current += 1;
    setPageBusy(true);
    setError("");
    setCommitMessage("");
    setReview(null);
    setApproval({ masterCandidates: [], standardTimeCandidates: [] });
    setReplaceConflicts(false);
    setDetailStatus("");
    try {
      const nextReview = await repositoryRef.openUploadReview(batchId);
      setReview(nextReview);
      setApproval(initialApproval(nextReview));
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "upload_batch_review_failed");
    } finally {
      setPageBusy(false);
    }
  };

  const commit = async () => {
    if (
      !review
      || busy
      || review.errorCount > 0
      || !candidatesResolved(review, approval)
      || (review.conflictCount > 0 && !(currentRole === "admin" && replaceConflicts))
      || (isLegacyReview(review) && review.duplicateCompletedBatch)
    ) return;
    setBusy("commit");
    setError("");
    try {
      const result = await repositoryRef.commitUpload(review.batchId, replaceConflicts, approval);
      setReviewableBatches((current) => current.filter((batch) => batch.batchId !== review.batchId));
      setCommitMessage(t("upload.committedDetailed", {
        inserted: result.insertedCount,
        replaced: result.replacedCount,
        skipped: result.skippedCount ?? 0,
        masters: result.masterInsertedCount ?? 0,
        standardTimes: result.standardTimeInsertedCount ?? 0,
      }));
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : t("upload.commitFailed"));
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    if (busy) return;
    setBusy("download");
    setError("");
    try {
      const master = await (masterRepositoryRef ?? masterRepository()).listMasterData();
      await templateDownloader(master);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : t("upload.templateFailed"));
    } finally {
      setBusy(null);
    }
  };

  const legacyReview = review && isLegacyReview(review) ? review : null;
  const adminApprovalRequired = review ? requiresAdminApproval(review) : false;
  const commitDisabled = !review
    || busy !== null
    || pageBusy
    || review.errorCount > 0
    || !candidatesResolved(review, approval)
    || (adminApprovalRequired && currentRole !== "admin")
    || (review.conflictCount > 0 && !(currentRole === "admin" && replaceConflicts))
    || (isLegacyReview(review) && review.duplicateCompletedBatch === true);
  const detailPage = legacyReview?.detailPage ?? 1;
  const detailTotal = legacyReview
    ? legacyReview.detailTotal
    : (review?.rows.length ?? 0) + (review?.diagnostics.length ?? 0);

  return <main className="feature-main upload-main">
    <h1>{t("upload.title")}</h1>
    {repositoryRef.listReviewableBatches && <section aria-label={t("upload.reviewableBatches")}>
      <h2>{t("upload.reviewableBatches")}</h2>
      {batchListLoading && <p role="status">{t("upload.reviewableBatchesLoading")}</p>}
      {reviewableBatches.length > 0 && <ul>
        {reviewableBatches.map((batch) => <li key={batch.batchId}>
          <span>{batch.sourceFileName}</span>{" "}
          <button
            type="button"
            disabled={busy !== null || pageBusy}
            aria-label={t("upload.openStagedWorkbook", { name: batch.sourceFileName })}
            onClick={() => void openBatch(batch.batchId)}
          >
            {t("upload.openStagedWorkbook", { name: batch.sourceFileName })}
          </button>
        </li>)}
      </ul>}
    </section>}
    <div className="upload-actions">
      <button type="button" onClick={download} disabled={busy !== null}>{t("upload.downloadTemplate")}</button>
      <label htmlFor="upload-workbook">{t("upload.workbook")} <input id="upload-workbook" type="file" accept=".xlsx" disabled={busy !== null} onChange={(event) => void stage(event.target.files?.[0])} /></label>
    </div>
    {busy === "stage" && <p role="status" aria-live="polite">{t("upload.validating")}</p>}
    {busy === "download" && <p role="status" aria-live="polite">{t("upload.preparing")}</p>}
    {error && <p role="alert">{error}</p>}
    {review && <>
      {isLegacyReview(review) && <section className="upload-source" aria-label={t("upload.sourceWorkbook")}>
        <dl>
          <div><dt>{t("upload.sourceFile")}</dt><dd>{review.sourceFileName}</dd></div>
          <div><dt>{t("upload.workbookKind")}</dt><dd>{review.workbookKind}</dd></div>
          <div><dt>{t("upload.sourceHash")}</dt><dd><code>{review.sourceSha256}</code></dd></div>
        </dl>
        {review.duplicateCompletedBatch && <p role="status">{t("upload.duplicateCompleted")}</p>}
      </section>}
      <section className="upload-summary" aria-label={t("upload.summary")}>
        <p>{t("upload.new")}: {review.newCount}</p>
        <p>{t("upload.duplicates")}: {review.conflictCount}</p>
        <p>{t("upload.errors")}: {review.errorCount}</p>
        <p>{t("upload.unknownMaster")}: {review.unknownMasterDataCount}</p>
      </section>
      {isLegacyReview(review) && <>
        <section aria-label={t("upload.masterStatusCounts")}>
          <h2>{t("upload.masterData")}</h2>
          <p><UploadStatusBadge status="existing">{t("upload.existing")}</UploadStatusBadge>: {review.masterCandidates.filter((candidate) => candidate.status === "existing").length}</p>
          <p><UploadStatusBadge status="new">{t("upload.new")}</UploadStatusBadge>: {review.masterCandidates.filter((candidate) => candidate.status === "new").length}</p>
          <p><UploadStatusBadge status="conflict">{t("upload.conflict")}</UploadStatusBadge>: {review.masterCandidates.filter((candidate) => candidate.status === "conflict").length}</p>
          <p><UploadStatusBadge status="error">{t("upload.error")}</UploadStatusBadge>: {review.masterCandidates.filter((candidate) => candidate.status === "error").length}</p>
        </section>
        <fieldset disabled={busy === "commit"}>
          <UploadMasterReview
            candidates={review.masterCandidates}
            role={currentRole}
            approvals={approval.masterCandidates}
            onChange={(masterCandidates) => setApproval((current) => ({ ...current, masterCandidates }))}
          />
          <UploadStandardTimeReview
            candidates={review.standardTimeCandidates}
            role={currentRole}
            approvals={approval.standardTimeCandidates}
            onChange={(standardTimeCandidates) => setApproval((current) => ({ ...current, standardTimeCandidates }))}
          />
        </fieldset>
      </>}
      <section aria-label={t("upload.detailStatusCounts")}>
        <h2>{t("upload.detailStatusCounts")}</h2>
        <p><UploadStatusBadge status="new">{t("upload.new")}</UploadStatusBadge>: {review.newCount}</p>
        <p><UploadStatusBadge status="conflict">{t("upload.conflict")}</UploadStatusBadge>: {review.conflictCount}</p>
        <p><UploadStatusBadge status="error">{t("upload.error")}</UploadStatusBadge>: {review.errorCount}</p>
        <label>
          {t("upload.detailStatus")}
          <select
            aria-label={t("upload.detailStatus")}
            value={detailStatus}
            disabled={pageBusy || busy === "commit"}
            onChange={(event) => {
              const status = event.target.value;
              setDetailStatus(status);
              void loadPage(1, status);
            }}
          >
            <option value="">{t("upload.allStatuses")}</option>
            <option value="new">{t("upload.new")}</option>
            <option value="conflict">{t("upload.conflict")}</option>
            <option value="error">{t("upload.error")}</option>
          </select>
        </label>
      </section>
      <UploadReviewTable
        review={review}
        page={detailPage}
        total={detailTotal}
        busy={pageBusy || busy === "commit"}
        onPageChange={(page) => void loadPage(page)}
      />
      {review.conflictCount > 0 && <fieldset className="upload-duplicate-policy">
        <legend>{t("upload.duplicatePolicy")}</legend>
        <p>{t("upload.skipDuplicates")}</p>
        <label>
          <input
            type="checkbox"
            checked={replaceConflicts}
            disabled={currentRole !== "admin" || busy === "commit"}
            onChange={(event) => setReplaceConflicts(event.target.checked)}
          />
          {t("upload.replace")}
        </label>
      </fieldset>}
      <button type="button" disabled={commitDisabled} onClick={() => void commit()}>
        {busy === "commit" ? t("upload.committing") : t("upload.commitFinal")}
      </button>
    </>}
    {commitMessage && <p role="status" aria-live="polite">{commitMessage}</p>}
  </main>;
}
