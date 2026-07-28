import { useState } from "react";
import type { MasterDataSnapshot, StandardTimeInput } from "../../domain/types";

export function StandardTimeEditor({ snapshot, save, disabled = false }: { snapshot: MasterDataSnapshot; save(input: StandardTimeInput): Promise<unknown>; disabled?: boolean }) {
  const [modelId, setModelId] = useState(""); const [seconds, setSeconds] = useState(""); const [from, setFrom] = useState(""); const [error, setError] = useState("");
  const processId = snapshot.processes[0]?.id ?? ""; const lineId = snapshot.lines[0]?.id ?? "";
  return <section aria-label="Standard time"><h2>Standard time</h2><form onSubmit={async event => {
    event.preventDefault(); const value = Number(seconds);
    if (!modelId || !processId || !lineId || !from || !Number.isFinite(value) || value <= 0) { setError("Enter valid standard time values."); return; }
    setError(""); try { await save({ modelId, processId, lineId, secondsPerUnit: value, effectiveFrom: from, effectiveTo: null }); setSeconds(""); setFrom(""); }
    catch (cause) { setError(cause instanceof Error && cause.message === "overlapping-effective-period" ? "Effective period overlaps an existing standard time." : "Unable to save standard time."); }
  }}><label>ST model<input disabled={disabled} aria-label="ST model" value={modelId} onChange={e => setModelId(e.target.value)} required /></label><label>Seconds per unit<input disabled={disabled} type="number" min="0.000001" step="any" value={seconds} onChange={e => setSeconds(e.target.value)} required /></label><label>Effective from<input disabled={disabled} type="date" value={from} onChange={e => setFrom(e.target.value)} required /></label><button disabled={disabled}>Save standard time</button></form>{error && <p role="alert">{error}</p>}</section>;
}
