import type { SheetData } from "write-excel-file/browser";
import type { MasterDataSnapshot } from "../domain/types";

type SheetColumns = Array<{ width?: number }>;

export const PRODUCTION_HEADERS = [
  "Production Date",
  "Shift",
  "Time Slot",
  "Line",
  "Model",
  "Process",
  "Input",
  "Actual",
  "OK",
  "NG",
  "Downtime Minutes",
  "Downtime Reason",
  "Note",
] as const;

export const DEFECT_HEADERS = [
  "Production Row",
  "Defect Type",
  "Classification",
  "Quantity",
] as const;

const header = (value: string) => ({
  value,
  type: String,
  fontWeight: "bold" as const,
  textColor: "#FFFFFF",
  backgroundColor: "#0F766E",
  align: "center" as const,
  height: 24,
});
const textCell = (value?: string) => ({ value, type: String });
const numberCell = (value?: number) => ({ value, type: Number, format: "#,##0" });
const dateCell = (value?: Date) => ({ value, type: Date, format: "yyyy-mm-dd" });
const excelCalendarDate = (value: Date) => new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));

export interface StandardTemplateDefinition {
  data: SheetData[];
  sheets: ["Production", "Defects", "Reference"];
  options: {
    columns: SheetColumns[];
    stickyRowsCount: number;
    showGridLines: boolean;
    dateFormat: string;
    fontFamily: string;
    fontSize: number;
  };
}

export function buildStandardTemplate(
  masterData: MasterDataSnapshot,
  generatedAt = new Date(),
): StandardTemplateDefinition {
  const production: SheetData = [
    [{
      value: "SMD_STANDARD_V1",
      type: String,
      columnSpan: PRODUCTION_HEADERS.length,
      fontWeight: "bold",
      fontSize: 16,
      textColor: "#FFFFFF",
      backgroundColor: "#134E4A",
      align: "left",
      height: 30,
    }],
    PRODUCTION_HEADERS.map(header),
    [
      dateCell(),
      textCell(),
      textCell(),
      textCell(),
      textCell(),
      textCell(),
      numberCell(),
      numberCell(),
      numberCell(),
      numberCell(),
      numberCell(),
      textCell(),
      textCell(),
    ],
  ];

  const defects: SheetData = [
    DEFECT_HEADERS.map(header),
    [numberCell(), textCell(), textCell(), numberCell()],
  ];

  const referenceRows: Array<Array<string | Date | number | null>> = [
    ["Template Version", 1],
    ["Generated On", excelCalendarDate(generatedAt)],
    [],
    ["Category", "Code", "Name", "Shift Code", "Starts At", "Ends At"],
  ];
  const addReferences = (
    category: string,
    values: Array<{ code: string; name: string }>,
  ) => values.forEach((value) => referenceRows.push([category, value.code, value.name, null, null, null]));
  addReferences("Model", masterData.models.filter((item) => item.active));
  addReferences("Line", masterData.lines.filter((item) => item.active));
  addReferences("Process", masterData.processes.filter((item) => item.active));
  addReferences("Shift", masterData.shifts.filter((item) => item.active));
  const activeShiftCodes = new Map(masterData.shifts.filter((item) => item.active).map((item) => [item.id, item.code]));
  masterData.timeSlots
    .filter((item) => activeShiftCodes.has(item.shiftId))
    .forEach((item) => referenceRows.push(["Time Slot", item.code, item.code, activeShiftCodes.get(item.shiftId)!, item.startsAt, item.endsAt]));
  addReferences("Downtime Reason", masterData.downtimeReasons.filter((item) => item.active));

  const reference: SheetData = referenceRows.map((row, rowIndex) => row.map((value, columnIndex) => {
    if (rowIndex === 0 && columnIndex === 1) return numberCell(value as number);
    if (rowIndex === 1 && columnIndex === 1) return dateCell(value as Date);
    if (rowIndex === 3) return header(String(value));
    return value === null || value === undefined ? null : textCell(String(value));
  }));

  return {
    data: [production, defects, reference],
    sheets: ["Production", "Defects", "Reference"],
    options: {
      columns: [
        [14, 12, 14, 14, 18, 14, 12, 12, 12, 12, 20, 22, 30].map((width) => ({ width })),
        [16, 24, 18, 12].map((width) => ({ width })),
        [20, 20, 28, 16, 14, 14].map((width) => ({ width })),
      ],
      stickyRowsCount: 2,
      showGridLines: false,
      dateFormat: "yyyy-mm-dd",
      fontFamily: "Arial",
      fontSize: 11,
    },
  };
}

export async function downloadStandardTemplate(masterData: MasterDataSnapshot): Promise<void> {
  const template = buildStandardTemplate(masterData);
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const {
    columns,
    fontFamily,
    fontSize,
    ...sheetOptions
  } = template.options;
  await writeXlsxFile(
    template.data.map((data, index) => ({
      ...sheetOptions,
      data,
      sheet: template.sheets[index],
      columns: columns[index],
    })),
    { fontFamily, fontSize },
  ).toFile("SMD_STANDARD_V1.xlsx");
}
