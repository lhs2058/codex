import { useEffect, useRef, useState } from "react";
import { createMasterDataRepository, type MasterDataRepository } from "../../data/repositories/master-data-repository";
import type { MasterDataSnapshot } from "../../domain/types";
import { MasterDataEditor } from "./MasterDataEditor";
import { StandardTimeEditor } from "./StandardTimeEditor";
import { UserEditor, type NewUser } from "./UserEditor";

async function invokeAdminCreateUser(input: NewUser) { const client: any = (await import("../../data/supabase")).getSupabaseClient(); const { error } = await client.functions.invoke("admin-create-user", { body: input }); if (error) throw new Error(error.message || "user_creation_failed"); }
export function AdminPage({ repository, createUser = invokeAdminCreateUser }: { repository?: MasterDataRepository; createUser?: (input: NewUser) => Promise<unknown> }) {
  const [snapshot, setSnapshot] = useState<MasterDataSnapshot | null>(null); const [error, setError] = useState(""); const [mutating, setMutating] = useState(false); const mounted = useRef(true); const generation = useRef(0); const mutationLockRef = useRef(false); const getRepository = () => repository ?? createMasterDataRepository();
  const refresh = async () => { const current = ++generation.current; try { const next = await getRepository().listMasterData(); if (mounted.current && current === generation.current) { setSnapshot(next); setError(""); } } catch (cause) { if (mounted.current && current === generation.current) setError(cause instanceof Error ? cause.message : "Unable to load master data."); } };
  const mutate = async (action: () => Promise<unknown>) => { if (mutationLockRef.current) return; mutationLockRef.current = true; setMutating(true); setError(""); try { await action(); await refresh(); } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Unable to save changes."); throw cause; } finally { mutationLockRef.current = false; if (mounted.current) setMutating(false); } };
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; generation.current++; }; }, [repository]);
  return <main><h1>Administration</h1><p>Admin workspace</p>{!snapshot && !error && <p role="status">Loading master data…</p>}{error && <p role="alert">{error}</p>}{error && <button onClick={() => void refresh()} disabled={mutating}>Retry</button>}{snapshot && <><MasterDataEditor disabled={mutating} snapshot={snapshot} createModel={(input) => mutate(() => getRepository().createModel(input))} deactivateDowntimeReason={(id, version) => mutate(() => getRepository().deactivateDowntimeReason(id, version))} /><StandardTimeEditor disabled={mutating} snapshot={snapshot} save={(input) => mutate(() => getRepository().saveStandardTime(input))} /><UserEditor createUser={createUser} /></>}</main>;
}
