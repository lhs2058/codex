import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  SEED_CONTRACT,
  assertSeedEnvironment,
  buildDuplicateWorkbookBuffer,
  buildLegacyApprovalWorkbookBuffer,
  datedSeedIds,
  publicSeedManifest,
  runAfterSeedPreflight,
} from "./e2e-seed-contract.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const configuration = assertSeedEnvironment(process.env, projectRoot);
const client = createClient(configuration.supabaseUrl, configuration.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

const LEGACY_DUPLICATE = Object.freeze({
  modelId: "e2000000-0000-4000-8000-000000000401",
  lineId: "e2000000-0000-4000-8000-000000000402",
  shiftId: "e2000000-0000-4000-8000-000000000403",
  slotId: "e2000000-0000-4000-8000-000000000404",
  modelCode: "E2E-LEGACY-DUPLICATE-MODEL",
  lineCode: "E2E-LEGACY-DUPLICATE-LINE",
});

function legacyDatedIds(productionDate) {
  const stamp = productionDate.replaceAll("-", "");
  const id = (suffix) => `e2000000-0000-4000-8000-${stamp}${suffix}`;
  return Object.freeze({
    production: id("0401"),
    quality: id("0402"),
    defect: id("0403"),
    downtime: id("0404"),
  });
}

function bangkokDate() {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function must(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message ?? "unknown error"}`);
  return result.data;
}

async function softRetire(label, table, column, values, actorId, deactivate = false) {
  if (values.length === 0) return;
  const timestamp = new Date().toISOString();
  const changes = {
    deleted_at: timestamp,
    deleted_by: actorId,
    updated_at: timestamp,
    updated_by: actorId,
    ...(deactivate ? { is_active: false } : {}),
  };
  await must(label, client.from(table).update(changes).in(column, values).is("deleted_at", null));
}

async function ensureAuthUser(role) {
  const identity = SEED_CONTRACT.employees[role];
  const list = await must(`list ${role} auth user`, client.auth.admin.listUsers({ page: 1, perPage: 1000 }));
  let user = list.users.find((candidate) => candidate.email === identity.email);
  if (user) {
    const updated = await must(`update ${role} auth user`, client.auth.admin.updateUserById(user.id, {
      password: configuration.passwords[role],
      email_confirm: true,
      user_metadata: { employee_id: identity.employeeId, e2e_fixture: true },
    }));
    user = updated.user;
  } else {
    const created = await must(`create ${role} auth user`, client.auth.admin.createUser({
      email: identity.email,
      password: configuration.passwords[role],
      email_confirm: true,
      user_metadata: { employee_id: identity.employeeId, e2e_fixture: true },
    }));
    user = created.user;
  }
  if (!user) throw new Error(`${role} auth user was not returned`);
  return user;
}

async function loadSeedPreflight() {
  const candidateKeys = [
    "model|E2E-LEGACY-MODEL",
    "line|E2E-LEGACY-LINE",
    "shift|NIGHT",
    "time_slot|NIGHT|B",
  ];
  const fileNames = [
    path.basename(configuration.workbookPath),
    path.basename(configuration.legacyWorkbookPath),
  ];
  const [
    reviewRpc,
    process,
    legacyReason,
    candidateModels,
    candidateLines,
    candidateShifts,
    masterCandidateRows,
    standardTimeCandidateRows,
    uploadBatches,
    storageRoots,
  ] = await Promise.all([
    client.rpc("list_reviewable_upload_batches", {}),
    client.from("processes").select("id").eq("code", SEED_CONTRACT.codes.process)
      .eq("is_active", true).is("deleted_at", null).limit(1).maybeSingle(),
    client.from("downtime_reasons").select("id").eq("code", "LEGACY_UNSPECIFIED")
      .eq("is_active", true).is("deleted_at", null).limit(1).maybeSingle(),
    client.from("models").select("id", { count: "exact", head: true })
      .eq("code", "E2E-LEGACY-MODEL"),
    client.from("lines").select("id", { count: "exact", head: true })
      .eq("code", "E2E-LEGACY-LINE"),
    client.from("shifts").select("id", { count: "exact", head: true })
      .eq("code", "NIGHT"),
    client.from("upload_master_candidates").select("id", { count: "exact", head: true })
      .in("candidate_key", candidateKeys),
    client.from("upload_standard_time_candidates").select("id", { count: "exact", head: true })
      .like("candidate_key", "E2E-LEGACY-MODEL|E2E-LEGACY-LINE|%"),
    client.from("upload_batches").select("id", { count: "exact", head: true })
      .in("source_file_name", fileNames),
    client.storage.from("smd-upload-originals").list("", { limit: 1000 }),
  ]);

  let storageObjectCount = 0;
  if (!storageRoots.error) {
    for (const root of storageRoots.data ?? []) {
      if (fileNames.includes(root.name)) storageObjectCount += 1;
      if (root.id === null) {
        const nested = await client.storage.from("smd-upload-originals").list(root.name, { limit: 1000 });
        if (nested.error) throw new Error(`inspect E2E storage namespace: ${nested.error.message}`);
        storageObjectCount += (nested.data ?? []).filter((item) =>
          fileNames.some((name) => item.name.endsWith(name))).length;
      }
    }
  }

  const prerequisiteReads = [
    process,
    legacyReason,
    candidateModels,
    candidateLines,
    candidateShifts,
    masterCandidateRows,
    standardTimeCandidateRows,
    uploadBatches,
  ];
  return {
    reviewRpcAvailable: reviewRpc.error?.code !== "PGRST202",
    candidateTablesAvailable: prerequisiteReads.every((result) => !result.error),
    processId: process.data?.id ?? null,
    legacyReasonId: legacyReason.data?.id ?? null,
    candidateNamespaceCount:
      (candidateModels.count ?? 0)
      + (candidateLines.count ?? 0)
      + (candidateShifts.count ?? 0),
    candidateRowCount:
      (masterCandidateRows.count ?? 0)
      + (standardTimeCandidateRows.count ?? 0),
    uploadBatchCount: uploadBatches.count ?? 0,
    storageObjectCount: storageRoots.error ? 1 : storageObjectCount,
  };
}

async function seed() {
  const productionDate = bangkokDate();
  const datedIds = datedSeedIds(productionDate);
  return runAfterSeedPreflight(loadSeedPreflight, async (preflight) => {
    const legacyIds = legacyDatedIds(productionDate);
  const users = {
    operator: await ensureAuthUser("operator"),
    admin: await ensureAuthUser("admin"),
    viewer: await ensureAuthUser("viewer"),
  };
  const adminId = users.admin.id;
  await must("upsert profiles", client.from("profiles").upsert(
    Object.entries(users).map(([role, user]) => ({
      id: user.id,
      employee_id: SEED_CONTRACT.employees[role].employeeId,
      display_name: SEED_CONTRACT.employees[role].displayName,
      role,
      language: "ko",
      is_active: true,
      created_by: adminId,
      updated_by: adminId,
      version: 1,
    })),
    { onConflict: "id" },
  ));
  const priorAdminModels = await must("find prior admin fixture model", client.from("models")
    .select("id")
    .eq("code", SEED_CONTRACT.codes.adminModel));
  const priorAdminModelIds = (priorAdminModels ?? []).map((model) => model.id);
  if (priorAdminModelIds.length > 0) {
    await softRetire("retire prior admin standard time", "standard_times", "model_id", priorAdminModelIds, adminId);
    await softRetire("retire prior admin targets", "yield_targets", "model_id", priorAdminModelIds, adminId);
    await softRetire("retire prior admin model", "models", "id", priorAdminModelIds, adminId, true);
  }

  await must("upsert model", client.from("models").upsert({
    id: SEED_CONTRACT.ids.model,
    code: SEED_CONTRACT.codes.model,
    name: SEED_CONTRACT.labels.model,
    is_active: true,
    created_by: adminId,
    updated_by: adminId,
    version: 1,
    deleted_at: null,
  }, { onConflict: "id" }));
  await must("upsert lines", client.from("lines").upsert([
    {
      id: SEED_CONTRACT.ids.line,
      code: SEED_CONTRACT.codes.line,
      name: SEED_CONTRACT.labels.line,
      is_active: true,
      created_by: adminId,
      updated_by: adminId,
      version: 1,
      deleted_at: null,
    },
    {
      id: SEED_CONTRACT.ids.operatorLine,
      code: SEED_CONTRACT.codes.operatorLine,
      name: SEED_CONTRACT.labels.operatorLine,
      is_active: true,
      created_by: adminId,
      updated_by: adminId,
      version: 1,
      deleted_at: null,
    },
  ], { onConflict: "id" }));
  await must("upsert shift", client.from("shifts").upsert({
    id: SEED_CONTRACT.ids.shift,
    code: SEED_CONTRACT.codes.shift,
    name: SEED_CONTRACT.labels.shift,
    is_active: true,
    created_by: adminId,
    updated_by: adminId,
    version: 1,
    deleted_at: null,
  }, { onConflict: "id" }));
  await must("upsert time slots", client.from("time_slots").upsert([
    {
      id: SEED_CONTRACT.ids.concurrencySlot,
      shift_id: SEED_CONTRACT.ids.shift,
      code: SEED_CONTRACT.codes.concurrencySlot,
      starts_at: "08:00",
      ends_at: "09:00",
      end_day_offset: 0,
      sequence: 1,
      is_active: true,
      created_by: adminId,
      updated_by: adminId,
      version: 1,
      deleted_at: null,
    },
    {
      id: SEED_CONTRACT.ids.reportSlot,
      shift_id: SEED_CONTRACT.ids.shift,
      code: SEED_CONTRACT.codes.reportSlot,
      starts_at: "09:00",
      ends_at: "10:00",
      end_day_offset: 0,
      sequence: 2,
      is_active: true,
      created_by: adminId,
      updated_by: adminId,
      version: 1,
      deleted_at: null,
    },
  ], { onConflict: "id" }));
  await must("upsert downtime reason", client.from("downtime_reasons").upsert({
    id: SEED_CONTRACT.ids.downtimeReason,
    code: SEED_CONTRACT.codes.downtimeReason,
    name: "E2E Waiting",
    is_active: true,
    created_by: adminId,
    updated_by: adminId,
    version: 1,
    deleted_at: null,
  }, { onConflict: "id" }));

  await must("upsert legacy duplicate masters", client.from("models").upsert({
    id: LEGACY_DUPLICATE.modelId,
    code: LEGACY_DUPLICATE.modelCode,
    name: LEGACY_DUPLICATE.modelCode,
    is_active: true,
    created_by: adminId,
    updated_by: adminId,
    version: 1,
    deleted_at: null,
  }, { onConflict: "id" }));
  await must("upsert legacy duplicate line", client.from("lines").upsert({
    id: LEGACY_DUPLICATE.lineId,
    code: LEGACY_DUPLICATE.lineCode,
    name: LEGACY_DUPLICATE.lineCode,
    is_active: true,
    created_by: adminId,
    updated_by: adminId,
    version: 1,
    deleted_at: null,
  }, { onConflict: "id" }));
  await must("upsert legacy DAY shift", client.from("shifts").upsert({
    id: LEGACY_DUPLICATE.shiftId,
    code: "DAY",
    name: "DAY",
    is_active: true,
    created_by: adminId,
    updated_by: adminId,
    version: 1,
    deleted_at: null,
  }, { onConflict: "id" }));
  await must("upsert legacy DAY A slot", client.from("time_slots").upsert({
    id: LEGACY_DUPLICATE.slotId,
    shift_id: LEGACY_DUPLICATE.shiftId,
    code: "A",
    starts_at: "07:30",
    ends_at: "09:30",
    end_day_offset: 0,
    sequence: 1,
    is_active: true,
    created_by: adminId,
    updated_by: adminId,
    version: 1,
    deleted_at: null,
  }, { onConflict: "id" }));

  const processId = preflight.processId;
  const legacyReasonId = preflight.legacyReasonId;
  await must("upsert standard times", client.from("standard_times").upsert([
    {
      id: SEED_CONTRACT.ids.standardTime,
      model_id: SEED_CONTRACT.ids.model,
      process_id: processId,
      line_id: SEED_CONTRACT.ids.line,
      seconds_per_unit: 10,
      effective_from: "2020-01-01",
      effective_to: null,
      created_by: adminId,
      updated_by: adminId,
      version: 1,
      deleted_at: null,
    },
    {
      id: SEED_CONTRACT.ids.operatorStandardTime,
      model_id: SEED_CONTRACT.ids.model,
      process_id: processId,
      line_id: SEED_CONTRACT.ids.operatorLine,
      seconds_per_unit: 10,
      effective_from: "2020-01-01",
      effective_to: null,
      created_by: adminId,
      updated_by: adminId,
      version: 1,
      deleted_at: null,
    },
  ], { onConflict: "id" }));
  await must("upsert yield target", client.from("yield_targets").upsert({
    id: SEED_CONTRACT.ids.yieldTarget,
    model_id: SEED_CONTRACT.ids.model,
    process_id: processId,
    line_id: SEED_CONTRACT.ids.line,
    target_percent: 95,
    effective_from: "2020-01-01",
    effective_to: null,
    created_by: adminId,
    updated_by: adminId,
    version: 1,
    deleted_at: null,
  }, { onConflict: "id" }));

  const operatorRecords = await must("find prior operator fixture records", client.from("production_records")
    .select("id")
    .eq("production_date", productionDate)
    .eq("shift_id", SEED_CONTRACT.ids.shift)
    .eq("line_id", SEED_CONTRACT.ids.operatorLine)
    .eq("model_id", SEED_CONTRACT.ids.model)
    .eq("process_id", processId));
  const operatorRecordIds = (operatorRecords ?? []).map((record) => record.id);
  if (operatorRecordIds.length > 0) {
    await softRetire("retire prior operator downtime", "downtime_records", "production_record_id", operatorRecordIds, adminId);
    await softRetire("retire prior operator quality", "quality_records", "production_record_id", operatorRecordIds, adminId);
    await softRetire("retire prior operator production", "production_records", "id", operatorRecordIds, adminId);
  }

  const priorFixtureRecords = await must("find prior fixed-line fixture records", client.from("production_records")
    .select("id")
    .eq("production_date", productionDate)
    .eq("shift_id", SEED_CONTRACT.ids.shift)
    .eq("line_id", SEED_CONTRACT.ids.line)
    .eq("model_id", SEED_CONTRACT.ids.model)
    .eq("process_id", processId));
  const recordIds = [...new Set([
    datedIds.concurrencyRecord,
    datedIds.reportRecord,
    ...(priorFixtureRecords ?? []).map((record) => record.id),
  ])];
  await softRetire("retire fixed-line fixture downtime", "downtime_records", "production_record_id", recordIds, adminId);
  await softRetire("retire fixed-line fixture quality", "quality_records", "production_record_id", recordIds, adminId);
  await softRetire("retire fixed-line fixture production", "production_records", "id", recordIds, adminId);
  await must("upsert production records", client.from("production_records").upsert([
    {
      id: datedIds.concurrencyRecord,
      production_date: productionDate,
      shift_id: SEED_CONTRACT.ids.shift,
      time_slot_id: SEED_CONTRACT.ids.concurrencySlot,
      line_id: SEED_CONTRACT.ids.line,
      model_id: SEED_CONTRACT.ids.model,
      process_id: processId,
      input_qty: SEED_CONTRACT.records.concurrency.inputQty,
      actual_qty: SEED_CONTRACT.records.concurrency.actualQty,
      note: "Seeded concurrency record",
      created_by: users.operator.id,
      updated_by: users.operator.id,
      version: SEED_CONTRACT.records.concurrency.version,
      deleted_at: null,
      deleted_by: null,
    },
    {
      id: datedIds.reportRecord,
      production_date: productionDate,
      shift_id: SEED_CONTRACT.ids.shift,
      time_slot_id: SEED_CONTRACT.ids.reportSlot,
      line_id: SEED_CONTRACT.ids.line,
      model_id: SEED_CONTRACT.ids.model,
      process_id: processId,
      input_qty: SEED_CONTRACT.records.report.inputQty,
      actual_qty: SEED_CONTRACT.records.report.actualQty,
      note: "Seeded dashboard/report baseline",
      created_by: users.operator.id,
      updated_by: users.operator.id,
      version: SEED_CONTRACT.records.report.version,
      deleted_at: null,
      deleted_by: null,
    },
  ], { onConflict: "id" }));
  await must("upsert quality records", client.from("quality_records").upsert([
    {
      id: datedIds.concurrencyQuality,
      production_record_id: datedIds.concurrencyRecord,
      production_date: productionDate,
      shift_id: SEED_CONTRACT.ids.shift,
      time_slot_id: SEED_CONTRACT.ids.concurrencySlot,
      line_id: SEED_CONTRACT.ids.line,
      model_id: SEED_CONTRACT.ids.model,
      process_id: processId,
      input_qty: SEED_CONTRACT.records.concurrency.inputQty,
      ok_qty: SEED_CONTRACT.records.concurrency.okQty,
      ng_qty: SEED_CONTRACT.records.concurrency.ngQty,
      note: "Seeded concurrency quality",
      created_by: users.operator.id,
      updated_by: users.operator.id,
      version: SEED_CONTRACT.records.concurrency.version,
      deleted_at: null,
      deleted_by: null,
    },
    {
      id: datedIds.reportQuality,
      production_record_id: datedIds.reportRecord,
      production_date: productionDate,
      shift_id: SEED_CONTRACT.ids.shift,
      time_slot_id: SEED_CONTRACT.ids.reportSlot,
      line_id: SEED_CONTRACT.ids.line,
      model_id: SEED_CONTRACT.ids.model,
      process_id: processId,
      input_qty: SEED_CONTRACT.records.report.inputQty,
      ok_qty: SEED_CONTRACT.records.report.okQty,
      ng_qty: SEED_CONTRACT.records.report.ngQty,
      note: "Seeded report quality",
      created_by: users.operator.id,
      updated_by: users.operator.id,
      version: 1,
      deleted_at: null,
      deleted_by: null,
    },
  ], { onConflict: "id" }));
  await must("upsert downtime record", client.from("downtime_records").upsert({
    id: datedIds.concurrencyDowntime,
    production_record_id: datedIds.concurrencyRecord,
    reason_id: SEED_CONTRACT.ids.downtimeReason,
    minutes: SEED_CONTRACT.records.concurrency.downtimeMinutes,
    note: "Seeded downtime",
    created_by: users.operator.id,
    updated_by: users.operator.id,
    version: 1,
    deleted_at: null,
    deleted_by: null,
  }, { onConflict: "id" }));

  await softRetire("retire legacy duplicate defect", "defect_records", "id", [legacyIds.defect], adminId);
  await softRetire("retire legacy duplicate downtime", "downtime_records", "id", [legacyIds.downtime], adminId);
  await softRetire("retire legacy duplicate quality", "quality_records", "id", [legacyIds.quality], adminId);
  await softRetire("retire legacy duplicate production", "production_records", "id", [legacyIds.production], adminId);
  await must("upsert legacy duplicate production", client.from("production_records").upsert({
    id: legacyIds.production,
    production_date: productionDate,
    shift_id: LEGACY_DUPLICATE.shiftId,
    time_slot_id: LEGACY_DUPLICATE.slotId,
    line_id: LEGACY_DUPLICATE.lineId,
    model_id: LEGACY_DUPLICATE.modelId,
    process_id: processId,
    input_qty: 45,
    actual_qty: 45,
    note: "E2E legacy replacement target",
    created_by: users.operator.id,
    updated_by: users.operator.id,
    version: 1,
    deleted_at: null,
    deleted_by: null,
  }, { onConflict: "id" }));
  await must("upsert legacy duplicate quality", client.from("quality_records").upsert({
    id: legacyIds.quality,
    production_record_id: legacyIds.production,
    production_date: productionDate,
    shift_id: LEGACY_DUPLICATE.shiftId,
    time_slot_id: LEGACY_DUPLICATE.slotId,
    line_id: LEGACY_DUPLICATE.lineId,
    model_id: LEGACY_DUPLICATE.modelId,
    process_id: processId,
    input_qty: 45,
    ok_qty: 43,
    ng_qty: 2,
    note: "E2E legacy replacement quality",
    created_by: users.operator.id,
    updated_by: users.operator.id,
    version: 1,
    deleted_at: null,
    deleted_by: null,
  }, { onConflict: "id" }));
  await must("upsert legacy duplicate defect", client.from("defect_records").upsert({
    id: legacyIds.defect,
    quality_record_id: legacyIds.quality,
    defect_type: "E2E solder bridge",
    classification: "real",
    quantity: 1,
    note: "E2E legacy replacement defect",
    created_by: users.operator.id,
    updated_by: users.operator.id,
    version: 1,
    deleted_at: null,
    deleted_by: null,
  }, { onConflict: "id" }));
  await must("upsert legacy duplicate downtime", client.from("downtime_records").upsert({
    id: legacyIds.downtime,
    production_record_id: legacyIds.production,
    reason_id: legacyReasonId,
    minutes: 3,
    note: "E2E legacy replacement downtime",
    created_by: users.operator.id,
    updated_by: users.operator.id,
    version: 1,
    deleted_at: null,
    deleted_by: null,
  }, { onConflict: "id" }));

  await mkdir(path.dirname(configuration.workbookPath), { recursive: true });
  await writeFile(configuration.workbookPath, await buildDuplicateWorkbookBuffer(productionDate));
  await writeFile(configuration.legacyWorkbookPath, await buildLegacyApprovalWorkbookBuffer(productionDate));
  const manifest = {
    ...publicSeedManifest(productionDate, processId),
    authUserIds: Object.fromEntries(Object.entries(users).map(([role, user]) => [role, user.id])),
    duplicateWorkbook: path.relative(projectRoot, configuration.workbookPath),
    legacyApprovalWorkbook: path.relative(projectRoot, configuration.legacyWorkbookPath),
    legacyDuplicate: { ...LEGACY_DUPLICATE, ...legacyIds },
  };
  await writeFile(path.join(projectRoot, ".e2e", "seed-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Seeded local SMD E2E fixture for ${productionDate}.`);
  console.log(`Manifest: ${path.join(projectRoot, ".e2e", "seed-manifest.json")}`);
  });
}

await seed();
