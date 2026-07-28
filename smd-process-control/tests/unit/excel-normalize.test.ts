import { describe, expect, it } from "vitest";
import {
  normalizeLineName,
  normalizeProcessName,
  normalizeProductionDate,
  normalizeQuantity,
} from "../../src/excel/normalize";

describe("Excel import normalization", () => {
  it.each([
    ["X-ray", "XRAY"],
    ["x ray", "XRAY"],
    ["검사 AOI", "AOI"],
    ["Máy SPI", "SPI"],
    ["Router Máy 2", "ROUTER"],
    ["Công đoạn ICT", "ICT"],
  ] as const)("normalizes %s to %s", (value, expected) => {
    expect(normalizeProcessName(value)).toBe(expected);
  });

  it("rejects unrecognized process names without fuzzy guessing", () => {
    expect(() => normalizeProcessName("AOI-ish")).toThrow("Unknown process");
  });

  it.each([
    ["AOI Line 3", "LINE-3"],
    ["Line 1", "LINE-1"],
    ["Chuyền số 4", "LINE-4"],
    ["LINE-12", "LINE-12"],
  ])("normalizes line identifier %s", (value, expected) => {
    expect(normalizeLineName(value)).toBe(expected);
  });

  it.each(["All Lines", "Tổng", "", "Line 1 + 2"])('rejects aggregate or blank line "%s"', (value) => {
    expect(() => normalizeLineName(value)).toThrow();
  });

  it.each([
    ["2026-07-27", undefined, "2026-07-27"],
    ["27.07", 2026, "2026-07-27"],
    ["27/07/2026", undefined, "2026-07-27"],
    [new Date(2026, 6, 27), undefined, "2026-07-27"],
    [46230, undefined, "2026-07-27"],
  ])("normalizes supported production date", (value, suppliedYear, expected) => {
    expect(normalizeProductionDate(value, suppliedYear)).toBe(expected);
  });

  it.each(["07/08/2026", "31.02", "2026-02-29", 0, Infinity])(
    "rejects invalid or ambiguous date %s",
    (value) => {
      expect(() => normalizeProductionDate(value, 2026)).toThrow();
    },
  );

  it.each([0, 4, "12"])('accepts finite nonnegative integer quantity %s', (value) => {
    expect(normalizeQuantity(value, "actual quantity")).toBe(Number(value));
  });

  it.each([-1, 1.5, "1.5", "#DIV/0!", ""])('rejects non-integer quantity %s', (value) => {
    expect(() => normalizeQuantity(value, "actual quantity")).toThrow();
  });
});
