import { useEffect, useMemo, useRef, useState } from "react";
import { previewProductionMetrics, productionEntrySchema, validateDowntime } from "../../domain/validation";
import type { MasterDataSnapshot, ProductionEntryDraft } from "../../domain/types";
import type { ProductionRepository } from "../../data/repositories/production-repository";
import type { ExistingProductionRecord } from "../../data/repositories/quality-repository";
import { useI18n, type TranslationKey } from "../../i18n";
import { DowntimeEditor } from "./DowntimeEditor";

const blank: ProductionEntryDraft = {
  productionDate: "",
  shiftId: "",
  timeSlotId: "",
  lineId: "",
  modelId: "",
  processId: "",
  inputQty: 0,
  actualQty: 0,
  okQty: 0,
  ngQty: 0,
  note: "",
  downtime: [],
};

const legacy: Partial<Record<TranslationKey, string>> = {
  "entry.productionDate": "Production date",
  "entry.shift": "Shift",
  "entry.timeSlot": "Time slot",
  "entry.line": "Line",
  "entry.model": "Model",
  "entry.process": "Process",
  "entry.input": "Input",
  "entry.actual": "Actual",
  "entry.ok": "OK",
  "entry.ng": "NG",
  "entry.note": "Note",
  "entry.save": "Save",
  "entry.saving": "Saving",
  "entry.saved": "Saved",
  "entry.required": "required fields are missing.",
  "entry.conflict": "다른 사용자가 수정했습니다",
  "entry.forbidden": "수정 권한이 없습니다",
  "entry.failed": "저장에 실패했습니다",
  "entry.standardTime": "Standard time: {seconds} sec/unit",
  "entry.standardTimeUnavailable": "Standard time: unavailable",
  "entry.yield": "Yield: {value}",
  "entry.utilization": "Utilization: {value}",
  "common.select": "Select",
};

const fieldKeys = {
  productionDate: "entry.productionDate",
  shiftId: "entry.shift",
  timeSlotId: "entry.timeSlot",
  lineId: "entry.line",
  modelId: "entry.model",
  processId: "entry.process",
  inputQty: "entry.input",
  actualQty: "entry.actual",
  okQty: "entry.ok",
  ngQty: "entry.ng",
  note: "entry.note",
} as const satisfies Record<Exclude<keyof ProductionEntryDraft, "downtime">, TranslationKey>;

