import { useState } from "react";
import type { MasterDataSnapshot } from "../../domain/types";
import { useI18n, type TranslationKey } from "../../i18n";

const legacy: Partial<Record<TranslationKey, string>> = {
  "admin.masterData": "Master data",
  "admin.modelCode": "Model code",
  "admin.modelName": "Model name",
  "admin.addModel": "Add model",
  "admin.invalidModel": "Enter a valid model code and name.",
  "admin.downtimeReasons": "Downtime reasons",
  "admin.noDowntimeReasons": "No downtime reasons.",
  "admin.deactivate": "Deactivate {name}",
};

export function MasterDataEditor({
  snapshot,
  createModel,
  deactivateDowntimeReason,
  disabled = false,
}: {
  snapshot: MasterDataSnapshot;
  createModel(input: { code: string; name: string }): Promise<void>;
  deactivateDowntimeReason(id: string, version: number): Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useI18n(legacy);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return <section aria-label={t("admin.masterData")}>
    <h2>{t("admin.masterData")}</h2>
    <form className="admin-form" onSubmit={async (event) => {
      event.preventDefault();
      if (!code.trim() || !name.trim() || code.trim().length > 50 || name.trim().length > 100) {
        setError(t("admin.invalidModel"));
        return;
      }
      setError("");
      await createModel({ code: code.trim(), name: name.trim() });
      setCode("");
      setName("");
    }}>
      <label htmlFor="admin-model-code">{t("admin.modelCode")}</label>
      <input id="admin-model-code" disabled={disabled} value={code} onChange={(event) => setCode(event.target.value)} required />
      <label htmlFor="admin-model-name">{t("admin.modelName")}</label>
      <input id="admin-model-name" disabled={disabled} value={name} onChange={(event) => setName(event.target.value)} required />
      <button disabled={disabled}>{t("admin.addModel")}</button>
      {error && <p role="alert">{error}</p>}
    </form>
    <h3>{t("admin.downtimeReasons")}</h3>
    {snapshot.downtimeReasons.length
      ? <ul>{snapshot.downtimeReasons.map((reason) => <li key={reason.id}>{reason.name} <button disabled={disabled} type="button" aria-label={t("admin.deactivate", { name: reason.name })} onClick={() => deactivateDowntimeReason(reason.id, reason.version)}>{t("admin.deactivate", { name: reason.name })}</button></li>)}</ul>
      : <p>{t("admin.noDowntimeReasons")}</p>}
  </section>;
}
