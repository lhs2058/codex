import type {
  ImportWarningCode,
  NormalizedImportRow,
} from "./contracts";

type BaseRow = Omit<NormalizedImportRow, "dimensions" | "warnings" | "defects">;

export function qualityOnlyRow(
  row: BaseRow,
): NormalizedImportRow {
  return {
    ...row,
    actualQty: 0,
    dimensions: {
      production: null,
      quality: {
        inputQty: row.inputQty,
        okQty: row.okQty,
        ngQty: row.ngQty,
      },
    },
    warnings: [],
    defects: [],
  };
}

export function productionOnlyRow(
  row: BaseRow,
  warnings: ImportWarningCode[] = [],
): NormalizedImportRow {
  return {
    ...row,
    dimensions: {
      production: {
        inputQty: row.inputQty,
        actualQty: row.actualQty,
      },
      quality: null,
    },
    warnings,
    defects: [],
  };
}

export function combinedRow(
  row: BaseRow,
): NormalizedImportRow {
  return {
    ...row,
    dimensions: {
      production: {
        inputQty: row.inputQty,
        actualQty: row.actualQty,
      },
      quality: {
        inputQty: row.inputQty,
        okQty: row.okQty,
        ngQty: row.ngQty,
      },
    },
    warnings: [],
    defects: [],
  };
}
