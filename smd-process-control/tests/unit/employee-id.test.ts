import { describe, expect, it } from "vitest";
import { employeeIdToInternalEmail } from "../../src/auth/employee-id";

describe("employeeIdToInternalEmail", () => {
  it("normalizes a trimmed employee ID into the internal sign-in identifier", () => {
    expect(employeeIdToInternalEmail(" 025017 ")).toBe("025017@smd.internal");
  });

  it("rejects any employee ID that is not 4 to 12 digits", () => {
    expect(() => employeeIdToInternalEmail("25-017")).toThrow("invalid_employee_id");
    expect(() => employeeIdToInternalEmail("123")).toThrow("invalid_employee_id");
  });
});
