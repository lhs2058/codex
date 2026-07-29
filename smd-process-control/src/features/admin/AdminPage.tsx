import { useEffect, useRef, useState } from "react";
import {
  createMasterDataRepository,
  type AdminOverview,
  type MasterDataRepository,
} from "../../data/repositories/master-data-repository";
import type { MasterDataSnapshot } from "../../domain/types";
import { useI18n, type TranslationKey } from "../../i18n";
import { MasterDataEditor } from "./MasterDataEditor";
import { StandardTimeEditor } from "./StandardTimeEditor";
import { UserEditor, type NewUser } from "./UserEditor";
import { AdminOperationsPanel } from "./AdminOperationsPanel";

const legacy: Partial<Record<TranslationKey, string>> = {
  "admin.title": "Administration",
  "admin.description": "Admin workspace",
  "admin.loading": "Loading master data…",
  "admin.loadError": "Unable to load master data.",
  "admin.saveError": "Unable to save changes.",
  "common.retry": "Retry",
};

async function invokeAdminCreateUser(input: NewUser) {
  const client = (await import("../../data/supabase")).getSupabaseClient();
  const { error } = await client.functions.invoke("admin-create-user", { body: input });
  if (error) throw new Error(error.message || "user_creation_failed");
}

export function AdminPage({
  repository,
  createUser = invokeAdminCreateUser,
}: {
  repository?: MasterDataRepository;
  createUser?(input: NewUser): Promise<unknown>;
}) {
  const { t } = useI18n(legacy);
  const [snapshot, setSnapshot] = useState<MasterDataSnapshot | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");
  const [mutating, setMutating] = useState(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const lock = useRef(false);
  const repo = () => repository ?? createMasterDataRepository();
  const refresh = async () => {
    const current = ++generation.current;
    try {
      const [value, admin] = await Promise.all([
        repo().listMasterData(),
        repo().listAdminOverview(),
      ]);
      if (mounted.current && current === generation.current) {
        setSnapshot(value);
        setOverview(admin);
        setError("");
      }
    } catch (cause) {
      if (mounted.current && current === generation.current) {
        setError(cause instanceof Error ? cause.message : t("admin.loadError"));
      }
    }
  };
  const mutate = async (action: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setMutating(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : t("admin.saveError"));
      throw cause;
    } finally {
      lock.current = false;
      if (mounted.current) setMutating(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [repository]);

  return <main className="feature-main admin-main">
    <h1>{t("admin.title")}</h1>
    <p>{t("admin.description")}<span aria-hidden="true" className="sr-only">Admin workspace</span></p>
    {!snapshot && !error && <p role="status" aria-live="polite">{t("admin.loading")}</p>}
    {error && <><p role="alert">{error}</p><button disabled={mutating} onClick={() => void refresh()}>{t("common.retry")}</button></>}
    {snapshot && overview && <>
      <MasterDataEditor disabled={mutating} snapshot={snapshot} createModel={(input) => mutate(() => repo().createModel(input))} deactivateDowntimeReason={(id, version) => mutate(() => repo().deactivateDowntimeReason(id, version))} />
      <StandardTimeEditor disabled={mutating} snapshot={snapshot} save={(input) => mutate(() => repo().saveStandardTime(input))} />
      <UserEditor disabled={mutating} createUser={(input) => mutate(() => createUser(input))} />
      <AdminOperationsPanel
        disabled={mutating}
        overview={overview}
        snapshot={snapshot}
        manageConfiguration={(command) => mutate(() => repo().manageConfiguration(command))}
        manageProfile={(input) => mutate(() => repo().manageProfile(input))}
        softDeleteProduction={(id, version) => mutate(() => repo().softDeleteProduction(id, version))}
        createUploadOriginalUrl={(storagePath) => repo().createUploadOriginalUrl(storagePath)}
      />
    </>}
  </main>;
}
