import { DomainValidationError, type MetricResult } from "./types";

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new DomainValidationError(`${name} must be a finite, non-negative number.`);
  }
}

export function calculateYield(input: number, ok: number): MetricResult {
  assertFiniteNonNegative(input, "Input quantity");
  assertFiniteNonNegative(ok, "Ok quantity");
  if (ok > input) {
    throw new DomainValidationError("Ok quantity cannot exceed input quantity.");
  }
  if (input === 0) {
    return { status: "not-calculable", reason: "zero-input" };
  }
  return { status: "ok", value: (ok / input) * 100 };
}

export function calculateUtilization(
  actual: number,
  standardTimeSeconds: number | null,
  plannedSeconds: number,
  downtimeSeconds: number,
): MetricResult {
  assertFiniteNonNegative(actual, "Actual quantity");
  assertFiniteNonNegative(plannedSeconds, "Planned seconds");
  assertFiniteNonNegative(downtimeSeconds, "Downtime seconds");
  if (standardTimeSeconds === null) {
    return { status: "not-calculable", reason: "missing-st" };
  }
  assertFiniteNonNegative(standardTimeSeconds, "Standard time seconds");
  const netSeconds = plannedSeconds - downtimeSeconds;
  if (netSeconds <= 0) {
    return { status: "not-calculable", reason: "zero-net-time" };
  }
  return { status: "ok", value: (actual * standardTimeSeconds * 100) / netSeconds };
}
