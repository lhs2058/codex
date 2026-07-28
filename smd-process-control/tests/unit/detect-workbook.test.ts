import { describe, expect, it } from "vitest";
import { detectWorkbook } from "../../src/excel/detect-workbook";
import type { WorkbookSheet } from "../../src/excel/contracts";

const sheet = (name: string, rows: unknown[][]): WorkbookSheet => ({ sheet: name, data: rows });

describe("workbook detection", () => {
  it.each([
    [sheet("Total AOI", [["Date", "Model", "Input", "OK", "NG"]]), "aoi"],
    [sheet("SPI MODEL", [["Ngày", "Model", "Input", "OK", "NG"]]), "spi"],
    [sheet("Data HS Công Đoạn ICT", [["Date", "Model", "Input", "OK", "NG"]]), "ict"],
    [sheet("Xray", [["Date", "Model", "Input", "OK", "NG"]]), "xray"],
    [sheet("Sản Lượng Từng Time", [["Date", "Line", "Time", "Actual", "Downtime"]]), "production"],
  ])("detects legacy %s only with its required header signature", (legacySheet, kind) => {
    expect(detectWorkbook([legacySheet])).toEqual({ kind, diagnostics: [] });
  });

  it("detects the standard workbook ahead of legacy signatures when version and headers match", () => {
    const standard = sheet("Production", [
      ["SMD_STANDARD_V1"],
      ["Production Date", "Shift", "Time Slot", "Line", "Model", "Process", "Input", "Actual", "OK", "NG", "Downtime Minutes", "Downtime Reason", "Note"],
    ]);
    const legacy = sheet("Total AOI", [["Date", "Model", "Input", "OK", "NG"]]);
    expect(detectWorkbook([legacy, standard])).toEqual({ kind: "standard", diagnostics: [] });
  });

  it("is deterministic when sheets are reordered", () => {
    const aoi = sheet("Total AOI", [["Date", "Model", "Input", "OK", "NG"]]);
    const spi = sheet("SPI MODEL", [["Date", "Model", "Input", "OK", "NG"]]);
    const expected = detectWorkbook([aoi, spi]);
    expect(detectWorkbook([spi, aoi])).toEqual(expected);
    expect(expected.kind).toBe("unknown");
    expect(expected.diagnostics[0]?.code).toBe("ambiguous-workbook");
  });

  it("does not treat a matching sheet name alone or formula error values as a signature", () => {
    expect(detectWorkbook([sheet("Total AOI", [["#DIV/0!", "", null]])]).kind).toBe("unknown");
  });

  it("detects a date sheet only when its grouped production title and time headers also match", () => {
    const grouped = sheet("25.07", [
      [], ["BÁO CÁO SẢN LƯỢNG CÁC CÔNG ĐOẠN SMD THEO TIME NGÀY 25/07/2026"], ["Sản Lượng Từng Time"],
      ["Time A", "Time B", "Time C", "Time D", "Time E"], [],
      ["CAPA", "Sản Lượng Thực Tế", "Tỷ Lệ", "Time dừng máy (p)", "Ghi chú", "CAPA", "Sản Lượng Thực Tế", "Tỷ Lệ", "Time dừng máy (p)", "Ghi chú"],
    ]);
    expect(detectWorkbook([grouped]).kind).toBe("unknown");
    expect(detectWorkbook([sheet("25.07", [["random"]])]).kind).toBe("unknown");
  });

  it("reports an unsupported standard version", () => {
    const result = detectWorkbook([sheet("Production", [["SMD_STANDARD_V2"], ["Production Date", "Shift"]])]);
    expect(result.kind).toBe("unknown");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "unsupported-template-version" }));
  });

  it("reports useful evidence when no signature matches", () => {
    const result = detectWorkbook([sheet("Random", [["Something", "Else"]])]);
    expect(result.kind).toBe("unknown");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "missing-workbook-signature", sourceSheet: "Random" }));
  });
});