export function ProductionEntryForm({
  masterData,
  repository,
  findExisting,
  onConflict,
}: {
  masterData: MasterDataSnapshot;
  repository: ProductionRepository;
  findExisting?(draft: Pick<ProductionEntryDraft, "productionDate" | "shiftId" | "timeSlotId" | "lineId" | "modelId" | "processId">): Promise<ExistingProductionRecord | null>;
  onConflict(draft: ProductionEntryDraft, expectedVersion: number): Promise<void>;
}) {
  const { t } = useI18n(legacy);
  const [draft, setDraft] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [lookupState, setLookupState] = useState<"incomplete" | "loading" | "new" | "existing" | "error">("incomplete");
  const [editing, setEditing] = useState<{ id: string; version: number } | null>(null);
  const [message, setMessage] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const submitting = useRef(false);
  const lookupGeneration = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const parsed = productionEntrySchema.safeParse(draft);
  const preview = useMemo(
    () => parsed.success ? previewProductionMetrics(draft, masterData) : null,
    [draft, masterData, parsed.success],
  );
  const downtimeValid = preview
    ? validateDowntime(draft.downtime, preview.plannedSeconds ?? 0).ok
    : false;
  const valid = parsed.success && preview?.plannedSeconds !== null && downtimeValid;
  const invalidFields = new Set(
    parsed.success
      ? (preview?.plannedSeconds === null ? ["timeSlotId"] : [])
      : parsed.error.issues.map((issue) => String(issue.path[0] ?? "productionDate")),
  );
  const invalidDowntimeRows: Record<number, { reason?: boolean; minutes?: boolean; start?: boolean; end?: boolean }> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path[0] !== "downtime" || typeof issue.path[1] !== "number") continue;
      const index = issue.path[1];
      const row = draft.downtime[index];
      const invalidRow = invalidDowntimeRows[index] ?? {};
      if (issue.path[2] === "reasonId" || !row?.reasonId) {
        invalidRow.reason = true;
      } else if (issue.path[2] === "minutes") {
        invalidRow.minutes = true;
      } else if (issue.path[2] === "startTime") {
        invalidRow.start = true;
      } else if (issue.path[2] === "endTime") {
        invalidRow.end = true;
      } else if (row.minutes !== undefined) {
        invalidRow.minutes = true;
      } else {
        invalidRow.start = true;
        invalidRow.end = true;
      }
      invalidDowntimeRows[index] = invalidRow;
    }
  }
  const downtimeExceedsSlot = parsed.success
    && preview?.plannedSeconds !== null
    && !downtimeValid;
  if (downtimeExceedsSlot && draft.downtime.length > 0) {
    const index = draft.downtime.findIndex((row) => row.minutes !== undefined);
    const targetIndex = index >= 0 ? index : 0;
    invalidDowntimeRows[targetIndex] = draft.downtime[targetIndex].minutes !== undefined
      ? { ...invalidDowntimeRows[targetIndex], minutes: true }
      : { ...invalidDowntimeRows[targetIndex], start: true, end: true };
  }
  const set = <K extends keyof ProductionEntryDraft>(key: K, value: ProductionEntryDraft[K]) => {
    setDraft((old) => ({ ...old, [key]: value }));
    setShowErrors(false);
  };
  const focusFirstInvalid = () => {
    const first = formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']");
    first?.focus();
  };
  useEffect(() => {
    if (showErrors) focusFirstInvalid();
  }, [showErrors]);
  useEffect(() => {
    const naturalKey = {
      productionDate: draft.productionDate,
      shiftId: draft.shiftId,
      timeSlotId: draft.timeSlotId,
      lineId: draft.lineId,
      modelId: draft.modelId,
      processId: draft.processId,
    };
    const generation = ++lookupGeneration.current;
    if (Object.values(naturalKey).some((value) => !value)) {
      setEditing(null);
      setLookupState("incomplete");
      return;
    }
    if (!findExisting) {
      setEditing(null);
      setLookupState("new");
      return;
    }
    setEditing(null);
    setLookupState("loading");
    findExisting(naturalKey).then((record) => {
      if (generation !== lookupGeneration.current) return;
      if (!record) {
        setEditing(null);
        setLookupState("new");
        return;
      }
      setDraft((current) => ({
        ...current,
        inputQty: record.inputQty,
        actualQty: record.actualQty,
        okQty: record.okQty,
        ngQty: record.ngQty,
        note: record.note,
        downtime: record.downtime,
      }));
      setEditing({ id: record.id, version: record.version });
      setLookupState("existing");
    }).catch(() => {
      if (generation !== lookupGeneration.current) return;
      setEditing(null);
      setLookupState("error");
      setMessage(t("entry.failed"));
    });
  }, [
    draft.productionDate,
    draft.shiftId,
    draft.timeSlotId,
    draft.lineId,
    draft.modelId,
    draft.processId,
    findExisting,
  ]);
  const submit = async () => {
    if (submitting.current) return;
    if (!valid || (lookupState !== "new" && lookupState !== "existing")) {
      setShowErrors(true);
      setMessage(t("entry.required"));
      return;
    }
    submitting.current = true;
    setSaving(true);
    setMessage("");
    try {
      const expectedVersion = editing?.version ?? 0;
      await repository.saveProductionRecord(editing ? { ...draft, id: editing.id } : draft, expectedVersion);
      setMessage(t("entry.saved"));
      if (editing) {
        setEditing({ id: editing.id, version: expectedVersion + 1 });
      } else {
        setDraft(blank);
        setLookupState("incomplete");
      }
    } catch (error: unknown) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
      if (code === "40001") {
        setMessage(t("entry.conflict"));
        await onConflict(draft, editing?.version ?? 0);
      } else if (code === "42501") {
        setMessage(t("entry.forbidden"));
      } else {
        setMessage(t("entry.failed"));
      }
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  const invalid = (key: string) => showErrors && invalidFields.has(key);
  const number = (key: "inputQty" | "actualQty" | "okQty" | "ngQty") => {
    const label = t(fieldKeys[key]);
    return <label htmlFor={`entry-${key}`}>{label}
      <input
        id={`entry-${key}`}
        aria-invalid={invalid(key)}
        type="number"
        min="0"
        value={draft[key]}
        onChange={(event) => set(key, event.target.value === "" ? Number.NaN : Number(event.target.value))}
      />
    </label>;
  };
  const select = (
    key: "lineId" | "modelId" | "processId",
    items: Array<{ id: string; name: string; active: boolean }>,
  ) => <label htmlFor={`entry-${key}`}>{t(fieldKeys[key])}
    <select
      id={`entry-${key}`}
      aria-invalid={invalid(key)}
      value={draft[key]}
      onChange={(event) => set(key, event.target.value)}
    >
      <option value="">{t("common.select")}</option>
      {items.filter((item) => item.active).map((item) =>
        <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  </label>;

  return <form
    className="entry-form"
    ref={formRef}
    data-testid="production-entry-form"
    data-record-state={lookupState}
    data-record-id={editing?.id}
    data-record-version={editing?.version}
    noValidate
    onSubmit={(event) => {
    event.preventDefault();
    void submit();
  }}>
    <label htmlFor="entry-productionDate">{t("entry.productionDate")}
      <input id="entry-productionDate" aria-invalid={invalid("productionDate")} type="date" value={draft.productionDate} onChange={(event) => set("productionDate", event.target.value)} />
    </label>
    <label htmlFor="entry-shiftId">{t("entry.shift")}
      <select id="entry-shiftId" aria-invalid={invalid("shiftId")} value={draft.shiftId} onChange={(event) => {
        set("shiftId", event.target.value);
        set("timeSlotId", "");
      }}>
        <option value="">{t("common.select")}</option>
        {masterData.shifts.filter((item) => item.active).map((item) =>
          <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    <label htmlFor="entry-timeSlotId">{t("entry.timeSlot")}
      <select id="entry-timeSlotId" aria-invalid={invalid("timeSlotId")} value={draft.timeSlotId} onChange={(event) => set("timeSlotId", event.target.value)}>
        <option value="">{t("common.select")}</option>
        {masterData.timeSlots.filter((item) => item.shiftId === draft.shiftId).map((item) =>
          <option key={item.id} value={item.id}>{item.code}</option>)}
      </select>
    </label>
    {select("lineId", masterData.lines)}
    {select("modelId", masterData.models)}
    {select("processId", masterData.processes)}
    {number("inputQty")}
    {number("actualQty")}
    {number("okQty")}
    {number("ngQty")}
    <label htmlFor="entry-note">{t("entry.note")}
      <textarea id="entry-note" aria-invalid={invalid("note")} value={draft.note} onChange={(event) => set("note", event.target.value)} />
    </label>
    <DowntimeEditor
      rows={draft.downtime}
      reasons={masterData.downtimeReasons.filter((item) => item.active)}
      invalidRows={showErrors ? invalidDowntimeRows : {}}
      validationMessageId="entry-validation-error"
      onChange={(rows) => set("downtime", rows)}
    />
    {preview && <section className="entry-preview" aria-live="polite">
      <p>{preview.standardTime
        ? t("entry.standardTime", { seconds: preview.standardTime.secondsPerUnit })
        : t("entry.standardTimeUnavailable")}</p>
      <p>{t("entry.yield", { value: preview.yieldResult.status === "ok" ? preview.yieldResult.value : "—" })}</p>
      <p>{t("entry.utilization", { value: preview.utilizationResult.status === "ok" ? preview.utilizationResult.value : "—" })}</p>
    </section>}
    {message && <p id="entry-validation-error" role="alert" aria-live="assertive">{message}</p>}
    <button type="submit" disabled={saving || lookupState === "loading" || lookupState === "error"}>{saving ? t("entry.saving") : t("entry.save")}</button>
  </form>;
}
