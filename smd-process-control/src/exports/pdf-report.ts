import type { jsPDF } from "jspdf";
import type { AnalysisDataset } from "../domain/types";
import { analysisReportFilename } from "./excel-report";

type Language = "ko" | "vi";
type PdfLabels = {
  title: string;
  filters: string;
  generatedAt: string;
  generatedBy: string;
  yield: string;
  utilization: string;
  processLine: string;
  timeSlot: string;
  downtime: string;
  defects: string;
  period: string;
  input: string;
  ok: string;
  target: string;
  below: string;
  actual: string;
  rate: string;
  reason: string;
  minutes: string;
  loss: string;
  type: string;
  classification: string;
  quantity: string;
  page: string;
  all: string;
};

const labels: Record<Language, PdfLabels> = {
  ko: {
    title: "SMD 공정 분석 보고서",
    filters: "필터",
    generatedAt: "생성 시각",
    generatedBy: "생성 사용자",
    yield: "수율 추이",
    utilization: "가동률 추이",
    processLine: "공정·라인 비교",
    timeSlot: "시간대 실적·가동률",
    downtime: "비가동 손실",
    defects: "불량 상세",
    period: "기간",
    input: "투입(EA)",
    ok: "양품(EA)",
    target: "목표(%)",
    below: "미달",
    actual: "실적(EA)",
    rate: "비율(%)",
    reason: "사유",
    minutes: "분",
    loss: "손실(EA)",
    type: "불량 유형",
    classification: "분류",
    quantity: "수량(EA)",
    page: "페이지",
    all: "전체",
  },
  vi: {
    title: "Báo cáo phân tích quy trình SMD",
    filters: "Bộ lọc",
    generatedAt: "Thời gian tạo",
    generatedBy: "Người tạo",
    yield: "Xu hướng tỷ lệ đạt",
    utilization: "Xu hướng hiệu suất",
    processLine: "So sánh công đoạn·chuyền",
    timeSlot: "Sản lượng·hiệu suất theo khung giờ",
    downtime: "Tổn thất dừng máy",
    defects: "Chi tiết lỗi",
    period: "Kỳ",
    input: "Đầu vào(EA)",
    ok: "Đạt(EA)",
    target: "Mục tiêu(%)",
    below: "Dưới MT",
    actual: "Sản lượng(EA)",
    rate: "Tỷ lệ(%)",
    reason: "Lý do",
    minutes: "Phút",
    loss: "Tổn thất(EA)",
    type: "Loại lỗi",
    classification: "Phân loại",
    quantity: "Số lượng(EA)",
    page: "Trang",
    all: "Tất cả",
  },
};

export function pdfReportLabels(language: Language): PdfLabels {
  return labels[language];
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let value = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    value += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(value);
}

async function loadBundledFont(): Promise<string> {
  const response = await fetch("/fonts/NotoSansKR-VF.ttf");
  if (!response.ok) throw new Error("report_font_load_failed");
  return arrayBufferToBase64(await response.arrayBuffer());
}

function formatPercent(value: number | null): string {
  return value === null ? "-" : value.toFixed(1);
}

function classification(value: AnalysisDataset["defects"][number]["classification"], language: Language): string {
  const translations = {
    ko: { real: "진성", pseudo: "가성", scrap: "폐기" },
    vi: { real: "Lỗi thật", pseudo: "Lỗi giả", scrap: "Phế phẩm" },
  };
  return translations[language][value];
}

export interface AnalysisPdfOptions {
  generatedAt?: Date;
  fontBase64?: string | null;
}

