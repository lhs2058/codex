import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspace = resolve(import.meta.dirname, "../..");
const migration023 = resolve(
  workspace,
  "supabase/migrations/023_legacy_master_detail_import.sql",
);
const migration024 = resolve(
  workspace,
  "supabase/migrations/024_legacy_import_slot_guard_fix.sql",
);
const smoke = resolve(
  workspace,
  "supabase/tests/legacy_master_detail_import.smoke.sql",
);

function readSql(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
}

function readDollarLiteral(sql: string, tag: string) {
  const delimiter = `$${tag}$`;
  const start = sql.indexOf(delimiter);
  const end = sql.indexOf(delimiter, start + delimiter.length);

  expect(start, `missing ${delimiter}`).toBeGreaterThanOrEqual(0);
  expect(end, `unterminated ${delimiter}`).toBeGreaterThan(start);
  return sql.slice(start + delimiter.length, end);
}

describe("migration 024 legacy slot record guard", () => {
  it("converges the migration 023 function through guarded one-time patches", () => {
    const source023 = readSql(migration023);
    const source024 = readSql(migration024);
    let transformed = source023;

    for (const name of ["dispatch", "status"]) {
      const unsafe = readDollarLiteral(source024, `${name}_unsafe`);
      const safe = readDollarLiteral(source024, `${name}_safe`);

      expect(transformed.split(unsafe)).toHaveLength(2);
      transformed = transformed.replace(unsafe, safe);
      expect(transformed).not.toContain(unsafe);
    }

    expect(source023).toHaveLength(71_310);
    expect(source024.length).toBeLessThan(50_000);
    expect(source024).toContain("pg_get_functiondef");
    expect(source024).toContain("execute function_definition");
    expect(transformed).toContain(
      "if master_candidate.entity = 'time_slot' then",
    );
    expect(transformed).not.toMatch(
      /master_candidate\.entity <> 'time_slot'[\s\S]{0,500}slot_definition\./,
    );
  });

  it("keeps a runtime new-model commit regression in the rollback smoke", () => {
    const sql = readSql(smoke);
    const regression = sql.match(
      /-- SLOT_GUARD_REGRESSION_START([\s\S]*?)-- SLOT_GUARD_REGRESSION_END/,
    )?.[1];

    expect(regression).toBeDefined();
    expect(regression).toContain("'status', 'new'");
    expect(regression).toContain("commit_upload_batch_with_masters");
    expect(regression).toContain(
      "SMOKE_ASSERT: new model candidate slot guard regression",
    );
  });
});
