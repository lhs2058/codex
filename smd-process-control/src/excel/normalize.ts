import { DomainValidationError, type ProcessCode } from "../domain/types";

const PROCESS_ALIASES: ReadonlyArray<readonly [ProcessCode, RegExp]> = [
  ["SPI", /(^| )(spi|solder paste inspection)( |$)|솔더 페이스트 검사/],
  ["AOI", /(^| )(aoi|automated optical inspection)( |$)|자동 광학 검사/],
  ["XRAY", /(^| )(x ray|xray)( |$)|엑스 레이/],
  ["ICT", /(^| )(ict|in circuit test)( |$)|인 서킷 테스트/],
  ["ROUTER", /(^| )(router|router may [0-9]+)( |$)|라우터/],
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase()
    .replace(/[‐‑‒–—-]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function error(message: string): never {
  throw new DomainValidationError(message);
}

export function normalizeProcessName(value: unknown): ProcessCode {
  const original = text(value);
  if (/-/.test(original) && !/^x-?ray$/i.test(original)) error(`Unknown process: ${original || "(blank)"}`);
  const normalized = fold(original);
  const match = PROCESS_ALIASES.find(([, alias]) => alias.test(normalized) || alias.test(original));
  if (!match) error(`Unknown process: ${original || "(blank)"}`);
  return match[0];
}

export function normalizeLineName(value: unknown): string {
  const original = text(value);
  const normalized = fold(original);
  if (!normalized || /\b(all|total|aggregate)\b|tong|tat ca|전체|합계/.test(normalized)) {
    error(`Unknown line: ${original || "(blank)"}`);
  }
  if (/\+|\band\b/.test(original) || /\band\b/.test(normalized)) error(`Aggregate line: ${original}`);

  const number = normalized.match(/(?:^| )(?:aoi )?line (\d+)(?: |$)|(?:^| )chuyen (?:so )?(\d+)(?: |$)|라인\s*(\d+)/);
  if (number) return `LINE-${number[1] ?? number[2] ?? number[3]}`;

  const canonical = original.toUpperCase().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(canonical)) error(`Unknown line: ${original}`);
  return canonical;
}

function calendarDate(year: number, month: number, day: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) error("Invalid production date");
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    error("Invalid production date");
  }
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function excelSerialDate(serial: number): string {
  // Excel's 1900 system intentionally contains a nonexistent 1900-02-29 at serial 60.
  if (!Number.isFinite(serial) || !Number.isInteger(serial) || serial < 1 || serial > 2_958_465 || serial === 60) {
    error("Invalid Excel date serial");
  }
  const daysSince1899December31 = serial < 60 ? serial : serial - 1;
  const utc = new Date(Date.UTC(1899, 11, 31 + daysSince1899December31));
  return calendarDate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

export function normalizeProductionDate(value: unknown, suppliedYear?: number): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return calendarDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number") return excelSerialDate(value);
  const valueText = text(value);
  let match = valueText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return calendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = valueText.match(/^(\d{2})\.(\d{2})\.(\d{4})$/) ?? valueText.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    if (day <= 12 && month <= 12) error(`Invalid or ambiguous production date: ${valueText}`);
    return calendarDate(Number(match[3]), month, day);
  }
  match = valueText.match(/^(\d{2})\.(\d{2})$/);
  if (match && suppliedYear !== undefined) return calendarDate(suppliedYear, Number(match[2]), Number(match[1]));
  error(`Invalid or ambiguous production date: ${valueText || "(blank)"}`);
}

export function normalizeQuantity(value: unknown, field = "quantity"): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) {
    error(`Invalid ${field}`);
  }
  return numeric;
}
