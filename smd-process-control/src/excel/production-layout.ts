import type { WorkbookSheet } from "./contracts";

const plain = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const label = (value: unknown) => plain(value).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();

export type ProductionGroupedLayout = { titleRow: number; groupRow: number; timeRow: number; subheaderRow: number; dataStartRow: number; lineColumn: number; modelColumn: number; slots: Array<{ actualColumn: number; downtimeColumn: number; noteColumn: number }> };

export function findProductionGroupedLayout(sheet: WorkbookSheet): ProductionGroupedLayout | null {
  if (!/^\d{2}\.\d{2}$/.test(sheet.sheet)) return null;
  const titleRow = sheet.data.findIndex((row) => row.some((cell) => /bao cao san luong.*ngay/.test(plain(cell))));
  if (titleRow < 0) return null;
  const groupRow = sheet.data.findIndex((row, index) => index > titleRow && row.some((cell) => /san luong tung time/.test(plain(cell))));
  const timeRow = sheet.data.findIndex((row, index) => index > groupRow && ["a", "b", "c", "d", "e"].every((slot) => row.some((cell) => new RegExp(`^time\\s*${slot}$`).test(label(cell)))));
  const subheaderRow = sheet.data.findIndex((row, index) => index > timeRow && row.filter((cell) => /san luong thuc te|dung may|ghi chu/.test(plain(cell))).length >= 3);
  if (groupRow < 0 || timeRow < 0 || subheaderRow < 0) return null;
  const metadataRow = sheet.data[groupRow] ?? [];
  const explicitLineColumn = metadataRow.findIndex((cell) => label(cell) === "line");
  const firstModelColumn = metadataRow.findIndex((cell) => label(cell) === "model");
  const lineColumn = explicitLineColumn >= 0 ? explicitLineColumn : firstModelColumn;
  const modelColumn = explicitLineColumn >= 0 ? metadataRow.findIndex((cell, index) => index > explicitLineColumn && label(cell) === "model") : firstModelColumn + 1;
  const slots = ["a", "b", "c", "d", "e"].map((slot) => {
    const start = (sheet.data[timeRow] ?? []).findIndex((cell) => new RegExp(`^time\\s*${slot}$`).test(label(cell)));
    const row = sheet.data[subheaderRow] ?? [];
    return {
      actualColumn: row.findIndex((cell, column) => column >= start && column < start + 5 && /san luong thuc te/.test(plain(cell))),
      downtimeColumn: row.findIndex((cell, column) => column >= start && column < start + 5 && /dung may/.test(plain(cell))),
      noteColumn: row.findIndex((cell, column) => column >= start && column < start + 5 && /ghi chu/.test(plain(cell))),
    };
  });
  return { titleRow, groupRow, timeRow, subheaderRow, dataStartRow: subheaderRow + 1, lineColumn, modelColumn, slots };
}
