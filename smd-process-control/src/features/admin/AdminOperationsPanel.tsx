import { useEffect, useMemo, useState } from "react";
import type { AppRole, MasterDataSnapshot } from "../../domain/types";
import type {
  AdminConfigurationCommand,
  AdminConfigurationEntity,
  AdminMasterRecord,
  AdminOverview,
  AdminStandardTimeRecord,
  AdminTimeSlotRecord,
  AdminYieldTargetRecord,
} from "../../data/repositories/master-data-repository";
import { useI18n, type TranslationKey } from "../../i18n";

const legacy: Partial<Record<TranslationKey, string>> = {
  "admin.operations": "Operational configuration",
  "admin.configurationType": "Configuration type",
  "admin.models": "Models",
  "admin.lines": "Lines",
  "admin.processes": "Processes",
  "admin.shifts": "Shifts",
  "admin.timeSlots": "Time slots",
  "admin.downtimeReasons": "Downtime reasons",
  "admin.yieldTargets": "Yield targets",
  "admin.standardTimes": "Standard times",
  "admin.configurationCode": "Configuration code",
  "admin.configurationName": "Configuration name",
  "admin.createConfiguration": "Create configuration",
  "admin.updateConfiguration": "Update configuration",
  "admin.edit": "Edit {name}",
  "admin.deactivate": "Deactivate {name}",
  "admin.reactivate": "Reactivate {name}",
  "admin.cancelEdit": "Cancel edit",
  "admin.startsAt": "Starts at",
  "admin.endsAt": "Ends at",
  "admin.endDayOffset": "End day offset",
  "admin.sequence": "Sequence",
  "admin.targetPercent": "Target percent",
  "admin.targetModel": "Target model",
  "admin.targetProcess": "Target process",
  "admin.targetLine": "Target line",
  "admin.effectiveFrom": "Effective from",
  "admin.effectiveTo": "Effective to",
  "admin.usersExisting": "Existing users",
  "admin.userToggle": "{action} {name}",
  "admin.saveRole": "Save role for {name}",
  "admin.activate": "Activate",
  "admin.deactivateAction": "Deactivate",
  "admin.roleFor": "Role for {name}",
  "admin.uploadOriginals": "Upload originals",
  "admin.inspectOriginal": "Inspect original {name}",
  "admin.auditHistory": "Audit history",
  "admin.productionMaintenance": "Production maintenance",
  "admin.deleteProduction": "Delete production {id}",
};

const entityOptions: Array<{ entity: AdminConfigurationEntity; label: TranslationKey }> = [
  { entity: "model", label: "admin.models" },
  { entity: "line", label: "admin.lines" },
  { entity: "process", label: "admin.processes" },
  { entity: "shift", label: "admin.shifts" },
  { entity: "time_slot", label: "admin.timeSlots" },
  { entity: "downtime_reason", label: "admin.downtimeReasons" },
  { entity: "yield_target", label: "admin.yieldTargets" },
  { entity: "standard_time", label: "admin.standardTimes" },
];

function bangkokDate(): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function displayName(record: AdminMasterRecord | AdminTimeSlotRecord | AdminYieldTargetRecord | AdminStandardTimeRecord): string {
  if ("name" in record) return record.name;
  if ("targetPercent" in record) return `Target ${record.targetPercent}%`;
  if ("secondsPerUnit" in record) return `ST ${record.secondsPerUnit}s`;
  return record.code;
}

function UserRow({
  profile,
  disabled,
  save,
}: {
  profile: AdminOverview["profiles"][number];
  disabled: boolean;
  save(input: { profileId: string; role: AppRole; active: boolean; expectedVersion: number }): Promise<unknown>;
}) {
  const { t } = useI18n(legacy);
  const [role, setRole] = useState(profile.role);
  useEffect(() => setRole(profile.role), [profile.id, profile.role, profile.version]);
  return <li>
    <strong>{profile.displayName}</strong> ({profile.employeeId})
    <label>
      <span>{t("admin.roleFor", { name: profile.displayName })}</span>
      <select
        aria-label={t("admin.roleFor", { name: profile.displayName })}
        disabled={disabled}
        value={role}
        onChange={(event) => setRole(event.target.value as AppRole)}
      >
        <option value="viewer">{t("admin.viewer")}</option>
        <option value="operator">{t("admin.operator")}</option>
        <option value="admin">{t("admin.admin")}</option>
      </select>
    </label>
    <button
      disabled={disabled || role === profile.role}
      type="button"
      aria-label={t("admin.saveRole", { name: profile.displayName })}
      onClick={() => save({
        profileId: profile.id,
        role,
        active: profile.active,
        expectedVersion: profile.version,
      })}
    >
      {t("admin.saveRole", { name: profile.displayName })}
    </button>
    <button
      disabled={disabled}
      type="button"
      aria-label={t("admin.userToggle", {
        action: profile.active ? t("admin.deactivateAction") : t("admin.activate"),
        name: profile.displayName,
      })}
      onClick={() => save({
        profileId: profile.id,
        role: profile.role,
        active: !profile.active,
        expectedVersion: profile.version,
      })}
    >
      {profile.active ? t("admin.deactivateAction") : t("admin.activate")}
    </button>
  </li>;
}

