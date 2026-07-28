import { describe, expect, it, vi } from "vitest";
import { corsHeaders, readBoundedJson, rollbackCreatedUser } from "../../supabase/functions/admin-create-user/helpers";

describe("admin-create-user Edge Function helpers", () => {
  it("includes Supabase invocation headers in CORS", () => {
    expect(corsHeaders["Access-Control-Allow-Headers"]).toContain("x-client-info");
    expect(corsHeaders["Access-Control-Allow-Headers"]).toContain("apikey");
  });

  it("rejects oversized bodies before parsing JSON", async () => {
    await expect(readBoundedJson(new Request("https://example.test", { method: "POST", headers: { "content-type": "application/json", "content-length": "20000" }, body: "{}" }))).resolves.toEqual({ ok: false, code: "payload_too_large" });
  });

  it("falls back to banning a newly-created user if deletion fails", async () => {
    const updateUserById = vi.fn().mockResolvedValue({ error: null });
    const log = vi.fn();
    const result = await rollbackCreatedUser({ deleteUser: vi.fn().mockResolvedValue({ error: { message: "failed" } }), updateUserById }, "new-user", "trace-1", log);
    expect(result).toBe("cleanup_failed");
    expect(updateUserById).toHaveBeenCalledWith("new-user", { ban_duration: "876000h" });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "admin_create_user_cleanup_failed", userId: "new-user", correlationId: "trace-1" }));
  });
});
