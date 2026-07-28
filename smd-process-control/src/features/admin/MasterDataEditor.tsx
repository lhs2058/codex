import { useState } from "react";
import type { MasterDataSnapshot } from "../../domain/types";

export function MasterDataEditor({ snapshot, createModel, deactivateDowntimeReason }: { snapshot: MasterDataSnapshot; createModel(input: { code: string; name: string }): Promise<void>; deactivateDowntimeReason(id: string): Promise<void> }) {
  const [code, setCode] = useState(""); const [name, setName] = useState("");
  return <section aria-label="Master data"><h2>Master data</h2><form onSubmit={async (e) => { e.preventDefault(); await createModel({ code, name }); setCode(""); setName(""); }}><label>Model code<input value={code} onChange={(e) => setCode(e.target.value)} required /></label><label>Model name<input value={name} onChange={(e) => setName(e.target.value)} required /></label><button>Add model</button></form><h3>Downtime reasons</h3>{snapshot.downtimeReasons.length ? <ul>{snapshot.downtimeReasons.map((reason) => <li key={reason.id}>{reason.name} <button type="button" aria-label={`Deactivate ${reason.name}`} onClick={() => deactivateDowntimeReason(reason.id)}>Deactivate</button></li>)}</ul> : <p>No downtime reasons.</p>}</section>;
}
