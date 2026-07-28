import { DomainValidationError } from "./types";

function timeToSeconds(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) {
    throw new DomainValidationError("Time must use HH:MM format.");
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new DomainValidationError("Time must be within a 24-hour day.");
  }
  return hours * 3600 + minutes * 60;
}

export function slotDurationSeconds(start: string, end: string, endDayOffset: 0 | 1): number {
  const startSeconds = timeToSeconds(start);
  const endSeconds = timeToSeconds(end);
  const duration = endSeconds + endDayOffset * 24 * 60 * 60 - startSeconds;

  if (duration < 0) {
    throw new DomainValidationError("End time must not precede start time on the same day.");
  }
  return duration;
}
