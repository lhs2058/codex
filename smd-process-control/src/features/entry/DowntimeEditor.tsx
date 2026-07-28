import type { DowntimeDraft } from "../../domain/types";
import { useI18n, type TranslationKey } from "../../i18n";

const legacy: Partial<Record<TranslationKey, string>> = {
  "downtime.title": "Downtime",
  "downtime.reason": "reason",
  "downtime.minutes": "minutes",
  "downtime.start": "start",
  "downtime.end": "end",
  "downtime.note": "note",
  "downtime.add": "Add downtime",
  "downtime.remove": "Remove downtime {index}",
  "common.select": "Select",
};

export function DowntimeEditor({
  rows,
  reasons,
  invalidRows = {},
  validationMessageId,
  onChange,
}: {
  rows: DowntimeDraft[];
  reasons: Array<{ id: string; name: string }>;
  invalidRows?: Record<number, { reason?: boolean; minutes?: boolean; start?: boolean; end?: boolean }>;
  validationMessageId?: string;
  onChange(rows: DowntimeDraft[]): void;
}) {
  const { t } = useI18n(legacy);
  const update = (index: number, patch: Partial<DowntimeDraft>) =>
    onChange(rows.map((row, candidate) => candidate === index ? { ...row, ...patch } : row));
  return <fieldset className="downtime-editor">
    <legend>{t("downtime.title")}</legend>
    {rows.map((row, index) => {
      const number = index + 1;
      const invalid = invalidRows[index] ?? {};
      const describedBy = (isInvalid: boolean | undefined) => isInvalid ? validationMessageId : undefined;
      return <div className="downtime-row" key={index}>
        <label htmlFor={`downtime-reason-${number}`}>{t("downtime.reason")}</label>
        <select id={`downtime-reason-${number}`} aria-label={`${t("downtime.title")} ${t("downtime.reason")} ${number}`} aria-invalid={invalid.reason} aria-describedby={describedBy(invalid.reason)} value={row.reasonId} onChange={(event) => update(index, { reasonId: event.target.value })}>
          <option value="">{t("common.select")}</option>
          {reasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}
        </select>
        <label htmlFor={`downtime-minutes-${number}`}>{t("downtime.minutes")}</label>
        <input id={`downtime-minutes-${number}`} aria-label={`${t("downtime.title")} ${t("downtime.minutes")} ${number}`} aria-invalid={invalid.minutes} aria-describedby={describedBy(invalid.minutes)} type="number" min="0" step="1" value={row.minutes ?? ""} onChange={(event) => update(index, { minutes: event.target.value === "" ? undefined : Number(event.target.value), startTime: undefined, endTime: undefined })} />
        <label htmlFor={`downtime-start-${number}`}>{t("downtime.start")}</label>
        <input id={`downtime-start-${number}`} aria-label={`${t("downtime.title")} ${t("downtime.start")} ${number}`} aria-invalid={invalid.start} aria-describedby={describedBy(invalid.start)} type="time" step="60" value={row.startTime ?? ""} onChange={(event) => update(index, { startTime: event.target.value || undefined, minutes: undefined })} />
        <label htmlFor={`downtime-end-${number}`}>{t("downtime.end")}</label>
        <input id={`downtime-end-${number}`} aria-label={`${t("downtime.title")} ${t("downtime.end")} ${number}`} aria-invalid={invalid.end} aria-describedby={describedBy(invalid.end)} type="time" step="60" value={row.endTime ?? ""} onChange={(event) => update(index, { endTime: event.target.value || undefined, minutes: undefined })} />
        <label htmlFor={`downtime-note-${number}`}>{t("downtime.note")}</label>
        <input id={`downtime-note-${number}`} aria-label={`${t("downtime.title")} ${t("downtime.note")} ${number}`} value={row.note} onChange={(event) => update(index, { note: event.target.value })} />
        <button type="button" aria-label={t("downtime.remove", { index: number })} onClick={() => onChange(rows.filter((_, candidate) => candidate !== index))}>{t("common.remove")}</button>
      </div>;
    })}
    <button type="button" onClick={() => onChange([...rows, { reasonId: "", minutes: 0, note: "" }])}>{t("downtime.add")}</button>
  </fieldset>;
}
