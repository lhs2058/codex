import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const smokePath = resolve(
  import.meta.dirname,
  "../../supabase/tests/legacy_master_detail_import.smoke.sql",
);

describe("legacy master/detail plain PostgreSQL smoke suite", () => {
  it("is a small, rollback-only script with no DDL or pgTAP dependency", () => {
    const sql = readFileSync(smokePath, "utf8");

    expect(sql.length).toBeLessThan(50_000);
    expect(sql.trimStart().toLowerCase()).toMatch(/^begin\s*;/);
    expect(sql.trimEnd().toLowerCase()).toMatch(/rollback\s*;$/);
    expect(sql).not.toMatch(
      /\b(?:create|alter|drop|truncate)\s+(?:table|function|policy|index|schema|extension)\b/i,
    );
    expect(sql).not.toMatch(/\b(?:no_plan|plan|ok|is|throws_ok|lives_ok)\s*\(/i);
  });

  it.each([
    "operator approval denial",
    "operator candidate bypass denial",
    "atomic master ST detail commit",
    "same batch idempotency",
    "inclusive ST overlap rejection",
    "exact second downtime rejection",
    "invalid detail atomic rollback",
  ])("contains an explicit assertion for %s", (assertion) => {
    const sql = readFileSync(smokePath, "utf8");

    expect(sql).toContain(`SMOKE_ASSERT: ${assertion}`);
  });

  it("asserts exact-second rejection at upload-row structural validation", () => {
    const sql = readFileSync(smokePath, "utf8");
    const boundary = sql.match(
      /-- EXACT_SECOND_BOUNDARY_START([\s\S]*?)-- EXACT_SECOND_BOUNDARY_END/,
    )?.[1];

    expect(boundary).toBeDefined();
    expect(boundary).toContain("insert into public.upload_rows");
    expect(boundary).toContain("'minutes', 121");
    expect(boundary).toContain(
      "sqlerrm <> 'downtime_exceeds_planned_time'",
    );
    expect(boundary).not.toContain("stage_upload_candidates");
    expect(boundary).not.toContain("commit_upload_batch_with_masters");
  });
});
