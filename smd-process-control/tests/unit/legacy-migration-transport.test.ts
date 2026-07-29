import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const workspace = resolve(import.meta.dirname, "../..");
const guard = resolve(workspace, "scripts/verify-sql-migration.mjs");
const migration = resolve(
  workspace,
  "supabase/migrations/023_legacy_master_detail_import.sql",
);
const sql = readFileSync(migration, "utf8");
const temporary = mkdtempSync(resolve(tmpdir(), "legacy-migration-"));

afterAll(() => rmSync(temporary, { recursive: true, force: true }));

function runGuard(path: string, expectedChars: number) {
  return spawnSync(
    process.execPath,
    [guard, path, "--expected-chars", String(expectedChars)],
    { cwd: workspace, encoding: "utf8" },
  );
}

describe("legacy migration transport guard", () => {
  it("accepts the complete migration with balanced SQL lexical states", () => {
    const result = runGuard(migration, sql.length);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`verified ${sql.length} characters`);
  });

  it("rejects a connector artifact containing an output truncation marker", () => {
    const truncated = resolve(temporary, "truncated.sql");
    writeFileSync(
      truncated,
      `${sql.slice(0, 20_000)}…7828 tokens truncated…${sql.slice(-20_000)}`,
    );

    const result = runGuard(truncated, sql.length);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("transport truncation marker");
  });
});
