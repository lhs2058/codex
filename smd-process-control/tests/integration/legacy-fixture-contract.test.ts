import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";

type FixtureBook = {
  sheets: Map<string, Document>;
};

const elements = (document: Document, localName: string) => Array.from(document.getElementsByTagNameNS("*", localName));

function parseXml(xml: string): Document {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  expect(document.getElementsByTagName("parsererror")).toHaveLength(0);
  return document;
}

async function fixtureBook(name: string): Promise<FixtureBook> {
  const bytes = unzipSync(new Uint8Array(await fs.readFile(path.join(import.meta.dirname, "..", "fixtures", name))));
  const entries = Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, strFromU8(value)]));
  const workbook = parseXml(entries["xl/workbook.xml"]!);
  const relationships = parseXml(entries["xl/_rels/workbook.xml.rels"]!);
  const targets = new Map(elements(relationships, "Relationship").map((relationship) => [
    relationship.getAttribute("Id")!,
    relationship.getAttribute("Target")!.replace(/^\/+/, ""),
  ]));
  const sheets = new Map(elements(workbook, "sheet").map((sheet) => {
    const target = targets.get(sheet.getAttribute("r:id")!);
    expect(target).toBeDefined();
    expect(entries[target!]).toBeDefined();
    return [sheet.getAttribute("name")!, parseXml(entries[target!]!)] as const;
  }));
  return { sheets };
}

function cell(document: Document, reference: string): string | null {
  const match = elements(document, "c").find((candidate) => candidate.getAttribute("r") === reference);
  if (!match) return null;
  return match.getElementsByTagNameNS("*", "v")[0]?.textContent ?? null;
}

function merges(document: Document): string[] {
  return elements(document, "mergeCell").map((merge) => merge.getAttribute("ref")!);
}

function expectSheet(book: FixtureBook, name: string, expectedCells: Record<string, string>, expectedMerges: string[]) {
  const sheet = book.sheets.get(name);
  expect(sheet, `missing mapped worksheet for ${name}`).toBeDefined();
  expect(Object.fromEntries(Object.keys(expectedCells).map((reference) => [reference, cell(sheet!, reference)]))).toEqual(expectedCells);
  expect(merges(sheet!)).toEqual(expectedMerges);
}

