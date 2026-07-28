import { describe, expect, it } from "vitest";
import { safeNextPath } from "../../src/auth/safe-next";

describe("safeNextPath", () => {
  it("preserves an internal application path including query and hash", () => {
    expect(safeNextPath("/admin?tab=users#active")).toBe("/admin?tab=users#active");
  });

  it.each(["//evil.example", "/\\evil.example", "%2F%2Fevil.example", "%5C%5Cevil.example", "/%5Cevil", "/ok%0aevil", "https://evil.example/admin", "javascript:alert(1)"])(
    "rejects an external or encoded bypass: %s", (value) => {
      expect(safeNextPath(value)).toBe("/");
    },
  );
});
