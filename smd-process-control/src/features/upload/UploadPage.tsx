import { useRef, useState } from "react";
import { useAuthState } from "../../auth/AuthProvider";
import { createMasterDataRepository, type MasterDataRepository } from "../../data/repositories/master-data-repository";
import { createUploadRepository, type UploadRepository } from "../../data/repositories/upload-repository";
import type { AppRole, UploadReview } from "../../domain/types";
import { downloadStandardTemplate } from "../../excel/template";
import { UploadReviewTable } from "./UploadReviewTable";

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
      setError(stageError instanceof Error ? stageError.message : "Workbook staging failed");
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
      setCommitMessage(`Committed: ${result.insertedCount} inserted, ${result.replacedCount} replaced`);
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : "Upload commit failed");
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
      setError(downloadError instanceof Error ? downloadError.message : "Template download failed");
    } finally {
      setBusy(null);
    }
  };

  const commitDisabled = !review
    || busy !== null
    || review.errorCount > 0
    || (review.conflictCount > 0 && !(currentRole === "admin" && replaceConflicts));

  return <main>
    <h1>Workbook upload</h1>
    <div className="upload-actions">
      <button type="button" onClick={download} disabled={busy !== null}>Download standard template</button>
      <label>Workbook <input type="file" accept=".xlsx" disabled={busy !== null} onChange={(event) => void stage(event.target.files?.[0])} /></label>
    </div>
    {busy === "stage" && <p role="status">Validating workbook…</p>}
    {busy === "download" && <p role="status">Preparing template…</p>}
    {error && <p role="alert">{error}</p>}
    {review && <>
      <section className="upload-summary" aria-label="Upload summary">
        <p>New: {review.newCount}</p>
        <p>Duplicates: {review.conflictCount}</p>
        <p>Errors: {review.errorCount}</p>
        <p>Unregistered master data: {review.unknownMasterDataCount}</p>
      </section>
      <UploadReviewTable review={review} />
      {currentRole === "admin" && review.conflictCount > 0 && <label>
        <input type="checkbox" checked={replaceConflicts} onChange={(event) => setReplaceConflicts(event.target.checked)} />
        Replace duplicate records
      </label>}
      <button type="button" disabled={commitDisabled} onClick={() => void commit()}>
        {busy === "commit" ? "Committing…" : "Commit upload"}
      </button>
    </>}
    {commitMessage && <p role="status">{commitMessage}</p>}
  </main>;
}
