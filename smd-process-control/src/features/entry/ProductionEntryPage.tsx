import { useCallback, useEffect, useRef, useState } from "react";
import type { MasterDataSnapshot, ProductionEntryDraft } from "../../domain/types";
import { createMasterDataRepository, type MasterDataRepository } from "../../data/repositories/master-data-repository";
import { createProductionRepository, type ProductionRepository } from "../../data/repositories/production-repository";
import { createQualityRepository } from "../../data/repositories/quality-repository";
import { ProductionEntryForm } from "./ProductionEntryForm";
import { downtimeDurationMinutes } from "../../domain/validation";

let defaults: { master?: Pick<MasterDataRepository, "listMasterData">; production?: ProductionRepository; quality?: ReturnType<typeof createQualityRepository> } = {};
function defaultMaster() { return defaults.master ??= createMasterDataRepository(); }
function defaultProduction() { return defaults.production ??= createProductionRepository(); }
function defaultQuality() { return defaults.quality ??= createQualityRepository(); }
export function ProductionEntryPage({ masterRepository, productionRepository, qualityRepository }: { masterRepository?: Pick<MasterDataRepository, "listMasterData">; productionRepository?: ProductionRepository; qualityRepository?: { findExisting(input: Pick<ProductionEntryDraft, "productionDate" | "shiftId" | "timeSlotId" | "lineId" | "modelId" | "processId">): Promise<any> } }) {
 const masterRepo = useRef(masterRepository ?? defaultMaster()).current; const productionRepo = useRef(productionRepository ?? defaultProduction()).current; const qualityRepo = useRef(qualityRepository).current;
 const [master, setMaster] = useState<MasterDataSnapshot | null>(null); const [error, setError] = useState(""); const [retry, setRetry] = useState(0); const [existing, setExisting] = useState<any>(null); const [conflictDraft, setConflictDraft] = useState<ProductionEntryDraft | null>(null);
 useEffect(() => { let mounted=true; const generation=retry; setError(""); masterRepo.listMasterData().then((data) => { if (mounted && generation===retry) setMaster(data); }).catch(() => { if (mounted && generation===retry) setError("기준정보를 불러오지 못했습니다"); }); return () => { mounted=false; }; }, [masterRepo,retry]);
 const conflict=useCallback(async (draft: ProductionEntryDraft) => { setConflictDraft(draft); setExisting(await (qualityRepo ?? defaultQuality()).findExisting(draft)); }, [qualityRepo]);
 if (error) return <main><p role="alert">{error}</p><button onClick={() => setRetry((n) => n+1)}>Retry</button></main>;
 if (!master) return <p role="status">Loading master data…</p>;
 const name = (items: Array<{ id: string; code: string; name?: string }>, id: string | undefined) => { const item=items.find((x) => x.id===id); return item ? `${item.code}${item.name ? ` — ${item.name}` : ""}` : id || "—"; };
 const detail = (label: string, value: unknown) => <><dt>{label}</dt><dd>{String(value ?? "—")}</dd></>;
 const summary = (value: any) => value.downtimeMinutes ?? (value.downtime ? (() => { const parts=value.downtime.map(downtimeDurationMinutes); return parts.some((n:number|null)=>n===null) ? "Invalid" : parts.reduce((total:number,n:number)=>total+n,0); })() : 0);
 const record = (title: string, value: any) => <section><h2>{title}</h2><dl>{detail("Production date",value.productionDate)}{detail("Shift",name(master.shifts,value.shiftId))}{detail("Time slot",name(master.timeSlots,value.timeSlotId))}{detail("Line",name(master.lines,value.lineId))}{detail("Model",name(master.models,value.modelId))}{detail("Process",name(master.processes,value.processId))}{detail("Version",value.version ?? 0)}{detail("Input",value.inputQty)}{detail("Actual",value.actualQty)}{detail("OK",value.okQty)}{detail("NG",value.ngQty)}{detail("Downtime",summary(value))}</dl></section>;
 return <main><h1>Production entry</h1><ProductionEntryForm masterData={master} repository={productionRepo} onConflict={conflict} />{existing && conflictDraft && <aside aria-label="Existing record comparison">{record("Draft",conflictDraft)}{record("Current record",existing)}</aside>}</main>;
}
