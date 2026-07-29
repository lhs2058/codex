import { useRef, useState } from "react";
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

const legacy: Partial<Record<TranslationKey, string>> = {
  "upload.title": "Workbook upload",
  "upload.downloadTemplate": "Download standard template",
  "upload.workbook": "Workbook",
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
      setCommitMessage(t("upload.committed", { inserted: result.insertedCount, replaced: result.replacedCount }));
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
    <div className="upload-actions">
      <button type="button" onClick={download} disabled={busy !== null}>{t("upload.downloadTemplate")}</button>
      <label htmlFor="upload-workbook">{t("upload.workbook")} <input id="upload-workbook" type="file" accept=".xlsx" disabled={busy !== null} onChange={(event) => void stage(event.target.files?.[0])} /></label>
    </div>
    {busy === "stage" && <p role="status" aria-live="polite">{t("upload.validating")}</p>}
    {busy === "download" && <p role="status" aria-live="polite">{t("upload.preparing")}</p>}
    {error && <p role="alert">{error}</p>}
    {review && <>
      {isLegacyReview(review) && <section aria-label="Source workbook">
        <h2>{review.sourceFileName}</h2>
        <p>Kind: {review.workbookKind}</p>
        <p>SHA-256: {review.sourceSha256}</p>
        {review.duplicateCompletedBatch && <p role="status">This workbook was already completed.</p>}
      </section>}
      <section className="upload-summary" aria-label={t("upload.summary")}>
        <p>{t("upload.new")}: {review.newCount}</p>
        <p>{t("upload.duplicates")}: {review.conflictCount}</p>
        <p>{t("upload.errors")}: {review.errorCount}</p>
        <p>{t("upload.unknownMaster")}: {review.unknownMasterDataCount}</p>
      </section>
      {isLegacyReview(review) && <>
        <section aria-label="Master candidate counts">
          <h2>Master status counts</h2>
          <p>Existing: {review.masterCandidates.filter((candidate) => candidate.status === "existing").length}</p>
          <p>New: {review.masterCandidates.filter((candidate) => candidate.status === "new").length}</p>
          <p>Conflict: {review.masterCandidates.filter((candidate) => candidate.status === "conflict").length}</p>
          <p>Error: {review.masterCandidates.filter((candidate) => candidate.status === "error").length}</p>
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
      <section aria-label="Detail status counts">
        <h2>Detail status counts</h2>
        <p>New: {review.newCount}</p>
        <p>Conflict: {review.conflictCount}</p>
        <p>Error: {review.errorCount}</p>
        <label>
          Detail status
          <select
            aria-label="Detail status"
            value={detailStatus}
            disabled={pageBusy || busy === "commit"}
            onChange={(event) => {
              const status = event.target.value;
              setDetailStatus(status);
              void loadPage(1, status);
            }}
          >
            <option value="">All</option>
            <option value="new">New</option>
            <option value="conflict">Conflict</option>
            <option value="error">Error</option>
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
      {review.conflictCount > 0 && <label>
        <input
          type="checkbox"
          checked={replaceConflicts}
          disabled={currentRole !== "admin" || busy === "commit"}
          onChange={(event) => setReplaceConflicts(event.target.checked)}
        />
        {t("upload.replace")}
      </label>}
      <button type="button" disabled={commitDisabled} onClick={() => void commit()}>
        {busy === "commit" ? t("upload.committing") : t("upload.commit")}
      </button>
    </>}
    {commitMessage && <p role="status" aria-live="polite">{commitMessage}</p>}
  </main>;
}
