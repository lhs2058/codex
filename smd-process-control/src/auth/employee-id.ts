const EMPLOYEE_ID_PATTERN = /^\d{4,12}$/;
const INTERNAL_EMAIL_DOMAIN = "smd.internal";

export function normalizeEmployeeId(employeeId: string): string {
  const normalized = employeeId.trim();
  if (!EMPLOYEE_ID_PATTERN.test(normalized)) {
    throw new Error("invalid_employee_id");
  }
  return normalized;
}

export function employeeIdToInternalEmail(employeeId: string): string {
  return `${normalizeEmployeeId(employeeId)}@${INTERNAL_EMAIL_DOMAIN}`;
}
