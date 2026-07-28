import { describe, expect, it } from "vitest";

import { DomainValidationError } from "../../src/domain/types";
import { slotDurationSeconds } from "../../src/domain/time";

describe("slotDurationSeconds", () => {
  it("calculates an overnight slot duration", () => {
    expect(slotDurationSeconds("22:00", "02:00", 1)).toBe(14400);
  });

  it("rejects times outside the 24-hour clock", () => {
    expect(() => slotDurationSeconds("25:00", "02:00", 1)).toThrow(DomainValidationError);
  });
});
