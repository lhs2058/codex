import type { WorkbookSheet } from "./contracts";

const plain = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d").trim();
const label = (value: unknown) => plain(value).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();

export type ProductionGroupedLayout = { titleRow: number; groupRow: number; timeRow: number; subheaderRow: number; dataStartRow: number; shiftColumn: number | null; lineColumn: number; modelColumn: number; slots: Array<{ actualColumn: number; downtimeColumn: number; noteColumn: number }> };

export function findProductionGroupedLayout(sheet: WorkbookSheet): ProductionGroupedLayout | null {
  if (!/^\d{2}\.\d{1,2}$/.test(sheet.sheet)) return null;
  const titleRow = sheet.data.findIndex((row) => row.some((cell) => /bao cao san luong.*ngay/.test(plain(cell))));
  if (titleRow < 0) return null;
  const groupRow = sheet.data.findIndex((row, index) => index > titleRow && row.some((cell) => /san luong tung time/.test(plain(cell))));
  const timeRow = sheet.data.findIndex((row, index) => index > groupRow && ["a", "b", "c", "d", "e"].every((slot) => row.some((cell) => new RegExp(`^time\\s*${slot}\\b`).test(label(cell)))));
  const subheaderRow = sheet.data.findIndex((row, index) =>
    index > timeRow && row.filter((cell) => /san luong thuc te/.test(plain(cell))).length >= 5);
  if (groupRow < 0 || timeRow < 0 || subheaderRow < 0) return null;
  const metadataRow = sheet.data[groupRow] ?? [];
  const discoveredShiftColumn = metadataRow.findIndex((cell) => ["shift", "ca"].includes(label(cell)));
  const shiftColumn = discoveredShiftColumn >= 0 ? discoveredShiftColumn : null;
  const explicitLineColumn = metadataRow.findIndex((cell) => label(cell) === "line");
  const firstModelColumn = metadataRow.findIndex((cell) => label(cell) === "model");
  const lineColumn = explicitLineColumn >= 0 ? explicitLineColumn : firstModelColumn;
  const modelColumn = explicitLineColumn >= 0 ? metadataRow.findIndex((cell, index) => index > explicitLineColumn && label(cell) === "model") : firstModelColumn + 1;
  const slots = ["a", "b", "c", "d", "e"].map((slot) => {
    const start = (sheet.data[timeRow] ?? []).findIndex((cell) => new RegExp(`^time\\s*${slot}\\b`).test(label(cell)));
    const row = sheet.data[subheaderRow] ?? [];
    const timeHeaders = sheet.data[timeRow] ?? [];
    const inSlot = (_cell: unknown, column: number) => column >= start && column < start + 5;
    const downtimeColumn = row.findIndex((cell, column) => inSlot(cell, column) && /dung\s+may/.test(plain(cell)));
    const noteColumn = row.findIndex((cell, column) => inSlot(cell, column) && /ghi chu/.test(plain(cell)));
    return {
      actualColumn: row.findIndex((cell, column) => inSlot(cell, column) && /san luong thuc te/.test(plain(cell))),
      downtimeColumn: downtimeColumn >= 0
        ? downtimeColumn
        : timeHeaders.findIndex((cell, column) => inSlot(cell, column) && /dung\s+may/.test(plain(cell))),
      noteColumn: noteColumn >= 0
        ? noteColumn
        : timeHeaders.findIndex((cell, column) => inSlot(cell, column) && /ghi chu/.test(plain(cell))),
    };
  });
  if (lineColumn < 0 || modelColumn < 0 || slots.some((slot) => Object.values(slot).some((column) => column < 0))) return null;
  return { titleRow, groupRow, timeRow, subheaderRow, dataStartRow: subheaderRow + 1, shiftColumn, lineColumn, modelColumn, slots };
}
