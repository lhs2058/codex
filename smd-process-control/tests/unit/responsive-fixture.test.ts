import { describe, expect, it } from "vitest";
import { responsiveFixturesEnabled } from "../../src/app/responsive-test";

describe("responsive test fixture gate", () => {
  it("requires development, the build flag, and an explicit fixture query", () => {
    expect(responsiveFixturesEnabled(true, true, true)).toBe(true);
    expect(responsiveFixturesEnabled(true, true, false)).toBe(false);
    expect(responsiveFixturesEnabled(true, false, true)).toBe(false);
    expect(responsiveFixturesEnabled(false, true, true)).toBe(false);
  });
});
