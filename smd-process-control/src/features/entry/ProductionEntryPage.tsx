import { useCallback, useEffect, useRef, useState } from "react";
import type { MasterDataSnapshot, ProductionEntryDraft } from "../../domain/types";
import { createMasterDataRepository, type MasterDataRepository } from "../../data/repositories/master-data-repository";
import { createProductionRepository, type ProductionRepository } from "../../data/repositories/production-repository";
import { createQualityRepository, type ExistingProductionRecord } from "../../data/repositories/quality-repository";
import { downtimeDurationMinutes } from "../../domain/validation";
import { useI18n, type TranslationKey } from "../../i18n";
import { ProductionEntryForm } from "./ProductionEntryForm";

let defaults: {
  master?: Pick<MasterDataRepository, "listMasterData">;
  production?: ProductionRepository;
  quality?: ReturnType<typeof createQualityRepository>;
} = {};
const defaultMaster = () => defaults.master ??= createMasterDataRepository();
const defaultProduction = () => defaults.production ??= createProductionRepository();
const defaultQuality = () => defaults.quality ??= createQualityRepository();

const legacy: Partial<Record<TranslationKey, string>> = {
  "entry.title": "Production entry",
  "entry.masterError": "기준정보를 불러오지 못했습니다",
  "entry.masterLoading": "Loading master data…",
  "common.retry": "Retry",
  "entry.comparison": "Existing record comparison",
  "entry.draft": "Draft",
  "entry.current": "Current record",
  "entry.productionDate": "Production date",
  "entry.shift": "Shift",
  "entry.timeSlot": "Time slot",
  "entry.line": "Line",
  "entry.model": "Model",
  "entry.process": "Process",
  "entry.version": "Version",
  "entry.input": "Input",
  "entry.actual": "Actual",
  "entry.ok": "OK",
  "entry.ng": "NG",
  "downtime.title": "Downtime",
};

export function ProductionEntryPage({
  masterRepository,
  productionRepository,
  qualityRepository,
}: {
  masterRepository?: Pick<MasterDataRepository, "listMasterData">;
  productionRepository?: ProductionRepository;
  qualityRepository?: {
    findExisting(input: Pick<ProductionEntryDraft, "productionDate" | "shiftId" | "timeSlotId" | "lineId" | "modelId" | "processId">): Promise<ExistingProductionRecord | null>;
  };
}) {
  const { t } = useI18n(legacy);
  const masterRepo = useRef(masterRepository ?? defaultMaster()).current;
  const productionRepo = useRef(productionRepository ?? defaultProduction()).current;
  const qualityRepo = useRef(qualityRepository).current;
  const [master, setMaster] = useState<MasterDataSnapshot | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [existing, setExisting] = useState<unknown>(null);
  const [conflictDraft, setConflictDraft] = useState<ProductionEntryDraft | null>(null);

  useEffect(() => {
    let mounted = true;
    const generation = retry;
    setError("");
    masterRepo.listMasterData()
      .then((data) => { if (mounted && generation === retry) setMaster(data); })
      .catch(() => { if (mounted && generation === retry) setError(t("entry.masterError")); });
    return () => { mounted = false; };
  }, [masterRepo, retry, t]);

  const findExisting = useCallback((draft: Pick<ProductionEntryDraft, "productionDate" | "shiftId" | "timeSlotId" | "lineId" | "modelId" | "processId">) =>
    (qualityRepo ?? defaultQuality()).findExisting(draft), [qualityRepo]);
  const conflict = useCallback(async (draft: ProductionEntryDraft, expectedVersion: number) => {
    setConflictDraft(Object.assign({}, draft, { version: expectedVersion }));
    setExisting(await (qualityRepo ?? defaultQuality()).findExisting(draft));
  }, [qualityRepo]);

  if (error) return <main className="feature-main"><p role="alert">{error}</p><button onClick={() => setRetry((value) => value + 1)}>{t("common.retry")}</button></main>;
  if (!master) return <p role="status" aria-live="polite">{t("entry.masterLoading")}</p>;

  const recordValue = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const name = (items: Array<{ id: string; code: string; name?: string }>, id: unknown) => {
    const item = items.find((candidate) => candidate.id === id);
    return item ? `${item.code}${item.name ? ` — ${item.name}` : ""}` : String(id || "—");
  };
  const summary = (value: Record<string, unknown>) => {
    if (typeof value.downtimeMinutes === "number") return value.downtimeMinutes;
    if (!Array.isArray(value.downtime)) return 0;
    const parts = value.downtime.map((row) => downtimeDurationMinutes(row));
    return parts.some((amount) => amount === null)
      ? t("common.notAvailable")
      : parts.reduce((total: number, amount) => total + (amount ?? 0), 0);
  };
  const record = (title: string, input: unknown) => {
    const value = recordValue(input);
    const details: Array<[string, unknown]> = [
      [t("entry.productionDate"), value.productionDate],
      [t("entry.shift"), name(master.shifts, value.shiftId)],
      [t("entry.timeSlot"), name(master.timeSlots, value.timeSlotId)],
      [t("entry.line"), name(master.lines, value.lineId)],
      [t("entry.model"), name(master.models, value.modelId)],
      [t("entry.process"), name(master.processes, value.processId)],
      [t("entry.version"), value.version ?? 0],
      [t("entry.input"), value.inputQty],
      [t("entry.actual"), value.actualQty],
      [t("entry.ok"), value.okQty],
      [t("entry.ng"), value.ngQty],
      [t("downtime.title"), summary(value)],
    ];
    return <section><h2>{title}</h2><dl>{details.map(([label, detail]) =>
      <div key={label}><dt>{label}</dt><dd>{String(detail ?? "—")}</dd></div>)}</dl></section>;
  };

  return <main className="feature-main entry-main">
    <h1>{t("entry.title")}</h1>
    <ProductionEntryForm masterData={master} repository={productionRepo} findExisting={findExisting} onConflict={conflict} />
    {Boolean(existing) && conflictDraft && <aside aria-label={t("entry.comparison")} className="entry-comparison">
      {record(t("entry.draft"), conflictDraft)}
      {record(t("entry.current"), existing)}
    </aside>}
  </main>;
}
