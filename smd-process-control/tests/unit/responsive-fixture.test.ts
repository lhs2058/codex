import { describe, expect, it } from "vitest";
import { responsiveFixturesEnabled } from "../../src/app/responsive-test";

describe("responsive test fixture gate", () => {
  it("requires both a development build and the explicit fixture flag", () => {
    expect(responsiveFixturesEnabled(true, true)).toBe(true);
    expect(responsiveFixturesEnabled(true, false)).toBe(false);
    expect(responsiveFixturesEnabled(false, true)).toBe(false);
    expect(responsiveFixturesEnabled(false, false)).toBe(false);
  });
});
