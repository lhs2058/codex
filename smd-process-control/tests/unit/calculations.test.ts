import { describe, expect, it } from "vitest";

import { calculateUtilization, calculateYield } from "../../src/domain/calculations";
import { DomainValidationError } from "../../src/domain/types";

describe("calculateYield", () => {
  it("returns yield as a percentage for valid production quantities", () => {
    expect(calculateYield(1000, 995)).toEqual({ status: "ok", value: 99.5 });
  });

  it("reports zero input as not calculable", () => {
    expect(calculateYield(0, 0)).toEqual({ status: "not-calculable", reason: "zero-input" });
  });

  it("rejects negative input quantities", () => {
    expect(() => calculateYield(-1, 0)).toThrow(DomainValidationError);
  });

  it("rejects an ok quantity greater than its input quantity", () => {
    expect(() => calculateYield(10, 11)).toThrow(DomainValidationError);
  });
});

describe("calculateUtilization", () => {
  it("returns utilization using net planned time", () => {
    expect(calculateUtilization(800, 1.5, 1800, 300)).toEqual({ status: "ok", value: 80 });
  });

  it("reports a missing standard time as not calculable", () => {
    expect(calculateUtilization(800, null, 1800, 0)).toEqual({ status: "not-calculable", reason: "missing-st" });
  });

  it("reports non-positive net planned time as not calculable", () => {
    expect(calculateUtilization(800, 1.5, 300, 300)).toEqual({
      status: "not-calculable",
      reason: "zero-net-time",
    });
  });
});
