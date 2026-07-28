import { useState } from "react";
import type { MasterDataSnapshot, StandardTimeInput } from "../../domain/types";
import { useI18n, type TranslationKey } from "../../i18n";

const legacy: Partial<Record<TranslationKey, string>> = {
  "admin.standardTime": "Standard time",
  "admin.stModel": "ST model",
  "common.process": "Process",
  "common.line": "Line",
  "common.select": "Select",
  "admin.secondsPerUnit": "Seconds per unit",
  "admin.effectiveFrom": "Effective from",
  "admin.effectiveTo": "Effective to",
  "admin.saveStandardTime": "Save standard time",
  "admin.invalidStandardTime": "Enter valid standard time values.",
  "admin.overlap": "Effective period overlaps an existing standard time.",
  "admin.standardTimeSaveError": "Unable to save standard time.",
};

export function StandardTimeEditor({
  snapshot,
  save,
  disabled = false,
}: {
  snapshot: MasterDataSnapshot;
  save(value: StandardTimeInput): Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useI18n(legacy);
  const [modelId, setModelId] = useState("");
  const [processId, setProcessId] = useState("");
  const [lineId, setLineId] = useState("");
  const [seconds, setSeconds] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");

  return <section aria-label={t("admin.standardTime")}>
    <h2>{t("admin.standardTime")}</h2>
    <form className="admin-form" onSubmit={async (event) => {
      event.preventDefault();
      const value = Number(seconds);
      if (!modelId || !processId || !lineId || !from || !Number.isFinite(value) || value <= 0) {
        setError(t("admin.invalidStandardTime"));
        return;
      }
      setError("");
      try {
        await save({ modelId, processId, lineId, secondsPerUnit: value, effectiveFrom: from, effectiveTo: to || null });
        setSeconds("");
        setFrom("");
        setTo("");
      } catch (cause) {
        setError(cause instanceof Error && cause.message === "overlapping-effective-period"
          ? t("admin.overlap")
          : t("admin.standardTimeSaveError"));
      }
    }}>
      <label htmlFor="st-model">{t("admin.stModel")}</label>
      <input id="st-model" disabled={disabled} value={modelId} onChange={(event) => setModelId(event.target.value)} required />
      <label htmlFor="st-process">{t("common.process")}</label>
      <select id="st-process" disabled={disabled} value={processId} onChange={(event) => setProcessId(event.target.value)} required><option value="">{t("common.select")} {t("common.process")}</option>{snapshot.processes.map((value) => <option key={value.id} value={value.id}>{value.code}</option>)}</select>
      <label htmlFor="st-line">{t("common.line")}</label>
      <select id="st-line" disabled={disabled} value={lineId} onChange={(event) => setLineId(event.target.value)} required><option value="">{t("common.select")} {t("common.line")}</option>{snapshot.lines.map((value) => <option key={value.id} value={value.id}>{value.code}</option>)}</select>
      <label htmlFor="st-seconds">{t("admin.secondsPerUnit")}</label>
      <input id="st-seconds" disabled={disabled} type="number" min="0.000001" step="any" value={seconds} onChange={(event) => setSeconds(event.target.value)} required />
      <label htmlFor="st-from">{t("admin.effectiveFrom")}</label>
      <input id="st-from" disabled={disabled} type="date" value={from} onChange={(event) => setFrom(event.target.value)} required />
      <label htmlFor="st-to">{t("admin.effectiveTo")}</label>
      <input id="st-to" disabled={disabled} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
      <button disabled={disabled}>{t("admin.saveStandardTime")}</button>
    </form>
    {error && <p role="alert">{error}</p>}
  </section>;
}
