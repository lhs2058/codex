import type { Columns, Row, SheetData } from "write-excel-file";
import type { AnalysisDataset } from "../domain/types";

type Language = "ko" | "vi";

const labels = {
  ko: {
    title: "SMD 공정 분석 보고서",
    from: "시작일",
    to: "종료일",
    groupBy: "집계",
    shift: "조",
    model: "모델",
    line: "라인",
    process: "공정",
    generatedAt: "생성 시각",
    generatedBy: "생성 사용자",
    all: "전체",
    periodDate: "기간 시작일",
    period: "기간",
    input: "투입 수량 (EA)",
    ok: "양품 수량 (EA)",
    yield: "수율 (%)",
    target: "목표 (%)",
    below: "목표 미달",
    actual: "실적 (EA)",
    productive: "생산 환산시간 (초)",
    net: "순가동시간 (초)",
    utilization: "가동률 (%)",
    reason: "비가동 사유",
    minutes: "비가동 (분)",
    lostUnits: "손실 수량 (EA)",
    defect: "불량 유형",
    classification: "분류",
    quantity: "수량 (EA)",
    real: "진성",
    pseudo: "가성",
    scrap: "폐기",
  },
  vi: {
    title: "Báo cáo phân tích quy trình SMD",
    from: "Từ ngày",
    to: "Đến ngày",
    groupBy: "Nhóm theo",
    shift: "Ca",
    model: "Mẫu",
    line: "Chuyền",
    process: "Công đoạn",
    generatedAt: "Thời gian tạo",
    generatedBy: "Người tạo",
    all: "Tất cả",
    periodDate: "Ngày bắt đầu kỳ",
    period: "Kỳ",
    input: "Đầu vào (EA)",
    ok: "Đạt (EA)",
    yield: "Tỷ lệ đạt (%)",
    target: "Mục tiêu (%)",
    below: "Dưới mục tiêu",
    actual: "Sản lượng (EA)",
    productive: "Thời gian quy đổi (giây)",
    net: "Thời gian chạy ròng (giây)",
    utilization: "Hiệu suất (%)",
    reason: "Lý do dừng",
    minutes: "Thời gian dừng (phút)",
    lostUnits: "Sản lượng mất (EA)",
    defect: "Loại lỗi",
    classification: "Phân loại",
    quantity: "Số lượng (EA)",
    real: "Lỗi thật",
    pseudo: "Lỗi giả",
    scrap: "Phế phẩm",
  },
} as const;

const header = (value: string) => ({
  value,
  type: String,
  fontWeight: "bold" as const,
  color: "#FFFFFF",
  backgroundColor: "#1E4E79",
  align: "center" as const,
  height: 26,
});
const text = (value: string) => ({ value, type: String, wrap: true });
const number = (value: number, format = "#,##0") => ({ value, type: Number, format });
const boolean = (value: boolean) => ({ value, type: Boolean });
const date = (value: Date, format = "yyyy-mm-dd") => ({ value, type: Date, format });

function calendarDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoWeekStart(period: string): Date {
  const [yearValue, weekValue] = period.replace("W", "").split("-").map(Number);
  const januaryFourth = new Date(Date.UTC(yearValue, 0, 4));
  const day = januaryFourth.getUTCDay() || 7;
  januaryFourth.setUTCDate(januaryFourth.getUTCDate() - day + 1 + (weekValue - 1) * 7);
  return januaryFourth;
}

function periodStart(period: string): Date {
  if (/^\d{4}-W\d{2}$/.test(period)) return isoWeekStart(period);
  if (/^\d{4}-\d{2}$/.test(period)) return calendarDate(`${period}-01`);
  return calendarDate(period);
}

const widths = (...values: number[]): Columns => values.map((width) => ({ width }));

export interface AnalysisExcelReport {
  data: SheetData[];
  sheets: ["Summary", "Yield", "Utilization", "Downtime", "Defects"];
  options: {
    columns: Columns[];
    stickyRowsCount: number;
    showGridLines: boolean;
    dateFormat: string;
    fontFamily: string;
    fontSize: number;
  };
}

