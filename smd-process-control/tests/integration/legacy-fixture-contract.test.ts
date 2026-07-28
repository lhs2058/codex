import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";

async function xml(name: string) {
  const bytes = unzipSync(new Uint8Array(await fs.readFile(path.join(import.meta.dirname, "..", "fixtures", name))));
  return Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, strFromU8(value)]));
}

describe("legacy fixture contracts", () => {
  it("keeps characteristic sheets, merged bands, and multi-row Vietnamese headers", async () => {
    const production = await xml("production-sample.xlsx");
    const workbook = production["xl/workbook.xml"]!;
    const sheet = production["xl/worksheets/sheet1.xml"]!;
    expect(workbook).toContain('name="25.07"');
    expect(sheet).toContain("mergeCells");
    expect((sheet.match(/mergeCell[^s]/g) ?? []).length).toBeGreaterThanOrEqual(6);
    const aoi = await xml("aoi-sample.xlsx");
    expect(aoi["xl/workbook.xml"]!).toContain('name="AOI Line"');
    expect(aoi["xl/workbook.xml"]!).toContain('name="aoi model"');
    expect(Object.values(aoi).join("\n")).toContain("Data Theo Dõi Hiệu Suất Máy AOI");
    for (const [file, sheets, title] of [
      ["aoi-sample.xlsx", ["AOI Line", "aoi model"], "Data Theo Dõi Hiệu Suất Máy AOI"],
      ["spi-sample.xlsx", ["SPI MODEL", "SPI Line"], "Data Theo Dõi Hiệu Suất Máy SPI"],
      ["ict-sample.xlsx", ["Data HS Công Đoạn ICT"], "Data Theo Dõi Hiệu Suất"],
      ["xray-sample.xlsx", ["Xray"], "Data Theo Dõi Hiệu Suất"],
    ] as const) {
      const book = await xml(file); const raw = Object.values(book).join("\n");
      for (const name of sheets) expect(book["xl/workbook.xml"]!).toContain(`name="${name}"`);
      expect(raw).toContain(title); expect(raw).toContain("mergeCell"); expect(raw).toMatch(/Ngày|Time/);
    }
  });

  it("contains one intentional stored #DIV/0! ratio only in production", async () => {
    const books = await Promise.all(["aoi-sample.xlsx", "spi-sample.xlsx", "ict-sample.xlsx", "xray-sample.xlsx", "production-sample.xlsx"].map(xml));
    const counts = books.map((book) => (Object.values(book).join("\n").match(/#DIV\/0!/g) ?? []).length);
    expect(counts).toEqual([0, 0, 0, 0, 1]);
  });
});
