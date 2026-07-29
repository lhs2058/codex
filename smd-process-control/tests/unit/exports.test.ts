import readXlsxFile, { readSheetNames } from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";
import type { AnalysisDataset } from "../../src/domain/types";
import {
  analysisReportFilename,
  buildAnalysisExcelReport,
} from "../../src/exports/excel-report";
import {
  buildAnalysisPdfDocument,
  pdfReportLabels,
} from "../../src/exports/pdf-report";

const dataset: AnalysisDataset = {
  filters: {
    from: "2026-07-01",
    to: "2026-07-31",
    groupBy: "day",
    shiftId: "shift-day",
    modelId: "model-a",
    lineId: "line-1",
    processCode: "AOI",
  },
  yieldSeries: [
    { period: "2026-07-01", inputQty: 100, okQty: 96, target: 95, belowTarget: false },
    { period: "2026-07-02", inputQty: 200, okQty: 180, target: 95, belowTarget: true },
  ],
  utilizationSeries: [
    { period: "2026-07-01", actualQty: 80, productiveSeconds: 2400, netSeconds: 3000, utilizationPercent: 80 },
    { period: "2026-07-02", actualQty: 150, productiveSeconds: 4500, netSeconds: 5400, utilizationPercent: 83.33333333333334 },
  ],
  processLines: [
    { processCode: "AOI", lineId: "line-1", lineCode: "L1", inputQty: 300, okQty: 276, yieldPercent: 92, target: 95, belowTarget: true },
  ],
  timeSlots: [
    { timeSlotId: "slot-a", timeSlotCode: "A", actualQty: 230, productiveSeconds: 6900, netSeconds: 8400, utilizationPercent: 82.14285714285714 },
  ],
  downtime: [{ reason: "설비 정지", minutes: 25, lostUnits: 50 }],
  defects: [
    { type: "브리지", classification: "real", quantity: 9 },
    { type: "Thiếu thiếc", classification: "pseudo", quantity: 4 },
  ],
  generatedBy: "홍길동 / Nguyễn An",
};

