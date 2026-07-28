import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  SEED_CONTRACT,
  assertSeedEnvironment,
  buildDuplicateWorkbookBuffer,
  publicSeedManifest,
} from "./e2e-seed-contract.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const configuration = assertSeedEnvironment(process.env, projectRoot);
const client = createClient(configuration.supabaseUrl, configuration.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

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

async function seed() {
  const productionDate = bangkokDate();
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
    await must("clear prior admin standard time", client.from("standard_times").delete().in("model_id", priorAdminModelIds));
    await must("clear prior admin targets", client.from("yield_targets").delete().in("model_id", priorAdminModelIds));
    await must("clear prior admin model", client.from("models").delete().in("id", priorAdminModelIds));
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

  const process = await must("resolve AOI process", client.from("processes")
    .select("id")
    .eq("code", SEED_CONTRACT.codes.process)
    .eq("is_active", true)
    .is("deleted_at", null)
    .single());
  if (!process?.id) throw new Error("The migration-owned AOI process is required");
  const processId = process.id;
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
    await must("clear prior operator downtime", client.from("downtime_records").delete().in("production_record_id", operatorRecordIds));
    await must("clear prior operator quality", client.from("quality_records").delete().in("production_record_id", operatorRecordIds));
    await must("clear prior operator production", client.from("production_records").delete().in("id", operatorRecordIds));
  }

  const recordIds = [SEED_CONTRACT.ids.concurrencyRecord, SEED_CONTRACT.ids.reportRecord];
  await must("clear fixture downtime", client.from("downtime_records").delete().in("production_record_id", recordIds));
  await must("clear fixture quality", client.from("quality_records").delete().in("production_record_id", recordIds));
  await must("upsert production records", client.from("production_records").upsert([
    {
      id: SEED_CONTRACT.ids.concurrencyRecord,
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
    },
    {
      id: SEED_CONTRACT.ids.reportRecord,
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
    },
  ], { onConflict: "id" }));
  await must("upsert quality records", client.from("quality_records").upsert([
    {
      id: SEED_CONTRACT.ids.concurrencyQuality,
      production_record_id: SEED_CONTRACT.ids.concurrencyRecord,
      production_date: productionDate,
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
    },
    {
      id: SEED_CONTRACT.ids.reportQuality,
      production_record_id: SEED_CONTRACT.ids.reportRecord,
      production_date: productionDate,
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
    },
  ], { onConflict: "id" }));
  await must("upsert downtime record", client.from("downtime_records").upsert({
    id: SEED_CONTRACT.ids.concurrencyDowntime,
    production_record_id: SEED_CONTRACT.ids.concurrencyRecord,
    reason_id: SEED_CONTRACT.ids.downtimeReason,
    minutes: SEED_CONTRACT.records.concurrency.downtimeMinutes,
    note: "Seeded downtime",
    created_by: users.operator.id,
    updated_by: users.operator.id,
    version: 1,
    deleted_at: null,
  }, { onConflict: "id" }));

  await mkdir(path.dirname(configuration.workbookPath), { recursive: true });
  await writeFile(configuration.workbookPath, await buildDuplicateWorkbookBuffer(productionDate));
  const manifest = {
    ...publicSeedManifest(productionDate, processId),
    authUserIds: Object.fromEntries(Object.entries(users).map(([role, user]) => [role, user.id])),
    duplicateWorkbook: path.relative(projectRoot, configuration.workbookPath),
  };
  await writeFile(path.join(projectRoot, ".e2e", "seed-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Seeded local SMD E2E fixture for ${productionDate}.`);
  console.log(`Manifest: ${path.join(projectRoot, ".e2e", "seed-manifest.json")}`);
}

await seed();
