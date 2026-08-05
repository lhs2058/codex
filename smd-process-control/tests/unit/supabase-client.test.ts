import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ identity: Symbol("supabase-client") }),
}));

describe("Supabase client lifetime", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  });

  it("reuses one auth client for the lifetime of the app module", async () => {
    const { getSupabaseClient } = await import("../../src/data/supabase");

    expect(getSupabaseClient()).toBe(getSupabaseClient());
  });
});