describe("analysis Excel export", () => {
  it("uses the exact stable range filename", () => {
    expect(analysisReportFilename(dataset, "xlsx")).toBe("smd-report_2026-07-01_2026-07-31.xlsx");
    expect(analysisReportFilename(dataset, "pdf")).toBe("smd-report_2026-07-01_2026-07-31.pdf");
  });

  it("creates the five exact sheets with typed dates, numbers, filters, and generation metadata", async () => {
    const generatedAt = new Date("2026-07-28T08:30:00.000Z");
    const report = buildAnalysisExcelReport(dataset, "ko", generatedAt);
    const {
      columns,
      fontFamily,
      fontSize,
      ...sheetOptions
    } = report.options;
    const buffer = await writeXlsxFile(
      report.data.map((data, index) => ({
        ...sheetOptions,
        data,
        sheet: report.sheets[index],
        columns: columns[index],
      })),
      { fontFamily, fontSize },
    ).toBuffer();

    await expect(readSheetNames(buffer)).resolves.toEqual([
      "Summary",
      "Yield",
      "Utilization",
      "Downtime",
      "Defects",
    ]);
    const summary = await readXlsxFile(buffer, { sheet: "Summary" });
    const yieldRows = await readXlsxFile(buffer, { sheet: "Yield" });
    const utilization = await readXlsxFile(buffer, { sheet: "Utilization" });
    const downtime = await readXlsxFile(buffer, { sheet: "Downtime" });
    const defects = await readXlsxFile(buffer, { sheet: "Defects" });

    expect(summary).toEqual(expect.arrayContaining([
      ["시작일", expect.any(Date)],
      ["종료일", expect.any(Date)],
      ["생성 시각", expect.any(Date)],
      ["생성 사용자", "홍길동 / Nguyễn An"],
      ["공정", "AOI"],
      ["라인", "line-1"],
      ["모델", "model-a"],
      ["조", "shift-day"],
    ]));
    expect((summary.find((row) => row[0] === "시작일")?.[1] as Date).toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(yieldRows[1]).toEqual([
      expect.any(Date),
      "2026-07-01",
      100,
      96,
      96,
      95,
      false,
    ]);
    expect(utilization[1]).toEqual([
      expect.any(Date),
      "2026-07-01",
      80,
      2400,
      3000,
      80,
    ]);
    expect(downtime[1]).toEqual(["설비 정지", 25, 50]);
    expect(defects[1]).toEqual(["브리지", "진성", 9]);
    const cells = [summary, yieldRows, utilization, downtime, defects].flat(2);
    expect(cells.filter((cell) => typeof cell === "string" && /^#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A)$/i.test(cell))).toEqual([]);
  });
});

describe("analysis PDF export", () => {
  it("paginates a representative long defect table without changing the stable filename", async () => {
    const longDataset: AnalysisDataset = {
      ...dataset,
      defects: Array.from({ length: 90 }, (_, index) => ({
        type: `불량 유형 ${index + 1} / Lỗi ${index + 1}`,
        classification: index % 3 === 0 ? "real" : index % 3 === 1 ? "pseudo" : "scrap",
        quantity: 100 - index,
      })),
    };
    const document = await buildAnalysisPdfDocument(longDataset, "ko", {
      generatedAt: new Date("2026-07-28T08:30:00.000Z"),
      fontBase64: null,
    });

    expect(document.getNumberOfPages()).toBeGreaterThan(2);
    expect(document.getCreationDate("jsDate")).toEqual(new Date("2026-07-28T08:30:00.000Z"));
    expect(analysisReportFilename(longDataset, "pdf")).toBe("smd-report_2026-07-01_2026-07-31.pdf");
  });

  it("splits one extreme multilingual logical row across pages without entering the footer", async () => {
    const longReason = Array.from(
      { length: 500 },
      (_, index) => `설비 점검 ${index + 1} · Kiểm tra thiết bị ${index + 1}`,
    ).join(" / ");
    const document = await buildAnalysisPdfDocument({
      ...dataset,
      downtime: [{ reason: longReason, minutes: 1_234, lostUnits: 2_468 }],
      defects: [],
    }, "vi", {
      generatedAt: new Date("2026-07-28T08:30:00.000Z"),
      fontBase64: null,
    });
    const pageOperations = (document as unknown as { internal: { pages: string[][] } }).internal.pages;
    const rectangleBottoms = pageOperations.flatMap((operations) =>
      operations.flatMap((operation) => {
        const match = operation.match(/^[\d.]+ ([\d.]+) [\d.]+ (-[\d.]+) re$/);
        return match ? [Number(match[1]) + Number(match[2])] : [];
      }));

    expect(document.getNumberOfPages()).toBeGreaterThan(2);
    expect(rectangleBottoms.length).toBeGreaterThan(0);
    expect(Math.min(...rectangleBottoms)).toBeGreaterThanOrEqual(16 * (72 / 25.4) - 0.1);
  });

  it("provides Korean and Vietnamese report labels for embedded-font output", () => {
    expect(pdfReportLabels("ko")).toEqual(expect.objectContaining({
      title: "SMD 공정 분석 보고서",
      defects: "불량 상세",
      generatedBy: "생성 사용자",
    }));
    expect(pdfReportLabels("vi")).toEqual(expect.objectContaining({
      title: "Báo cáo phân tích quy trình SMD",
      defects: "Chi tiết lỗi",
      generatedBy: "Người tạo",
    }));
  });

  it("restores the light row fill before drawing every PDF table cell", async () => {
    const document = await buildAnalysisPdfDocument(dataset, "ko", {
      generatedAt: new Date("2026-07-28T08:30:00.000Z"),
      fontBase64: null,
    });
    const pageOperations = (document as unknown as { internal: { pages: string[][] } })
      .internal.pages.flat().join("\n");

    expect(pageOperations.match(/0\.96 0\.98 0\.99 rg/g)?.length ?? 0).toBeGreaterThanOrEqual(28);
  });
});
