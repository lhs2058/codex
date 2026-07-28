import { useCallback, useEffect, useRef, useState } from "react";
import type { MasterDataSnapshot, ProductionEntryDraft } from "../../domain/types";
import { createMasterDataRepository, type MasterDataRepository } from "../../data/repositories/master-data-repository";
import { createProductionRepository, type ProductionRepository } from "../../data/repositories/production-repository";
import { createQualityRepository } from "../../data/repositories/quality-repository";
import { ProductionEntryForm } from "./ProductionEntryForm";

let defaults: { master?: Pick<MasterDataRepository, "listMasterData">; production?: ProductionRepository; quality?: ReturnType<typeof createQualityRepository> } = {};
function defaultMaster() { return defaults.master ??= createMasterDataRepository(); }
function defaultProduction() { return defaults.production ??= createProductionRepository(); }
function defaultQuality() { return defaults.quality ??= createQualityRepository(); }
export function ProductionEntryPage({ masterRepository, productionRepository, qualityRepository }: { masterRepository?: Pick<MasterDataRepository, "listMasterData">; productionRepository?: ProductionRepository; qualityRepository?: { findExisting(input: Pick<ProductionEntryDraft, "productionDate" | "shiftId" | "timeSlotId" | "lineId" | "modelId" | "processId">): Promise<any> } }) {
 const masterRepo = useRef(masterRepository ?? defaultMaster()).current; const productionRepo = useRef(productionRepository ?? defaultProduction()).current; const qualityRepo = useRef(qualityRepository).current;
 const [master, setMaster] = useState<MasterDataSnapshot | null>(null); const [error, setError] = useState(""); const [retry, setRetry] = useState(0); const [existing, setExisting] = useState<any>(null);
 useEffect(() => { let mounted=true; const generation=retry; setError(""); masterRepo.listMasterData().then((data) => { if (mounted && generation===retry) setMaster(data); }).catch(() => { if (mounted && generation===retry) setError("기준정보를 불러오지 못했습니다"); }); return () => { mounted=false; }; }, [masterRepo,retry]);
 const conflict=useCallback(async (draft: ProductionEntryDraft) => setExisting(await (qualityRepo ?? defaultQuality()).findExisting(draft)), [qualityRepo]);
 if (error) return <main><p role="alert">{error}</p><button onClick={() => setRetry((n) => n+1)}>Retry</button></main>;
 if (!master) return <p role="status">Loading master data…</p>;
 return <main><h1>Production entry</h1><ProductionEntryForm masterData={master} repository={productionRepo} onConflict={conflict} />{existing && <aside aria-label="Existing record comparison"><p>Existing date: {existing.productionDate ?? "—"}</p><p>Existing input: {existing.inputQty}</p><p>Existing actual: {existing.actualQty}</p><p>Existing OK: {existing.okQty}</p><p>Existing NG: {existing.ngQty}</p><p>Existing version: {existing.version}</p><p>Existing downtime: {existing.downtimeMinutes ?? 0}</p></aside>}</main>;
}
