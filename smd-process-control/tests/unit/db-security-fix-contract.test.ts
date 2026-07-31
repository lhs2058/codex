import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrations = join(process.cwd(), "supabase", "migrations");
const readMigration = (name: string) => readFileSync(join(migrations, name), "utf8");

describe("final database and security migration contracts", () => {
  it("adds daily-quality identity, upload target versions, defect linkage, and the legacy downtime seed", () => {
    const sql = readMigration("016_daily_quality_and_upload_staging.sql");

    expect(sql).toMatch(/quality_records[\s\S]*shift_id uuid/i);
    expect(sql).toMatch(/quality_records[\s\S]*time_slot_id uuid/i);
    expect(sql).toMatch(/quality_records_daily_unique/i);
    expect(sql).toMatch(/quality_records_unlinked_slot_unique/i);
    expect(sql).toMatch(/legacy_unlinked_quality_requires_shift_mapping/i);
    expect(sql).toMatch(/validate constraint quality_records_observation_shape/i);
    expect(sql).toMatch(/source_upload_row_id/i);
    expect(sql).toMatch(/upload_rows[\s\S]*row_kind/i);
    expect(sql).toMatch(/row_kind in \('production', 'daily_quality', 'defect', 'diagnostic'\)/i);
    expect(sql).toMatch(/upload_rows[\s\S]*target_record_id/i);
    expect(sql).toMatch(/upload_rows[\s\S]*expected_target_version/i);
    expect(sql).toMatch(/upload_rows[\s\S]*quality_record_id/i);
    expect(sql).toMatch(/upload_rows[\s\S]*defect_record_id/i);
    expect(sql).toMatch(/LEGACY_UNSPECIFIED/);
  });

  it("requires an active allow-listed profile in every cumulative SELECT policy and storage policy", () => {
    const sql = readMigration("017_rls_active_profile_hardening.sql");
    const protectedTables = [
      "profiles", "models", "processes", "lines", "shifts", "time_slots",
      "downtime_reasons", "yield_targets", "standard_times", "production_records",
      "quality_records", "defect_records", "downtime_records", "upload_batches",
      "upload_rows", "audit_logs",
    ];

    for (const table of protectedTables) {
      expect(sql).toMatch(new RegExp(`create policy [^\\n]+ on public\\.${table} for select to authenticated[\\s\\S]*?current_app_role\\(\\) in \\('viewer', 'operator', 'admin'\\)`, "i"));
    }
    expect(sql).toMatch(/smd_upload_originals_insert[\s\S]*current_app_role\(\) in \('operator', 'admin'\)/i);
    expect(sql).toMatch(/smd_upload_originals_select[\s\S]*current_app_role\(\) in \('viewer', 'operator', 'admin'\)/i);
    expect(sql).toMatch(/revoke insert, update, delete on public\.profiles/i);
    expect(sql).toMatch(/revoke insert, update, delete on public\.models[\s\S]*public\.standard_times/i);
  });

  it("uses unambiguous upload parameters, fails NULL replacement closed, and locks the exact staged target version", () => {
    const sql = readMigration("020_upload_v2_contract.sql");

    expect(sql).toMatch(/alter column row_kind drop default/i);
    expect(sql).toMatch(/alter column row_kind set not null/i);
    expect(sql).toMatch(/where row_kind = 'defect'[\s\S]*row_kind = 'diagnostic'|set row_kind = 'diagnostic'[\s\S]*where row_kind = 'defect'/i);
    expect(sql).toMatch(/row_kind in \('production', 'daily_quality', 'diagnostic'\)/i);
    expect(sql).not.toMatch(/row_kind in \([^)]*'defect'/i);
    expect(sql).toMatch(/quality_records_active_slot_unique/i);
    expect(sql).toMatch(/where time_slot_id is not null[\s\S]*deleted_at is null/i);
    expect(sql).toMatch(/commit_upload_batch\(\s*p_batch_id uuid,\s*p_replace_conflicts boolean\s*\)/i);
    expect(sql).toMatch(/coalesce\(p_replace_conflicts, false\)/i);
    expect(sql).not.toMatch(/where batch_id\s*=\s*commit_upload_batch\.batch_id/i);
    expect(sql).toMatch(/target_record_id[\s\S]*expected_target_version[\s\S]*for update/i);
    expect(sql).toMatch(/stale_upload_target/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/concat_ws\([\s\S]*'quality'[\s\S]*validated_production_date/i);
    expect(sql).toMatch(/downtime_exceeds_planned_time/i);
    for (const key of ["contractVersion", "sourceTrace", "production", "quality", "downtime", "defects", "warnings"]) {
      expect(sql).toMatch(new RegExp(`'${key}'`));
    }
    expect(sql).toMatch(/jsonb_array_elements\([\s\S]*?payload\s*->\s*'defects'/i);
    expect(sql).toMatch(/duplicate_defect_row/i);
    expect(sql).toMatch(/lower\(btrim\([\s\S]*?defectType/i);
    expect(sql).toMatch(/length\(btrim\([\s\S]*?defectType/i);
    expect(sql).toMatch(/defect_quantity_total[\s\S]*validated_ng_qty/i);
    expect(sql).toMatch(/update public\.defect_records[\s\S]*?deleted_at = now\(\)/i);
    expect(sql).toMatch(/row_kind[\s\S]{0,80}'daily_quality'/i);
    expect(sql).toMatch(/time_slot_id is not distinct from[\s\S]{0,80}validated_time_slot_id/i);
    expect(sql).toMatch(/defectInserted/i);
    expect(sql).toMatch(/errorCount/i);
    expect(sql).toMatch(/set_config\(\s*'app\.commit_upload_mode',\s*'off',\s*true\s*\)/i);
  });

  it("keeps historical standard-time periods immutable across admin changes", () => {
    const sql = readMigration("019_admin_rpc_and_verified_actor.sql");

    expect(sql).toMatch(/historical_standard_time_immutable/i);
    expect(sql).toMatch(/p_entity = 'standard_times'[\s\S]*effective_from[\s\S]*business_date/i);
    expect(sql).toMatch(/effective_to\s*=\s*case[\s\S]*business_date\s*-\s*1/i);
    expect(sql).toMatch(/private\.list_historical_standard_times\(\)/i);
    expect(sql).toMatch(/from public\.standard_times as standard_time[\s\S]*deleted_at[\s\S]*effective_from/i);
  });

  it("ships the runtime hardening wrappers for existing 001-020 databases", () => {
    const sql = readMigration("021_runtime_verification_hardening.sql");

    expect(sql).toMatch(/save_production_record_v20_impl/i);
    expect(sql).toMatch(/extract\(second from start_value\)\s*<>\s*0/i);
    expect(sql).toMatch(/extract\(second from end_value\)\s*<>\s*0/i);
    expect(sql).toMatch(/commit_upload_batch_v20_impl/i);
    expect(sql).toMatch(/set_config\(\s*'app\.commit_upload_mode',\s*'off',\s*true\s*\)/i);
    expect(sql).toMatch(/revoke all on function public\.commit_upload_batch_v20_impl/i);
  });

  it("moves extension-owned objects outside the API-exposed schema", () => {
    const sql = readMigration("022_extension_schema_hardening.sql");

    expect(sql).toMatch(/alter extension btree_gist set schema extensions/i);
  });

  it("guards operator commits with immutable candidates and exposes an import-only snapshot", () => {
    const sql = readMigration("026_secure_operator_import_snapshot.sql");
    const wrapper = sql.match(
      /create function public\.commit_upload_batch\([\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
    )?.[1]?.toLowerCase();
    const staging = readMigration("023_legacy_master_detail_import.sql").match(
      /create or replace function public\.stage_upload_candidates\([\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
    )?.[1]?.toLowerCase();

    expect(sql).toMatch(/alter function public\.commit_upload_batch\(uuid,\s*boolean\)\s+rename to commit_upload_batch_v26_impl/i);
    expect(sql).toMatch(/revoke all on function public\.commit_upload_batch_v26_impl\(uuid,\s*boolean\)/i);
    expect(sql).toMatch(/from public\.upload_master_candidates[\s\S]*status <> 'existing'/i);
    expect(sql).toMatch(/from public\.upload_standard_time_candidates[\s\S]*status <> 'existing'/i);
    expect(sql).toMatch(/from public\.models as model[\s\S]*model\.is_active[\s\S]*model\.deleted_at is null/i);
    expect(sql).toMatch(/from public\.standard_times as standard_time[\s\S]*standard_time\.deleted_at is null/i);
    expect(sql).toMatch(/upload_candidates_require_admin/i);
    expect(sql).toMatch(/return public\.commit_upload_batch_v26_impl\(/i);
    expect(sql).toMatch(/create (?:or replace )?function public\.list_import_master_data\(\)/i);
    expect(sql).toMatch(/security definer[\s\S]*set search_path = ''/i);
    expect(sql).toMatch(/from private\.current_profile\(\)/i);
    expect(sql).toMatch(/actor_profile\.app_role not in \('viewer', 'operator', 'admin'\)/i);
    expect(sql).toMatch(/from public\.standard_times as standard_time[\s\S]*where standard_time\.deleted_at is null/i);
    expect(sql).toMatch(/revoke all on function public\.list_import_master_data\(\)\s+from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.list_import_master_data\(\)\s+to authenticated/i);
    expect(wrapper).toBeDefined();
    expect(staging).toBeDefined();
    const wrapperBatchLock = wrapper!.indexOf("for update");
    const wrapperCandidateRead = wrapper!.indexOf("from public.upload_master_candidates");
    const wrapperDelegate = wrapper!.indexOf("return public.commit_upload_batch_v26_impl");
    expect(wrapperBatchLock).toBeGreaterThan(-1);
    expect(wrapperBatchLock).toBeLessThan(wrapperCandidateRead);
    expect(wrapperCandidateRead).toBeLessThan(wrapperDelegate);
    const stagingBatchLock = staging!.indexOf("for update");
    const stagingCandidateRead = staging!.indexOf("from public.upload_master_candidates");
    const stagingCandidateInsert = staging!.indexOf("insert into public.upload_master_candidates");
    expect(stagingBatchLock).toBeGreaterThan(-1);
    expect(stagingBatchLock).toBeLessThan(stagingCandidateRead);
    expect(stagingCandidateRead).toBeLessThan(stagingCandidateInsert);
  });

  it("exposes staged upload review without leaking private storage paths", () => {
    const sql = readMigration("20260731010321_staged_upload_review.sql");

    expect(sql).toMatch(/create function public\.list_reviewable_upload_batches\(\)/i);
    expect(sql).toMatch(/create function public\.get_upload_batch_review\(\s*p_batch_id uuid\s*\)/i);
    expect(sql.match(/security definer/gi)).toHaveLength(2);
    expect(sql.match(/set search_path = ''/gi)).toHaveLength(2);
    expect(sql).toMatch(/from private\.current_profile\(\)/i);
    expect(sql).toMatch(/profile_is_active/i);
    expect(sql).toMatch(/app_role in \('viewer', 'admin'\)/i);
    expect(sql).toMatch(/batch\.created_by = actor_id/i);
    expect(sql).toMatch(/private\.can_view_upload_batch\(p_batch_id\)/i);
    expect(sql).not.toMatch(/jsonb_build_object\([\s\S]*?'storagePath'|jsonb_build_object\([\s\S]*?'storage_path'/i);
    expect(sql).toMatch(/revoke all on function public\.list_reviewable_upload_batches\(\)\s+from public, anon, authenticated/i);
    expect(sql).toMatch(/revoke all on function public\.get_upload_batch_review\(uuid\)\s+from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.list_reviewable_upload_batches\(\)\s+to authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.get_upload_batch_review\(uuid\)\s+to authenticated/i);
  });

  it("rejects inactive manual dimensions and exposes hardened optimistic admin RPCs only to intended roles", () => {
    const uploadSql = readMigration("018_atomic_upload_and_manual_validation.sql");
    const adminSql = readMigration("019_admin_rpc_and_verified_actor.sql");
    const edgeFunction = readFileSync(join(process.cwd(), "supabase", "functions", "admin-create-user", "index.ts"), "utf8");

    for (const table of ["models", "lines", "processes", "shifts", "time_slots", "downtime_reasons"]) {
      expect(uploadSql).toMatch(new RegExp(`from public\\.${table}[\\s\\S]*?is_active[\\s\\S]*?deleted_at is null`, "i"));
    }
    expect(uploadSql).toMatch(/extract\(second from start_value\)\s*<>\s*0/i);
    expect(uploadSql).toMatch(/extract\(second from end_value\)\s*<>\s*0/i);
    expect(adminSql).toMatch(/admin_list_operational_data\(\s*\)/i);
    expect(adminSql).toMatch(/admin_manage_configuration\(\s*p_entity text,\s*p_action text,\s*p_record_id uuid,\s*p_expected_version bigint,\s*p_values jsonb\s*\)/i);
    expect(adminSql).toMatch(/admin_manage_profile\(\s*p_profile_id uuid,\s*p_role text,\s*p_is_active boolean,\s*p_expected_version bigint\s*\)/i);
    expect(adminSql).toMatch(/admin_soft_delete_production\(\s*p_record_id uuid,\s*p_expected_version bigint\s*\)/i);
    expect(adminSql).toMatch(/admin_soft_delete_production\([\s\S]*?\)\s*returns jsonb[\s\S]*?returning to_jsonb\(/i);
    for (const key of ["models", "processes", "lines", "shifts", "time_slots", "downtime_reasons", "yield_targets", "standard_times", "profiles", "upload_batches", "audit_logs", "production_records"]) {
      expect(adminSql).toMatch(new RegExp(`'${key}'`));
    }
    expect(adminSql.match(/limit 100/gi)?.length).toBeGreaterThanOrEqual(3);
    expect(adminSql).toMatch(/admin-profile-role-roster/i);
    expect(adminSql).toMatch(/cannot_remove_last_admin/i);
    expect(adminSql).toMatch(/time_slots_valid_duration/i);
    expect(adminSql).toMatch(/interval '24 hours'/i);
    expect(adminSql).toMatch(/extract\(second from starts_at\)\s*=\s*0/i);
    expect(adminSql).toMatch(/extract\(second from ends_at\)\s*=\s*0/i);
    expect(adminSql).toMatch(/admin_create_profile/i);
    expect(adminSql).toMatch(/auth\.role\(\)\s*<>\s*'service_role'/i);
    expect(adminSql).toMatch(/grant execute on function public\.admin_create_profile[\s\S]*to service_role/i);
    expect(adminSql).toMatch(/revoke all on function public\.admin_create_profile[\s\S]*from public, anon, authenticated/i);
    expect(edgeFunction).toMatch(/\.rpc\(\s*"admin_create_profile"/);
    expect(edgeFunction).not.toMatch(/\.from\("profiles"\)\.insert/);
  });
});
