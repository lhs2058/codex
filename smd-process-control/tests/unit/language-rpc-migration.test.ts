import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/015_set_my_language.sql"),
  "utf8",
).toLowerCase();

describe("set_my_language migration contract", () => {
  it("has no target-user parameter and updates only the active auth.uid profile", () => {
    expect(migration).toMatch(/function public\.set_my_language\s*\(\s*new_language text\s*\)/);
    expect(migration).toContain("actor_id uuid := auth.uid()");
    expect(migration).toContain("where id = actor_id");
    expect(migration).toContain("and is_active");
    expect(migration).not.toMatch(/target_(user|profile)|user_id\s+uuid/);
  });

  it("uses a fixed empty search path, an allowlist, and authenticated-only execution", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("new_language not in ('ko', 'vi')");
    expect(migration).toContain("revoke all on function public.set_my_language(text) from public, anon");
    expect(migration).toContain("grant execute on function public.set_my_language(text) to authenticated");
  });
});
