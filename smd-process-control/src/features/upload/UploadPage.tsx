import { useRef, useState } from "react";
import { useAuthState } from "../../auth/AuthProvider";
import { createMasterDataRepository, type MasterDataRepository } from "../../data/repositories/master-data-repository";
import { createUploadRepository, type UploadRepository } from "../../data/repositories/upload-repository";
import type { AppRole, UploadReview } from "../../domain/types";
import { downloadStandardTemplate } from "../../excel/template";
import { UploadReviewTable } from "./UploadReviewTable";
import { useI18n, type TranslationKey } from "../../i18n";

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
  const [review, setReview] = useState<UploadReview | null>(null);
  const [replaceConflicts, setReplaceConflicts] = useState(false);
  const [busy, setBusy] = useState<"stage" | "commit" | "download" | null>(null);
  const [error, setError] = useState("");
  const [commitMessage, setCommitMessage] = useState("");

  const stage = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy("stage");
    setError("");
    setCommitMessage("");
    setReview(null);
    setReplaceConflicts(false);
    try {
      setReview(await repositoryRef.stageUpload(file));
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : t("upload.stagingFailed"));
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!review || busy || review.errorCount > 0 || (review.conflictCount > 0 && !replaceConflicts)) return;
    setBusy("commit");
    setError("");
    try {
      const result = await repositoryRef.commitUpload(review.batchId, replaceConflicts);
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

  const commitDisabled = !review
    || busy !== null
    || review.errorCount > 0
    || (review.conflictCount > 0 && !(currentRole === "admin" && replaceConflicts));

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
      <section className="upload-summary" aria-label={t("upload.summary")}>
        <p>{t("upload.new")}: {review.newCount}</p>
        <p>{t("upload.duplicates")}: {review.conflictCount}</p>
        <p>{t("upload.errors")}: {review.errorCount}</p>
        <p>{t("upload.unknownMaster")}: {review.unknownMasterDataCount}</p>
      </section>
      <UploadReviewTable review={review} />
      {currentRole === "admin" && review.conflictCount > 0 && <label>
        <input type="checkbox" checked={replaceConflicts} onChange={(event) => setReplaceConflicts(event.target.checked)} />
        {t("upload.replace")}
      </label>}
      <button type="button" disabled={commitDisabled} onClick={() => void commit()}>
        {busy === "commit" ? t("upload.committing") : t("upload.commit")}
      </button>
    </>}
    {commitMessage && <p role="status" aria-live="polite">{commitMessage}</p>}
  </main>;
}