export function analysisReportFilename(dataset: AnalysisDataset, extension: "xlsx" | "pdf"): string {
  return `smd-report_${dataset.filters.from}_${dataset.filters.to}.${extension}`;
}

export function buildAnalysisExcelReport(
  dataset: AnalysisDataset,
  language: Language,
  generatedAt = new Date(),
): AnalysisExcelReport {
  const label = labels[language];
  const filterValue = (value: string | null) => value ?? label.all;
  const summary: SheetData = [
    [{
      value: label.title,
      type: String,
      span: 2,
      fontWeight: "bold",
      fontSize: 16,
      color: "#FFFFFF",
      backgroundColor: "#123A5A",
      align: "left",
      height: 32,
    }],
    [header("Filter / Metadata"), header("Value")],
    [text(label.from), date(calendarDate(dataset.filters.from))],
    [text(label.to), date(calendarDate(dataset.filters.to))],
    [text(label.groupBy), text(dataset.filters.groupBy)],
    [text(label.shift), text(filterValue(dataset.filters.shiftId))],
    [text(label.model), text(filterValue(dataset.filters.modelId))],
    [text(label.line), text(filterValue(dataset.filters.lineId))],
    [text(label.process), text(filterValue(dataset.filters.processCode))],
    [text(label.generatedAt), date(generatedAt, "yyyy-mm-dd hh:mm:ss")],
    [text(label.generatedBy), text(dataset.generatedBy)],
  ];
  const yieldSheet: SheetData = [
    [label.periodDate, label.period, label.input, label.ok, label.yield, label.target, label.below].map(header),
    ...dataset.yieldSeries.map((row): Row => [
      date(periodStart(row.period)),
      text(row.period),
      number(row.inputQty),
      number(row.okQty),
      number(row.inputQty === 0 ? 0 : (row.okQty / row.inputQty) * 100, "0.0"),
      row.target === null ? null : number(row.target, "0.0"),
      boolean(row.belowTarget),
    ]),
  ];
  const utilization: SheetData = [
    [label.periodDate, label.period, label.actual, label.productive, label.net, label.utilization].map(header),
    ...dataset.utilizationSeries.map((row): Row => [
      date(periodStart(row.period)),
      text(row.period),
      number(row.actualQty),
      number(row.productiveSeconds),
      number(row.netSeconds),
      row.utilizationPercent === null ? null : number(row.utilizationPercent, "0.0"),
    ]),
  ];
  const downtime: SheetData = [
    [label.reason, label.minutes, label.lostUnits].map(header),
    ...dataset.downtime.map((row): Row => [
      text(row.reason),
      number(row.minutes),
      number(row.lostUnits, "#,##0.0"),
    ]),
  ];
  const defects: SheetData = [
    [label.defect, label.classification, label.quantity].map(header),
    ...dataset.defects.map((row): Row => [
      text(row.type),
      text(label[row.classification]),
      number(row.quantity),
    ]),
  ];
  return {
    data: [summary, yieldSheet, utilization, downtime, defects],
    sheets: ["Summary", "Yield", "Utilization", "Downtime", "Defects"],
    options: {
      columns: [
        widths(24, 38),
        widths(16, 16, 16, 16, 14, 14, 14),
        widths(16, 16, 16, 24, 22, 16),
        widths(34, 20, 20),
        widths(34, 20, 16),
      ],
      stickyRowsCount: 1,
      showGridLines: false,
      dateFormat: "yyyy-mm-dd",
      fontFamily: "Arial",
      fontSize: 10,
    },
  };
}

export async function downloadAnalysisExcel(dataset: AnalysisDataset, language: Language): Promise<void> {
  const report = buildAnalysisExcelReport(dataset, language);
  const { default: writeXlsxFile } = await import("write-excel-file");
  await writeXlsxFile(report.data, {
    ...report.options,
    sheets: report.sheets,
    fileName: analysisReportFilename(dataset, "xlsx"),
  });
}
