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
  });

  it("keeps historical standard-time periods immutable across admin changes", () => {
    const sql = readMigration("019_admin_rpc_and_verified_actor.sql");

    expect(sql).toMatch(/historical_standard_time_immutable/i);
    expect(sql).toMatch(/p_entity = 'standard_times'[\s\S]*effective_from[\s\S]*business_date/i);
    expect(sql).toMatch(/effective_to\s*=\s*case[\s\S]*business_date\s*-\s*1/i);
    expect(sql).toMatch(/private\.list_historical_standard_times\(\)/i);
    expect(sql).toMatch(/from public\.standard_times as standard_time[\s\S]*deleted_at[\s\S]*effective_from/i);
  });

  it("rejects inactive manual dimensions and exposes hardened optimistic admin RPCs only to intended roles", () => {
    const uploadSql = readMigration("018_atomic_upload_and_manual_validation.sql");
    const adminSql = readMigration("019_admin_rpc_and_verified_actor.sql");
    const edgeFunction = readFileSync(join(process.cwd(), "supabase", "functions", "admin-create-user", "index.ts"), "utf8");

    for (const table of ["models", "lines", "processes", "shifts", "time_slots", "downtime_reasons"]) {
      expect(uploadSql).toMatch(new RegExp(`from public\\.${table}[\\s\\S]*?is_active[\\s\\S]*?deleted_at is null`, "i"));
    }
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
