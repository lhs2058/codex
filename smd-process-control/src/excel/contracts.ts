import type {
  ImportDiagnostic,
  NormalizedImportRow as LegacyNormalizedImportRow,
  WorkbookKind,
} from "../domain/types";

export type {
  ImportDiagnostic,
  ImportRowErrorCode,
  WorkbookDetection,
  WorkbookDiagnostic,
  WorkbookDiagnosticCode,
  WorkbookKind,
  WorkbookSheet,
} from "../domain/types";

export type ImportWarningCode = "legacy-downtime-reason-unspecified";
export type DefectClassification = "pseudo" | "real" | "scrap";

export interface NormalizedDefectRow {
  sourceSheet: "Defects";
  sourceRow: number;
  productionSourceRow: number;
  defectType: string;
  classification: DefectClassification;
  quantity: number;
}

export interface ImportDimensions {
  production: { inputQty: number; actualQty: number } | null;
  quality: { inputQty: number; okQty: number; ngQty: number } | null;
}

export interface NormalizedImportRow extends LegacyNormalizedImportRow {
  dimensions: ImportDimensions;
  warnings: ImportWarningCode[];
  defects: NormalizedDefectRow[];
}

export interface ImportParseResult {
  kind: WorkbookKind;
  rows: NormalizedImportRow[];
  diagnostics: ImportDiagnostic[];
}

export interface StagedUploadPayloadV2 {
  contractVersion: 2;
  sourceTrace: { sheet: string; row: number };
  productionDate: string;
  shiftCode: string;
  timeSlotCode: string | null;
  lineCode: string;
  modelCode: string;
  processCode: LegacyNormalizedImportRow["processCode"];
  note: string;
  production: ImportDimensions["production"];
  quality: ImportDimensions["quality"];
  downtime: { minutes: number; reasonCode: string } | null;
  defects: NormalizedDefectRow[];
  warnings: ImportWarningCode[];
}