export async function buildAnalysisPdfDocument(
  dataset: AnalysisDataset,
  language: Language,
  options: AnalysisPdfOptions = {},
): Promise<jsPDF> {
  const label = labels[language];
  const generatedAt = options.generatedAt ?? new Date();
  const fontBase64 = options.fontBase64 === undefined ? await loadBundledFont() : options.fontBase64;
  const { jsPDF: JsPdfDocument } = await import("jspdf");
  const document = new JsPdfDocument({ unit: "mm", format: "a4", putOnlyUsedFonts: true, compress: true });
  if (fontBase64) {
    document.addFileToVFS("NotoSansKR-VF.ttf", fontBase64);
    document.addFont("NotoSansKR-VF.ttf", "NotoSansReport", "normal");
    document.setFont("NotoSansReport", "normal");
  } else {
    document.setFont("helvetica", "normal");
  }
  document.setProperties({
    title: label.title,
    subject: `${dataset.filters.from} - ${dataset.filters.to}`,
    author: dataset.generatedBy,
    creator: "SMD CONTROL",
    keywords: `SMD,${language},yield,utilization,downtime,defects`,
  });
  document.setCreationDate(generatedAt);

  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  const bottom = pageHeight - 16;
  let y = margin;

  const addPage = () => {
    document.addPage();
    y = margin;
  };
  const ensure = (height: number) => {
    if (y + height > bottom) addPage();
  };
  const heading = (title: string, size = 13) => {
    ensure(size + 7);
    document.setFontSize(size);
    document.setTextColor(25, 62, 96);
    document.text(title, margin, y);
    y += size * .45 + 4;
  };
  const detail = (text: string) => {
    document.setFontSize(8.5);
    document.setTextColor(67, 79, 99);
    const lines = document.splitTextToSize(text, contentWidth);
    ensure(lines.length * 4 + 2);
    document.text(lines, margin, y);
    y += lines.length * 4 + 2;
  };
  const table = (title: string, headers: string[], rows: string[][], widths: number[]) => {
    heading(title);
    const drawHeader = () => {
      ensure(8);
      let x = margin;
      document.setFillColor(30, 78, 121);
      document.setTextColor(255, 255, 255);
      document.setFontSize(8);
      headers.forEach((header, index) => {
        document.setFillColor(30, 78, 121);
        document.rect(x, y, widths[index], 8, "F");
        document.setTextColor(255, 255, 255);
        document.text(document.splitTextToSize(header, widths[index] - 4), x + 2, y + 5);
        x += widths[index];
      });
      y += 8;
    };
    const continueTable = () => {
      addPage();
      heading(title, 10);
      drawHeader();
    };
    drawHeader();
    rows.forEach((row, rowIndex) => {
      const remaining = row.map((value, index) => {
        const lines = document.splitTextToSize(value, Math.max(5, widths[index] - 4)) as string[];
        return lines.length > 0 ? [...lines] : [""];
      });
      while (remaining.some((lines) => lines.length > 0)) {
        let available = bottom - y;
        let lineCapacity = Math.floor((available - 3) / 4);
        if (lineCapacity < 1 || available < 7) {
          continueTable();
          available = bottom - y;
          lineCapacity = Math.max(1, Math.floor((available - 3) / 4));
        }
        const cells = remaining.map((lines) => lines.splice(0, lineCapacity));
        const height = Math.max(7, ...cells.map((lines) => lines.length * 4 + 3));
        let x = margin;
        document.setDrawColor(220, 227, 235);
        document.setTextColor(46, 57, 73);
        document.setFontSize(8);
        cells.forEach((lines, index) => {
          document.setFillColor(rowIndex % 2 === 0 ? 246 : 255, rowIndex % 2 === 0 ? 249 : 255, rowIndex % 2 === 0 ? 252 : 255);
          document.rect(x, y, widths[index], height, "FD");
          document.setTextColor(46, 57, 73);
          if (lines.length > 0) document.text(lines, x + 2, y + 4.5);
          x += widths[index];
        });
        y += height;
        if (remaining.some((lines) => lines.length > 0)) continueTable();
      }
    });
    y += 5;
  };

  document.setFillColor(18, 58, 90);
  document.rect(0, 0, pageWidth, 34, "F");
  document.setTextColor(255, 255, 255);
  document.setFontSize(18);
  document.text(label.title, margin, 18);
  document.setFontSize(9);
  document.text(`${dataset.filters.from} - ${dataset.filters.to}`, margin, 26);
  y = 42;
  heading(label.filters, 11);
  const filter = (value: string | null) => value ?? label.all;
  detail([
    `${label.period}: ${dataset.filters.from} - ${dataset.filters.to} (${dataset.filters.groupBy})`,
    `Process: ${filter(dataset.filters.processCode)} / Line: ${filter(dataset.filters.lineId)} / Model: ${filter(dataset.filters.modelId)} / Shift: ${filter(dataset.filters.shiftId)}`,
    `${label.generatedAt}: ${generatedAt.toISOString()} / ${label.generatedBy}: ${dataset.generatedBy}`,
  ].join("\n"));

  table(label.yield,
    [label.period, label.input, label.ok, label.rate, label.target, label.below],
    dataset.yieldSeries.map((row) => [
      row.period,
      String(row.inputQty),
      String(row.okQty),
      row.inputQty === 0 ? "-" : ((row.okQty / row.inputQty) * 100).toFixed(1),
      formatPercent(row.target),
      row.belowTarget ? "!" : "",
    ]),
    [35, 30, 30, 28, 28, 29]);
  table(label.utilization,
    [label.period, label.actual, "Productive(s)", "Net(s)", label.rate],
    dataset.utilizationSeries.map((row) => [
      row.period,
      String(row.actualQty),
      String(row.productiveSeconds),
      String(row.netSeconds),
      formatPercent(row.utilizationPercent),
    ]),
    [40, 35, 38, 35, 32]);
  table(label.processLine,
    ["Process", "Line", label.input, label.ok, label.rate, label.target],
    dataset.processLines.map((row) => [
      row.processCode,
      row.lineCode,
      String(row.inputQty),
      String(row.okQty),
      formatPercent(row.yieldPercent),
      formatPercent(row.target),
    ]),
    [32, 30, 30, 30, 29, 29]);
  table(label.timeSlot,
    ["Slot", label.actual, "Productive(s)", "Net(s)", label.rate],
    dataset.timeSlots.map((row) => [
      row.timeSlotCode,
      String(row.actualQty),
      String(row.productiveSeconds),
      String(row.netSeconds),
      formatPercent(row.utilizationPercent),
    ]),
    [34, 36, 40, 36, 34]);
  table(label.downtime,
    [label.reason, label.minutes, label.loss],
    dataset.downtime.map((row) => [row.reason, String(row.minutes), row.lostUnits.toFixed(1)]),
    [100, 35, 45]);
  table(label.defects,
    [label.type, label.classification, label.quantity],
    dataset.defects.map((row) => [row.type, classification(row.classification, language), String(row.quantity)]),
    [100, 45, 35]);

  const pages = document.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    document.setPage(page);
    document.setFontSize(8);
    document.setTextColor(105, 116, 132);
    document.text(`${label.page} ${page} / ${pages}`, pageWidth - margin, pageHeight - 8, { align: "right" });
  }
  return document;
}

export async function downloadAnalysisPdf(dataset: AnalysisDataset, language: Language): Promise<void> {
  const document = await buildAnalysisPdfDocument(dataset, language);
  document.save(analysisReportFilename(dataset, "pdf"));
}