describe("legacy fixture contracts", () => {
  it("maps every named tab to its relationship target and preserves exact title/header/merge contracts", async () => {
    const aoi = await fixtureBook("aoi-sample.xlsx");
    expect([...aoi.sheets.keys()]).toEqual(["AOI Line", "aoi model"]);
    expectSheet(aoi, "AOI Line", {
      B4: "Data Theo Dõi Hiệu Suất Máy AOI công đoạn SMD", C5: "Ngày", D5: "Ca", E5: "Công Đoạn", G5: "Time", H5: "Input", I5: "Ouput", K5: "Q'ty NG", K6: "Lỗi Ảo", M6: "Lỗi Thật", O6: "Chi Tiết Lỗi", O7: "Short",
    }, ["B4:AC4"]);
    expectSheet(aoi, "aoi model", {
      B4: "Data Theo Dõi Hiệu Suất Máy AOI công đoạn SMD", C5: "Ngày", D5: "Ca", E5: "Model", G5: "Time", H5: "Input", I5: "Ouput", K5: "Q'ty NG", K6: "Lỗi Ảo", M6: "Lỗi Thật", O6: "Chi Tiết Lỗi",
    }, ["B4:AC4"]);

    const spi = await fixtureBook("spi-sample.xlsx");
    expect([...spi.sheets.keys()]).toEqual(["SPI MODEL", "SPI Line"]);
    expectSheet(spi, "SPI MODEL", {
      B4: "Data Theo Dõi Hiệu Suất Máy SPI công đoạn SMD", C5: "Ngày", D5: "Ca", E5: "Model", G5: "Time", H5: "Input", I5: "Ouput", K5: "Q'ty NG", K6: "Lỗi Ảo", M6: "Lỗi Thật", O6: "Chi Tiết Lỗi",
    }, ["B4:AC4"]);
    expectSheet(spi, "SPI Line", {
      B4: "Data Theo Dõi Hiệu Suất Máy SPI công đoạn SMD", C5: "Ngày", D5: "Ca", E5: "Công Đoạn", G5: "Time", H5: "Input", I5: "Ouput", K5: "Q'ty NG", K6: "Lỗi Ảo", M6: "Lỗi Thật", O6: "Chi Tiết Lỗi", O7: "Short",
    }, ["B4:AC4"]);

    const ict = await fixtureBook("ict-sample.xlsx");
    expect([...ict.sheets.keys()]).toEqual(["Data HS Công Đoạn ICT"]);
    expectSheet(ict, "Data HS Công Đoạn ICT", {
      B4: "Data Theo Dõi Hiệu Suất công đoạn ICT", C5: "Ngày", D5: "Ca", E5: "Model", G5: "Time", H5: "Input", I5: "OK", M5: "NG", Q5: "Chi Tiết Lỗi", Q6: "Short", I7: "Trước CF", K7: "Sau CF", M7: "Trước CF", O7: "Sau CF",
    }, ["B4:AC4"]);

    const xray = await fixtureBook("xray-sample.xlsx");
    expect([...xray.sheets.keys()]).toEqual(["Xray"]);
    expectSheet(xray, "Xray", {
      B4: "Data Theo Dõi Hiệu Suất công đoạn XRAY", C5: "Ngày", D5: "Ca", E5: "Model", G5: "Time", H5: "Input", I5: "OK", M5: "NG", Q5: "Chi Tiết Lỗi", Q6: "Short", I7: "Trước CF", K7: "Sau CF", M7: "Trước CF", O7: "Sau CF",
    }, ["B4:AC4"]);

    const production = await fixtureBook("production-sample.xlsx");
    expect([...production.sheets.keys()]).toEqual(["25.07"]);
    expectSheet(production, "25.07", {
      C2: "BÁO CÁO SẢN LƯỢNG CÁC CÔNG ĐOẠN SMD THEO TIME NGÀY 25/07/2026", C3: "Ngày", D3: "Ca", E3: "Model", N3: "Sản Lượng Từng Time",
      N4: "Time A", S4: "Time B", X4: "Time C", AC4: "Time D", AH4: "Time E",
      N6: "CAPA", O6: "Sản Lượng Thực Tế", Q6: "Time dừng máy (p)", R6: "Ghi chú",
      S6: "CAPA", T6: "Sản Lượng Thực Tế", V6: "Time dừng máy (p)", W6: "Ghi chú",
      X6: "CAPA", Y6: "Sản Lượng Thực Tế", AA6: "Time dừng máy (p)", AB6: "Ghi chú",
      AC6: "CAPA", AD6: "Sản Lượng Thực Tế", AF6: "Time dừng máy (p)", AG6: "Ghi chú",
      AH6: "CAPA", AI6: "Sản Lượng Thực Tế", AK6: "Time dừng máy (p)", AL6: "Ghi chú",
    }, ["C2:AW2", "N3:AL3", "N4:R4", "S4:W4", "X4:AB4", "AC4:AG4", "AH4:AL4"]);
  });

  it("contains one intentional stored #DIV/0! ratio only in production", async () => {
    const books = await Promise.all(["aoi-sample.xlsx", "spi-sample.xlsx", "ict-sample.xlsx", "xray-sample.xlsx", "production-sample.xlsx"].map(fixtureBook));
    const counts = books.map((book) => [...book.sheets.values()].reduce((count, sheet) =>
      count + elements(sheet, "c").filter((entry) => entry.getElementsByTagNameNS("*", "v")[0]?.textContent === "#DIV/0!").length, 0));
    expect(counts).toEqual([0, 0, 0, 0, 1]);
  });
});
