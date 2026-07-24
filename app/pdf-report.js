import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

import { downloadBlob } from "./excel-report.js";

export const buildPdfReportBlob = async (element) => {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const canvas = await html2canvas(element, {
    backgroundColor: "#ffffff",
    scale: 2,
    logging: false,
    useCORS: false,
  });

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 10;
  const maxWidth = pageWidth - margin * 2;
  const maxHeight = pageHeight - margin * 2;
  const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
  const width = canvas.width * scale;
  const height = canvas.height * scale;
  const x = (pageWidth - width) / 2;
  const y = (pageHeight - height) / 2;

  pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, width, height, undefined, "FAST");
  return pdf.output("blob");
};

export const downloadPdfReport = async (element, date) => {
  const blob = await buildPdfReportBlob(element);
  downloadBlob(blob, `ACM_일일_출근_현황_${date}.pdf`);
};