export function AdminOperationsPanel({
  overview,
  snapshot,
  disabled = false,
  manageConfiguration,
  manageProfile,
  softDeleteProduction,
  createUploadOriginalUrl,
}: {
  overview: AdminOverview;
  snapshot: MasterDataSnapshot;
  disabled?: boolean;
  manageConfiguration(command: AdminConfigurationCommand): Promise<unknown>;
  manageProfile(input: { profileId: string; role: AppRole; active: boolean; expectedVersion: number }): Promise<unknown>;
  softDeleteProduction(id: string, expectedVersion: number): Promise<unknown>;
  createUploadOriginalUrl(storagePath: string): Promise<string>;
}) {
  const { t } = useI18n(legacy);
  const [entity, setEntity] = useState<AdminConfigurationEntity>("model");
  const [editing, setEditing] = useState<{ id: string; version: number } | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [endDayOffset, setEndDayOffset] = useState("0");
  const [sequence, setSequence] = useState("1");
  const [modelId, setModelId] = useState("");
  const [processId, setProcessId] = useState("");
  const [lineId, setLineId] = useState("");
  const [targetPercent, setTargetPercent] = useState("");
  const [secondsPerUnit, setSecondsPerUnit] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const records = overview.masters[entity];

  const clear = () => {
    setEditing(null);
    setCode("");
    setName("");
    setShiftId("");
    setStartsAt("");
    setEndsAt("");
    setEndDayOffset("0");
    setSequence("1");
    setModelId("");
    setProcessId("");
    setLineId("");
    setTargetPercent("");
    setSecondsPerUnit("");
    setEffectiveFrom("");
    setEffectiveTo("");
  };

  const values = useMemo((): Record<string, unknown> => {
    if (entity === "time_slot") return {
      shift_id: shiftId,
      code: code.trim(),
      starts_at: startsAt,
      ends_at: endsAt,
      end_day_offset: Number(endDayOffset),
      sequence: Number(sequence),
    };
    if (entity === "yield_target") return {
      model_id: modelId || null,
      process_id: processId,
      line_id: lineId || null,
      target_percent: Number(targetPercent),
      effective_from: effectiveFrom,
      effective_to: effectiveTo || null,
    };
    if (entity === "standard_time") return {
      model_id: modelId,
      process_id: processId,
      line_id: lineId,
      seconds_per_unit: Number(secondsPerUnit),
      effective_from: effectiveFrom,
      effective_to: effectiveTo || null,
    };
    return { code: code.trim(), name: name.trim() };
  }, [
    code,
    effectiveFrom,
    effectiveTo,
    endDayOffset,
    endsAt,
    entity,
    lineId,
    modelId,
    name,
    processId,
    sequence,
    secondsPerUnit,
    shiftId,
    startsAt,
    targetPercent,
  ]);

  const edit = (record: AdminMasterRecord | AdminTimeSlotRecord | AdminYieldTargetRecord | AdminStandardTimeRecord) => {
    setEditing({ id: record.id, version: record.version });
    if ("code" in record) setCode(record.code);
    if ("name" in record) setName(record.name);
    if ("startsAt" in record) {
      setShiftId(record.shiftId);
      setStartsAt(record.startsAt);
      setEndsAt(record.endsAt);
      setEndDayOffset(String(record.endDayOffset));
      setSequence(String(record.sequence));
    }
    if ("targetPercent" in record) {
      setModelId(record.modelId ?? "");
      setProcessId(record.processId);
      setLineId(record.lineId ?? "");
      setTargetPercent(String(record.targetPercent));
      setEffectiveFrom(record.effectiveFrom);
      setEffectiveTo(record.effectiveTo ?? "");
    }
    if ("secondsPerUnit" in record) {
      setModelId(record.modelId);
      setProcessId(record.processId);
      setLineId(record.lineId);
      setSecondsPerUnit(String(record.secondsPerUnit));
      setEffectiveFrom(record.effectiveFrom);
      setEffectiveTo(record.effectiveTo ?? "");
    }
  };

  return <>
    <section aria-label={t("admin.operations")}>
      <h2>{t("admin.operations")}</h2>
      <form className="admin-form" onSubmit={async (event) => {
        event.preventDefault();
        await manageConfiguration({
          entity,
          action: editing ? "update" : "create",
          id: editing?.id ?? null,
          expectedVersion: editing?.version ?? null,
          values,
        });
        clear();
      }}>
        <label htmlFor="admin-configuration-type">{t("admin.configurationType")}</label>
        <select
          id="admin-configuration-type"
          disabled={disabled}
          value={entity}
          onChange={(event) => {
            clear();
            setEntity(event.target.value as AdminConfigurationEntity);
          }}
        >
          {entityOptions.map((option) => <option key={option.entity} value={option.entity}>{t(option.label)}</option>)}
        </select>
        {!["yield_target", "standard_time"].includes(entity) && <>
          <label htmlFor="admin-configuration-code">{t("admin.configurationCode")}</label>
          <input id="admin-configuration-code" disabled={disabled} required value={code} onChange={(event) => setCode(event.target.value)} />
        </>}
        {!["time_slot", "yield_target", "standard_time"].includes(entity) && <>
          <label htmlFor="admin-configuration-name">{t("admin.configurationName")}</label>
          <input id="admin-configuration-name" disabled={disabled} required value={name} onChange={(event) => setName(event.target.value)} />
        </>}
        {entity === "time_slot" && <>
          <label htmlFor="admin-slot-shift">{t("common.shift")}</label>
          <select id="admin-slot-shift" disabled={disabled} required value={shiftId} onChange={(event) => setShiftId(event.target.value)}>
            <option value="">{t("common.select")}</option>
            {snapshot.shifts.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <label htmlFor="admin-slot-start">{t("admin.startsAt")}</label>
          <input id="admin-slot-start" disabled={disabled} required type="time" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          <label htmlFor="admin-slot-end">{t("admin.endsAt")}</label>
          <input id="admin-slot-end" disabled={disabled} required type="time" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
          <label htmlFor="admin-slot-offset">{t("admin.endDayOffset")}</label>
          <select id="admin-slot-offset" disabled={disabled} value={endDayOffset} onChange={(event) => setEndDayOffset(event.target.value)}>
            <option value="0">0</option><option value="1">1</option>
          </select>
          <label htmlFor="admin-slot-sequence">{t("admin.sequence")}</label>
          <input id="admin-slot-sequence" disabled={disabled} min="1" required type="number" value={sequence} onChange={(event) => setSequence(event.target.value)} />
        </>}
        {entity === "yield_target" && <>
          <label htmlFor="admin-target-model">{t("admin.targetModel")}</label>
          <select id="admin-target-model" disabled={disabled} value={modelId} onChange={(event) => setModelId(event.target.value)}>
            <option value="">{t("common.all")}</option>
            {snapshot.models.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <label htmlFor="admin-target-process">{t("admin.targetProcess")}</label>
          <select id="admin-target-process" disabled={disabled} required value={processId} onChange={(event) => setProcessId(event.target.value)}>
            <option value="">{t("common.select")}</option>
            {snapshot.processes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <label htmlFor="admin-target-line">{t("admin.targetLine")}</label>
          <select id="admin-target-line" disabled={disabled} value={lineId} onChange={(event) => setLineId(event.target.value)}>
            <option value="">{t("common.all")}</option>
            {snapshot.lines.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <label htmlFor="admin-target-percent">{t("admin.targetPercent")}</label>
          <input id="admin-target-percent" disabled={disabled} max="100" min="0" required step="0.01" type="number" value={targetPercent} onChange={(event) => setTargetPercent(event.target.value)} />
          <label htmlFor="admin-target-from">{t("admin.effectiveFrom")}</label>
          <input id="admin-target-from" disabled={disabled} required type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
          <label htmlFor="admin-target-to">{t("admin.effectiveTo")}</label>
          <input id="admin-target-to" disabled={disabled} type="date" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} />
        </>}
        {entity === "standard_time" && <>
          <label htmlFor="admin-standard-model">{t("admin.stModel")}</label>
          <select id="admin-standard-model" disabled={disabled} required value={modelId} onChange={(event) => setModelId(event.target.value)}>
            <option value="">{t("common.select")}</option>
            {snapshot.models.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <label htmlFor="admin-standard-process">{t("common.process")}</label>
          <select id="admin-standard-process" disabled={disabled} required value={processId} onChange={(event) => setProcessId(event.target.value)}>
            <option value="">{t("common.select")}</option>
            {snapshot.processes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <label htmlFor="admin-standard-line">{t("common.line")}</label>
          <select id="admin-standard-line" disabled={disabled} required value={lineId} onChange={(event) => setLineId(event.target.value)}>
            <option value="">{t("common.select")}</option>
            {snapshot.lines.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <label htmlFor="admin-standard-seconds">{t("admin.secondsPerUnit")}</label>
          <input id="admin-standard-seconds" disabled={disabled} min="0.000001" required step="any" type="number" value={secondsPerUnit} onChange={(event) => setSecondsPerUnit(event.target.value)} />
          <label htmlFor="admin-standard-from">{t("admin.effectiveFrom")}</label>
          <input id="admin-standard-from" disabled={disabled} required type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
          <label htmlFor="admin-standard-to">{t("admin.effectiveTo")}</label>
          <input id="admin-standard-to" disabled={disabled} type="date" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} />
        </>}
        <button disabled={disabled}>{editing ? t("admin.updateConfiguration") : t("admin.createConfiguration")}</button>
        {editing && <button disabled={disabled} type="button" onClick={clear}>{t("admin.cancelEdit")}</button>}
      </form>
      <ul>{records.map((record) => {
        const label = displayName(record);
        const historicalStandard = "secondsPerUnit" in record
          && record.effectiveFrom <= bangkokDate();
        return <li key={record.id}>
          <span>{label}</span>
          {!historicalStandard && <button disabled={disabled} type="button" aria-label={t("admin.edit", { name: label })} onClick={() => edit(record)}>{t("admin.edit", { name: label })}</button>}
          <button
            disabled={disabled}
            type="button"
            aria-label={record.active ? t("admin.deactivate", { name: label }) : t("admin.reactivate", { name: label })}
            onClick={() => manageConfiguration({
              entity,
              action: record.active ? "deactivate" : "reactivate",
              id: record.id,
              expectedVersion: record.version,
              values: {},
            })}
          >
            {record.active ? t("admin.deactivate", { name: label }) : t("admin.reactivate", { name: label })}
          </button>
        </li>;
      })}</ul>
    </section>

    <section aria-label={t("admin.usersExisting")}>
      <h2>{t("admin.usersExisting")}</h2>
      <ul>{overview.profiles.map((profile) => <UserRow disabled={disabled} key={profile.id} profile={profile} save={manageProfile} />)}</ul>
    </section>

    <section aria-label={t("admin.uploadOriginals")}>
      <h2>{t("admin.uploadOriginals")}</h2>
      <table><tbody>{overview.uploads.map((upload) => <tr key={upload.id}>
        <td>{upload.fileName}</td><td>{upload.storagePath}</td><td>{upload.status}</td>
        <td>
          <button
            disabled={disabled}
            type="button"
            aria-label={t("admin.inspectOriginal", { name: upload.fileName })}
            onClick={() => {
              const popup = window.open("about:blank", "_blank");
              if (popup) popup.opener = null;
              void createUploadOriginalUrl(upload.storagePath)
                .then((url) => {
                  if (popup) {
                    popup.location.replace(url);
                    return;
                  }
                  const link = document.createElement("a");
                  link.href = url;
                  link.rel = "noopener noreferrer";
                  link.target = "_blank";
                  link.click();
                })
                .catch(() => popup?.close());
            }}
          >
            {t("admin.inspectOriginal", { name: upload.fileName })}
          </button>
        </td>
      </tr>)}</tbody></table>
    </section>

    <section aria-label={t("admin.auditHistory")}>
      <h2>{t("admin.auditHistory")}</h2>
      <table><tbody>{overview.audits.map((audit) => <tr key={audit.id}>
        <td>{audit.actorId ?? "—"}</td><td>{audit.createdAt}</td>
        <td>{audit.tableName}</td><td>{audit.action}</td>
        <td>{audit.before && "name" in audit.before ? String(audit.before.name) : JSON.stringify(audit.before)}</td>
        <td>{audit.after && "name" in audit.after ? String(audit.after.name) : JSON.stringify(audit.after)}</td>
      </tr>)}</tbody></table>
    </section>

    <section aria-label={t("admin.productionMaintenance")}>
      <h2>{t("admin.productionMaintenance")}</h2>
      <ul>{overview.production.map((record) => <li key={record.id}>
        {record.productionDate} · {record.actualQty}
        <button
          disabled={disabled}
          type="button"
          aria-label={t("admin.deleteProduction", { id: record.id })}
          onClick={() => softDeleteProduction(record.id, record.version)}
        >
          {t("admin.deleteProduction", { id: record.id })}
        </button>
      </li>)}</ul>
    </section>
  </>;
}
