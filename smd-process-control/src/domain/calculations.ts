import { DomainValidationError, type MetricResult } from "./types";

export function calculateYield(input: number, ok: number): MetricResult {
  if (input < 0 || ok < 0) {
    throw new DomainValidationError("Production quantities cannot be negative.");
  }
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
  if (standardTimeSeconds === null) {
    return { status: "not-calculable", reason: "missing-st" };
  }
  const netSeconds = plannedSeconds - downtimeSeconds;
  if (netSeconds <= 0) {
    return { status: "not-calculable", reason: "zero-net-time" };
  }
  return { status: "ok", value: (actual * standardTimeSeconds * 100) / netSeconds };
}
